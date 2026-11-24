/**
 * How another person's cursor moves (ADR-265, `spec/character.md` §4.1).
 *
 * Awareness delivers a cursor a few times a second. Drawn where it last arrived, it jumps.
 * Here every peer's cursor is a point on a damped spring that chases the position the peer
 * had BUFFER_MS ago, interpolated between the samples that arrived. The spring gives the
 * motion a hand's weight — it gathers speed and eases in — and the buffer hides network
 * jitter. The owner chose stiffness 125 and damping 23 on the prototype: just above critical
 * damping (2·√125 ≈ 22.4), so a cursor never overshoots its target.
 *
 * Pure: no React, no DOM, no clock of its own. The overlay painter feeds it presence and
 * the frame time, asks where to draw, and keeps painting while `step` says it moves.
 */

export const CURSOR_SPRING = { stiffness: 125, damping: 23 } as const;
/** How far behind the latest sample the spring aims, in ms. */
export const CURSOR_BUFFER_MS = 100;
/** A still cursor dims after this long, and hides after IDLE_HIDE_MS. */
export const CURSOR_IDLE_DIM_MS = 10_000;
export const CURSOR_IDLE_HIDE_MS = 60_000;
export const CURSOR_IDLE_ALPHA = 0.4;
/** Fade in after a teleport, a reappearance or a new peer. */
export const CURSOR_FADE_IN_MS = 150;
/** The longest step the integrator takes; a background tab must not fling cursors. */
const MAX_DT = 1 / 30;
/**
 * A cursor that was still and then moves: awareness only tells us where it is now. The move
 * is assumed to have taken one typical update interval, so the spring does not start drifting
 * towards the new point from the moment of the previous, long-stale sample.
 */
const STILL_GAP_MS = 50;
/** Samples kept per peer: enough for the buffer at any realistic update rate. */
const MAX_SAMPLES = 12;

interface Sample {
  t: number;
  x: number;
  y: number;
}

interface Track {
  samples: Sample[];
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Frame time of the last sample that moved. */
  movedAt: number;
  /** When the cursor last (re)appeared, for the fade-in. */
  shownAt: number;
  lastStep: number | null;
}

export interface CursorView {
  x: number;
  y: number;
  /** 0…1; 0 means do not draw. */
  alpha: number;
}

export interface StepOptions {
  /** Board units per screen pixel inverse: the camera zoom. Settling is judged on screen. */
  zoom: number;
  /** A jump longer than this (board units) is a teleport, not a flight. */
  teleport: number;
  /** prefers-reduced-motion or "calm animations": no spring, no buffer, no fades. */
  reduced: boolean;
}

export interface StepResult {
  /** Some cursor is still travelling or fading: paint the next frame too. */
  moving: boolean;
  /** Milliseconds until an idle threshold changes how a still cursor looks, or null. */
  wakeIn: number | null;
}

export interface CursorPeer {
  sessionKey: string;
  self: boolean;
  cursor: { x: number; y: number } | null;
}

export class CursorMotion {
  private tracks = new Map<string, Track>();

  /** Record the latest presence. Only a changed position becomes a sample. */
  ingest(peers: readonly CursorPeer[], now: number): void {
    const seen = new Set<string>();
    for (const peer of peers) {
      if (peer.self || !peer.cursor) continue;
      seen.add(peer.sessionKey);
      const { x, y } = peer.cursor;
      const track = this.tracks.get(peer.sessionKey);
      if (!track) {
        this.tracks.set(peer.sessionKey, {
          samples: [{ t: now, x, y }],
          x,
          y,
          vx: 0,
          vy: 0,
          movedAt: now,
          shownAt: now,
          lastStep: null,
        });
        continue;
      }
      const last = track.samples[track.samples.length - 1];
      if (last && last.x === x && last.y === y) continue;
      if (now - track.movedAt >= CURSOR_IDLE_HIDE_MS) track.shownAt = now;
      if (last && now - last.t > CURSOR_BUFFER_MS) track.samples.push({ t: now - STILL_GAP_MS, x: last.x, y: last.y });
      track.samples.push({ t: now, x, y });
      if (track.samples.length > MAX_SAMPLES) track.samples.splice(0, track.samples.length - MAX_SAMPLES);
      track.movedAt = now;
    }
    for (const key of [...this.tracks.keys()]) if (!seen.has(key)) this.tracks.delete(key);
  }

