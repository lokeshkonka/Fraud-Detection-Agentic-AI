import { useEffect, useMemo, useRef, useState } from 'react'
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation } from 'd3-force'
import type { GraphEdge, GraphNode, ReplayStep } from '../../types/api'

interface Props {
  nodes: GraphNode[]
  edges: GraphEdge[]
  height?: number
  frozen?: boolean
  replay?: ReplayStep[]
  replayIndex?: number
}

interface SimNode extends GraphNode {
  x: number
  y: number
  vx: number
  vy: number
  fx?: number
  fy?: number
}

interface SimLink {
  source: string
  target: string
  amount: number
  edge: GraphEdge
}

type Transform = { x: number; y: number; k: number }
const positionMemory = new Map<string, { x: number; y: number }>()

function nodeTypeColor(type: string, status: string): string {
  if (status === 'frozen' || type === 'frozen_account') return '#ef4444'
  if (type === 'mule') return '#f59e0b'
  if (type === 'sink') return '#a78bfa'
  if (type === 'beneficiary' || type === 'beneficiary_account') return '#60a5fa'
  if (type === 'customer_account') return '#22d3ee'
  return '#a1a1aa'
}

function edgeColorByRisk(risk: number): string {
  if (risk >= 0.9) return '#ef4444'
  if (risk >= 0.75) return '#f97316'
  if (risk >= 0.55) return '#f59e0b'
  return '#52525b'
}

