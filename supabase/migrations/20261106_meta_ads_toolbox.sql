-- Supabase preparation only; Railway remains the live production database.
-- The Meta token stays server-side and never enters public schemas.
DO $socio_meta_toolbox$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_constraint
  WHERE conrelid='socio_app.meta_ads_plans'::regclass
  AND conname='meta_ads_plans_kind_check'
  AND (pg_get_constraintdef(oid) NOT LIKE '%create_whatsapp%'
   OR pg_get_constraintdef(oid) NOT LIKE '%create_ad%')) THEN
  ALTER TABLE socio_app.meta_ads_plans DROP CONSTRAINT meta_ads_plans_kind_check;
  ALTER TABLE socio_app.meta_ads_plans ADD CONSTRAINT meta_ads_plans_kind_check
   CHECK(kind IN ('create','create_whatsapp','create_ad','status','rename','budget'));
 END IF;
END $socio_meta_toolbox$;
CREATE TABLE IF NOT EXISTS socio_app.meta_report_schedules (
 tenant_id uuid PRIMARY KEY REFERENCES socio_app.tenants(id) ON DELETE CASCADE,
 user_id uuid NOT NULL,
 account_id text NOT NULL CHECK(account_id ~ '^act_[0-9]{4,20}$'),
 hour text NOT NULL DEFAULT '20:00' CHECK(hour ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
 time_zone text NOT NULL DEFAULT 'America/Sao_Paulo',
 period text NOT NULL DEFAULT 'yesterday'
  CHECK(period IN ('today','yesterday','last_7d','last_30d')),
 enabled boolean NOT NULL DEFAULT false,
 next_run_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,user_id) REFERENCES socio_app.meta_official_grants(tenant_id,user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS meta_report_schedules_due_idx ON socio_app.meta_report_schedules(next_run_at)
 WHERE enabled=true;
CREATE TABLE IF NOT EXISTS socio_app.meta_report_runs (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES socio_app.tenants(id) ON DELETE CASCADE,
 scheduled_for timestamptz NOT NULL,
 status text NOT NULL CHECK(status IN ('running','completed','failed')),
 summary jsonb,
 error_code text,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,scheduled_for)
);
CREATE INDEX IF NOT EXISTS meta_report_runs_recent_idx
 ON socio_app.meta_report_runs(tenant_id,scheduled_for DESC);
REVOKE ALL ON socio_app.meta_report_schedules,socio_app.meta_report_runs FROM anon,authenticated;
