
-- OAuth 2.1 for ChatGPT custom MCP; credentials hashed, scoped by user+tenant.
CREATE TABLE IF NOT EXISTS socio_app.ads_oauth_clients (
 client_id text PRIMARY KEY,
 redirect_uris jsonb NOT NULL,
 client_name text NOT NULL DEFAULT 'ChatGPT',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS socio_app.ads_oauth_codes (
 id uuid PRIMARY KEY,
 code_hash text NOT NULL UNIQUE CHECK(length(code_hash)=64),
 client_id text NOT NULL REFERENCES socio_app.ads_oauth_clients(client_id) ON DELETE CASCADE,
 redirect_uri text NOT NULL,
 code_challenge text NOT NULL CHECK(length(code_challenge)=43),
 resource text NOT NULL,
 scope text NOT NULL,
 user_id uuid NOT NULL REFERENCES socio_app.users(id) ON DELETE CASCADE,
 tenant_id uuid NOT NULL REFERENCES socio_app.tenants(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL,
 used_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ads_oauth_codes_expiry ON socio_app.ads_oauth_codes(expires_at);
CREATE TABLE IF NOT EXISTS socio_app.ads_oauth_tokens (
 id uuid PRIMARY KEY,
 access_hash text NOT NULL UNIQUE CHECK(length(access_hash)=64),
 refresh_hash text NOT NULL UNIQUE CHECK(length(refresh_hash)=64),
 client_id text NOT NULL REFERENCES socio_app.ads_oauth_clients(client_id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES socio_app.users(id) ON DELETE CASCADE,
 tenant_id uuid NOT NULL REFERENCES socio_app.tenants(id) ON DELETE CASCADE,
 resource text NOT NULL,
 scope text NOT NULL,
 access_expires_at timestamptz NOT NULL,
 refresh_expires_at timestamptz NOT NULL,
 revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ads_oauth_tokens_owner ON socio_app.ads_oauth_tokens(tenant_id,user_id);

REVOKE ALL ON socio_app.ads_oauth_clients,socio_app.ads_oauth_codes,socio_app.ads_oauth_tokens FROM anon,authenticated;
