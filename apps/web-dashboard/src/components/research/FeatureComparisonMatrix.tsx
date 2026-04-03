import { useMemo, useState } from 'react'
import { ArrowDownUp, X } from 'lucide-react'
import { MermaidCodeCanvas } from '../ui/MermaidCodeCanvas'
import type { DocsResearchFeatureMatrixRow, MatrixVerdict } from '../../types/api'

type SortKey = 'feature' | 'traditional' | 'our' | 'verdict'

type SortState = { key: SortKey; dir: 'asc' | 'desc' }

interface FeatureComparisonMatrixProps {
  rows: DocsResearchFeatureMatrixRow[]
}

export function FeatureComparisonMatrix({ rows }: FeatureComparisonMatrixProps) {
  const [selected, setSelected] = useState<DocsResearchFeatureMatrixRow | null>(null)
  const [sort, setSort] = useState<SortState>({ key: 'feature', dir: 'asc' })

  const sortedRows = useMemo(() => {
    const copy = [...rows]
    copy.sort((a, b) => {
      const dir = sort.dir === 'asc' ? 1 : -1
      if (sort.key === 'feature') return a.feature.localeCompare(b.feature) * dir
      if (sort.key === 'traditional') return a.traditional_system.localeCompare(b.traditional_system) * dir
      if (sort.key === 'our') return a.ai_system.localeCompare(b.ai_system) * dir
      const order: Record<MatrixVerdict, number> = { Right: 3, Partial: 2, Wrong: 1 }
      return (order[a.verdict] - order[b.verdict]) * dir
    })
    return copy
  }, [rows, sort])

  function updateSort(key: SortKey) {
    setSort((prev) => {
      if (prev.key === key) {
        return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      }
      return { key, dir: 'asc' }
    })
  }

  return (
    <div className="relative font-serif">
      <div className="w-full border-t-2 border-b-2 border-black overflow-x-auto">
        <table className="w-full text-left text-sm whitespace-normal">
          <thead className="border-b border-black">
            <tr>
              <th className="px-4 py-3 font-bold text-black align-bottom w-1/4">
                <button type="button" onClick={() => updateSort('feature')} className="inline-flex items-center gap-1 hover:text-gray-600 transition-colors">
                  Feature <ArrowDownUp className="h-3 w-3" />
                </button>
              </th>
              <th className="px-4 py-3 font-bold text-black align-bottom w-[30%]">
                <button type="button" onClick={() => updateSort('traditional')} className="inline-flex items-center gap-1 hover:text-gray-600 transition-colors">
                  Traditional System <ArrowDownUp className="h-3 w-3" />
                </button>
              </th>
              <th className="px-4 py-3 font-bold text-black align-bottom w-[35%]">
                <button type="button" onClick={() => updateSort('our')} className="inline-flex items-center gap-1 hover:text-gray-600 transition-colors">
                  Our AI System <ArrowDownUp className="h-3 w-3" />
                </button>
              </th>
              <th className="px-4 py-3 font-bold text-black align-bottom text-right w-[10%]">
                <button type="button" onClick={() => updateSort('verdict')} className="inline-flex items-center gap-1 hover:text-gray-600 transition-colors justify-end w-full">
                  Verdict <ArrowDownUp className="h-3 w-3" />
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row, index) => (
              <tr
                key={row.id}
                className={`cursor-pointer transition-colors ${index !== sortedRows.length - 1 ? 'border-b border-gray-200' : ''} hover:bg-gray-50`}
                onClick={() => setSelected(row)}
              >
                <td className="px-4 py-4 font-semibold text-black align-top">{row.feature}</td>
                <td className="px-4 py-4 text-gray-700 align-top leading-relaxed">{row.traditional_system}</td>
                <td className="px-4 py-4 text-black align-top leading-relaxed">{row.ai_system}</td>
                <td className="px-4 py-4 text-right align-top">
                  <span className="text-xs uppercase tracking-widest font-mono text-gray-500">{row.verdict}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="fixed inset-0 z-65 flex justify-end bg-black/10 backdrop-blur-[2px]">
          <aside className="h-full w-full max-w-2xl overflow-y-auto border-l border-gray-200 bg-[#fafafa] p-8 md:p-12 shadow-2xl font-sans">
            <div className="mb-10 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-2">Feature Detail</p>
                <h3 className="text-3xl font-bold tracking-tight text-black">{selected.feature}</h3>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="text-gray-400 hover:text-black transition-colors"
                aria-label="Close feature detail"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            <div className="space-y-8 text-base">
              <div>
                <h4 className="text-sm font-bold uppercase tracking-widest text-black mb-3">Traditional Limitation</h4>
                <p className="text-gray-700 leading-relaxed font-serif border-l-2 border-gray-200 pl-4">{selected.why_traditional_fails}</p>
              </div>
              
              <div>
                <h4 className="text-sm font-bold uppercase tracking-widest text-black mb-3">AI Resolution</h4>
                <p className="text-black leading-relaxed font-serif border-l-2 border-black pl-4">{selected.how_ai_solves}</p>
              </div>

              <div className="grid gap-6 md:grid-cols-2 pt-6 border-t border-gray-200">
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3">ML Features</h4>
                  <ul className="space-y-2 text-gray-700 font-serif">
                    {selected.ml_features.map((f) => <li key={f} className="flex gap-2"><span className="text-gray-300">-</span> {f}</li>)}
                  </ul>
                </div>
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-2">Backend Architecture</h4>
                  <p className="font-mono text-sm text-black mb-6">{selected.backend_service}</p>
                  
                  <h4 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-2">UI Workflow</h4>
                  <p className="text-gray-700 font-serif">{selected.ui_workflow}</p>
                </div>
              </div>

              <div className="pt-6 border-t border-gray-200">
                <h4 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3">System Context</h4>
                <div className="flex flex-wrap gap-4">
                  <div>
                    <p className="text-[10px] uppercase text-gray-400 mb-1">Endpoints</p>
                    <div className="flex flex-wrap gap-2">
                       {selected.api_routes.map((route) => (
                         <span key={route} className="bg-gray-100 text-gray-600 px-2 py-1 font-mono text-[11px] rounded">{route}</span>
                       ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase text-gray-400 mb-1">Artifacts</p>
                    <div className="flex flex-wrap gap-2">
                       {selected.related_artifacts.map((artifact) => (
                         <span key={artifact} className="bg-white border border-gray-200 text-gray-600 px-2 py-1 font-mono text-[11px] rounded">{artifact}</span>
                       ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-6 border-t border-gray-200">
                <MermaidCodeCanvas
                  title="Interaction Flow"
                  subtitle="Service execution trace"
                  initialCode={selected.mermaid_mini_flow}
                  editable={false}
                  height={320}
                />
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}
