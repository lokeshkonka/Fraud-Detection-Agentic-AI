#!/usr/bin/env bash
# =============================================================================
# scripts/final_demo_check.sh — Fraud-Detection platform demo readiness check
# =============================================================================
# Usage:
#   BASE_URL=http://localhost:8000 DASH_URL=http://localhost:3000 bash scripts/final_demo_check.sh
#
# Exit codes: 0 = all checks passed, 1 = one or more failures.
# =============================================================================
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8000}"
DASH_URL="${DASH_URL:-http://localhost:3000}"
SCREENSHOTS_DIR="${SCREENSHOTS_DIR:-/tmp/fraud-demo-screenshots}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

PASS=0
FAIL=0

log_ok()   { echo "  ✅  $1"; PASS=$((PASS+1)); }
log_fail() { echo "  ❌  $1"; FAIL=$((FAIL+1)); }
log_skip() { echo "  ⏭   $1 (skipped — docker not available)"; }

section() { echo ""; echo "── $1 ──"; }

# ---------------------------------------------------------------------------
# 1. Docker services healthy
# ---------------------------------------------------------------------------
section "Docker services"
if command -v docker &>/dev/null && docker info &>/dev/null 2>&1; then
  REQUIRED_SERVICES=(
    "fraud-detection-agentic-ai-gateway-1"
    "fraud-detection-agentic-ai-ml-inference-1"
    "fraud-detection-agentic-ai-ml-retrain-scheduler-1"
    "fraud-detection-agentic-ai-simulation-engine-1"
    "fraud-detection-agentic-ai-graph-service-1"
    "fraud-detection-agentic-ai-audit-service-1"
    "fraud-detection-agentic-ai-postgres-1"
    "fraud-detection-agentic-ai-redis-1"
    "fraud-detection-agentic-ai-neo4j-1"
  )
  for svc in "${REQUIRED_SERVICES[@]}"; do
    # accept any container name that contains the service suffix
    short="${svc##*-ai-}"
    short="${short%-1}"
    running=$(docker ps --format '{{.Names}}' 2>/dev/null | grep -c "$short" || true)
    if [ "$running" -gt 0 ]; then
      log_ok "container $short running"
    else
      log_fail "container $short NOT running"
    fi
  done
else
  log_skip "docker daemon not reachable"
fi

# ---------------------------------------------------------------------------
# 2. Artifacts mounted / exist in repo
# ---------------------------------------------------------------------------
section "Artifacts"
REQUIRED_ARTIFACTS=(
  "artifacts/drift/drift_baseline.json"
  "artifacts/model_eval/thresholds.json"
  "artifacts/model_eval/model_eval_summary.csv"
  "models/xgb.joblib"
  "models/lr.joblib"
  "models/rf.joblib"
)
for f in "${REQUIRED_ARTIFACTS[@]}"; do
  if [ -f "$REPO_ROOT/$f" ]; then
    log_ok "$f present"
  else
    log_fail "$f MISSING"
  fi
done

