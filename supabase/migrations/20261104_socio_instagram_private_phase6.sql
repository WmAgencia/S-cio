-- Sócio stage-6 private schema alignment, no customer data copied.
SET search_path TO socio_app,pg_catalog;
DO $socio_instagram_empty_check$
BEGIN
 IF EXISTS(SELECT 1 FROM socio_app.tenants)
  OR EXISTS(SELECT 1 FROM socio_app.users)
  OR has_schema_privilege('anon','socio_app','USAGE')
  OR has_schema_privilege('authenticated','socio_app','USAGE') THEN
   RAISE EXCEPTION 'Refusing Instagram staging update: runtime data or exposed schema detected';
 END IF;
END $socio_instagram_empty_check$;

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

RESET search_path;