export function FraudGraphCanvas({ nodes, edges, height = 540, frozen = false, replay = [], replayIndex = -1 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const simulationRef = useRef<ReturnType<typeof forceSimulation<SimNode>> | null>(null)
  const transformRef = useRef<Transform>({ x: 0, y: 0, k: 1 })
  const dragRef = useRef<{ id: string | null; pointerId: number | null }>({ id: null, pointerId: null })
  const rafRef = useRef(0)
  const layoutDebounce = useRef<number | null>(null)
  const [hoverNodeId, setHoverNodeId] = useState<string | null>(null)
  const [selectedNode, setSelectedNode] = useState<SimNode | null>(null)
  const [selectedEdge, setSelectedEdge] = useState<GraphEdge | null>(null)

  const data = useMemo(() => {
    const cappedNodes = nodes.slice(0, 240)
    const cappedEdges = edges.slice(0, 500)
    const simNodes: SimNode[] = cappedNodes.map((n, i) => {
      const prev = positionMemory.get(n.id)
      return {
        ...n,
        x: prev?.x ?? (180 + ((i * 47) % 520)),
        y: prev?.y ?? (90 + ((i * 29) % Math.max(220, height - 120))),
        vx: 0,
        vy: 0,
      }
    })
    const idSet = new Set(simNodes.map((n) => n.id))
    const simLinks: SimLink[] = cappedEdges
      .filter((e) => idSet.has(e.source) && idSet.has(e.target))
      .map((e) => ({ source: e.source, target: e.target, amount: e.amount, edge: e }))
    return { simNodes, simLinks }
  }, [nodes, edges, height])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const resize = () => {
      canvas.width = canvas.clientWidth || 960
      canvas.height = height
    }
    resize()
    const obs = new ResizeObserver(resize)
    obs.observe(canvas)
    return () => obs.disconnect()
  }, [height])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    if (layoutDebounce.current) window.clearTimeout(layoutDebounce.current)
    layoutDebounce.current = window.setTimeout(() => {
      simulationRef.current?.stop()
      const W = canvas.width || 960
      const H = canvas.height || height
      const sim = forceSimulation<SimNode>(data.simNodes)
        .force('charge', forceManyBody<SimNode>().strength(-55).distanceMin(18).distanceMax(300))
        .force('collide', forceCollide<SimNode>().radius((d) => 9 + Math.min(9, (d.risk_score ?? d.risk ?? 0) * 10)).strength(0.9))
        .force('link', forceLink<SimNode, SimLink>(data.simLinks).id((d) => d.id).distance(78).strength(0.08))
        .force('center', forceCenter(W / 2, H / 2))
        .alpha(0.95)
        .alphaDecay(0.045)
      simulationRef.current = sim
      const persist = () => {
        for (const n of data.simNodes) {
          if (Number.isFinite(n.x) && Number.isFinite(n.y)) {
            positionMemory.set(n.id, { x: n.x, y: n.y })
          }
        }
      }
      const render = () => {
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        const { x: tx, y: ty, k } = transformRef.current
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.save()
        ctx.translate(tx, ty)
        ctx.scale(k, k)

        const activeReplay = replayIndex >= 0 ? replay[replayIndex] : null
        for (const link of data.simLinks) {
          const s = data.simNodes.find((n) => n.id === link.source)
          const t = data.simNodes.find((n) => n.id === link.target)
          if (!s || !t) continue
          const replayHit = !!activeReplay && activeReplay.tx_id === link.edge.tx_id
          ctx.beginPath()
          ctx.moveTo(s.x, s.y)
          ctx.lineTo(t.x, t.y)
          ctx.strokeStyle = replayHit ? '#a78bfa' : edgeColorByRisk(link.edge.risk_score ?? 0)
          ctx.lineWidth = replayHit ? 4 : 1.5
          ctx.globalAlpha = replayHit ? 0.95 : 0.78
          ctx.stroke()
          if (replayHit) {
            ctx.strokeStyle = 'rgba(167,139,250,0.35)'
            ctx.lineWidth = 8
            ctx.stroke()
          }
        }
        ctx.globalAlpha = 1
        for (const n of data.simNodes) {
          const r = 7 + Math.min(9, (n.risk_score ?? n.risk ?? 0) * 8)
          ctx.beginPath()
          ctx.arc(n.x, n.y, r, 0, Math.PI * 2)
          const c = nodeTypeColor(n.type, n.status)
          ctx.fillStyle = `${c}66`
          ctx.fill()
          ctx.strokeStyle = selectedNode?.id === n.id ? '#ffffff' : c
          ctx.lineWidth = selectedNode?.id === n.id ? 2.4 : 1.4
          ctx.stroke()
          if (n.status === 'frozen') {
            ctx.beginPath()
            ctx.arc(n.x, n.y, r + 4, 0, Math.PI * 2)
            ctx.strokeStyle = 'rgba(239,68,68,0.45)'
            ctx.lineWidth = 2
            ctx.stroke()
          }
        }
        ctx.restore()
        persist()
        rafRef.current = requestAnimationFrame(render)
      }
      cancelAnimationFrame(rafRef.current)
      render()
      if (frozen) {
        window.setTimeout(() => {
          simulationRef.current?.alphaTarget(0).stop()
        }, 1300)
      }
    }, 80)
    return () => {
      if (layoutDebounce.current) window.clearTimeout(layoutDebounce.current)
    }
  }, [data, frozen, replay, replayIndex, selectedNode, height])

  useEffect(() => () => {
    simulationRef.current?.stop()
    cancelAnimationFrame(rafRef.current)
  }, [])

  function toWorld(clientX: number, clientY: number) {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    const px = clientX - rect.left
    const py = clientY - rect.top
    const { x, y, k } = transformRef.current
    return { x: (px - x) / k, y: (py - y) / k }
  }

  function nearestNode(wx: number, wy: number): SimNode | null {
    let best: SimNode | null = null
    let bestD = Infinity
    for (const n of data.simNodes) {
      const d = Math.hypot(n.x - wx, n.y - wy)
      if (d < 18 && d < bestD) {
        best = n
        bestD = d
      }
    }
    return best
  }

  function nearestEdge(wx: number, wy: number): GraphEdge | null {
    let best: GraphEdge | null = null
    let bestD = 8
    for (const link of data.simLinks) {
      const s = data.simNodes.find((n) => n.id === link.source)
      const t = data.simNodes.find((n) => n.id === link.target)
      if (!s || !t) continue
      const dx = t.x - s.x
      const dy = t.y - s.y
      const len2 = dx * dx + dy * dy
      if (len2 <= 1) continue
      const u = Math.max(0, Math.min(1, ((wx - s.x) * dx + (wy - s.y) * dy) / len2))
      const px = s.x + u * dx
      const py = s.y + u * dy
      const d = Math.hypot(wx - px, wy - py)
      if (d < bestD) {
        bestD = d
        best = link.edge
      }
    }
    return best
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = toWorld(e.clientX, e.clientY)
    const n = nearestNode(p.x, p.y)
    if (n) {
      dragRef.current = { id: n.id, pointerId: e.pointerId }
      n.fx = n.x
      n.fy = n.y
      simulationRef.current?.alphaTarget(0.12).restart()
      return
    }
    dragRef.current = { id: '__pan__', pointerId: e.pointerId }
    ;(e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = toWorld(e.clientX, e.clientY)
    const dragging = dragRef.current
    if (dragging.pointerId === e.pointerId && dragging.id && dragging.id !== '__pan__') {
      const n = data.simNodes.find((x) => x.id === dragging.id)
      if (n) {
        n.fx = p.x
        n.fy = p.y
      }
      return
    }
    if (dragging.pointerId === e.pointerId && dragging.id === '__pan__') {
      transformRef.current = {
        ...transformRef.current,
        x: transformRef.current.x + e.movementX,
        y: transformRef.current.y + e.movementY,
      }
      return
    }
    const hover = nearestNode(p.x, p.y)
    setHoverNodeId(hover?.id ?? null)
  }

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const dragging = dragRef.current
    if (dragging.pointerId === e.pointerId && dragging.id && dragging.id !== '__pan__') {
      const n = data.simNodes.find((x) => x.id === dragging.id)
      if (n) {
        n.fx = undefined
        n.fy = undefined
      }
      simulationRef.current?.alphaTarget(0.02).restart()
    }
    dragRef.current = { id: null, pointerId: null }
    ;(e.currentTarget as HTMLCanvasElement).releasePointerCapture(e.pointerId)
  }

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    const current = transformRef.current
    const zoom = Math.exp(-e.deltaY * 0.001)
    const nextK = Math.max(0.35, Math.min(2.8, current.k * zoom))
    const ratio = nextK / current.k
    transformRef.current = {
      k: nextK,
      x: px - (px - current.x) * ratio,
      y: py - (py - current.y) * ratio,
    }
  }

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const p = toWorld(e.clientX, e.clientY)
    const n = nearestNode(p.x, p.y)
    if (n) {
      setSelectedNode(n)
      setSelectedEdge(null)
      return
    }
    const edge = nearestEdge(p.x, p.y)
    if (edge) {
      setSelectedEdge(edge)
      setSelectedNode(null)
      return
    }
    setSelectedNode(null)
    setSelectedEdge(null)
  }

  return (
    <div className="relative w-full rounded-xl border border-zinc-800 bg-zinc-950 overflow-hidden">
      <canvas
        ref={canvasRef}
        style={{ height }}
        className="w-full touch-none cursor-crosshair"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
        onClick={onClick}
      />
      <div className="absolute right-3 top-3 z-10 flex gap-2">
        <span className="rounded-md border border-zinc-700 bg-zinc-900/90 px-2 py-0.5 text-[10px] text-zinc-400">{data.simNodes.length} nodes</span>
        <span className="rounded-md border border-zinc-700 bg-zinc-900/90 px-2 py-0.5 text-[10px] text-zinc-400">{data.simLinks.length} edges</span>
      </div>
      {hoverNodeId && <div className="absolute left-3 top-10 rounded-md border border-zinc-700 bg-zinc-900/90 px-2 py-1 text-[10px] text-zinc-300">{hoverNodeId}</div>}
      {selectedNode && (
        <div className="absolute right-3 top-12 w-[250px] rounded-lg border border-zinc-700 bg-zinc-900/95 p-3 text-xs">
          <button type="button" onClick={() => setSelectedNode(null)} className="absolute right-2 top-1 text-zinc-600 hover:text-zinc-300">✕</button>
          <p className="text-zinc-500">Node</p>
          <p className="font-mono text-[10px] text-zinc-300 break-all">{selectedNode.id}</p>
          <p className="mt-2 text-zinc-500">Type / Status</p>
          <p className="text-zinc-300">{selectedNode.type} · {selectedNode.status}</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div><p className="text-zinc-500">Risk</p><p className="text-zinc-200">{((selectedNode.risk_score ?? selectedNode.risk ?? 0) * 100).toFixed(1)}%</p></div>
            <div><p className="text-zinc-500">Linked Cases</p><p className="text-zinc-200">{selectedNode.linked_cases ?? 0}</p></div>
            <div><p className="text-zinc-500">Total Out</p><p className="text-zinc-200">${(selectedNode.total_out ?? 0).toFixed(2)}</p></div>
            <div><p className="text-zinc-500">Total In</p><p className="text-zinc-200">${(selectedNode.total_in ?? 0).toFixed(2)}</p></div>
          </div>
        </div>
      )}
      {selectedEdge && (
        <div className="absolute right-3 top-12 w-[260px] rounded-lg border border-zinc-700 bg-zinc-900/95 p-3 text-xs">
          <button type="button" onClick={() => setSelectedEdge(null)} className="absolute right-2 top-1 text-zinc-600 hover:text-zinc-300">✕</button>
          <p className="text-zinc-500">Transaction</p>
          <p className="font-mono text-[10px] text-zinc-300 break-all">{selectedEdge.tx_id}</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div><p className="text-zinc-500">Amount</p><p className="text-zinc-200">${selectedEdge.amount.toFixed(2)}</p></div>
            <div><p className="text-zinc-500">Risk</p><p className="text-zinc-200">{(selectedEdge.risk_score * 100).toFixed(1)}%</p></div>
          </div>
        </div>
      )}
      {nodes.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-sm text-zinc-600">No transaction graph yet — run simulation</p>
        </div>
      )}
    </div>
  )
}
