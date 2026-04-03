// ---------------------------------------------------------------------------
// App — thin hash-based router. All page logic lives in src/pages/*.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from 'react'
import { resolveApiBase } from './lib/api'
import { useApi } from './hooks/useApi'
import { AppShell } from './components/layout/AppShell'
import type { RouteKey } from './components/layout/Navbar'
import { DashboardPage } from './pages/DashboardPage'
import { TransactionFlowPage } from './pages/TransactionFlowPage'
import { SimulationLabPage } from './pages/SimulationLabPage'
import { GraphIntelligencePage } from './pages/GraphIntelligencePage'
import { ModelLabPage } from './pages/ModelLabPage'
import { ModelOpsPage } from './pages/ModelOpsPage'
import { CasesAuditPage } from './pages/CasesAuditPage'
import { RuleStudioPage } from './pages/RuleStudioPage'
import { DocsPage } from './pages/DocsPage'
import { DocsResearchPage } from './pages/DocsResearchPage'
import type { GatewayHealthResponse } from './types/api'

const VALID_ROUTES: RouteKey[] = [
  '/dashboard',
  '/transaction-flow',
  '/simulation-lab',
  '/graph-intelligence',
  '/model-lab',
  '/model-ops',
  '/cases-audit',
  '/rule-studio',
  '/docs',
  '/docs-research',
]

function hashRoute(): RouteKey {
  const normalize = (raw: string): RouteKey | null => {
    const trimmed = raw.trim()
    if (!trimmed) return null
    const withoutHash = trimmed.replace(/^#/, '')
    const normalized = withoutHash.startsWith('/') ? withoutHash : `/${withoutHash}`
    const noTrailingSlash = normalized.length > 1 ? normalized.replace(/\/+$/, '') : normalized
    return VALID_ROUTES.includes(noTrailingSlash as RouteKey) ? (noTrailingSlash as RouteKey) : null
  }

  const fromHash = normalize(window.location.hash)
  if (fromHash) return fromHash

  const fromPath = normalize(window.location.pathname)
  if (fromPath) return fromPath

  return '/dashboard'
}

function App() {
  const apiBase = useMemo(() => resolveApiBase(), [])
  const [route, setRoute] = useState<RouteKey>(hashRoute)
  const [health, refreshHealth] = useApi<GatewayHealthResponse>(apiBase, '/health')

  // Keep URL hash in sync with route state
  useEffect(() => {
    window.location.hash = route
  }, [route])

  // Allow browser back/forward to change route
  useEffect(() => {
    const onHashChange = () => setRoute(hashRoute())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  function handleRefreshAll() {
    void refreshHealth()
    // Each page manages its own data — this just refreshes the health bar.
  }

  if (route === '/docs-research') {
    return <DocsResearchPage apiBase={apiBase} />
  }

  return (
    <AppShell
      route={route}
      onNavigate={setRoute}
      gatewayStatus={health.data?.status}
      onRefreshAll={handleRefreshAll}
    >
      {route === '/dashboard'          && <DashboardPage         apiBase={apiBase} />}
      {route === '/transaction-flow'   && <TransactionFlowPage   apiBase={apiBase} />}
      {route === '/simulation-lab'     && <SimulationLabPage     apiBase={apiBase} />}
      {route === '/graph-intelligence' && <GraphIntelligencePage apiBase={apiBase} />}
      {route === '/model-lab'          && <ModelLabPage          apiBase={apiBase} />}
      {route === '/model-ops'          && <ModelOpsPage          apiBase={apiBase} />}
      {route === '/cases-audit'        && <CasesAuditPage        apiBase={apiBase} />}
      {route === '/rule-studio'        && <RuleStudioPage        apiBase={apiBase} />}
      {route === '/docs'               && <DocsPage              apiBase={apiBase} />}
    </AppShell>
  )
}

export default App
