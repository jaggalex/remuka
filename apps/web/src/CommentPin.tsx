import { useRef, useState, type CSSProperties, type PointerEvent } from "react";
import type { Vec2 } from "@remo/model";
import type { CommentThread } from "./commentsApi";

export function CommentPin({ thread, point, active, movable, label, title, colour, letter, onOpen, onDrop }: {
  thread: CommentThread; point: Vec2; active: boolean; movable: boolean; label: string; title: string;
  colour: string; letter: string; onOpen: () => void; onDrop: (clientX: number, clientY: number) => void;
}) {
  const start = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const skipClick = useRef(false);
  const [preview, setPreview] = useState<Vec2 | null>(null);
  function move(event: PointerEvent<HTMLButtonElement>) {
    const drag = start.current;
    if (!drag || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 4 && !drag.moved) return;
    drag.moved = true;
    const box = event.currentTarget.parentElement!.getBoundingClientRect();
    setPreview({ x: event.clientX - box.left, y: event.clientY - box.top });
  }
  function end(event: PointerEvent<HTMLButtonElement>, cancelled: boolean) {
    const drag = start.current;
    start.current = null;
    setPreview(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!drag?.moved) return;
    skipClick.current = true;
    if (!cancelled) onDrop(event.clientX, event.clientY);
  }
  return <button type="button" data-movable={movable} data-thread-id={thread.id}
    className={`comment-pin${active ? " active" : ""}${thread.unread ? " unread" : ""}`}
    style={{ left: (preview ?? point).x, top: (preview ?? point).y, "--pin-color": colour } as CSSProperties}
    title={title} aria-label={label}
    onPointerDown={event => {
      if (event.button !== 0 || !event.isPrimary) return;
      skipClick.current = false;
      if (!movable) return;
      start.current = { x: event.clientX, y: event.clientY, moved: false };
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={move} onPointerUp={event => end(event, false)}
    onPointerCancel={event => end(event, true)}
    onLostPointerCapture={() => { start.current = null; setPreview(null); }}
    onClick={event => {
      if (skipClick.current && event.detail !== 0) { skipClick.current = false; return; }
      onOpen();
    }}>
    <span className="comment-pin-letter" aria-hidden="true">{letter}</span>
    {thread.unread > 0 && <span className="comment-pin-count">{thread.unread}</span>}
  </button>;
}
