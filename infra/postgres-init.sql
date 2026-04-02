CREATE TABLE IF NOT EXISTS channel_catalog (
  channel TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS merchant_catalog (
  merchant TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS fraud_archetypes (
  id TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  risk_level TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rules_config (
  id INT PRIMARY KEY,
  risk_threshold DOUBLE PRECISION NOT NULL,
  velocity_limit INT NOT NULL,
  high_risk_channels JSONB NOT NULL,
  amount_scale DOUBLE PRECISION NOT NULL,
  night_start_hour INT NOT NULL,
  night_end_hour INT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS model_weights (
  name TEXT PRIMARY KEY,
  value DOUBLE PRECISION NOT NULL
);

CREATE TABLE IF NOT EXISTS model_metrics (
  id INT PRIMARY KEY,
  champion_pr_auc DOUBLE PRECISION NOT NULL,
  champion_roc_auc DOUBLE PRECISION NOT NULL,
  challenger_pr_auc DOUBLE PRECISION NOT NULL,
  challenger_roc_auc DOUBLE PRECISION NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS feature_stats (
  feature TEXT PRIMARY KEY,
  mean DOUBLE PRECISION NOT NULL,
  variance DOUBLE PRECISION NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS accuracy_curve (
  x INT PRIMARY KEY,
  precision DOUBLE PRECISION NOT NULL,
  recall DOUBLE PRECISION NOT NULL,
  fraud_catch DOUBLE PRECISION NOT NULL,
  fp_trend DOUBLE PRECISION NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS drift_baseline (
  id INT PRIMARY KEY,
  generated_at TIMESTAMPTZ NOT NULL,
  fraud_prevalence DOUBLE PRECISION NOT NULL,
  psi DOUBLE PRECISION NOT NULL,
  mean_shift_score DOUBLE PRECISION NOT NULL,
  variance_shift_score DOUBLE PRECISION NOT NULL
);

CREATE TABLE IF NOT EXISTS scheduler_state (
  id INT PRIMARY KEY,
  next_run TIMESTAMPTZ,
  last_retrain TIMESTAMPTZ,
  champion_version TEXT NOT NULL,
  challenger_version TEXT NOT NULL,
  drift_psi DOUBLE PRECISION NOT NULL,
  drift_mean_shift DOUBLE PRECISION NOT NULL,
  drift_variance_shift DOUBLE PRECISION NOT NULL,
  threshold DOUBLE PRECISION NOT NULL,
  policy TEXT NOT NULL,
  last_adjustment TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS retrain_history (
  id TEXT PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL,
  candidate_version TEXT NOT NULL,
  challenger_pr_auc DOUBLE PRECISION NOT NULL,
  promoted BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS artifacts (
  name TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audits (
  id BIGSERIAL PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cases (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL,
  status TEXT NOT NULL,
  severity TEXT NOT NULL,
  owner TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transactions (
  id BIGSERIAL PRIMARY KEY,
  transaction_id TEXT UNIQUE NOT NULL,
  user_id TEXT NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  merchant TEXT,
  channel TEXT NOT NULL,
  score DOUBLE PRECISION NOT NULL,
  label TEXT NOT NULL,
  decision TEXT NOT NULL,
  reasons JSONB NOT NULL,
  rule_score DOUBLE PRECISION NOT NULL,
  model_score DOUBLE PRECISION NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_transactions_timestamp ON transactions(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_user_ts ON transactions(user_id, timestamp DESC);

CREATE TABLE IF NOT EXISTS simulation_runs (
  run_id TEXT PRIMARY KEY,
  generated_at TIMESTAMPTZ NOT NULL,
  generated INT NOT NULL,
  fraud INT NOT NULL,
  legit INT NOT NULL,
  fraud_ratio DOUBLE PRECISION NOT NULL
);

CREATE TABLE IF NOT EXISTS simulation_events (
  id BIGSERIAL PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES simulation_runs(run_id) ON DELETE CASCADE,
  transaction_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  merchant TEXT NOT NULL,
  channel TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  label TEXT NOT NULL,
  archetype TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sim_events_run ON simulation_events(run_id);

CREATE TABLE IF NOT EXISTS graph_nodes (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  risk DOUBLE PRECISION NOT NULL
);

CREATE TABLE IF NOT EXISTS graph_edges (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  target TEXT NOT NULL,
  relation TEXT NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO channel_catalog(channel) VALUES
('card'),('wire'),('crypto'),('ach'),('upi')
ON CONFLICT DO NOTHING;

INSERT INTO merchant_catalog(merchant) VALUES
('groceries'),('travel'),('electronics'),('fashion'),('gaming'),('wallet_topup'),('fuel'),('healthcare')
ON CONFLICT DO NOTHING;

INSERT INTO fraud_archetypes(id, description, risk_level) VALUES
('mule_ring','High-risk account network forwarding illicit funds across multiple hops to obscure beneficial owner.','critical'),
('account_takeover','Credential compromise enabling unauthorized transfers from legitimate account.','high'),
('friendly_fraud','Cardholder disputes a legitimate charge to force chargeback.','medium'),
('cross_border_smurfing','Structured below-threshold transfers across jurisdictions to evade AML controls.','high'),
('merchant_collusion','Refund inflation or fictitious charge manipulation with complicit merchant.','high'),
('synthetic_identity','Blended real+fabricated identity passing KYC checks.','critical'),
('velocity_burst','Rapid sequential transactions to drain account before controls trigger.','high')
ON CONFLICT DO NOTHING;

INSERT INTO rules_config(id, risk_threshold, velocity_limit, high_risk_channels, amount_scale, night_start_hour, night_end_hour, updated_at)
VALUES (1, 0.55, 4, '["wire","crypto","upi"]'::jsonb, 10000, 0, 5, NOW())
ON CONFLICT (id) DO UPDATE SET
risk_threshold = EXCLUDED.risk_threshold,
velocity_limit = EXCLUDED.velocity_limit,
high_risk_channels = EXCLUDED.high_risk_channels,
amount_scale = EXCLUDED.amount_scale,
night_start_hour = EXCLUDED.night_start_hour,
night_end_hour = EXCLUDED.night_end_hour,
updated_at = NOW();

INSERT INTO model_weights(name, value) VALUES
('amount_norm', 1.20),
('velocity', 0.60),
('is_high_risk_channel', 1.50),
('merchant_missing', 0.40),
('night_risk', 0.50),
('balance_delta_org', 0.30),
('balance_delta_dest', 0.30)
ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value;

INSERT INTO model_metrics(id, champion_pr_auc, champion_roc_auc, challenger_pr_auc, challenger_roc_auc, updated_at)
VALUES (1, 0.842, 0.913, 0.852, 0.918, NOW())
ON CONFLICT (id) DO UPDATE SET
champion_pr_auc = EXCLUDED.champion_pr_auc,
champion_roc_auc = EXCLUDED.champion_roc_auc,
challenger_pr_auc = EXCLUDED.challenger_pr_auc,
challenger_roc_auc = EXCLUDED.challenger_roc_auc,
updated_at = NOW();

INSERT INTO feature_stats(feature, mean, variance, updated_at) VALUES
('amount', 946.22, 40231.90, NOW()),
('amount_log', 5.19, 1.21, NOW()),
('velocity', 2.74, 3.49, NOW()),
('balance_delta_org', 73.60, 8122.20, NOW()),
('balance_delta_dest', 58.40, 7021.50, NOW())
ON CONFLICT (feature) DO UPDATE SET
mean = EXCLUDED.mean,
variance = EXCLUDED.variance,
updated_at = NOW();

INSERT INTO accuracy_curve(x, precision, recall, fraud_catch, fp_trend, updated_at) VALUES
(500, 0.82, 0.48, 0.46, 0.12, NOW()),
(1000, 0.83, 0.56, 0.55, 0.13, NOW()),
(2000, 0.84, 0.63, 0.62, 0.14, NOW()),
(5000, 0.86, 0.71, 0.70, 0.16, NOW()),
(10000, 0.87, 0.78, 0.77, 0.17, NOW())
ON CONFLICT (x) DO UPDATE SET
precision = EXCLUDED.precision,
recall = EXCLUDED.recall,
fraud_catch = EXCLUDED.fraud_catch,
fp_trend = EXCLUDED.fp_trend,
updated_at = NOW();

INSERT INTO drift_baseline(id, generated_at, fraud_prevalence, psi, mean_shift_score, variance_shift_score)
VALUES (1, NOW(), 0.011, 0.08, 0.06, 0.09)
ON CONFLICT (id) DO UPDATE SET
generated_at = NOW(),
fraud_prevalence = EXCLUDED.fraud_prevalence,
psi = EXCLUDED.psi,
mean_shift_score = EXCLUDED.mean_shift_score,
variance_shift_score = EXCLUDED.variance_shift_score;

INSERT INTO scheduler_state(id, next_run, last_retrain, champion_version, challenger_version, drift_psi, drift_mean_shift, drift_variance_shift, threshold, policy, last_adjustment)
VALUES (1, NOW() + INTERVAL '7 days', NOW() - INTERVAL '7 days', 'xgb_trained_external_v1', 'xgb_challenger_v3', 0.09, 0.07, 0.11, 0.55, 'dynamic-threshold-enabled', NOW() - INTERVAL '9 hours')
ON CONFLICT (id) DO UPDATE SET
next_run = EXCLUDED.next_run,
last_retrain = EXCLUDED.last_retrain,
champion_version = EXCLUDED.champion_version,
challenger_version = EXCLUDED.challenger_version,
drift_psi = EXCLUDED.drift_psi,
drift_mean_shift = EXCLUDED.drift_mean_shift,
drift_variance_shift = EXCLUDED.drift_variance_shift,
threshold = EXCLUDED.threshold,
policy = EXCLUDED.policy,
last_adjustment = EXCLUDED.last_adjustment;

INSERT INTO retrain_history(id, started_at, completed_at, status, candidate_version, challenger_pr_auc, promoted) VALUES
('run-001', NOW() - INTERVAL '14 days', NOW() - INTERVAL '14 days' + INTERVAL '6 minutes', 'completed', 'xgb_challenger_v2', 0.831, FALSE),
('run-002', NOW() - INTERVAL '7 days', NOW() - INTERVAL '7 days' + INTERVAL '5 minutes', 'completed', 'xgb_challenger_v3', 0.848, FALSE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO artifacts(name, path, updated_at) VALUES
('champion_model', 'models/xgb_fraud_v1.json', NOW()),
('drift_baseline', 'artifacts/drift/drift_baseline.json', NOW()),
('accuracy_curve', 'artifacts/model_eval/xgb_accuracy_curve.png', NOW())
ON CONFLICT (name) DO UPDATE SET
path = EXCLUDED.path,
updated_at = NOW();

INSERT INTO audits(actor, action, target, timestamp)
SELECT 'system', 'score', 'txn_seed_123', NOW()
WHERE NOT EXISTS (SELECT 1 FROM audits);

INSERT INTO cases(id, transaction_id, status, severity, owner, updated_at)
VALUES ('case_seed_001', 'txn_seed_123', 'open', 'high', 'fraud-ops', NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO graph_nodes(id, label, risk)
VALUES ('acct_1', 'account', 0.12), ('acct_2', 'account', 0.72)
ON CONFLICT (id) DO UPDATE SET risk = EXCLUDED.risk;

INSERT INTO graph_edges(source, target, relation, amount)
SELECT 'acct_1', 'acct_2', 'transfer', 245.0
WHERE NOT EXISTS (SELECT 1 FROM graph_edges);
