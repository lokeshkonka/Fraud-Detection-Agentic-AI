import { useEffect, useId, useRef, useState } from 'react'
import mermaid from 'mermaid'
import { Code2, Copy, Play, ZoomIn, ZoomOut } from 'lucide-react'

interface MermaidCodeCanvasProps {
  title: string
  initialCode: string
  subtitle?: string
  editable?: boolean
  height?: number
  className?: string
}

const mermaidInit = (() => {
  let initialized = false
  return () => {
    if (initialized) return
    mermaid.initialize({
      startOnLoad: false,
      theme: 'base',
      securityLevel: 'strict',
      fontFamily: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial',
      themeVariables: {
        primaryColor: '#ffffff',
        primaryTextColor: '#000000',
        primaryBorderColor: '#000000',
        lineColor: '#666666',
        secondaryColor: '#f9fafb',
        tertiaryColor: '#f3f4f6',
        background: '#ffffff',
      },
      flowchart: {
        curve: 'basis',
        htmlLabels: true,
      },
    })
    initialized = true
  }
})()

export function MermaidCodeCanvas({
  title,
  initialCode,
  subtitle,
  editable = true,
  height = 600,
  className = '',
}: MermaidCodeCanvasProps) {
  const [code, setCode] = useState(initialCode)
  const [svg, setSvg] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [showSource, setShowSource] = useState(false)
  const [zoom, setZoom] = useState(100)
  const renderPrefix = useId().replace(/:/g, '')
  const renderSeqRef = useRef(0)

  useEffect(() => {
    setCode(initialCode)
  }, [initialCode])

  useEffect(() => {
    let active = true
    const run = async () => {
      try {
        mermaidInit()
        renderSeqRef.current += 1
        const renderId = `mermaid-${renderPrefix}-${renderSeqRef.current}`
        const { svg: rendered } = await mermaid.render(renderId, code)
        if (!active) return
        setSvg(rendered)
        setError(null)
      } catch (e) {
        if (!active) return
        setError(e instanceof Error ? e.message : 'Mermaid render failed')
      }
    }
    void run()
    return () => {
      active = false
    }
  }, [code, renderPrefix])

  async function copyCode() {
    await navigator.clipboard.writeText(code)
  }

  const handleZoomOut = () => setZoom(z => Math.max(z - 25, 50))
  const handleZoomIn = () => setZoom(z => Math.min(z + 25, 300))
  const handleResetZoom = () => setZoom(100)

  return (
    <section className={`border border-gray-200 bg-white rounded-2xl overflow-hidden shadow-sm ${className}`}>
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-100 px-6 py-4 bg-white">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-gray-950">{title}</h3>
          {subtitle && <p className="text-xs text-gray-400 font-serif mt-0.5 leading-relaxed">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => void copyCode()}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-400 hover:text-gray-700 transition-colors px-3 py-1.5 rounded-lg hover:bg-gray-50 border border-gray-200"
          >
            <Copy className="h-3.5 w-3.5" /> Copy
          </button>
          <button
            type="button"
            onClick={() => setShowSource((s) => !s)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
               showSource
                 ? 'bg-gray-950 text-white border-gray-950 hover:bg-gray-800'
                 : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400 hover:text-gray-900'
            }`}
          >
            {showSource ? <Play className="h-3.5 w-3.5" /> : <Code2 className="h-3.5 w-3.5" />}
            {showSource ? 'Diagram' : 'Source'}
          </button>
        </div>
      </header>

      <div style={{ minHeight: height }} className="relative bg-[#fafaf8] flex flex-col justify-center items-center w-full overflow-hidden">
        {showSource ? (
          <div className="w-full h-full flex flex-col bg-gray-50 absolute inset-0">
             <div className="px-6 py-3 border-b border-gray-200 bg-gray-100/50 flex items-center justify-between z-10">
                <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Mermaid Definition</span>
                {!editable && <span className="text-[10px] uppercase text-gray-400">Read only</span>}
             </div>
             <textarea
              value={code}
              readOnly={!editable}
              onChange={(e) => setCode(e.target.value)}
              className="flex-1 w-full h-full resize-none border-0 bg-transparent p-6 font-mono text-sm leading-relaxed text-gray-800 outline-none focus:ring-0 absolute inset-0 pt-16"
             />
          </div>
        ) : (
          <div className="w-full h-full p-4 md:p-8 flex items-center overflow-auto absolute inset-0">
            {/* Floating Zoom Controls */}
            {svg && !error && (
              <div className="absolute bottom-6 right-6 flex flex-col md:flex-row items-center bg-white border-2 border-black rounded-lg shadow-sm z-20 overflow-hidden text-black transition-all">
                <button onClick={handleZoomOut} className="p-2.5 hover:bg-gray-100 transition-colors border-b-2 md:border-b-0 md:border-r-2 border-black" title="Zoom Out">
                   <ZoomOut className="w-4 h-4" />
                </button>
                <div onClick={handleResetZoom} className="px-4 py-2 text-xs font-mono font-bold w-16 text-center cursor-pointer hover:bg-gray-50 transition-colors" title="Reset Zoom">
                   {zoom}%
                </div>
                <button onClick={handleZoomIn} className="p-2.5 hover:bg-gray-100 transition-colors border-t-2 md:border-t-0 md:border-l-2 border-black" title="Zoom In">
                   <ZoomIn className="w-4 h-4" />
                </button>
              </div>
            )}

            {error ? (
              <div className="border border-red-200 bg-red-50 p-6 text-sm font-mono text-red-700 max-w-xl text-center m-auto">
                 <p className="font-bold mb-2">Render Error</p>
                 {error}
              </div>
            ) : (
              <div className="m-auto transition-all duration-300 ease-out origin-top-left" style={{ width: `${zoom}%`, minWidth: zoom < 100 ? `${zoom}%` : '100%' }}>
                <div dangerouslySetInnerHTML={{ __html: svg }} className="w-full [&>svg]:w-full [&>svg]:h-auto [&>svg]:max-w-none text-center" />
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
