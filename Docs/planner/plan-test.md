# plan-test.md
## Backend endpoint validation plan
- [ ] GET /health (gateway + all services)
- [ ] GET /routes
- [ ] POST /score with low/high-risk payloads
- [ ] GET /transaction-flow/recent
- [ ] GET /dashboard/overview
- [ ] GET /model-lab/overview
- [ ] GET /model-ops/overview
- [ ] POST /model-ops/promote
- [ ] POST /model-ops/rollback
- [ ] POST /simulation/run
- [ ] GET /simulation/last-run
- [ ] GET /graph-intelligence/network
- [ ] GET /graph-intelligence/overview
- [ ] GET /cases-audit/list
- [ ] GET /cases-audit/audits
- [ ] GET /rule-studio/rules
- [ ] POST /rule-studio/rules/evaluate

## Frontend validation plan
- [ ] All 8 routes render from primary navigation
- [ ] Responsive behavior at mobile/tablet/desktop breakpoints
- [ ] Route transitions animate smoothly
- [ ] Model-ops layout follows documented architecture
- [ ] Simulation to transaction-flow data updates reflected in UI
- [ ] Risk labels and action badges map correctly

## Bug-fix loop
- [ ] Run lint/build checks
- [ ] Fix regressions
- [ ] Re-run checks to green
