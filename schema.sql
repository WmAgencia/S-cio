
CREATE TABLE IF NOT EXISTS tenants (
 id uuid PRIMARY KEY,
 name text NOT NULL,
 slug text NOT NULL UNIQUE,
 plan text NOT NULL DEFAULT 'essencial',
 status text NOT NULL DEFAULT 'trial' CHECK (status IN ('trial','active','paused')),
 created_at timestamptz NOT NULL DEFAULT now()
);
-- Feature bundles: existing companies retain all functions until the platform owner changes them.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS features jsonb NOT NULL DEFAULT
 '{"whatsapp":true,"catalog":true,"quotes":true,"meta_ads":true,"ai":true,"team":true}'::jsonb;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS quote_alert_whatsapp boolean NOT NULL DEFAULT false;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS quote_alert_enabled_at timestamptz;
CREATE TABLE IF NOT EXISTS users (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 email text NOT NULL UNIQUE,
 name text NOT NULL,
 password_hash text NOT NULL,
 role text NOT NULL DEFAULT 'owner' CHECK (role IN ('owner','admin','agent')),
 platform_owner boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
-- Backward compatible with existing Railway users and passwords.
-- Phone is an optional individual login identifier, never a business channel number.
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone text;
CREATE UNIQUE INDEX IF NOT EXISTS users_phone_login_unique ON users(phone) WHERE phone IS NOT NULL;

CREATE TABLE IF NOT EXISTS sessions (
 token_hash text PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 active_tenant_id uuid NOT NULL REFERENCES tenants(id),
 csrf text NOT NULL,
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE TABLE IF NOT EXISTS channels (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 label text NOT NULL,
 phone text NOT NULL,
 provider text NOT NULL DEFAULT 'meta' CHECK (provider IN ('meta','manual','waakg')),
 external_phone_id text UNIQUE,
 status text NOT NULL DEFAULT 'not_connected',
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (tenant_id,phone)
);
CREATE INDEX IF NOT EXISTS channels_tenant_idx ON channels(tenant_id);
CREATE TABLE IF NOT EXISTS products (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 name text NOT NULL,
 description text NOT NULL DEFAULT '',
 price_cents integer NOT NULL CHECK (price_cents >= 0),
 active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS products_tenant_idx ON products(tenant_id);
CREATE TABLE IF NOT EXISTS agents (
 tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
 name text NOT NULL DEFAULT 'Sócio',
 tone text NOT NULL DEFAULT 'Profissional, natural e prestativo',
 instructions text NOT NULL DEFAULT 'Não invente preços, prazos ou disponibilidade. Em caso de dúvida, encaminhe para um humano.',
 knowledge_md text NOT NULL DEFAULT '',
 enabled boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS imports (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 filename text NOT NULL,
 conversation_count integer NOT NULL DEFAULT 0,
 message_count integer NOT NULL DEFAULT 0,
 sample_md text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS imports_tenant_idx ON imports(tenant_id);
CREATE TABLE IF NOT EXISTS conversations (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 channel_id uuid NOT NULL REFERENCES channels(id),
 customer_name text NOT NULL DEFAULT '',
 customer_phone text NOT NULL,
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','human','resolved')),
 last_message_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,channel_id,customer_phone)
);
CREATE INDEX IF NOT EXISTS conversations_tenant_latest_idx ON conversations(tenant_id,last_message_at DESC);
CREATE TABLE IF NOT EXISTS messages (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
 direction text NOT NULL CHECK(direction IN ('inbound','outbound','note')),
 body text NOT NULL,
 provider_id text,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (tenant_id,provider_id)
);
CREATE INDEX IF NOT EXISTS messages_thread_idx ON messages(tenant_id,conversation_id,created_at);
CREATE TABLE IF NOT EXISTS audit (
 id uuid PRIMARY KEY,
 tenant_id uuid REFERENCES tenants(id),
 actor_id uuid REFERENCES users(id),
 action text NOT NULL,
 metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);


-- On-premise Railway phase: auditable jobs derived ONLY from imported examples.
-- Supabase RLS model is a separate migration, not a production DB switch.
CREATE UNIQUE INDEX IF NOT EXISTS imports_tenant_id_unique ON imports(tenant_id,id);
CREATE TABLE IF NOT EXISTS training_jobs (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','analyzing','paused','completed','cancelled','failed')),
 total_items integer NOT NULL DEFAULT 0 CHECK(total_items>=0),
 processed_items integer NOT NULL DEFAULT 0 CHECK(processed_items>=0 AND processed_items<=total_items),
 report_json jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz,
 UNIQUE(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS training_jobs_tenant_idx ON training_jobs(tenant_id,created_at DESC);
CREATE INDEX IF NOT EXISTS training_jobs_status_idx ON training_jobs(status,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS training_jobs_one_open_per_tenant ON training_jobs(tenant_id) WHERE status IN ('queued','analyzing','paused');
CREATE TABLE IF NOT EXISTS training_job_items (
 job_id uuid NOT NULL,
 tenant_id uuid NOT NULL,
 import_id uuid NOT NULL,
 processed boolean NOT NULL DEFAULT false,
 findings jsonb NOT NULL DEFAULT '{}'::jsonb,
 PRIMARY KEY(job_id,import_id),
 FOREIGN KEY(tenant_id,job_id) REFERENCES training_jobs(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,import_id) REFERENCES imports(tenant_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS training_versions (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 job_id uuid NOT NULL,
 version integer NOT NULL CHECK(version>0),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','archived')),
 knowledge_md text NOT NULL CHECK(char_length(knowledge_md)<=22000),
 report_json jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 approved_at timestamptz,
 FOREIGN KEY(tenant_id,job_id) REFERENCES training_jobs(tenant_id,id) ON DELETE CASCADE,
 UNIQUE(tenant_id,version)
);
CREATE INDEX IF NOT EXISTS training_versions_tenant_idx ON training_versions(tenant_id,created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS training_versions_one_approved_per_tenant ON training_versions(tenant_id) WHERE status='approved';


-- WA-AKG phase 2: read-only bindings; no gateway credential is stored here.
-- Foreign keys include tenant_id so accidental cross-tenant association fails.
-- Avoid taking an ACCESS EXCLUSIVE lock on every app restart.
DO $socio_provider_guard$
BEGIN
 IF EXISTS(
  SELECT 1 FROM pg_constraint WHERE conrelid='channels'::regclass
  AND conname='channels_provider_check'
  AND pg_get_constraintdef(oid) NOT LIKE '%waakg%'
 ) THEN
  ALTER TABLE channels DROP CONSTRAINT channels_provider_check;
  ALTER TABLE channels ADD CONSTRAINT channels_provider_check CHECK(provider IN ('meta','manual','waakg'));
 END IF;
END $socio_provider_guard$;
CREATE UNIQUE INDEX IF NOT EXISTS channels_tenant_id_unique ON channels(tenant_id,id);
-- A physical WA-AKG number may not be claimed by two customer companies.
CREATE UNIQUE INDEX IF NOT EXISTS channels_unique_waakg_phone ON channels(phone) WHERE provider='waakg' AND status='connected';
CREATE UNIQUE INDEX IF NOT EXISTS imports_tenant_id_unique ON imports(tenant_id,id);
CREATE TABLE IF NOT EXISTS waakg_links (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 channel_id uuid NOT NULL,
 session_id text NOT NULL UNIQUE CHECK(char_length(session_id) BETWEEN 6 AND 64),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,channel_id) REFERENCES channels(tenant_id,id) ON DELETE CASCADE,
 UNIQUE(tenant_id,channel_id)
);
CREATE INDEX IF NOT EXISTS waakg_links_tenant_idx ON waakg_links(tenant_id);
CREATE TABLE IF NOT EXISTS waakg_scans (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 channel_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','scanning','importing','paused','failed','completed','cancelled')),
 total_chats integer NOT NULL DEFAULT 0 CHECK(total_chats>=0),
 processed_chats integer NOT NULL DEFAULT 0 CHECK(processed_chats>=0 AND processed_chats<=total_chats),
 imported_chats integer NOT NULL DEFAULT 0 CHECK(imported_chats>=0),
 imported_messages integer NOT NULL DEFAULT 0 CHECK(imported_messages>=0),
 partial_coverage boolean NOT NULL DEFAULT false,
 truncated_chats integer NOT NULL DEFAULT 0 CHECK(truncated_chats>=0),
 error_code text,
 lease_until timestamptz,
 lease_token uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz,
 FOREIGN KEY(tenant_id,channel_id) REFERENCES waakg_links(tenant_id,channel_id),
 UNIQUE(tenant_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS waakg_scan_single_active ON waakg_scans(tenant_id,channel_id)
 WHERE status IN ('queued','scanning','importing','paused');
CREATE INDEX IF NOT EXISTS waakg_scans_queue ON waakg_scans(status,lease_until,created_at);
CREATE TABLE IF NOT EXISTS waakg_scan_chats (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 channel_id uuid NOT NULL,
 scan_id uuid NOT NULL,
 jid_ciphertext text NOT NULL,
 jid_hash char(64) NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','imported','unchanged','empty')),
 message_count integer NOT NULL DEFAULT 0 CHECK(message_count>=0),
 truncated boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,scan_id) REFERENCES waakg_scans(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,channel_id) REFERENCES waakg_links(tenant_id,channel_id),
 UNIQUE(scan_id,jid_hash)
);
CREATE INDEX IF NOT EXISTS waakg_scan_chats_pending ON waakg_scan_chats(scan_id,status);
CREATE TABLE IF NOT EXISTS waakg_import_snapshots (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 channel_id uuid NOT NULL,
 jid_hash char(64) NOT NULL,
 fingerprint char(64) NOT NULL,
 import_id uuid NOT NULL,
 imported_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,channel_id) REFERENCES waakg_links(tenant_id,channel_id),
 FOREIGN KEY(tenant_id,import_id) REFERENCES imports(tenant_id,id) ON DELETE CASCADE,
 UNIQUE(tenant_id,channel_id,jid_hash,fingerprint)
);


-- Catalog phase: additive schema, existing products and prices remain unchanged.
ALTER TABLE products ADD COLUMN IF NOT EXISTS sku text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_quantity integer;
ALTER TABLE products ADD COLUMN IF NOT EXISTS compare_at_price_cents integer;
ALTER TABLE products ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
DO $product_catalog_constraints$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='products_stock_quantity_valid' AND conrelid='products'::regclass)
 THEN ALTER TABLE products ADD CONSTRAINT products_stock_quantity_valid CHECK(stock_quantity IS NULL OR stock_quantity>=0); END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='products_compare_at_valid' AND conrelid='products'::regclass)
 THEN ALTER TABLE products ADD CONSTRAINT products_compare_at_valid CHECK(compare_at_price_cents IS NULL OR compare_at_price_cents>=0); END IF;
END $product_catalog_constraints$;
CREATE UNIQUE INDEX IF NOT EXISTS products_tenant_id_fk ON products(tenant_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS products_tenant_sku_unique ON products(tenant_id,sku) WHERE sku IS NOT NULL AND sku<>'';
CREATE TABLE IF NOT EXISTS product_variants(
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 product_id uuid NOT NULL,
 name text NOT NULL CHECK(char_length(name) BETWEEN 1 AND 100),
 sku text,
 price_cents integer NOT NULL CHECK(price_cents>=0 AND price_cents<100000000),
 stock_quantity integer CHECK(stock_quantity IS NULL OR stock_quantity>=0),
 active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,product_id) REFERENCES products(tenant_id,id) ON DELETE CASCADE,
 UNIQUE(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS product_variants_tenant_product ON product_variants(tenant_id,product_id);
CREATE UNIQUE INDEX IF NOT EXISTS product_variants_tenant_sku_unique ON product_variants(tenant_id,sku) WHERE sku IS NOT NULL AND sku<>'';
CREATE TABLE IF NOT EXISTS product_media (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 product_id uuid NOT NULL,
 object_key text NOT NULL,
 content_type text NOT NULL CHECK(content_type='image/jpeg'),
 bytes integer NOT NULL CHECK(bytes>0 AND bytes<=2200000),
 alt text NOT NULL DEFAULT '' CHECK(char_length(alt)<=200),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,product_id) REFERENCES products(tenant_id,id) ON DELETE CASCADE,
 UNIQUE(tenant_id,object_key)
);
CREATE INDEX IF NOT EXISTS product_media_tenant_product ON product_media(tenant_id,product_id);
CREATE TABLE IF NOT EXISTS product_campaign_links (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 product_id uuid NOT NULL,
 provider text NOT NULL CHECK(provider IN ('meta_ads','google_ads')),
 campaign_id text NOT NULL CHECK(char_length(campaign_id) BETWEEN 1 AND 150),
 label text NOT NULL DEFAULT '' CHECK(char_length(label)<=120),
 verified boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,product_id) REFERENCES products(tenant_id,id) ON DELETE CASCADE,
 UNIQUE(tenant_id,product_id,provider,campaign_id)
);
CREATE INDEX IF NOT EXISTS product_campaign_links_tenant_product ON product_campaign_links(tenant_id,product_id);


-- Conversas: tenant-owned operational metadata, never WhatsApp network actions.
-- Keep cross-tenant foreign keys and preserve imported records.
CREATE UNIQUE INDEX IF NOT EXISTS conversations_tenant_id_unique ON conversations(tenant_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS messages_tenant_id_unique ON messages(tenant_id,id);
ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_id uuid;
CREATE INDEX IF NOT EXISTS messages_reply_ref_idx ON messages(tenant_id,reply_to_id) WHERE reply_to_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS conversation_ui_state (
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 conversation_id uuid NOT NULL,
 pinned boolean NOT NULL DEFAULT false,
 favorite boolean NOT NULL DEFAULT false,
 archived boolean NOT NULL DEFAULT false,
 muted boolean NOT NULL DEFAULT false,
 marked_unread boolean NOT NULL DEFAULT false,
 last_read_at timestamptz,
 draft text NOT NULL DEFAULT '' CHECK (char_length(draft) <= 3000),
 labels text[] NOT NULL DEFAULT ARRAY[]::text[],
 assigned_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
 handling_mode text NOT NULL DEFAULT 'human' CHECK(handling_mode IN ('human','ai_assist')),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (tenant_id,conversation_id),
 FOREIGN KEY (tenant_id,conversation_id) REFERENCES conversations(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS conversation_ui_state_owner_idx ON conversation_ui_state(tenant_id,pinned,archived);
CREATE TABLE IF NOT EXISTS message_ui_state (
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 message_id uuid NOT NULL,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 starred boolean NOT NULL DEFAULT false,
 reaction text CHECK(reaction IS NULL OR char_length(reaction)<=16),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,message_id,user_id),
 FOREIGN KEY(tenant_id,message_id) REFERENCES messages(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS message_ui_state_starred_idx ON message_ui_state(tenant_id,user_id,starred) WHERE starred=true;


-- Optional public business registration data for master onboarding.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS cnpj char(14);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS legal_name text NOT NULL DEFAULT '';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS trade_name text NOT NULL DEFAULT '';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS company_profile jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS tenants_cnpj_unique ON tenants(cnpj) WHERE cnpj IS NOT NULL;

-- One-click supervised WhatsApp history analysis; drafts still require approval.
CREATE TABLE IF NOT EXISTS training_auto_runs (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 status text NOT NULL DEFAULT 'scanning' CHECK(status IN ('scanning','analyzing','completed','failed','cancelled')),
 scan_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
 job_id uuid,
 error_code text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS training_auto_one_active ON training_auto_runs(tenant_id)
 WHERE status IN ('scanning','analyzing');
CREATE INDEX IF NOT EXISTS training_auto_recent ON training_auto_runs(tenant_id,created_at DESC);

-- Outgoing delivery journal: prevents duplicate sends after retries/timeouts.
-- No automatic retries of uncertain WhatsApp requests.
ALTER TABLE conversation_ui_state ADD COLUMN IF NOT EXISTS ai_activated_at timestamptz;
CREATE TABLE IF NOT EXISTS message_outbox (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 conversation_id uuid NOT NULL,
 user_id uuid REFERENCES users(id) ON DELETE SET NULL,
 client_request_id uuid NOT NULL,
 mode text NOT NULL CHECK(mode IN ('human','ai')),
 body text NOT NULL CHECK(char_length(body) BETWEEN 1 AND 3000),
 reply_to_id uuid,
 status text NOT NULL DEFAULT 'pending'
  CHECK(status IN ('pending','processing','sent','uncertain','cancelled')),
 provider_id text,
 error_code text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,client_request_id),
 FOREIGN KEY (tenant_id,conversation_id) REFERENCES conversations(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS message_outbox_tenant_status_idx ON message_outbox(tenant_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS message_outbox_ai_conversation_idx ON message_outbox(tenant_id,conversation_id,created_at DESC) WHERE mode='ai';

-- Exactly one automatic reply attempt per inbound message, regardless of
-- application restarts or replicas; a failed attempt needs human review.
CREATE TABLE IF NOT EXISTS ai_reply_attempts (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 conversation_id uuid NOT NULL,
 inbound_message_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'generating'
  CHECK(status IN ('generating','sent','failed','cancelled')),
 reason text,
 created_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz,
 UNIQUE(tenant_id,inbound_message_id),
 FOREIGN KEY(tenant_id,conversation_id) REFERENCES conversations(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,inbound_message_id) REFERENCES messages(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ai_reply_attempts_recent ON ai_reply_attempts(tenant_id,conversation_id,created_at DESC);

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


-- Phase 6 — one authorized Instagram professional account per channel and
-- per company. Tokens are AES-256-GCM encrypted at rest by the server.
DO $socio_instagram_provider$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_constraint
   WHERE conrelid='channels'::regclass AND conname='channels_provider_check'
     AND pg_get_constraintdef(oid) NOT LIKE '%instagram%') THEN
  ALTER TABLE channels DROP CONSTRAINT channels_provider_check;
  ALTER TABLE channels ADD CONSTRAINT channels_provider_check
   CHECK(provider IN ('meta','manual','waakg','instagram'));
 END IF;
END $socio_instagram_provider$;

CREATE TABLE IF NOT EXISTS instagram_oauth_states (
 state_hash text PRIMARY KEY CHECK(length(state_hash)=64),
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL,
 consumed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS instagram_oauth_expiry ON instagram_oauth_states(expires_at);

CREATE TABLE IF NOT EXISTS instagram_accounts (
 channel_id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 ig_user_id text NOT NULL UNIQUE,
 username text NOT NULL,
 token_ciphertext text,
 token_expires_at timestamptz,
 status text NOT NULL DEFAULT 'connected' CHECK(status IN ('connected','revoked')),
 updated_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,channel_id) REFERENCES channels(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS instagram_accounts_tenant_idx ON instagram_accounts(tenant_id);

CREATE TABLE IF NOT EXISTS instagram_outbox (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 conversation_id uuid NOT NULL,
 user_id uuid NOT NULL REFERENCES users(id),
 client_request_id uuid NOT NULL,
 text_sha256 text NOT NULL CHECK(length(text_sha256)=64),
 status text NOT NULL CHECK(status IN ('processing','sent','failed','uncertain')),
 provider_message_id text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,client_request_id),
 FOREIGN KEY(tenant_id,conversation_id) REFERENCES conversations(tenant_id,id),
 FOREIGN KEY(tenant_id,user_id) REFERENCES users(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS instagram_outbox_recent ON instagram_outbox(tenant_id,created_at DESC);


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


-- OAuth-only social connectors. Consent is stored by tenant + platform;
-- authorizing Pipeboard does not mean an ads account is linked.
CREATE TABLE IF NOT EXISTS marketing_oauth_attempts (
 state_hash text PRIMARY KEY CHECK(length(state_hash)=64),
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 user_id uuid NOT NULL,
 provider text NOT NULL CHECK(provider IN ('meta','google')),
 data_ciphertext text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 consumed_at timestamptz,
 FOREIGN KEY(tenant_id,user_id) REFERENCES users(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS marketing_oauth_attempts_tenant ON marketing_oauth_attempts(tenant_id,expires_at);

CREATE TABLE IF NOT EXISTS marketing_oauth_grants (
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 user_id uuid NOT NULL,
 provider text NOT NULL CHECK(provider IN ('meta','google')),
 token_ciphertext text,
 status text NOT NULL CHECK(status IN ('authorized','disconnected')),
 expires_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,provider),
 FOREIGN KEY(tenant_id,user_id) REFERENCES users(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS marketing_oauth_grants_actor_idx ON marketing_oauth_grants(tenant_id,user_id);

-- Result of the latest real, read-only account inspection, not just an OAuth login.
-- Status is reset on each new authorization, and is never a claim of current access
-- after the saved check has become stale.
ALTER TABLE marketing_oauth_grants ADD COLUMN IF NOT EXISTS last_checked_at timestamptz;
ALTER TABLE marketing_oauth_grants ADD COLUMN IF NOT EXISTS last_read_status text NOT NULL DEFAULT 'not_tested'
 CHECK(last_read_status IN ('not_tested','verified','no_accounts'));
ALTER TABLE marketing_oauth_grants ADD COLUMN IF NOT EXISTS last_account_count integer NOT NULL DEFAULT 0
 CHECK(last_account_count BETWEEN 0 AND 200);


-- One managed Instagram social profile per business, with a provider profile
-- key encrypted server-side. No Instagram password or session cookie is stored.
CREATE TABLE IF NOT EXISTS instagram_hosted_profiles (
 tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
 profile_ref text NOT NULL UNIQUE CHECK(length(profile_ref) BETWEEN 10 AND 128),
 profile_key_ciphertext text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','linked')),
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,created_by) REFERENCES users(tenant_id,id)
);


-- Customer-initiated budget requests are NOT priced or sent to customers by AI.
-- Incoming message uniqueness prevents duplicate owner alerts when a worker restarts.
CREATE TABLE IF NOT EXISTS quote_requests (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 conversation_id uuid NOT NULL,
 inbound_message_id uuid NOT NULL,
 customer_name text NOT NULL DEFAULT '',
 customer_phone text NOT NULL DEFAULT '',
 summary text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'pending'
  CHECK(status IN ('pending','preparing','resolved')),
 alert_status text NOT NULL DEFAULT 'pending'
  CHECK(alert_status IN ('pending','processing','sent','unconfirmed')),
 alert_last_attempt_at timestamptz,
 alert_sent_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,inbound_message_id),
 UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,conversation_id) REFERENCES conversations(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,inbound_message_id) REFERENCES messages(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS quote_requests_tenant_status ON quote_requests(tenant_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS quote_requests_delivery_queue ON quote_requests(alert_status,created_at);


-- Supervised purchase opportunities. Each inbound message yields at most one card.
-- A potential sale is NOT a paid order; prices come from the official tenant catalogue.
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

-- Sócio Ads Media Bridge — isolamento por tenant, sem mídia ou token públicos.
CREATE TABLE IF NOT EXISTS ads_media (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 created_by uuid NOT NULL,
 filename text NOT NULL CHECK(length(filename) BETWEEN 5 AND 149),
 source text NOT NULL CHECK(source IN ('chat','whatsapp','mcp')),
 object_key text NOT NULL UNIQUE,
 content_type text NOT NULL CHECK(content_type IN ('video/mp4','video/quicktime')),
 status text NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','uploading','ready','failed')),
 bytes bigint CHECK(bytes IS NULL OR bytes BETWEEN 512 AND 94371840),
 sha256 text CHECK(sha256 IS NULL OR length(sha256)=64),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,created_by) REFERENCES users(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS ads_media_tenant_time ON ads_media(tenant_id,created_at DESC);
CREATE TABLE IF NOT EXISTS ads_media_mcp_tokens (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 created_by uuid NOT NULL,
 token_hash text NOT NULL UNIQUE CHECK(length(token_hash)=64),
 expires_at timestamptz NOT NULL,
 revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,created_by) REFERENCES users(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS ads_media_tokens_issued ON ads_media_mcp_tokens(tenant_id,created_by,expires_at);


-- OAuth 2.1 for ChatGPT custom MCP; credentials hashed, scoped by user+tenant.
CREATE TABLE IF NOT EXISTS ads_oauth_clients (
 client_id text PRIMARY KEY,
 redirect_uris jsonb NOT NULL,
 client_name text NOT NULL DEFAULT 'ChatGPT',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ads_oauth_codes (
 id uuid PRIMARY KEY,
 code_hash text NOT NULL UNIQUE CHECK(length(code_hash)=64),
 client_id text NOT NULL REFERENCES ads_oauth_clients(client_id) ON DELETE CASCADE,
 redirect_uri text NOT NULL,
 code_challenge text NOT NULL CHECK(length(code_challenge)=43),
 resource text NOT NULL,
 scope text NOT NULL,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL,
 used_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ads_oauth_codes_expiry ON ads_oauth_codes(expires_at);
CREATE TABLE IF NOT EXISTS ads_oauth_tokens (
 id uuid PRIMARY KEY,
 access_hash text NOT NULL UNIQUE CHECK(length(access_hash)=64),
 refresh_hash text NOT NULL UNIQUE CHECK(length(refresh_hash)=64),
 client_id text NOT NULL REFERENCES ads_oauth_clients(client_id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 resource text NOT NULL,
 scope text NOT NULL,
 access_expires_at timestamptz NOT NULL,
 refresh_expires_at timestamptz NOT NULL,
 revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ads_oauth_tokens_owner ON ads_oauth_tokens(tenant_id,user_id);
-- API Anything: browser sessions are scoped to both company and signed-in user.
CREATE TABLE IF NOT EXISTS meta_browser_connections (
 id text PRIMARY KEY CHECK (id ~ '^[a-f0-9]{32}$'),
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 status text NOT NULL CHECK (status IN ('active','disconnected')) DEFAULT 'active',
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS meta_browser_active_actor ON meta_browser_connections(tenant_id,user_id) WHERE status='active';
CREATE TABLE IF NOT EXISTS meta_browser_writes (
 id uuid PRIMARY KEY,
 connection_id text NOT NULL REFERENCES meta_browser_connections(id) ON DELETE CASCADE,
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 key_hash text NOT NULL, payload_hash text NOT NULL,
 status text NOT NULL CHECK (status IN ('pending','done')),
 result jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(connection_id,key_hash)
);
CREATE TABLE IF NOT EXISTS meta_local_connections (
 id text PRIMARY KEY CHECK (id ~ '^[a-f0-9]{32}$'),
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 status text NOT NULL CHECK (status IN ('pending','active','disconnected')),
 pair_hash text UNIQUE, pair_expires_at timestamptz, token_hash text UNIQUE,
 device_label text NOT NULL DEFAULT '', last_seen_at timestamptz,
 session_present boolean NOT NULL DEFAULT false, browser_open boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS meta_local_active_actor ON meta_local_connections(tenant_id,user_id) WHERE status='active';
CREATE TABLE IF NOT EXISTS meta_local_jobs (
 id uuid PRIMARY KEY, connection_id text NOT NULL REFERENCES meta_local_connections(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('login','status','plan','execute')),
 input jsonb NOT NULL DEFAULT '{}', status text NOT NULL CHECK(status IN ('pending','leased','done')),
 key_hash text, payload_hash text, lease_hash text, result jsonb,
 created_at timestamptz NOT NULL DEFAULT now(), claimed_at timestamptz, completed_at timestamptz,
 UNIQUE(connection_id,key_hash)
);

-- Official Meta grants are private and scoped to both tenant and user.
CREATE TABLE IF NOT EXISTS meta_official_states (
 state_hash text PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, session_hash text NOT NULL,
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE meta_official_states ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
CREATE TABLE IF NOT EXISTS meta_official_grants (
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 meta_user_id text NOT NULL, token_encrypted text NOT NULL, scopes text[] NOT NULL,
 expires_at timestamptz NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,user_id)
);

CREATE TABLE IF NOT EXISTS meta_official_revocations (
 meta_user_hash text PRIMARY KEY, revoked_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS meta_official_deletions (
 confirmation_code text PRIMARY KEY, completed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS meta_official_grants_meta_user_idx ON meta_official_grants(meta_user_id);

-- One explicit advertising destination per company. Grant removal clears it.
CREATE TABLE IF NOT EXISTS meta_official_account_selections (
 tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
 user_id uuid NOT NULL, account_id text NOT NULL, account_name text NOT NULL,
 currency text, updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,user_id) REFERENCES meta_official_grants(tenant_id,user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS meta_ads_plans (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, account_id text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('create','status','rename','budget')),
 payload jsonb NOT NULL, summary jsonb NOT NULL,
 status text NOT NULL CHECK(status IN ('ready','running','succeeded','failed','uncertain')),
 result jsonb NOT NULL DEFAULT '{}', expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS meta_ads_plans_tenant_idx ON meta_ads_plans(tenant_id,created_at DESC);
-- Permit the new WhatsApp destination without weakening existing approvals.
DO $socio_meta_whatsapp_kind$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='meta_ads_plans'::regclass
  AND conname='meta_ads_plans_kind_check'
  AND (pg_get_constraintdef(oid) NOT LIKE '%create_whatsapp%'
   OR pg_get_constraintdef(oid) NOT LIKE '%create_ad%')) THEN
  ALTER TABLE meta_ads_plans DROP CONSTRAINT meta_ads_plans_kind_check;
  ALTER TABLE meta_ads_plans ADD CONSTRAINT meta_ads_plans_kind_check
   CHECK(kind IN ('create','create_whatsapp','create_ad','status','rename','budget'));
 END IF;
END $socio_meta_whatsapp_kind$;


-- WhatsApp attribution phase 1: codes embedded in prefilled click-to-chat messages.
-- The code is not a credential and does NOT prove a Meta click or paid sale.
CREATE TABLE IF NOT EXISTS wa_tracking_links (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 channel_id uuid NOT NULL,
 created_by uuid REFERENCES users(id) ON DELETE SET NULL,
 account_id text NOT NULL CHECK(account_id ~ '^act_[0-9]{4,20}$'),
 label text NOT NULL CHECK(char_length(label) BETWEEN 3 AND 90),
 campaign_id text CHECK(campaign_id IS NULL OR campaign_id ~ '^[0-9]{4,30}$'),
 adset_id text CHECK(adset_id IS NULL OR adset_id ~ '^[0-9]{4,30}$'),
 ad_id text CHECK(ad_id IS NULL OR ad_id ~ '^[0-9]{4,30}$'),
 code text NOT NULL UNIQUE CHECK(code ~ '^SC[A-F0-9]{20}$'),
 active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,channel_id) REFERENCES channels(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS wa_tracking_links_tenant_idx ON wa_tracking_links(tenant_id,created_at DESC);
CREATE TABLE IF NOT EXISTS wa_lead_attributions (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 conversation_id uuid NOT NULL,
 inbound_message_id uuid NOT NULL,
 link_id uuid NOT NULL,
 method text NOT NULL CHECK(method='message_code'),
 confidence text NOT NULL CHECK(confidence='indicative'),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,conversation_id),
 UNIQUE(tenant_id,inbound_message_id),
 FOREIGN KEY(tenant_id,conversation_id) REFERENCES conversations(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,inbound_message_id) REFERENCES messages(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,link_id) REFERENCES wa_tracking_links(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS wa_lead_attributions_link_idx ON wa_lead_attributions(tenant_id,link_id,created_at DESC);
