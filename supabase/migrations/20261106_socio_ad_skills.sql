-- Private future Supabase migration: assisted Meta Ads skills. Railway remains production.
CREATE TABLE IF NOT EXISTS socio_app.socio_skill_runs (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES socio_app.tenants(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES socio_app.users(id) ON DELETE CASCADE,
 account_id text NOT NULL CHECK(account_id ~ '^act_[0-9]{4,20}$'),
 skill text NOT NULL CHECK(skill IN ('ads.campaign.launch','ads.meta.command')),
 status text NOT NULL CHECK(status IN ('collecting','ready','executing','completed','failed')),
 brief jsonb NOT NULL DEFAULT '{}'::jsonb,
 origin_conversation_id uuid REFERENCES socio_app.conversations(id) ON DELETE SET NULL,
 plan_id uuid REFERENCES socio_app.meta_ads_plans(id) ON DELETE SET NULL,
 pixel_plan_id uuid REFERENCES socio_app.meta_ads_plans(id) ON DELETE SET NULL,
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

CREATE TABLE IF NOT EXISTS socio_app.socio_owner_skill_receipts (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES socio_app.tenants(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES socio_app.users(id) ON DELETE CASCADE,
 conversation_id uuid NOT NULL REFERENCES socio_app.conversations(id) ON DELETE CASCADE,
 inbound_message_id uuid NOT NULL REFERENCES socio_app.messages(id) ON DELETE CASCADE,
 run_id uuid REFERENCES socio_app.socio_skill_runs(id) ON DELETE SET NULL,
 status text NOT NULL CHECK(status IN ('processing','response_ready','replied','uncertain')),
 response_text text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,inbound_message_id)
);
CREATE INDEX IF NOT EXISTS socio_owner_skill_receipts_tenant_idx
 ON socio_app.socio_owner_skill_receipts(tenant_id,user_id,created_at DESC);
REVOKE ALL ON socio_app.socio_owner_skill_receipts FROM anon,authenticated;
