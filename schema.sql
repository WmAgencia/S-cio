
CREATE TABLE IF NOT EXISTS tenants (
 id uuid PRIMARY KEY,
 name text NOT NULL,
 slug text NOT NULL UNIQUE,
 plan text NOT NULL DEFAULT 'essencial',
 status text NOT NULL DEFAULT 'trial' CHECK (status IN ('trial','active','paused')),
 created_at timestamptz NOT NULL DEFAULT now()
);
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
