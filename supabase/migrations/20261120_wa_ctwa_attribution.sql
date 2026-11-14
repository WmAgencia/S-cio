-- Click-to-WhatsApp tracking: the referral Meta sends with the first message
-- after an ad click. One row per arrival, so a customer who clicks twice counts twice.
-- occurred_at is the WhatsApp message timestamp, not the webhook delivery time.
CREATE TABLE IF NOT EXISTS wa_ctwa_attributions (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 channel_id uuid NOT NULL,
 conversation_id uuid NOT NULL,
 inbound_message_id text NOT NULL CHECK(char_length(inbound_message_id) BETWEEN 8 AND 200),
 waba_id text NOT NULL DEFAULT '',
 source_id text NOT NULL CHECK(char_length(source_id) BETWEEN 1 AND 128),
 source_type text NOT NULL DEFAULT 'unknown'
  CHECK(source_type IN ('ad','post','open_thread','unknown')),
 ctwa_clid text CHECK(ctwa_clid IS NULL OR char_length(ctwa_clid) BETWEEN 1 AND 512),
 source_url text,
 headline text,
 body text,
 media_type text,
 image_url text,
 video_url text,
 thumbnail_url text,
 ad_greeting_text text,
 welcome_message text,
 occurred_at timestamptz NOT NULL,
 ad_name text,
 adset_id text,
 adset_name text,
 campaign_id text,
 campaign_name text,
 account_id text,
 resolution_attempts smallint NOT NULL DEFAULT 0
  CHECK(resolution_attempts BETWEEN 0 AND 5),
 last_attempt_at timestamptz,
 resolution_error text,
 resolved_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,inbound_message_id),
 FOREIGN KEY(tenant_id,channel_id) REFERENCES channels(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,conversation_id) REFERENCES conversations(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS wa_ctwa_attributions_tenant_latest_idx
 ON wa_ctwa_attributions(tenant_id,occurred_at DESC);
CREATE INDEX IF NOT EXISTS wa_ctwa_attributions_source_idx
 ON wa_ctwa_attributions(tenant_id,source_id);
CREATE INDEX IF NOT EXISTS wa_ctwa_attributions_campaign_idx
 ON wa_ctwa_attributions(tenant_id,campaign_id);
CREATE INDEX IF NOT EXISTS wa_ctwa_attributions_pending_idx
 ON wa_ctwa_attributions(tenant_id,last_attempt_at)
 WHERE resolved_at IS NULL AND source_type='ad';