  /** Advance every spring to `now`. */
  step(now: number, options: StepOptions): StepResult {
    let moving = false;
    let wakeIn: number | null = null;
    const settle = 0.25 / Math.max(options.zoom, 1e-6);
    for (const track of this.tracks.values()) {
      const target = targetAt(track.samples, now - (options.reduced ? 0 : CURSOR_BUFFER_MS));
      const dt = track.lastStep === null ? 0 : Math.min(MAX_DT, Math.max(0, (now - track.lastStep) / 1000));
      track.lastStep = now;
      if (options.reduced) {
        track.x = target.x;
        track.y = target.y;
        track.vx = 0;
        track.vy = 0;
      } else if (Math.hypot(target.x - track.x, target.y - track.y) > options.teleport) {
        track.x = target.x;
        track.y = target.y;
        track.vx = 0;
        track.vy = 0;
        track.shownAt = now;
      } else if (dt > 0) {
        const { stiffness: k, damping: c } = CURSOR_SPRING;
        // Semi-implicit Euler: velocity first, then position — stable at these constants.
        track.vx += (k * (target.x - track.x) - c * track.vx) * dt;
        track.vy += (k * (target.y - track.y) - c * track.vy) * dt;
        track.x += track.vx * dt;
        track.y += track.vy * dt;
      }
      const latest = track.samples[track.samples.length - 1]!;
      const travelling =
        Math.abs(latest.x - track.x) > settle ||
        Math.abs(latest.y - track.y) > settle ||
        Math.hypot(track.vx, track.vy) > settle * 10;
      if (!options.reduced && (travelling || now - track.shownAt < CURSOR_FADE_IN_MS)) moving = true;
      if (!travelling && !options.reduced) {
        // A settled cursor snaps the last fraction of a pixel, so it rests exactly on target.
        track.x = latest.x;
        track.y = latest.y;
        track.vx = 0;
        track.vy = 0;
      }
      const idle = now - track.movedAt;
      for (const edge of [CURSOR_IDLE_DIM_MS, CURSOR_IDLE_HIDE_MS]) {
        if (idle < edge) wakeIn = wakeIn === null ? edge - idle : Math.min(wakeIn, edge - idle);
      }
    }
    return { moving, wakeIn };
  }

  /** Where to draw a peer's cursor, and how opaque; null when it has none. */
  view(sessionKey: string, now: number, reduced = false): CursorView | null {
    const track = this.tracks.get(sessionKey);
    if (!track) return null;
    const idle = now - track.movedAt;
    let alpha = idle >= CURSOR_IDLE_HIDE_MS ? 0 : idle >= CURSOR_IDLE_DIM_MS ? CURSOR_IDLE_ALPHA : 1;
    if (!reduced && alpha > 0) alpha *= Math.min(1, Math.max(0, (now - track.shownAt) / CURSOR_FADE_IN_MS));
    return { x: track.x, y: track.y, alpha };
  }
}

/** The position the peer had at `t`, interpolated between the two samples around it. */
function targetAt(samples: readonly Sample[], t: number): { x: number; y: number } {
  const last = samples[samples.length - 1]!;
  if (t >= last.t) return last;
  for (let i = samples.length - 1; i > 0; i -= 1) {
    const b = samples[i]!;
    const a = samples[i - 1]!;
    if (t >= a.t) {
      const f = b.t === a.t ? 1 : (t - a.t) / (b.t - a.t);
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    }
  }
  return samples[0]!;
}
