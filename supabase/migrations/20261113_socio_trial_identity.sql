-- Free trial: 7 days per business identity (CNPJ/CPF, phone, e-mail).
-- Idempotent: safe to run more than once against socio_app.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS tax_id text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS tax_id_type text
 CHECK (tax_id_type IS NULL OR tax_id_type IN ('cnpj','cpf'));
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz;

-- Existing companies keep the window they always had: 7 days from signup.
UPDATE tenants SET trial_ends_at=created_at+interval '7 days' WHERE trial_ends_at IS NULL;

CREATE TABLE IF NOT EXISTS socio_trial_claims (
 kind text NOT NULL CHECK (kind IN ('tax_id','phone','email')),
 value_hash char(64) NOT NULL,
 tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (kind,value_hash)
);

CREATE INDEX IF NOT EXISTS socio_trial_claims_tenant_idx ON socio_trial_claims(tenant_id);

-- Claims are HMAC digests keyed by SOCIO_TRIAL_HASH_KEY, so they cannot be
-- seeded from SQL: the application writes them as companies are registered.

