-- Delivered ad videos are deleted from the private bucket once Meta has copied
-- them into the ad account. The row stays as history with status 'expired'.
-- Idempotent: safe to run more than once against socio_app.

ALTER TABLE ads_media DROP CONSTRAINT IF EXISTS ads_media_status_check;
ALTER TABLE ads_media ADD CONSTRAINT ads_media_status_check
 CHECK(status IN ('reserved','uploading','ready','failed','expired'));

-- The purge looks up receipts by media; receipts are otherwise indexed per tenant.
CREATE INDEX IF NOT EXISTS socio_ads_meta_video_uploads_media_idx
 ON socio_ads_meta_video_uploads(media_id);
