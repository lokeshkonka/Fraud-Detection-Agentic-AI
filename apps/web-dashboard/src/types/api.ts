// ---------------------------------------------------------------------------
// API response types — mirrors Pydantic models in all backend services.
// ---------------------------------------------------------------------------

// ── Shared ──────────────────────────────────────────────────────────────────

export type DecisionType = 'approve' | 'step_up_auth' | 'hold' | 'freeze'
export type LabelType = 'fraud' | 'legit'
export type ChannelType = 'card' | 'wire' | 'crypto' | 'ach' | 'upi'
export type CaseStatus = 'open' | 'investigating' | 'closed' | 'escalated'
export type Severity = 'low' | 'medium' | 'high' | 'critical'

// ── API Gateway ──────────────────────────────────────────────────────────────

export interface ServiceUrls {
  ml_inference: string
  ml_retrain_scheduler: string
  simulation_engine: string
  graph_service: string
  audit_service: string
}

export interface GatewayHealthResponse {
  status: string
  inference_status: string
  scheduler_status: string
  simulation_status: string
  graph_status: string
  audit_status: string
  services: ServiceUrls
}

export interface ScoreResponse {
  transaction_id: string
  user_id: string
  amount: number
  channel: ChannelType
  score: number
  label: LabelType
  decision: DecisionType
  reasons: string[]
  rule_score: number
  model_score: number
  timestamp: string
}

export interface TransactionRecord {
  transaction_id: string | null
  user_id: string | null
  amount: number
  channel: string
  score: number
  label: string
  decision: string
  reasons: string[]
  rule_score: number
  model_score: number
  timestamp: string | null
}

export interface TransactionFlowResponse {
  items: TransactionRecord[]
  page: number
  limit: number
  total: number
}

export interface DashboardKpis {
  transactions_seen: number
  fraud_rate: number
  avg_score: number
  open_cases: number
}

export interface DashboardModelOps {
  next_retrain_at: string | null
  champion: Record<string, unknown>
  challenger: Record<string, unknown>
}

export interface DashboardResponse {
  kpis: DashboardKpis
  decision_counts: Record<string, number>
  graph: Record<string, unknown>
  model_ops: DashboardModelOps
}

export interface RuleSetInput {
  risk_threshold: number
  velocity_limit: number
  high_risk_channels: string[]
}

export interface RuleStudioResponse {
  rules: RuleSetInput
}

export interface RuleEvalResponse {
  status: string
  rules: RuleSetInput
  note: string
}

// ── ML Inference ─────────────────────────────────────────────────────────────

export interface FeatureStat {
  feature: string
  mean: number
  variance: number
}

export interface AccuracyPoint {
  x: number
  precision: number
  recall: number
  fraud_catch: number
  fp_trend: number
}

export interface DriftBaseline {
  generated_at: string
  fraud_prevalence: number
  psi: number
  mean_shift_score: number
  variance_shift_score: number
}

export interface ModelInfo {
  champion: string
  challenger: string
  pr_auc: number
  roc_auc: number
}

export interface ModelLabResponse {
  model: ModelInfo
  feature_stats: FeatureStat[]
  accuracy_curve: AccuracyPoint[]
  drift_baseline: DriftBaseline
}

export interface ExplainResponse {
  transaction_id: string
  score: number
  label: LabelType
  contributions: Record<string, number>
}

// ── ML Retrain Scheduler ─────────────────────────────────────────────────────

export interface ScheduleInfo {
  interval_days: number
  next_retrain_at: string
  last_retrain_at: string | null
  countdown_seconds: number
}

export interface DriftInfo {
  psi: number
  mean_shift: number
  variance_shift: number
}

export interface ModelVersionInfo {
  version: string
  pr_auc: number
  status: string
  source?: string
}

export interface AdaptiveLearningInfo {
  threshold: number
  policy: string
  last_adjustment: string
}

export interface RetrainHistoryItem {
  id: string
  started_at: string
  completed_at: string
  status: string
  candidate_version: string
  challenger_pr_auc: number
  promoted: boolean
}

export interface ArtifactItem {
  name: string
  path: string
  updated_at: string
}

export interface ModelOpsOverviewResponse {
  schedule: ScheduleInfo
  drift: DriftInfo
  champion: ModelVersionInfo
  challenger: ModelVersionInfo
  adaptive_learning: AdaptiveLearningInfo
  artifacts: ArtifactItem[]
  history: RetrainHistoryItem[]
}

// ── Simulation Engine ────────────────────────────────────────────────────────

export interface SimEvent {
  transaction_id: string
  user_id: string
  amount: number
  merchant: string
  channel: string
  timestamp: string
  label: string
  archetype: string
}

export interface SimSummary {
  generated: number
  fraud: number
  legit: number
  fraud_ratio: number
}

export interface SimRunResponse {
  events: SimEvent[]
  summary: SimSummary
  generated_at: string
}

export interface ArchetypeInfo {
  id: string
  description: string
  risk_level: string
}

// ── Graph Service ────────────────────────────────────────────────────────────

export interface GraphNode {
  id: string
  label: string
  risk: number
}

export interface GraphEdge {
  source: string
  target: string
  relation: string
  amount: number
}

export interface GraphNetworkResponse {
  nodes: GraphNode[]
  edges: GraphEdge[]
  rings: RingInfo[]
}

export interface GraphOverviewResponse {
  nodes: number
  edges: number
  high_risk_nodes: number
  mule_ring_signals: number
}

export interface RingInfo {
  id: string
  members: string[]
  risk: number
}

// ── Audit Service ────────────────────────────────────────────────────────────

export interface AuditRecord {
  id: string
  actor: string
  action: string
  target: string
  timestamp: string
}

export interface CaseRecord {
  id: string
  transaction_id: string
  status: CaseStatus
  severity: Severity
  owner: string
  updated_at: string
}

export interface AuditListResponse {
  items: AuditRecord[]
  total: number
  limit: number
  offset: number
}

export interface CaseListResponse {
  items: CaseRecord[]
  total: number
  limit: number
  offset: number
}
