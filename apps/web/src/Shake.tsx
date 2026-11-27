import { useEffect, useRef, type ReactNode } from "react";

/**
 * The frame of a form that shakes its head once when a submit is refused
 * (ADR-265 §4.2, `spec/character.md` §4.2).
 *
 * `token` is bumped by the screen on every refusal. The class is re-applied to the same
 * element rather than remounting it, so the fields keep focus and their value; the CSS
 * removes the movement under `prefers-reduced-motion` and `data-motion="calm"`. A count of
 * zero means "nothing refused yet" and never animates.
 */
export function Shake({
  token,
  className,
  children,
}: {
  /** Increments on each refusal; zero is the untouched form. */
  token: number;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element || token === 0) return;
    element.classList.remove("is-shaking");
    // Reading the layout restarts a CSS animation that is already on the element.
    void element.offsetWidth;
    element.classList.add("is-shaking");
  }, [token]);

  return (
    <div
      ref={ref}
      className={["rm-shake", className].filter(Boolean).join(" ")}
      data-shake={token}
      onAnimationEnd={(event) => {
        if (event.target === ref.current) ref.current?.classList.remove("is-shaking");
      }}
    >
      {children}
    </div>
  );
}
