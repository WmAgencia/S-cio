-- Private future Supabase migration: assisted Meta Ads skills. Railway remains production.
CREATE TABLE IF NOT EXISTS socio_app.socio_skill_runs (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES socio_app.tenants(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES socio_app.users(id) ON DELETE CASCADE,
 account_id text NOT NULL CHECK(account_id ~ '^act_[0-9]{4,20}$'),
 skill text NOT NULL CHECK(skill IN ('ads.campaign.launch')),
 status text NOT NULL CHECK(status IN ('collecting','ready','executing','completed','failed')),
 brief jsonb NOT NULL DEFAULT '{}'::jsonb,
 plan_id uuid REFERENCES socio_app.meta_ads_plans(id) ON DELETE SET NULL,
 result jsonb,
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS socio_skill_runs_owner_idx
 ON socio_app.socio_skill_runs(tenant_id,user_id,updated_at DESC);
CREATE INDEX IF NOT EXISTS socio_skill_runs_expiry_idx ON socio_app.socio_skill_runs(expires_at);
REVOKE ALL ON socio_app.socio_skill_runs FROM anon,authenticated;
