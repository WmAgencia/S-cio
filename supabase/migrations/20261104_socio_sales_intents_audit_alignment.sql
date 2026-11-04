-- Additive private-schema alignment for supervised sales; no data copy or cutover.
BEGIN;
SET LOCAL search_path TO socio_app,pg_catalog;
DO $guard$ BEGIN
 IF has_schema_privilege('anon','socio_app','USAGE') OR has_schema_privilege('authenticated','socio_app','USAGE') THEN
  RAISE EXCEPTION 'Refusing migration: private schema exposed';
 END IF;
END $guard$;

CREATE TABLE IF NOT EXISTS sale_intents (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 conversation_id uuid NOT NULL,
 inbound_message_id uuid NOT NULL,
 customer_name text NOT NULL DEFAULT '',
 customer_phone text NOT NULL DEFAULT '',
 summary text NOT NULL DEFAULT '',
 items jsonb NOT NULL DEFAULT '[]'::jsonb,
 amount_cents integer CHECK(amount_cents IS NULL OR amount_cents BETWEEN 1 AND 99999999),
 status text NOT NULL DEFAULT 'pending'
  CHECK(status IN ('pending','contacted','completed','dismissed')),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),
 UNIQUE(tenant_id,inbound_message_id),
 FOREIGN KEY(tenant_id,conversation_id) REFERENCES conversations(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,inbound_message_id) REFERENCES messages(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS sale_intents_tenant_recent ON sale_intents(tenant_id,status,created_at DESC);

-- Manually reviewed custom estimates. One customer-directed send per request;
-- uncertain gateway delivery is never retried without deliberate intervention.
ALTER TABLE quote_requests ADD COLUMN IF NOT EXISTS draft_text text;
ALTER TABLE quote_requests ADD COLUMN IF NOT EXISTS draft_amount_cents integer;
ALTER TABLE quote_requests ADD COLUMN IF NOT EXISTS delivery_status text NOT NULL DEFAULT 'not_sent';
ALTER TABLE quote_requests ADD COLUMN IF NOT EXISTS quote_sent_at timestamptz;
DO $quote_amount_check$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='quote_requests_draft_amount_nonnegative' AND conrelid='quote_requests'::regclass) THEN
  ALTER TABLE quote_requests ADD CONSTRAINT quote_requests_draft_amount_nonnegative CHECK(draft_amount_cents IS NULL OR draft_amount_cents BETWEEN 1 AND 99999999) NOT VALID;
 END IF;
END $quote_amount_check$;

ALTER TABLE socio_app.sale_intents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON socio_app.sale_intents FROM PUBLIC,anon,authenticated;
COMMIT;
