// ---------------------------------------------------------------------------
// Navbar — left sidebar navigation (collapses to top bar on small screens).
// ---------------------------------------------------------------------------

export type RouteKey =
  | '/dashboard'
  | '/transaction-flow'
  | '/simulation-lab'
  | '/graph-intelligence'
  | '/model-lab'
  | '/model-ops'
  | '/cases-audit'
  | '/rule-studio'
  | '/docs'

interface NavItem {
  route: RouteKey
  label: string
  icon: string
}

const NAV_ITEMS: NavItem[] = [
  { route: '/dashboard',          label: 'Dashboard',         icon: '◈' },
  { route: '/transaction-flow',   label: 'Transaction Flow',  icon: '⟳' },
  { route: '/simulation-lab',     label: 'Simulation Lab',    icon: '⚗' },
  { route: '/graph-intelligence', label: 'Graph Intel',       icon: '⬡' },
  { route: '/model-lab',          label: 'Model Lab',         icon: '⊞' },
  { route: '/model-ops',          label: 'Model Ops',         icon: '⚙' },
  { route: '/cases-audit',        label: 'Cases & Audit',     icon: '⊟' },
  { route: '/rule-studio',        label: 'Rule Studio',       icon: '⊛' },
  { route: '/docs',               label: 'Docs',              icon: '☰' },
]

interface NavbarProps {
  current: RouteKey
  onNavigate: (route: RouteKey) => void
}

export function Navbar({ current, onNavigate }: NavbarProps) {
  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden w-56 shrink-0 flex-col gap-1 lg:flex">
        <div className="mb-4 px-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-400">Fraud Command</p>
          <p className="text-xs text-zinc-500">AI Intelligence Platform</p>
        </div>
        {NAV_ITEMS.map((item) => {
          const active = current === item.route
          return (
            <button
              key={item.route}
              type="button"
              onClick={() => onNavigate(item.route)}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150 ${
                active
                  ? 'bg-cyan-500/15 text-cyan-200 border border-cyan-500/30 motion-safe:animate-[slideInLeft_.2s_ease_both]'
                  : 'text-zinc-400 hover:bg-zinc-800/80 hover:text-zinc-100 border border-transparent'
              }`}
            >
              <span className="text-base leading-none">{item.icon}</span>
              {item.label}
            </button>
          )
        })}
      </aside>

      {/* Mobile top nav */}
      <nav className="flex flex-wrap gap-1.5 lg:hidden">
        {NAV_ITEMS.map((item) => {
          const active = current === item.route
          return (
            <button
              key={item.route}
              type="button"
              onClick={() => onNavigate(item.route)}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                active
                  ? 'bg-cyan-500/15 text-cyan-200 border border-cyan-500/30'
                  : 'border border-zinc-700 text-zinc-400 hover:text-white'
              }`}
            >
              {item.icon} {item.label}
            </button>
          )
        })}
      </nav>
    </>
  )
}
