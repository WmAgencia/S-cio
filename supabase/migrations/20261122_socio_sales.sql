-- Sales reported by the customer and confirmed by the owner. A receipt only
-- opens a pending candidate; revenue exists after confirmation, never before.
CREATE TABLE IF NOT EXISTS socio_sales (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
 inbound_message_id text,
 evidence_kind text NOT NULL CHECK(evidence_kind IN ('text','image','document','manual')),
 evidence_excerpt text,
 amount_cents bigint CHECK(amount_cents IS NULL OR amount_cents>0),
 currency text NOT NULL DEFAULT 'BRL' CHECK(currency='BRL'),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','rejected')),
 source text NOT NULL CHECK(source IN ('heuristic','owner_whatsapp','owner_ui','manual')),
 origin_source text NOT NULL DEFAULT 'unknown' CHECK(origin_source IN ('ctwa','link','organic','unknown')),
 origin_campaign_id text,
 origin_campaign_name text,
 origin_adset_id text,
 origin_adset_name text,
 origin_ad_id text,
 origin_ad_name text,
 ctwa_attribution_id uuid REFERENCES wa_ctwa_attributions(id) ON DELETE SET NULL,
 lead_attribution_id uuid REFERENCES wa_lead_attributions(id) ON DELETE SET NULL,
 notified_at timestamptz,
 confirmed_at timestamptz,
 confirmed_by text,
 rejected_at timestamptz,
 capi_event_id text,
 capi_sent_at timestamptz,
 capi_attempts smallint NOT NULL DEFAULT 0 CHECK(capi_attempts BETWEEN 0 AND 5),
 capi_last_attempt_at timestamptz,
 capi_error text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,inbound_message_id),
 CHECK(status<>'confirmed' OR amount_cents IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS socio_sales_tenant_recent_idx ON socio_sales(tenant_id,created_at DESC);
CREATE INDEX IF NOT EXISTS socio_sales_conversation_idx ON socio_sales(tenant_id,conversation_id,created_at DESC);
CREATE INDEX IF NOT EXISTS socio_sales_pending_idx ON socio_sales(tenant_id,created_at DESC) WHERE status='pending';
CREATE INDEX IF NOT EXISTS socio_sales_confirmed_idx ON socio_sales(tenant_id,confirmed_at DESC) WHERE status='confirmed';
CREATE INDEX IF NOT EXISTS socio_sales_capi_pending_idx ON socio_sales(confirmed_at)
 WHERE status='confirmed' AND capi_sent_at IS NULL;
