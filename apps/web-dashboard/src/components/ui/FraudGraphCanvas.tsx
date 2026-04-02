// ---------------------------------------------------------------------------
// FraudGraphCanvas — directed transaction graph with edge + node inspection.
// Performance-safe canvas rendering up to ~200 nodes / 400 edges.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState, useCallback } from 'react'
import type { GraphNode, GraphEdge } from '../../types/api'

interface Props {
  nodes: GraphNode[]
  edges: GraphEdge[]
  height?: number
  frozen?: boolean
}

interface SimNode {
  id: string
  type: string
  status: string
  risk: number
  totalIn: number
  totalOut: number
  sharedDevices: number
  fraudHistory: number
  linkedCases: number
  x: number
  y: number
  vx: number
  vy: number
}

const REPULSION = 1200
const SPRING_K = 0.035
const SPRING_LEN = 95
const DAMPING = 0.84
const GRAVITY = 0.007
const FREEZE_AFTER_FRAMES = 150

function nodeTypeColor(type: string, status: string): string {
  if (status === 'frozen' || type === 'frozen_account') return '#ef4444' // red
  if (type === 'customer_account') return '#22d3ee' // cyan
  if (type === 'beneficiary' || type === 'beneficiary_account') return '#60a5fa' // blue
  if (type === 'mule') return '#f59e0b' // amber
  if (type === 'sink') return '#a78bfa' // purple
  if (type === 'merchant') return '#22c55e' // green
  if (type === 'shared_device_hub') return '#eab308' // yellow
  return '#a1a1aa'
}

function edgeColorByRisk(risk: number): string {
  if (risk >= 0.9) return '#ef4444'
  if (risk >= 0.75) return '#f97316'
  if (risk >= 0.55) return '#f59e0b'
  return '#52525b'
}

function edgeWidthByAmount(amount: number): number {
  if (amount >= 9000) return 3.2
  if (amount >= 5000) return 2.4
  if (amount >= 2500) return 1.8
  return 1.2
}

