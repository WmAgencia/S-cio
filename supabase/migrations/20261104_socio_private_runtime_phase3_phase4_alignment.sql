-- Private Supabase runtime compatibility: Fases 3/4, no production-data copies.
-- Explicit private search_path; the public.socio_* RLS structures are unaffected.
-- Requires existing private socio_app schema from approved earlier migrations.
SET LOCAL search_path TO socio_app, pg_catalog;
DO $phase5_empty$
BEGIN
 IF (SELECT count(*) FROM socio_app.tenants)>0 OR (SELECT count(*) FROM socio_app.users)>0
    OR (SELECT count(*) FROM socio_app.conversations)>0 OR (SELECT count(*) FROM socio_app.messages)>0
    THEN RAISE EXCEPTION 'Refusing to align schema with existing runtime data without a verified backup';
 END IF;
 IF has_schema_privilege('anon','socio_app','USAGE')
    OR has_schema_privilege('authenticated','socio_app','USAGE') THEN
    RAISE EXCEPTION 'Private runtime schema is exposed to Data API roles';
 END IF;
END $phase5_empty$;

-- Sócio Fase 3: vendas e aprovações; alterações aditivas sem cobranças automáticas.
CREATE UNIQUE INDEX IF NOT EXISTS conversations_tenant_sales_fk ON conversations(tenant_id,id);
CREATE TABLE IF NOT EXISTS sales_quotes (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 conversation_id uuid NOT NULL,
 series_id uuid NOT NULL,
 version integer NOT NULL CHECK(version>0),
 status text NOT NULL DEFAULT 'draft'
  CHECK(status IN ('draft','issued','accepted','declined','superseded','cancelled','expired')),
 currency char(3) NOT NULL DEFAULT 'BRL' CHECK(currency='BRL'),
 amount_cents integer NOT NULL CHECK(amount_cents>0 AND amount_cents<100000000),
 items jsonb NOT NULL,
 token_hash char(64) UNIQUE,
 buyer_name text,
 expires_at timestamptz,
 accepted_at timestamptz,
 created_by uuid REFERENCES users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,conversation_id) REFERENCES conversations(tenant_id,id) ON DELETE CASCADE,
 UNIQUE(tenant_id,series_id,version),
 UNIQUE(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS sales_quotes_tenant_recent ON sales_quotes(tenant_id,created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS sales_quotes_one_issued_per_series
 ON sales_quotes(tenant_id,series_id) WHERE status='issued';
CREATE TABLE IF NOT EXISTS sales_orders (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 quote_id uuid NOT NULL,
 conversation_id uuid NOT NULL,
 customer_name text NOT NULL,
 amount_cents integer NOT NULL CHECK(amount_cents>0),
 items jsonb NOT NULL,
 status text NOT NULL DEFAULT 'pending_payment'
  CHECK(status IN ('pending_payment','paid_test','manual_review','cancelled')),
 payment_provider text,
 payment_session_id text UNIQUE,
 payment_url text,
 paid_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,quote_id),
 UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,quote_id) REFERENCES sales_quotes(tenant_id,id),
 FOREIGN KEY(tenant_id,conversation_id) REFERENCES conversations(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS sales_orders_tenant_recent ON sales_orders(tenant_id,created_at DESC);
CREATE TABLE IF NOT EXISTS sales_payment_events (
 event_id text PRIMARY KEY,
 order_id uuid NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
 provider text NOT NULL,
 processed_at timestamptz NOT NULL DEFAULT now()
);


-- Phase 4, additive authorization + tenant integrity hardening.
-- Inactive team members cannot authenticate and all their sessions are revoked
-- as part of the corresponding member-management transaction.
ALTER TABLE users ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
CREATE UNIQUE INDEX IF NOT EXISTS socio_users_tenant_id_unique ON users(tenant_id,id);
CREATE INDEX IF NOT EXISTS socio_users_tenant_status_idx ON users(tenant_id,active,role);
CREATE INDEX IF NOT EXISTS socio_audit_tenant_recent ON audit(tenant_id,created_at DESC,id DESC);

-- Enforce new writes at the database layer, not just in route handlers.
-- NOT VALID is deliberate: avoid rejecting an existing production schema
-- until the separately documented integrity preflight inspects old records.
DO $socio_phase4_tenant_guards$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='socio_conversation_tenant_channel') THEN
  ALTER TABLE conversations ADD CONSTRAINT socio_conversation_tenant_channel
   FOREIGN KEY(tenant_id,channel_id) REFERENCES channels(tenant_id,id) NOT VALID;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='socio_message_tenant_conversation') THEN
  ALTER TABLE messages ADD CONSTRAINT socio_message_tenant_conversation
   FOREIGN KEY(tenant_id,conversation_id) REFERENCES conversations(tenant_id,id) NOT VALID;
 END IF;
END $socio_phase4_tenant_guards$;
