-- Sócio: private schema parity for Prospector-guided owner onboarding.
-- State belongs to exactly one company; no grants to client API roles.
CREATE TABLE IF NOT EXISTS socio_app.socio_training_interviews (
 tenant_id uuid PRIMARY KEY REFERENCES socio_app.tenants(id) ON DELETE CASCADE,
 state jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(state)='object'),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON socio_app.socio_training_interviews FROM anon,authenticated;
