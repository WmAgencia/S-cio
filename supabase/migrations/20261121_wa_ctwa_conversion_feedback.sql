-- Meta Conversions API for Business Messaging: send each confirmed click-to-WhatsApp
-- arrival back as LeadSubmitted so delivery can optimize for real conversations.
-- Sending is opt-in and idempotent through a stable event_id per arrival.
ALTER TABLE wa_ctwa_attributions
 ADD COLUMN IF NOT EXISTS capi_sent_at timestamptz,
 ADD COLUMN IF NOT EXISTS capi_attempts smallint NOT NULL DEFAULT 0
  CHECK(capi_attempts BETWEEN 0 AND 5),
 ADD COLUMN IF NOT EXISTS capi_last_attempt_at timestamptz,
 ADD COLUMN IF NOT EXISTS capi_error text;
CREATE INDEX IF NOT EXISTS wa_ctwa_attributions_capi_pending_idx
 ON wa_ctwa_attributions(occurred_at)
 WHERE capi_sent_at IS NULL AND source_type='ad' AND ctwa_clid IS NOT NULL;
CREATE TABLE IF NOT EXISTS meta_waba_datasets (
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 waba_id text NOT NULL CHECK(char_length(waba_id) BETWEEN 1 AND 64),
 dataset_id text CHECK(dataset_id IS NULL OR char_length(dataset_id) BETWEEN 1 AND 64),
 attempts smallint NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
 last_attempt_at timestamptz,
 error text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,waba_id)
);
