-- Sócio staging only. Do not cut over production Railway data or expose private schema.
SET search_path TO socio_app,pg_catalog;
DO $guard$
BEGIN
 IF EXISTS(SELECT 1 FROM socio_app.tenants) OR
    has_schema_privilege('anon','socio_app','USAGE') OR
    has_schema_privilege('authenticated','socio_app','USAGE') THEN
  RAISE EXCEPTION 'Quote/multi-module schema only allowed on empty private staging.';
 END IF;
END $guard$;

-- Features configurable per company; default on for existing tenants.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS features jsonb NOT NULL DEFAULT
 '{"whatsapp":true,"catalog":true,"sales":true,"ai":true,"metaAds":true}'::jsonb;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS quote_alerts_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS quote_alert_owner_id uuid;
DO $quote_alert_owner$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='socio_quote_alert_owner_tenant_fk') THEN
  ALTER TABLE tenants ADD CONSTRAINT socio_quote_alert_owner_tenant_fk
   FOREIGN KEY(id,quote_alert_owner_id) REFERENCES users(tenant_id,id) NOT VALID;
 END IF;
END $quote_alert_owner$;


-- Requests detected in recent WhatsApp conversations explicitly handed to AI.
-- Nothing here is a quoted price, payment request or permission for unsolicited DMs.
CREATE TABLE IF NOT EXISTS quote_requests (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 conversation_id uuid NOT NULL,
 inbound_message_id uuid NOT NULL,
 request_excerpt text NOT NULL CHECK(length(request_excerpt) BETWEEN 1 AND 700),
 status text NOT NULL DEFAULT 'pending'
   CHECK(status IN ('pending','preparing','done','dismissed')),
 alert_status text NOT NULL DEFAULT 'disabled'
   CHECK(alert_status IN ('disabled','pending','sending','sent','uncertain','unavailable')),
 alert_attempted_at timestamptz,
 alerted_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,inbound_message_id),
 UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,conversation_id) REFERENCES conversations(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,inbound_message_id) REFERENCES messages(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS quote_requests_inbox_idx ON quote_requests(tenant_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS quote_requests_alerts_idx ON quote_requests(alert_status,created_at)
 WHERE alert_status='pending';

RESET search_path;
