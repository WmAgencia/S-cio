-- Web Media Bridge -> Meta library. The orb uploads a video directly to the
-- selected ad account; this receipt proves the video belongs to THIS tenant in
-- THIS account, exactly like socio_whatsapp_meta_video_imports does for the
-- owner channel. Ad creation only accepts videos with a receipt here or there.
-- Idempotent: safe to run more than once against socio_app.

CREATE TABLE IF NOT EXISTS socio_ads_meta_video_uploads (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 media_id uuid NOT NULL,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 account_id text NOT NULL CHECK (account_id ~ '^act_[0-9]{4,30}$'),
 meta_video_id text NOT NULL CHECK (meta_video_id ~ '^[0-9]{4,30}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,account_id,meta_video_id)
);

CREATE INDEX IF NOT EXISTS socio_ads_meta_video_uploads_tenant_idx
 ON socio_ads_meta_video_uploads(tenant_id,created_at DESC);
