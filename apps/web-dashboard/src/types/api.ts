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
  balance_delta_org_threshold: number
  balance_delta_dest_threshold: number
  amount_log_threshold: number
  amount_to_org_balance_ratio_threshold: number
  amount_to_dest_balance_ratio_threshold: number
  queue_risk_score_threshold: number
  drift_alert_signal_threshold: number
  mule_cluster_density_threshold: number
  repeated_beneficiary_anomaly_threshold: number
  expression_mode: 'AND' | 'OR'
  confidence_weight: number
  override_ml_score: boolean
  shadow_mode: boolean
  analyst_approval_required: boolean
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
  human_label?: string
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
  champion_pr_auc: number
  champion_roc_auc: number
  challenger_pr_auc: number
  challenger_roc_auc: number
  champion_last_retrained: string | null
  challenger_created_at: string | null
}

export interface BusinessMetrics {
  fraud_catch_rate: number
  queue_precision: number
  model_health: 'healthy' | 'warning' | 'retrain_soon'
  alerts_per_day: number
  estimated_fraud_caught_daily: number
  prevented_loss_estimate: number
  freeze_success_rate: number
  false_positive_rate: number
  analyst_queue_size: number
}

export interface ModelLabResponse {
  model: ModelInfo
  feature_stats: FeatureStat[]
  accuracy_curve: AccuracyPoint[]
  drift_baseline: DriftBaseline
  business_metrics: BusinessMetrics
  human_behavior: HumanBehaviorSnapshot
}

export interface HumanBehaviorSnapshot {
  typical_transaction_size: string
  common_velocity: string
  sender_balance_movement: string
  receiver_spike_behavior: string
  anomaly_intensity: 'low' | 'moderate' | 'high'
}

export interface ExplainResponse {
  transaction_id: string
  score: number
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
  name: string
  description: string
  risk_level: string
  risk_pattern: string
  typical_graph_shape: string
  sample_path: string
  detection_layer: string
  freeze_probability: number
}

// ── Graph Service ────────────────────────────────────────────────────────────

export interface GraphNode {
  id: string
  type: string
  status: string
  risk_score: number
  total_in: number
  total_out: number
  shared_devices: number
  fraud_history: number
  linked_cases: number
  label: string
  risk: number
}

export interface GraphEdge {
  source: string
  target: string
  relation: string
  amount: number
  tx_id: string
  timestamp: string
  channel: string
  risk_score: number
  decision: string
  is_fraud: boolean
  suspicious_burst?: boolean
  frozen_path?: boolean
  case_link?: string | null
}

export interface GraphNetworkResponse {
  nodes: GraphNode[]
  edges: GraphEdge[]
  rings: RingInfo[]
}

export interface ClusterActionResponse {
  cluster_id: string
  action: string
  members: string[]
  linked_accounts: string[]
  propagated_risk: Record<string, number>
  updated_nodes: number
}

export interface ThreatEntityActionResponse {
  status: string
  entity_id: string
  case_id: string
  graph: Record<string, unknown>
}

export interface ReplayStep {
  order: number
  tx_id: string
  source: string
  target: string
  amount: number
  timestamp: string
  risk_score: number
  cumulative_amount: number
}

export interface ReplayTimelineResponse {
  seed: string
  steps: ReplayStep[]
  total_amount: number
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
  reason?: string
  model_version?: string
  rule_version?: string
  before_state?: Record<string, unknown>
  after_state?: Record<string, unknown>
}

export interface CaseRecord {
  id: string
  transaction_id: string
  status: CaseStatus
  severity: Severity
  owner: string
  updated_at: string
  fraud_type?: string
  analyst?: string
  suspicious_amount?: number
  linked_entities?: string[]
  sla_minutes_remaining?: number
  queue_priority_score?: number
  shap_preview?: Record<string, number>
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

export interface CaseEventRecord {
  id: string
  actor: string
  action: string
  details: Record<string, unknown>
  created_at: string
}

export interface CaseCommentRecord {
  id: string
  author: string
  message: string
  created_at: string
}

// ── Docs Research ────────────────────────────────────────────────────────────

export type MatrixVerdict = 'Wrong' | 'Partial' | 'Right'

export interface DocsResearchFeatureMatrixRow {
  id: string
  feature: string
  traditional_system: string
  ai_system: string
  verdict: MatrixVerdict
  why_traditional_fails: string
  how_ai_solves: string
  ml_features: string[]
  backend_service: string
  api_routes: string[]
  ui_workflow: string
  related_artifacts: string[]
  mermaid_mini_flow: string
}

export interface DocsResearchFeatureMatrixResponse {
  generated_at: string
  rows: DocsResearchFeatureMatrixRow[]
}

export interface DocsResearchOverviewResponse {
  generated_at: string
  service_health: GatewayHealthResponse
  routes: string[]
  model_lab: Record<string, unknown>
  model_ops: Record<string, unknown>
  graph_overview: GraphOverviewResponse
  graph_network_sample: {
    nodes: GraphNode[]
    edges: GraphEdge[]
    rings: RingInfo[]
  }
  replay: ReplayTimelineResponse
  rules: Record<string, unknown>
  cases: {
    items: CaseRecord[]
    total?: number
    limit?: number
    offset?: number
  }
  audits: {
    items: AuditRecord[]
    total?: number
    limit?: number
    offset?: number
  }
  archetypes: ArchetypeInfo[]
  feature_matrix: DocsResearchFeatureMatrixRow[]
}
