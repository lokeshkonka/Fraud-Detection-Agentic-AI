// ---------------------------------------------------------------------------
// FraudGraphCanvas — canvas 2D force-directed graph for fraud network viz.
// Zero extra dependencies. Uses requestAnimationFrame + spring physics.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState, useCallback } from 'react'
import type { GraphNode, GraphEdge } from '../../types/api'

interface Props {
  nodes: GraphNode[]
  edges: GraphEdge[]
  height?: number
}

interface SimNode {
  id: string
  label: string
  risk: number
  x: number
  y: number
  vx: number
  vy: number
  fx?: number
  fy?: number
}

function riskToColor(risk: number): string {
  if (risk >= 0.8) return '#f87171'   // red-400
  if (risk >= 0.6) return '#fb923c'   // orange-400
  if (risk >= 0.4) return '#fbbf24'   // amber-400
  return '#34d399'                     // emerald-400
}

function nodeRadius(risk: number): number {
  return 6 + risk * 10
}

const REPULSION = 1800
const SPRING_K = 0.04
const SPRING_LEN = 90
const DAMPING = 0.82
const GRAVITY = 0.008

export function FraudGraphCanvas({ nodes, edges, height = 420 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const simRef = useRef<SimNode[]>([])
  const rafRef = useRef<number>(0)
  const [selected, setSelected] = useState<SimNode | null>(null)

  // Build edge index for fast lookup
  const edgeIndex = useRef<Array<{ si: number; ti: number }>>([])

  // Initialise simulation when nodes/edges change
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const W = canvas.clientWidth || 640
    const H = height

    const sim: SimNode[] = nodes.slice(0, 150).map((n, i) => { // cap at 150 for smooth 60fps canvas rendering
      const angle = (i / Math.max(nodes.length, 1)) * Math.PI * 2
      const r = Math.min(W, H) * 0.3
      return {
        ...n,
        x: W / 2 + r * Math.cos(angle) + (Math.random() - 0.5) * 30,
        y: H / 2 + r * Math.sin(angle) + (Math.random() - 0.5) * 30,
        vx: 0,
        vy: 0,
      }
    })
    simRef.current = sim

    const idToIdx = new Map(sim.map((n, i) => [n.id, i]))
    edgeIndex.current = edges
      .slice(0, 400)  // cap at 400 edges — above this the per-frame O(edges) draw cost becomes visible
      .map((e) => ({ si: idToIdx.get(e.source) ?? -1, ti: idToIdx.get(e.target) ?? -1 }))
      .filter((e) => e.si >= 0 && e.ti >= 0)
  }, [nodes, edges, height])

  // Animation loop
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    function step() {
      const W = canvas!.width
      const H = canvas!.height
      const sim = simRef.current
      const eIdx = edgeIndex.current
      const cx = W / 2
      const cy = H / 2

      // Forces
      for (let i = 0; i < sim.length; i++) {
        const a = sim[i]
        if (a.fx !== undefined) continue
        // Gravity toward center
        a.vx += (cx - a.x) * GRAVITY
        a.vy += (cy - a.y) * GRAVITY
        // Repulsion from other nodes
        for (let j = i + 1; j < sim.length; j++) {
          const b = sim[j]
          const dx = a.x - b.x
          const dy = a.y - b.y
          const dist2 = dx * dx + dy * dy + 1
          const f = REPULSION / dist2
          const nx = dx / Math.sqrt(dist2)
          const ny = dy / Math.sqrt(dist2)
          a.vx += nx * f
          a.vy += ny * f
          b.vx -= nx * f
          b.vy -= ny * f
        }
      }

      // Spring forces on edges
      for (const e of eIdx) {
        const a = sim[e.si]
        const b = sim[e.ti]
        const dx = b.x - a.x
        const dy = b.y - a.y
        const dist = Math.sqrt(dx * dx + dy * dy) || 1
        const force = (dist - SPRING_LEN) * SPRING_K
        const fx = (dx / dist) * force
        const fy = (dy / dist) * force
        if (a.fx === undefined) { a.vx += fx; a.vy += fy }
        if (b.fx === undefined) { b.vx -= fx; b.vy -= fy }
      }

      // Integrate & clamp
      for (const n of sim) {
        if (n.fx !== undefined) { n.x = n.fx; n.y = n.fy!; continue }
        n.vx *= DAMPING
        n.vy *= DAMPING
        n.x = Math.max(14, Math.min(W - 14, n.x + n.vx))
        n.y = Math.max(14, Math.min(H - 14, n.y + n.vy))
      }

      // Draw
      ctx!.clearRect(0, 0, W, H)

      // Edges
      ctx!.lineWidth = 1
      ctx!.globalAlpha = 0.22
      for (const e of eIdx) {
        const a = sim[e.si]
        const b = sim[e.ti]
        ctx!.strokeStyle = '#71717a'
        ctx!.beginPath()
        ctx!.moveTo(a.x, a.y)
        ctx!.lineTo(b.x, b.y)
        ctx!.stroke()
      }
      ctx!.globalAlpha = 1

      // Nodes
      for (const n of sim) {
        const r = nodeRadius(n.risk)
        const color = riskToColor(n.risk)
        const isSelected = selected?.id === n.id
        ctx!.beginPath()
        ctx!.arc(n.x, n.y, r, 0, Math.PI * 2)
        ctx!.fillStyle = color + '33'
        ctx!.fill()
        ctx!.lineWidth = isSelected ? 2.5 : 1.2
        ctx!.strokeStyle = isSelected ? '#ffffff' : color
        ctx!.stroke()
        // Risk label for selected
        if (isSelected) {
          ctx!.fillStyle = '#f4f4f5'
          ctx!.font = '10px monospace'
          ctx!.textAlign = 'center'
          ctx!.fillText(n.id.slice(0, 12), n.x, n.y - r - 4)
        }
      }

      rafRef.current = requestAnimationFrame(step)
    }

    rafRef.current = requestAnimationFrame(step)
    return () => { cancelAnimationFrame(rafRef.current) }
  }, [selected])

  // Handle canvas resize
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const obs = new ResizeObserver(() => {
      canvas.width = canvas.clientWidth
      canvas.height = height
    })
    obs.observe(canvas)
    canvas.width = canvas.clientWidth || 640
    canvas.height = height
    return () => obs.disconnect()
  }, [height])

  // Click handler — find nearest node
  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    let best: SimNode | null = null
    let bestDist = Infinity
    for (const n of simRef.current) {
      const d = Math.hypot(n.x - mx, n.y - my)
      if (d < nodeRadius(n.risk) + 4 && d < bestDist) {
        bestDist = d
        best = n
      }
    }
    setSelected(best)
  }, [])

  return (
    <div className="relative w-full rounded-xl border border-zinc-800 bg-zinc-950 overflow-hidden">
      <canvas
        ref={canvasRef}
        onClick={handleClick}
        className="w-full cursor-crosshair"
        style={{ height }}
      />
      {/* Legend */}
      <div className="absolute bottom-3 left-3 flex flex-wrap gap-3 rounded-lg border border-zinc-800 bg-zinc-950/80 px-3 py-2 text-[10px] backdrop-blur-sm">
        {[['≥80%', '#f87171'], ['60–80%', '#fb923c'], ['40–60%', '#fbbf24'], ['<40%', '#34d399']].map(([label, color]) => (
          <span key={label} className="flex items-center gap-1 text-zinc-400">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color }} />
            {label}
          </span>
        ))}
        <span className="text-zinc-600">risk</span>
      </div>
      {/* Node detail on click */}
      {selected && (
        <div className="absolute right-3 top-3 min-w-[160px] rounded-lg border border-zinc-700 bg-zinc-900/95 p-3 text-xs backdrop-blur-sm">
          <button
            type="button"
            onClick={() => setSelected(null)}
            className="absolute right-2 top-1 text-zinc-600 hover:text-zinc-300"
          >
            ✕
          </button>
          <p className="mb-1 text-zinc-500">Node ID</p>
          <p className="mb-2 font-mono text-[10px] text-zinc-300 break-all">{selected.id}</p>
          <p className="text-zinc-500">Type</p>
          <p className="mb-2 text-zinc-300">{selected.label}</p>
          <p className="text-zinc-500">Risk</p>
          <p className="text-lg font-bold" style={{ color: riskToColor(selected.risk) }}>
            {(selected.risk * 100).toFixed(0)}%
          </p>
        </div>
      )}
      {nodes.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-sm text-zinc-600">No graph data — run a simulation to populate</p>
        </div>
      )}
    </div>
  )
}
