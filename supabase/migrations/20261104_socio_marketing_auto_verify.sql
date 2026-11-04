-- Sólo staging: preserve production Railway PostgreSQL; never switch DATABASE_URL here.
DO $guard$
BEGIN
 IF (SELECT count(*) FROM socio_app.tenants)>0
 OR has_schema_privilege('anon','socio_app','USAGE')
 OR has_schema_privilege('authenticated','socio_app','USAGE') THEN
  RAISE EXCEPTION 'Private empty staging required for OAuth verification schema';
 END IF;
END $guard$;
ALTER TABLE socio_app.marketing_oauth_grants
 ADD COLUMN IF NOT EXISTS last_checked_at timestamptz;
ALTER TABLE socio_app.marketing_oauth_grants
 ADD COLUMN IF NOT EXISTS last_read_status text NOT NULL DEFAULT 'not_tested'
 CHECK(last_read_status IN ('not_tested','verified','no_accounts'));
ALTER TABLE socio_app.marketing_oauth_grants
 ADD COLUMN IF NOT EXISTS last_account_count integer NOT NULL DEFAULT 0
 CHECK(last_account_count BETWEEN 0 AND 200);
