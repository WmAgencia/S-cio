CREATE TABLE IF NOT EXISTS socio_daily_owner_reports (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 group_id uuid NOT NULL REFERENCES socio_owner_groups(id) ON DELETE CASCADE,
 report_date date NOT NULL,
 status text NOT NULL CHECK(status IN ('sending','sent','uncertain')),
 provider_message_id text,
 summary jsonb,
 error_code text,
 sent_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(group_id,report_date)
);
CREATE INDEX IF NOT EXISTS socio_daily_owner_reports_tenant_idx
 ON socio_daily_owner_reports(tenant_id,report_date DESC);
