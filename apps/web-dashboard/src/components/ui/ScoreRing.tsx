// ---------------------------------------------------------------------------
// ScoreRing — SVG circular gauge for a 0-1 risk score.
// ---------------------------------------------------------------------------

interface ScoreRingProps {
  score: number           // 0–1
  size?: number           // px diameter
  strokeWidth?: number
}

function ringColor(score: number): string {
  if (score >= 0.75) return '#f87171'  // red-400
  if (score >= 0.55) return '#fb923c'  // orange-400
  if (score >= 0.35) return '#facc15'  // yellow-400
  return '#34d399'                      // emerald-400
}

export function ScoreRing({ score, size = 80, strokeWidth = 8 }: ScoreRingProps) {
  const r = (size - strokeWidth) / 2
  const cx = size / 2
  const circumference = 2 * Math.PI * r
  const filled = Math.max(0, Math.min(1, score)) * circumference
  const color = ringColor(score)
  const pct = Math.round(score * 100)

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-label={`Risk score ${pct}%`}>
      <circle
        cx={cx} cy={cx} r={r}
        stroke="#27272a"
        strokeWidth={strokeWidth}
        fill="none"
      />
      <circle
        cx={cx} cy={cx} r={r}
        stroke={color}
        strokeWidth={strokeWidth}
        fill="none"
        strokeDasharray={`${filled} ${circumference}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cx})`}
        style={{ transition: 'stroke-dasharray 0.4s ease' }}
      />
      <text
        x={cx} y={cx}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={size * 0.22}
        fontWeight="600"
        fill={color}
      >
        {pct}%
      </text>
    </svg>
  )
}
