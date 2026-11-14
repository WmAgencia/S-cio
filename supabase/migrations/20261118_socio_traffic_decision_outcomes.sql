-- Self-evaluation: seven days after a decision is applied, the next review
-- measures whether the cost per result improved and records the verdict on the
-- decision itself. Idempotent so it is safe on every environment.
ALTER TABLE socio_traffic_decisions
 ADD COLUMN IF NOT EXISTS question text,
 ADD COLUMN IF NOT EXISTS notified_at timestamptz,
 ADD COLUMN IF NOT EXISTS responded_at timestamptz,
 ADD COLUMN IF NOT EXISTS resolved_via text
  CHECK (resolved_via IS NULL OR resolved_via IN ('system','whatsapp','whatsapp_amount')),
 ADD COLUMN IF NOT EXISTS outcome text
  CHECK (outcome IS NULL OR outcome IN ('improved','worsened','neutral','unknown')),
 ADD COLUMN IF NOT EXISTS outcome_kind text
  CHECK (outcome_kind IS NULL OR outcome_kind IN ('purchase','conversation','lead')),
 ADD COLUMN IF NOT EXISTS cost_before_cents integer
  CHECK (cost_before_cents IS NULL OR cost_before_cents >= 0),
 ADD COLUMN IF NOT EXISTS cost_after_cents integer
  CHECK (cost_after_cents IS NULL OR cost_after_cents >= 0),
 ADD COLUMN IF NOT EXISTS outcome_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
 ADD COLUMN IF NOT EXISTS evaluated_at timestamptz;

CREATE INDEX IF NOT EXISTS socio_traffic_decisions_eval_idx
 ON socio_traffic_decisions(tenant_id,account_id,updated_at)
 WHERE evaluated_at IS NULL;
