-- Preparation for a future Supabase cutover; Railway PostgreSQL remains production.
-- No public access: server-only use under socio_app.
CREATE TABLE IF NOT EXISTS socio_app.wa_tracking_links (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES socio_app.tenants(id) ON DELETE CASCADE,
 channel_id uuid NOT NULL,
 created_by uuid REFERENCES socio_app.users(id) ON DELETE SET NULL,
 account_id text NOT NULL CHECK(account_id ~ '^act_[0-9]{4,20}$'),
 label text NOT NULL CHECK(char_length(label) BETWEEN 3 AND 90),
 campaign_id text CHECK(campaign_id IS NULL OR campaign_id ~ '^[0-9]{4,30}$'),
 adset_id text CHECK(adset_id IS NULL OR adset_id ~ '^[0-9]{4,30}$'),
 ad_id text CHECK(ad_id IS NULL OR ad_id ~ '^[0-9]{4,30}$'),
 code text NOT NULL UNIQUE CHECK(code ~ '^SC[A-F0-9]{20}$'),
 active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,channel_id) REFERENCES socio_app.channels(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS wa_tracking_links_tenant_idx ON socio_app.wa_tracking_links(tenant_id,created_at DESC);
CREATE TABLE IF NOT EXISTS socio_app.wa_lead_attributions (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES socio_app.tenants(id) ON DELETE CASCADE,
 conversation_id uuid NOT NULL,
 inbound_message_id uuid NOT NULL,
 link_id uuid NOT NULL,
 method text NOT NULL CHECK(method='message_code'),
 confidence text NOT NULL CHECK(confidence='indicative'),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,conversation_id),
 UNIQUE(tenant_id,inbound_message_id),
 FOREIGN KEY(tenant_id,conversation_id) REFERENCES socio_app.conversations(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,inbound_message_id) REFERENCES socio_app.messages(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,link_id) REFERENCES socio_app.wa_tracking_links(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS wa_lead_attributions_link_idx ON socio_app.wa_lead_attributions(tenant_id,link_id,created_at DESC);
REVOKE ALL ON socio_app.wa_tracking_links,socio_app.wa_lead_attributions FROM anon,authenticated;