# ---------------------------------------------------------------------------
# 3. Backend gateway health
# ---------------------------------------------------------------------------
section "Gateway health"
GW_HEALTH=$(curl -sf --max-time 5 "$BASE_URL/health" 2>/dev/null || echo '{}')
GW_STATUS=$(echo "$GW_HEALTH" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status',''))" 2>/dev/null || echo "")
if [ "$GW_STATUS" = "ok" ]; then
  log_ok "gateway /health → ok"
else
  log_fail "gateway /health returned: $GW_STATUS"
fi

for SVC_KEY in inference_status scheduler_status simulation_status graph_status audit_status; do
  SVC_VAL=$(echo "$GW_HEALTH" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('$SVC_KEY','degraded'))" 2>/dev/null || echo "degraded")
  if [ "$SVC_VAL" = "ok" ]; then
    log_ok "$SVC_KEY → ok"
  else
    log_fail "$SVC_KEY → $SVC_VAL"
  fi
done

# ---------------------------------------------------------------------------
# 4. ML Inference loads champion model
# ---------------------------------------------------------------------------
section "ML Inference"
INF_HEALTH=$(curl -sf --max-time 5 "$BASE_URL/health" 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('inference_status',''))" 2>/dev/null || echo "")
if [ "$INF_HEALTH" = "ok" ]; then
  log_ok "ml-inference health ok"
else
  log_fail "ml-inference health: $INF_HEALTH"
fi

# Quick score test
SCORE_RESP=$(curl -sf --max-time 10 -X POST "$BASE_URL/score" \
  -H 'Content-Type: application/json' \
  -d '{"transaction_id":"demo_check_001","user_id":"u_check","amount":9500,"channel":"wire","features":{"velocity":9}}' \
  2>/dev/null || echo '{}')
SCORE_VAL=$(echo "$SCORE_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('score',''))" 2>/dev/null || echo "")
if [ -n "$SCORE_VAL" ]; then
  log_ok "score endpoint → $SCORE_VAL"
else
  log_fail "score endpoint returned no score"
fi

# ---------------------------------------------------------------------------
# 5. Simulation preset works
# ---------------------------------------------------------------------------
section "Simulation Preset"
PRESET_RESP=$(curl -sf --max-time 30 -X POST "$BASE_URL/simulation/run-preset/demo-final" \
  -H 'Content-Type: application/json' -d '{}' 2>/dev/null || echo '{}')
PRESET_GEN=$(echo "$PRESET_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); s=d.get('summary',{}); print(s.get('generated',0))" 2>/dev/null || echo "0")
if [ "$PRESET_GEN" -gt 0 ]; then
  log_ok "demo-final preset generated=$PRESET_GEN events"
else
  log_fail "demo-final preset returned no events"
fi

PRESET_FRAUD=$(echo "$PRESET_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); s=d.get('summary',{}); print(s.get('fraud',0))" 2>/dev/null || echo "0")
if [ "$PRESET_FRAUD" -gt 0 ]; then
  log_ok "preset includes fraud events (fraud=$PRESET_FRAUD)"
else
  log_fail "preset has no fraud events"
fi

# ---------------------------------------------------------------------------
# 6. Graph service renders (returns nodes)
# ---------------------------------------------------------------------------
section "Graph Service"
GRAPH_RESP=$(curl -sf --max-time 10 "$BASE_URL/graph-intelligence/overview" 2>/dev/null || echo '{}')
GRAPH_NODES=$(echo "$GRAPH_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('nodes',0))" 2>/dev/null || echo "0")
if [ "$GRAPH_NODES" -gt 0 ]; then
  log_ok "graph overview nodes=$GRAPH_NODES"
else
  log_fail "graph overview returned 0 nodes (run simulation first)"
fi

NETWORK_RESP=$(curl -sf --max-time 10 "$BASE_URL/graph-intelligence/network" 2>/dev/null || echo '{"nodes":[]}')
NETWORK_NODES=$(echo "$NETWORK_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('nodes',[])))" 2>/dev/null || echo "0")
if [ "$NETWORK_NODES" -gt 0 ]; then
  log_ok "graph network returned $NETWORK_NODES nodes"
else
  log_fail "graph network has 0 nodes"
fi

# ---------------------------------------------------------------------------
# 7. 9 frontend routes accessible (or gateway API routes)
# ---------------------------------------------------------------------------
section "Frontend / API Routes"
API_ROUTES=(
  "/dashboard/overview"
  "/transaction-flow/recent"
  "/simulation/last-run"
  "/graph-intelligence/overview"
  "/graph-intelligence/network"
  "/model-lab/overview"
  "/model-ops/overview"
  "/cases-audit/list"
  "/rule-studio/rules"
)
for route in "${API_ROUTES[@]}"; do
  HTTP_CODE=$(curl -sf -o /dev/null -w "%{http_code}" --max-time 10 "$BASE_URL$route" 2>/dev/null || echo "000")
  if [ "$HTTP_CODE" = "200" ]; then
    log_ok "GET $route → 200"
  else
    log_fail "GET $route → $HTTP_CODE"
  fi
done

# ---------------------------------------------------------------------------
# 8. Retrain overview API works
# ---------------------------------------------------------------------------
section "Model Ops"
MOPS_RESP=$(curl -sf --max-time 10 "$BASE_URL/model-ops/overview" 2>/dev/null || echo '{}')
CHAMPION=$(echo "$MOPS_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('champion',{}).get('version',''))" 2>/dev/null || echo "")
if [ -n "$CHAMPION" ]; then
  log_ok "model-ops champion=$CHAMPION"
else
  log_fail "model-ops overview returned no champion"
fi

COUNTDOWN=$(echo "$MOPS_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('schedule',{}).get('countdown_seconds',''))" 2>/dev/null || echo "")
if [ -n "$COUNTDOWN" ]; then
  log_ok "retrain countdown=$COUNTDOWN s"
else
  log_fail "retrain countdown not present"
fi

# ---------------------------------------------------------------------------
# 9. Screenshots directory exists (or can be created)
# ---------------------------------------------------------------------------
section "Screenshots directory"
mkdir -p "$SCREENSHOTS_DIR" && log_ok "$SCREENSHOTS_DIR ready" || log_fail "Cannot create $SCREENSHOTS_DIR"

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "══════════════════════════════════════════"
echo "  Result: ${PASS} passed  ·  ${FAIL} failed"
echo "══════════════════════════════════════════"
if [ "$FAIL" -gt 0 ]; then
  echo "  ❌  Demo NOT ready — fix the failures above."
  exit 1
fi
echo "  ✅  Demo ready! All checks passed."
