-- Owner WhatsApp channel: one group per connected number ("Meu Sócio").
-- Idempotent: safe to run more than once against socio_app.

CREATE TABLE IF NOT EXISTS socio_owner_groups (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 channel_id uuid NOT NULL,
 group_jid text CHECK (group_jid IS NULL OR group_jid ~ '^[0-9]{5,24}(-[0-9]{5,24})?@g\.us$'),
 subject text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 100),
 status text NOT NULL DEFAULT 'active'
  CHECK (status IN ('active','waiting_owner_phone','failed')),
 error_code text,
 ad_page_id text CHECK (ad_page_id IS NULL OR ad_page_id ~ '^[0-9]{4,30}$'),
 ad_city_key text CHECK (ad_city_key IS NULL OR ad_city_key ~ '^[0-9]{4,30}$'),
 ad_city_name text,
 ad_daily_budget_cents integer
  CHECK (ad_daily_budget_cents IS NULL OR ad_daily_budget_cents BETWEEN 100 AND 10000000),
 ad_age_min integer NOT NULL DEFAULT 18 CHECK (ad_age_min BETWEEN 18 AND 65),
 ad_age_max integer NOT NULL DEFAULT 65 CHECK (ad_age_max BETWEEN 18 AND 65),
 ad_genders integer[] NOT NULL DEFAULT '{}',
 whatsapp_destination text CHECK (whatsapp_destination IS NULL OR whatsapp_destination ~ '^[0-9]{10,15}$'),
 last_video_message_id text,
 last_video_id text CHECK (last_video_id IS NULL OR last_video_id ~ '^[0-9]{4,30}$'),
 last_seen_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (tenant_id,channel_id),
 UNIQUE (tenant_id,group_jid),
 FOREIGN KEY (tenant_id,channel_id) REFERENCES channels(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS socio_owner_groups_status_idx ON socio_owner_groups(status);

CREATE TABLE IF NOT EXISTS socio_owner_commands (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 group_id uuid NOT NULL REFERENCES socio_owner_groups(id) ON DELETE CASCADE,
 provider_message_id text NOT NULL CHECK (char_length(provider_message_id) BETWEEN 4 AND 180),
 sender_jid text,
 kind text NOT NULL DEFAULT 'text' CHECK (kind IN ('text','video','image','other')),
 body text,
 media_message_id text,
 action text,
 state text NOT NULL DEFAULT 'received'
  CHECK (state IN ('received','working','preparing','awaiting_settings',
   'awaiting_confirmation','done','failed','cancelled')),
 attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 context jsonb NOT NULL DEFAULT '{}'::jsonb,
 reply text,
 error_code text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (tenant_id,provider_message_id)
);
CREATE INDEX IF NOT EXISTS socio_owner_commands_pending_idx
 ON socio_owner_commands(state,next_attempt_at);
CREATE INDEX IF NOT EXISTS socio_owner_commands_group_idx
 ON socio_owner_commands(tenant_id,group_id,created_at DESC);

-- Same protections as every other tenant table (the app connects as owner,
-- which bypasses RLS; any other role gets nothing).
ALTER TABLE socio_owner_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE socio_owner_commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE socio_owner_groups FROM PUBLIC;
REVOKE ALL ON TABLE socio_owner_commands FROM PUBLIC;