export function FraudGraphCanvas({ nodes, edges, height = 460, frozen = false }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const simRef = useRef<SimNode[]>([])
  const edgeRef = useRef<Array<{ edge: GraphEdge; si: number; ti: number }>>([])
  const rafRef = useRef<number>(0)
  const frameCount = useRef(0)

  const [selectedNode, setSelectedNode] = useState<SimNode | null>(null)
  const [selectedEdge, setSelectedEdge] = useState<GraphEdge | null>(null)
  const [hoverNodeId, setHoverNodeId] = useState<string | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const W = canvas.clientWidth || 760
    const H = height
    frameCount.current = 0

    const cappedNodes = nodes.slice(0, 220)
    const sim: SimNode[] = cappedNodes.map((n, i) => {
      const layerBias = n.type === 'sink' ? 0.85 : n.type === 'mule' ? 0.62 : n.type.includes('beneficiary') ? 0.45 : 0.2
      const xBase = W * layerBias
      const ySpread = ((i * 31) % Math.max(80, H - 60)) + 30
      return {
        id: n.id,
        type: n.type,
        status: n.status,
        risk: n.risk_score ?? n.risk ?? 0.1,
        totalIn: n.total_in ?? 0,
        totalOut: n.total_out ?? 0,
        sharedDevices: n.shared_devices ?? 0,
        fraudHistory: n.fraud_history ?? 0,
        linkedCases: n.linked_cases ?? 0,
        x: xBase + (Math.random() - 0.5) * 40,
        y: ySpread + (Math.random() - 0.5) * 20,
        vx: 0,
        vy: 0,
      }
    })
    simRef.current = sim
    const idToIdx = new Map(sim.map((n, i) => [n.id, i]))
    edgeRef.current = edges
      .slice(0, 420)
      .map((e) => ({ edge: e, si: idToIdx.get(e.source) ?? -1, ti: idToIdx.get(e.target) ?? -1 }))
      .filter((e) => e.si >= 0 && e.ti >= 0)
  }, [nodes, edges, height])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const drawArrow = (x1: number, y1: number, x2: number, y2: number, color: string, width: number, dashed: boolean) => {
      const dx = x2 - x1
      const dy = y2 - y1
      const len = Math.hypot(dx, dy) || 1
      const ux = dx / len
      const uy = dy / len
      const endX = x2 - ux * 10
      const endY = y2 - uy * 10

      ctx.strokeStyle = color
      ctx.lineWidth = width
      ctx.globalAlpha = 0.8
      if (dashed) ctx.setLineDash([5, 4])
      else ctx.setLineDash([])
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(endX, endY)
      ctx.stroke()

      // arrow head
      const head = 7
      ctx.setLineDash([])
      ctx.beginPath()
      ctx.moveTo(endX, endY)
      ctx.lineTo(endX - ux * head - uy * (head * 0.55), endY - uy * head + ux * (head * 0.55))
      ctx.lineTo(endX - ux * head + uy * (head * 0.55), endY - uy * head - ux * (head * 0.55))
      ctx.closePath()
      ctx.fillStyle = color
      ctx.fill()
      ctx.globalAlpha = 1
    }

    function step() {
      const W = canvas!.width
      const H = canvas!.height
      const sim = simRef.current
      const eIdx = edgeRef.current
      const physicsActive = !frozen || frameCount.current < FREEZE_AFTER_FRAMES

      if (physicsActive) {
        frameCount.current++
        const cy = H / 2
        for (let i = 0; i < sim.length; i++) {
          const a = sim[i]
          // direction bias: keep sink-ish nodes more to the right
          const targetX = a.type === 'sink' ? W * 0.84 : a.type === 'mule' ? W * 0.63 : a.type.includes('beneficiary') ? W * 0.45 : W * 0.22
          a.vx += (targetX - a.x) * (GRAVITY * 1.8)
          a.vy += (cy - a.y) * GRAVITY
          for (let j = i + 1; j < sim.length; j++) {
            const b = sim[j]
            const dx = a.x - b.x
            const dy = a.y - b.y
            const d2 = dx * dx + dy * dy + 1
            const f = REPULSION / d2
            const nx = dx / Math.sqrt(d2)
            const ny = dy / Math.sqrt(d2)
            a.vx += nx * f
            a.vy += ny * f
            b.vx -= nx * f
            b.vy -= ny * f
          }
        }
        for (const e of eIdx) {
          const a = sim[e.si]
          const b = sim[e.ti]
          const dx = b.x - a.x
          const dy = b.y - a.y
          const d = Math.sqrt(dx * dx + dy * dy) || 1
          const force = (d - SPRING_LEN) * SPRING_K
          const fx = (dx / d) * force
          const fy = (dy / d) * force
          a.vx += fx
          a.vy += fy
          b.vx -= fx
          b.vy -= fy
        }
        for (const n of sim) {
          n.vx *= DAMPING
          n.vy *= DAMPING
          n.x = Math.max(14, Math.min(W - 14, n.x + n.vx))
          n.y = Math.max(14, Math.min(H - 14, n.y + n.vy))
        }
      }

      ctx!.clearRect(0, 0, W, H)
      const now = Date.now()

      // edges first
      for (const row of eIdx) {
        const a = sim[row.si]
        const b = sim[row.ti]
        const e = row.edge
        const color = edgeColorByRisk(e.risk_score ?? 0)
        const width = edgeWidthByAmount(e.amount ?? 0)
        drawArrow(a.x, a.y, b.x, b.y, color, width, !!e.suspicious_burst)
        if (e.frozen_path || e.decision === 'freeze') {
          ctx!.strokeStyle = 'rgba(239,68,68,0.24)'
          ctx!.lineWidth = width + 4
          ctx!.beginPath()
          ctx!.moveTo(a.x, a.y)
          ctx!.lineTo(b.x, b.y)
          ctx!.stroke()
        }
      }

      // nodes
      for (const n of sim) {
        const r = 7 + Math.min(10, n.risk * 9)
        const color = nodeTypeColor(n.type, n.status)
        const isHovered = hoverNodeId === n.id
        const isSelected = selectedNode?.id === n.id
        if (n.status === 'frozen' || n.risk >= 0.9) {
          const pulse = 0.38 + 0.36 * Math.sin(now / 350)
          ctx!.beginPath()
          ctx!.arc(n.x, n.y, r + 3 + pulse * 6, 0, Math.PI * 2)
          ctx!.fillStyle = `rgba(239,68,68,${pulse * 0.26})`
          ctx!.fill()
        }
        ctx!.beginPath()
        ctx!.arc(n.x, n.y, r, 0, Math.PI * 2)
        ctx!.fillStyle = `${color}33`
        ctx!.fill()
        ctx!.lineWidth = isSelected || isHovered ? 2.8 : 1.3
        ctx!.strokeStyle = isSelected ? '#ffffff' : color
        ctx!.stroke()
      }

      rafRef.current = requestAnimationFrame(step)
    }

    rafRef.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(rafRef.current)
  }, [frozen, selectedNode, hoverNodeId])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const obs = new ResizeObserver(() => {
      canvas.width = canvas.clientWidth
      canvas.height = height
    })
    obs.observe(canvas)
    canvas.width = canvas.clientWidth || 760
    canvas.height = height
    return () => obs.disconnect()
  }, [height])

  const nearestNode = (mx: number, my: number): SimNode | null => {
    let best: SimNode | null = null
    let bestDist = Infinity
    for (const n of simRef.current) {
      const d = Math.hypot(n.x - mx, n.y - my)
      if (d < 18 && d < bestDist) {
        best = n
        bestDist = d
      }
    }
    return best
  }

  const nearestEdge = (mx: number, my: number): GraphEdge | null => {
    let best: GraphEdge | null = null
    let bestDist = 9
    for (const row of edgeRef.current) {
      const a = simRef.current[row.si]
      const b = simRef.current[row.ti]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const len2 = dx * dx + dy * dy
      if (len2 <= 1) continue
      const t = Math.max(0, Math.min(1, ((mx - a.x) * dx + (my - a.y) * dy) / len2))
      const px = a.x + t * dx
      const py = a.y + t * dy
      const d = Math.hypot(mx - px, my - py)
      if (d < bestDist) {
        bestDist = d
        best = row.edge
      }
    }
    return best
  }

  const handleMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current
    if (!c) return
    const r = c.getBoundingClientRect()
    const mx = e.clientX - r.left
    const my = e.clientY - r.top
    const n = nearestNode(mx, my)
    setHoverNodeId(n?.id ?? null)
  }, [])

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current
    if (!c) return
    const r = c.getBoundingClientRect()
    const mx = e.clientX - r.left
    const my = e.clientY - r.top
    const n = nearestNode(mx, my)
    if (n) {
      setSelectedNode(n)
      setSelectedEdge(null)
      return
    }
    const edge = nearestEdge(mx, my)
    if (edge) {
      setSelectedEdge(edge)
      setSelectedNode(null)
      return
    }
    setSelectedNode(null)
    setSelectedEdge(null)
  }, [])

  const displayedNodes = Math.min(nodes.length, 220)
  const displayedEdges = Math.min(edges.length, 420)

  return (
    <div className="relative w-full rounded-xl border border-zinc-800 bg-zinc-950 overflow-hidden">
      <div className="absolute left-3 top-3 z-10 flex gap-2">
        <span className="rounded-md border border-zinc-700 bg-zinc-900/90 px-2 py-0.5 text-[10px] text-zinc-400">
          {displayedNodes} nodes
        </span>
        <span className="rounded-md border border-zinc-700 bg-zinc-900/90 px-2 py-0.5 text-[10px] text-zinc-400">
          {displayedEdges} edges
        </span>
      </div>

      <canvas
        ref={canvasRef}
        onMouseMove={handleMove}
        onClick={handleClick}
        className="w-full cursor-crosshair"
        style={{ height }}
      />

      {hoverNodeId && (
        <div className="absolute left-3 top-10 rounded-md border border-zinc-700 bg-zinc-900/90 px-2 py-1 text-[10px] text-zinc-300">
          {hoverNodeId}
        </div>
      )}

      {selectedNode && (
        <div className="absolute right-3 top-3 w-[240px] rounded-lg border border-zinc-700 bg-zinc-900/95 p-3 text-xs">
          <button type="button" onClick={() => setSelectedNode(null)} className="absolute right-2 top-1 text-zinc-600 hover:text-zinc-300">✕</button>
          <p className="text-zinc-500">Node</p>
          <p className="font-mono text-[10px] text-zinc-300 break-all">{selectedNode.id}</p>
          <p className="mt-2 text-zinc-500">Type / Status</p>
          <p className="text-zinc-300">{selectedNode.type} · {selectedNode.status}</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div><p className="text-zinc-500">Total Sent</p><p className="text-zinc-200">${selectedNode.totalOut.toFixed(2)}</p></div>
            <div><p className="text-zinc-500">Total Received</p><p className="text-zinc-200">${selectedNode.totalIn.toFixed(2)}</p></div>
            <div><p className="text-zinc-500">Shared Devices</p><p className="text-zinc-200">{selectedNode.sharedDevices}</p></div>
            <div><p className="text-zinc-500">Fraud History</p><p className="text-zinc-200">{selectedNode.fraudHistory}</p></div>
          </div>
          <p className="mt-2 text-zinc-500">Linked Cases</p>
          <p className="text-zinc-200">{selectedNode.linkedCases}</p>
        </div>
      )}

      {selectedEdge && (
        <div className="absolute right-3 top-3 w-[260px] rounded-lg border border-zinc-700 bg-zinc-900/95 p-3 text-xs">
          <button type="button" onClick={() => setSelectedEdge(null)} className="absolute right-2 top-1 text-zinc-600 hover:text-zinc-300">✕</button>
          <p className="text-zinc-500">Transaction</p>
          <p className="font-mono text-[10px] text-zinc-300 break-all">{selectedEdge.tx_id}</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div><p className="text-zinc-500">Amount</p><p className="text-zinc-200">${selectedEdge.amount.toFixed(2)}</p></div>
            <div><p className="text-zinc-500">Channel</p><p className="text-zinc-200">{selectedEdge.channel}</p></div>
            <div><p className="text-zinc-500">Risk</p><p className="text-zinc-200">{(selectedEdge.risk_score * 100).toFixed(1)}%</p></div>
            <div><p className="text-zinc-500">Decision</p><p className="text-zinc-200">{selectedEdge.decision}</p></div>
          </div>
          <p className="mt-2 text-zinc-500">Timestamp</p>
          <p className="text-zinc-200">{new Date(selectedEdge.timestamp).toLocaleString()}</p>
          <p className="mt-2 text-zinc-500">Fraud Flag</p>
          <p className={`${selectedEdge.is_fraud ? 'text-red-400' : 'text-emerald-400'}`}>{selectedEdge.is_fraud ? 'fraud' : 'legit'}</p>
          {selectedEdge.case_link && (
            <p className="mt-2 text-cyan-300 text-[11px]">Case link: {selectedEdge.case_link}</p>
          )}
        </div>
      )}

      <div className="absolute bottom-3 left-3 flex flex-wrap gap-3 rounded-lg border border-zinc-800 bg-zinc-950/80 px-3 py-2 text-[10px] text-zinc-400">
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-cyan-400" />customer</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-blue-400" />beneficiary</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-amber-400" />mule</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-purple-400" />sink</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-green-400" />merchant</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-red-400" />frozen</span>
      </div>

      {nodes.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-sm text-zinc-600">No transaction graph yet — run simulation</p>
        </div>
      )}
    </div>
  )
}
