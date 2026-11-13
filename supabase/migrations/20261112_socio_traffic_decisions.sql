-- Log of autonomous and owner-approved Meta Ads changes. The application
-- writes the row before executing a plan, so a failure never disappears.
-- Idempotente: pode rodar mais de uma vez.

CREATE TABLE IF NOT EXISTS socio_app.socio_traffic_decisions (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES socio_app.tenants(id) ON DELETE CASCADE,
 account_id text NOT NULL CHECK (account_id ~ '^act_[0-9]{4,30}$'),
 action text NOT NULL CHECK (action IN ('pause','scale','duplicate_campaign',
  'broaden_audience','approval_request','hold')),
 entity text NOT NULL CHECK (entity IN ('campaign','adset','ad')),
 entity_id text NOT NULL CHECK (entity_id ~ '^[0-9]{4,30}$'),
 entity_name text,
 campaign_id text CHECK (campaign_id IS NULL OR campaign_id ~ '^[0-9]{4,30}$'),
 reason text NOT NULL,
 explanation text NOT NULL,
 evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
 current_budget_cents integer CHECK (current_budget_cents IS NULL OR current_budget_cents >= 100),
 target_budget_cents integer CHECK (target_budget_cents IS NULL OR target_budget_cents >= 100),
 within_autonomy boolean NOT NULL DEFAULT false,
 status text NOT NULL DEFAULT 'proposed'
  CHECK (status IN ('proposed','awaiting_approval','executing','done','failed','dismissed')),
 plan_id uuid,
 result jsonb,
 error_code text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS socio_traffic_decisions_tenant_idx
 ON socio_app.socio_traffic_decisions(tenant_id,created_at DESC);
CREATE INDEX IF NOT EXISTS socio_traffic_decisions_pending_idx
 ON socio_app.socio_traffic_decisions(tenant_id,status)
 WHERE status IN ('awaiting_approval','executing');

ALTER TABLE socio_app.socio_traffic_decisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON socio_app.socio_traffic_decisions FROM PUBLIC,anon,authenticated;
