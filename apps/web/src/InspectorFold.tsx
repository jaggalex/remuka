import { useEffect, useState, type ReactNode } from "react";
import { Icon } from "@remo/ui";

/**
 * A rare group folded to one row (ADR-236, sketch D4): its name, what it holds now
 * ("нет" when empty) and a chevron. One disclosure pattern for the whole panel, so
 * there is no second kind of "+" or "▸" to learn.
 */
export function InspectorFold({
  label,
  value,
  className,
  open = false,
  children,
}: {
  label: string;
  value: string;
  className?: string;
  /** A card, a section or a kanban has no frequent block: its fields are the subject. */
  open?: boolean;
  children: ReactNode;
}) {
  const [shown, setShown] = useState(open);
  useEffect(() => setShown(open), [open]);

  return (
    <details
      className={`inspector-fold${className ? ` ${className}` : ""}`}
      open={shown}
      onToggle={(event) => setShown(event.currentTarget.open)}
    >
      <summary onPointerDown={(event) => event.preventDefault()}>
        <span className="inspector-fold-label">{label}</span>
        <span className="inspector-fold-value">{value}</span>
        <Icon name="chevron-right" size={16} />
      </summary>
      <div className="inspector-fold-body">{children}</div>
    </details>
  );
}
