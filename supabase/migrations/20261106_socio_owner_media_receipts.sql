
-- Opt-in owner-only WA-AKG media; never replay a message on an ambiguous gateway response.
CREATE TABLE IF NOT EXISTS socio_owner_media_receipts (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
 conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 provider_message_id text NOT NULL CHECK(length(provider_message_id) BETWEEN 4 AND 180),
 media_kind text NOT NULL CHECK(media_kind IN ('image','audio')),
 status text NOT NULL CHECK(status IN ('processing','response_ready','replied','uncertain')),
 run_id uuid REFERENCES socio_skill_runs(id) ON DELETE SET NULL,
 response_text text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,channel_id,provider_message_id)
);
CREATE INDEX IF NOT EXISTS socio_owner_media_receipts_recent_idx
 ON socio_owner_media_receipts(tenant_id,channel_id,created_at DESC);
