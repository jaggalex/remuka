import { STICKER_HOVER, STICKER_SETTLE, hoverHand, settleHand } from "@remo/canvas";

/**
 * Which sheets are in hand, and how much (ADR-265 §4.2, `spec/character.md`).
 *
 * The painter is a pure function of time; this class is the clock it reads. Every frame
 * the canvas feeds it the current hover and the ids being dragged, and asks "how much is
 * this note in hand now". A note the pointer left falls straight back to rest; a note that
 * was released settles on the owner's spring with one small press into the table.
 *
 * No React, no DOM: the frame loop owns the timing, so a skipped frame does not make the
 * note jump and a still room costs nothing (`moving` is false once every sheet rests).
 */
export class ObjectHand {
  private hoverId: string | null = null;
  private hoverFrom = 0;
  private dragging: string[] = [];
  private previousDrag: string[] = [];
  private settledAt = new Map<string, number>();
  private calm = false;

  /** Feed the current pointer and drag state; called once per painted frame. */
  update(
    now: number,
    input: { hoverId: string | null; dragIds: readonly string[]; calm: boolean },
  ): void {
    if (input.hoverId !== this.hoverId) {
      this.hoverId = input.hoverId;
      this.hoverFrom = now;
    }
    this.calm = input.calm;
    // A carried note that is no longer carried was just released: start its settle here,
    // where the frame knows both lists, not in the gesture handler.
    for (const id of this.previousDrag) {
      if (!input.dragIds.includes(id)) this.settledAt.set(id, now);
    }
    for (const id of input.dragIds) this.settledAt.delete(id);
    this.previousDrag = [...input.dragIds];
    this.dragging = [...input.dragIds];
  }

  /** How much the note with this id is in hand at `now`; 0 at rest. */
  handOf(id: string, now: number): number {
    if (this.calm) return 0;
    if (this.dragging.includes(id)) return 1;
    if (this.hoverId === id) return hoverHand(now - this.hoverFrom);
    const released = this.settledAt.get(id);
    if (released === undefined) return 0;
    const age = now - released;
    if (age >= STICKER_SETTLE.ms) {
      this.settledAt.delete(id);
      return 0;
    }
    return settleHand(age);
  }

  /** Some sheet is still lifting or settling: paint another frame. */
  moving(now: number): boolean {
    if (this.calm) return false;
    if (this.hoverId !== null && now - this.hoverFrom < STICKER_HOVER.ms) return true;
    for (const at of this.settledAt.values()) if (now - at < STICKER_SETTLE.ms) return true;
    return false;
  }

  /** Forget everything: a room switch must not settle a note from another room. */
  reset(): void {
    this.hoverId = null;
    this.dragging = [];
    this.previousDrag = [];
    this.settledAt.clear();
  }
}
