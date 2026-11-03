
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
 provider text NOT NULL DEFAULT 'meta' CHECK (provider IN ('meta','manual')),
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
