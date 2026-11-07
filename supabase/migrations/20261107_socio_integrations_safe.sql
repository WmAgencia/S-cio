-- Sócio private-schema parity for optional Stripe SaaS, Google Ads OAuth, and website CAPI.
-- Apply ONLY through reviewed Supabase migration, not inside public Data API.
CREATE TABLE IF NOT EXISTS socio_app.socio_billing_accounts (
 tenant_id uuid PRIMARY KEY REFERENCES socio_app.tenants(id) ON DELETE CASCADE,
 provider text NOT NULL DEFAULT 'stripe' CHECK(provider='stripe'),
 stripe_customer_id text UNIQUE,
 stripe_subscription_id text UNIQUE,
 stripe_mode text NOT NULL DEFAULT 'test' CHECK(stripe_mode IN ('test','live')),
 stripe_checkout_session_id text UNIQUE,
 subscription_status text NOT NULL DEFAULT 'not_started'
  CHECK(subscription_status IN ('not_started','checkout_pending','trialing','active','past_due','unpaid','paused','canceled','incomplete','incomplete_expired')),
 period_end timestamptz,
 paid_invoices_count integer NOT NULL DEFAULT 0,
 paid_amount_cents bigint NOT NULL DEFAULT 0,
 last_paid_invoice_id text,
 last_paid_at timestamptz,
 last_subscription_event_created bigint NOT NULL DEFAULT 0,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS socio_app.socio_billing_webhook_events (
 event_id text PRIMARY KEY,
 event_type text NOT NULL,
 tenant_id uuid REFERENCES socio_app.tenants(id) ON DELETE SET NULL,
 received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS socio_billing_events_recent_idx ON socio_app.socio_billing_webhook_events(received_at DESC);
CREATE TABLE IF NOT EXISTS socio_app.socio_google_ads_states (
 state_hash text PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES socio_app.tenants(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES socio_app.users(id) ON DELETE CASCADE,
 session_hash text NOT NULL REFERENCES socio_app.sessions(token_hash) ON DELETE CASCADE,
 verifier_ciphertext text NOT NULL,
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS socio_google_states_expiry_idx ON socio_app.socio_google_ads_states(expires_at);
CREATE TABLE IF NOT EXISTS socio_app.socio_google_ads_grants (
 tenant_id uuid PRIMARY KEY REFERENCES socio_app.tenants(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES socio_app.users(id),
 token_ciphertext text NOT NULL,
 selected_customer_id text,
 connected_at timestamptz NOT NULL DEFAULT now(),
 checked_at timestamptz,
 checked_account_count integer,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS socio_app.socio_tracking_sites (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES socio_app.tenants(id) ON DELETE CASCADE,
 owner_user_id uuid NOT NULL REFERENCES socio_app.users(id),
 site_origin text NOT NULL,
 pixel_id text NOT NULL,
 signing_ciphertext text NOT NULL,
 enabled boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,site_origin)
);
CREATE TABLE IF NOT EXISTS socio_app.socio_tracking_events (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES socio_app.tenants(id) ON DELETE CASCADE,
 site_id uuid NOT NULL REFERENCES socio_app.socio_tracking_sites(id) ON DELETE CASCADE,
 event_id uuid NOT NULL,
 event_name text NOT NULL,
 event_time timestamptz NOT NULL,
 status text NOT NULL CHECK(status IN ('received','sent','uncertain')),
 error_code text,
 received_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(site_id,event_name,event_id)
);
CREATE INDEX IF NOT EXISTS socio_tracking_events_recent_idx ON socio_app.socio_tracking_events(tenant_id,received_at DESC);
REVOKE ALL ON socio_app.socio_billing_accounts,socio_app.socio_billing_webhook_events,
 socio_app.socio_google_ads_states,socio_app.socio_google_ads_grants,
 socio_app.socio_tracking_sites,socio_app.socio_tracking_events FROM anon,authenticated;
