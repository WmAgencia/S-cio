-- Private empty-schema alignment. Never run against active customer data.
SET search_path TO socio_app,pg_catalog;
DO $guard$
BEGIN
 IF EXISTS(SELECT 1 FROM socio_app.tenants)
  OR has_schema_privilege('anon','socio_app','USAGE')
  OR has_schema_privilege('authenticated','socio_app','USAGE') THEN
  RAISE EXCEPTION 'OAuth schema can only be applied to the private empty staging environment';
 END IF;
END $guard$;

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

RESET search_path;
