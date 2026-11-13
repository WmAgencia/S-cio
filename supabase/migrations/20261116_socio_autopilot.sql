-- Autonomous review loop: Sócio reviews the account every 6 hours and asks the
-- owner before every change (system pop-up and "Meu Sócio" group).
-- Idempotent: pode rodar mais de uma vez.

ALTER TABLE socio_owner_groups
 ADD COLUMN IF NOT EXISTS ticket_cents integer
  CHECK (ticket_cents IS NULL OR ticket_cents BETWEEN 100 AND 100000000),
 ADD COLUMN IF NOT EXISTS margin_percent numeric(5,2)
  CHECK (margin_percent IS NULL OR (margin_percent > 0 AND margin_percent <= 100)),
 ADD COLUMN IF NOT EXISTS autopilot_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE socio_traffic_decisions
 ADD COLUMN IF NOT EXISTS question text,
 ADD COLUMN IF NOT EXISTS notified_at timestamptz,
 ADD COLUMN IF NOT EXISTS responded_at timestamptz,
 ADD COLUMN IF NOT EXISTS resolved_via text
  CHECK (resolved_via IS NULL OR resolved_via IN ('system','whatsapp','whatsapp_amount'));

-- One row per scheduled review. Doubles as the 6-hour gate and the history the
-- owner can audit later.
CREATE TABLE IF NOT EXISTS socio_traffic_reviews (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 account_id text NOT NULL CHECK (account_id ~ '^act_[0-9]{4,30}$'),
 status text NOT NULL DEFAULT 'done'
  CHECK (status IN ('done','failed','skipped')),
 decisions integer NOT NULL DEFAULT 0 CHECK (decisions >= 0),
 pending integer NOT NULL DEFAULT 0 CHECK (pending >= 0),
 summary jsonb NOT NULL DEFAULT '{}'::jsonb,
 error_code text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS socio_traffic_reviews_tenant_idx
 ON socio_traffic_reviews(tenant_id,created_at DESC);

CREATE INDEX IF NOT EXISTS socio_traffic_decisions_notified_idx
 ON socio_traffic_decisions(tenant_id,notified_at DESC)
 WHERE status='awaiting_approval';

ALTER TABLE socio_traffic_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE socio_traffic_reviews FROM PUBLIC;
