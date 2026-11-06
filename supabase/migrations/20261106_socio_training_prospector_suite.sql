-- Private Supabase preparation only; does not migrate or modify Railway production.
ALTER TABLE socio_app.tenants ADD COLUMN IF NOT EXISTS trial_started_at timestamptz;
ALTER TABLE socio_app.tenants ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz;
ALTER TABLE socio_app.tenants ADD COLUMN IF NOT EXISTS contracted_at timestamptz;
CREATE INDEX IF NOT EXISTS tenants_trials_due ON socio_app.tenants(trial_ends_at) WHERE status='trial';
CREATE TABLE IF NOT EXISTS socio_app.socio_interviews (
 tenant_id uuid PRIMARY KEY REFERENCES socio_app.tenants(id) ON DELETE CASCADE,
 state jsonb NOT NULL DEFAULT '{}'::jsonb,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS socio_app.socio_social_proofs (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES socio_app.tenants(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('portfolio','case','testimonial')),
 title text NOT NULL CHECK(char_length(title) BETWEEN 3 AND 120),
 description text NOT NULL DEFAULT '' CHECK(char_length(description)<=500),
 url text NOT NULL DEFAULT '' CHECK(char_length(url)<=800),
 object_key text,
 media_type text CHECK(media_type IS NULL OR media_type IN ('image/jpeg','application/pdf')),
 approved boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 approved_at timestamptz,
 UNIQUE(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS socio_social_proofs_tenant ON socio_app.socio_social_proofs(tenant_id,created_at DESC);
CREATE TABLE IF NOT EXISTS socio_app.socio_closing_policies (
 tenant_id uuid PRIMARY KEY REFERENCES socio_app.tenants(id) ON DELETE CASCADE,
 mode text NOT NULL DEFAULT 'handoff' CHECK(mode IN ('handoff','proposal')),
 methods text[] NOT NULL DEFAULT ARRAY[]::text[],
 deposit_percent integer NOT NULL DEFAULT 0 CHECK(deposit_percent BETWEEN 0 AND 100),
 pix_ciphertext text,
 pix_name text NOT NULL DEFAULT '',
 updated_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON socio_app.socio_interviews,socio_app.socio_social_proofs,socio_app.socio_closing_policies FROM anon,authenticated;
