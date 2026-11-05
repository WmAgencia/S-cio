-- Copy the same private, tenant-scoped advertising-media schema to Supabase
-- if a future, supervised migration moves Sócio away from Railway PostgreSQL.
-- Runtime still uses Railway. Never expose this schema to anon/authenticated.
CREATE TABLE IF NOT EXISTS socio_app.ads_media (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES socio_app.tenants(id) ON DELETE CASCADE,
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
 FOREIGN KEY(tenant_id,created_by) REFERENCES socio_app.users(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS ads_media_tenant_time ON socio_app.ads_media(tenant_id,created_at DESC);
CREATE TABLE IF NOT EXISTS socio_app.ads_media_mcp_tokens (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES socio_app.tenants(id) ON DELETE CASCADE,
 created_by uuid NOT NULL,
 token_hash text NOT NULL UNIQUE CHECK(length(token_hash)=64),
 expires_at timestamptz NOT NULL,
 revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,created_by) REFERENCES socio_app.users(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS ads_media_tokens_issued ON socio_app.ads_media_mcp_tokens(tenant_id,created_by,expires_at);
REVOKE ALL ON socio_app.ads_media,socio_app.ads_media_mcp_tokens FROM anon,authenticated;
