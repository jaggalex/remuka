/**
 * A one-line trend for a Pulse tile (`spec/pulse.md` §6: one axis, no legend).
 *
 * Drawn with the design system's current colour so the theme decides the line; the
 * numbers are also printed beside it, which is what a screen reader reads.
 */
export function Sparkline({
  values,
  label,
  width = 132,
  height = 32,
}: {
  values: number[];
  label: string;
  width?: number;
  height?: number;
}) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const step = width / (values.length - 1);
  const points = values.map((value, index) => {
    const x = index * step;
    const y = height - ((value - min) / span) * (height - 2) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg
      className="operator-spark"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label={label}
      preserveAspectRatio="none"
    >
      <polyline points={points.join(" ")} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
