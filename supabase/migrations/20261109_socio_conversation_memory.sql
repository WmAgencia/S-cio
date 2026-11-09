-- Sócio Inteligente — per-tenant, per-conversation memory (Prospector adaptation).
-- Contains only enum intent labels and small counters; not raw chat, PII, prices or secrets.
CREATE TABLE IF NOT EXISTS socio_app.socio_conversation_memory (
 tenant_id uuid NOT NULL REFERENCES socio_app.tenants(id) ON DELETE CASCADE,
 conversation_id uuid NOT NULL,
 state jsonb NOT NULL DEFAULT '{}'::jsonb
  CHECK(jsonb_typeof(state)='object' AND octet_length(state::text)<=3000),
 seen_created_at timestamptz,
 seen_message_id uuid,
 updated_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT (now()+interval '30 days'),
 PRIMARY KEY(tenant_id,conversation_id),
 FOREIGN KEY(tenant_id,conversation_id)
  REFERENCES socio_app.conversations(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS socio_conversation_memory_expiry_idx
 ON socio_app.socio_conversation_memory(expires_at);
REVOKE ALL ON socio_app.socio_conversation_memory FROM anon,authenticated;
