-- Sócio private staging update — no live Railway data is touched.
SET search_path TO socio_app,pg_catalog;
DO $guard$
BEGIN
 IF EXISTS(SELECT 1 FROM socio_app.tenants)
  OR has_schema_privilege('anon','socio_app','USAGE')
  OR has_schema_privilege('authenticated','socio_app','USAGE') THEN
  RAISE EXCEPTION 'Refusing staging marketing migration: data or private schema exposure';
 END IF;
END $guard$;

-- Marketing integrations: no shared agency master token and no auto-spend.
-- Each provider credential belongs to exactly one authorized company tenant.
CREATE TABLE IF NOT EXISTS marketing_connections (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 provider text NOT NULL CHECK(provider IN ('pipeboard_meta','google_ads_scripts')),
 account_id text NOT NULL,
 label text NOT NULL CHECK(length(label) BETWEEN 1 AND 90),
 secret_ciphertext text,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','verified','disabled')),
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 last_verified_at timestamptz,
 UNIQUE(tenant_id,id),
 UNIQUE(tenant_id,provider,account_id),
 FOREIGN KEY(tenant_id,created_by) REFERENCES users(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS marketing_connections_tenant_idx ON marketing_connections(tenant_id,provider);

-- Signed Google Ads Scripts use unique receipt IDs to reject replays.
CREATE TABLE IF NOT EXISTS marketing_report_receipts (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 connection_id uuid NOT NULL,
 run_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(connection_id,run_id),
 FOREIGN KEY(tenant_id,connection_id) REFERENCES marketing_connections(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS marketing_report_receipts_tenant_idx ON marketing_report_receipts(tenant_id,created_at DESC);

-- Aggregated daily campaign data only; no customer audiences or ad identifiers for individuals.
CREATE TABLE IF NOT EXISTS marketing_daily_metrics (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 connection_id uuid NOT NULL,
 date date NOT NULL,
 campaign_id text NOT NULL CHECK(length(campaign_id) BETWEEN 1 AND 22),
 campaign_name text NOT NULL DEFAULT '',
 impressions bigint NOT NULL CHECK(impressions>=0),
 clicks bigint NOT NULL CHECK(clicks>=0),
 cost_micros bigint NOT NULL CHECK(cost_micros>=0),
 conversions numeric(18,4) NOT NULL CHECK(conversions>=0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(connection_id,date,campaign_id),
 FOREIGN KEY(tenant_id,connection_id) REFERENCES marketing_connections(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS marketing_daily_metrics_tenant_date ON marketing_daily_metrics(tenant_id,date DESC);

RESET search_path;
