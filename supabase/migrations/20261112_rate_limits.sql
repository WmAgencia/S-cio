-- Shared rate limit counters, mirroring schema.sql.
-- Keys hold no tenant data: bucket namespace plus ip, user id or token prefix.
CREATE TABLE IF NOT EXISTS socio_app.rate_limits (
 bucket text NOT NULL,
 key text NOT NULL,
 window_start timestamptz NOT NULL,
 count integer NOT NULL DEFAULT 0,
 PRIMARY KEY (bucket, key, window_start)
);

CREATE INDEX IF NOT EXISTS rate_limits_window_idx ON socio_app.rate_limits(window_start);

-- The private lockdown migration already enables row level security here.
-- Counters are not tenant data, so the runtime role needs unrestricted access
-- once a non-owner role exists; until then the owner bypasses RLS anyway.
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='socio_runtime') THEN
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON socio_app.rate_limits TO socio_runtime';
  IF NOT EXISTS (SELECT 1 FROM pg_policies
   WHERE schemaname='socio_app' AND tablename='rate_limits' AND policyname='rate_limits_runtime') THEN
   EXECUTE 'CREATE POLICY rate_limits_runtime ON socio_app.rate_limits FOR ALL TO socio_runtime USING (true) WITH CHECK (true)';
  END IF;
 END IF;
END $$;
