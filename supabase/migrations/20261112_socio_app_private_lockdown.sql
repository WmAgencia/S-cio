-- Lock down the private runtime schema.
-- The Sócio server connects as the schema owner and is unaffected. Supabase
-- roles (anon/authenticated) and PUBLIC lose every implicit privilege, and
-- row level security is enabled with no policies so any non-owner role sees
-- no tenant rows even if the schema is exposed by mistake.

DO $$
DECLARE t record;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='socio_app') THEN
  RAISE NOTICE 'schema socio_app absent; nothing to lock down';
  RETURN;
 END IF;

 EXECUTE 'REVOKE ALL ON SCHEMA socio_app FROM PUBLIC';
 EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA socio_app REVOKE ALL ON TABLES FROM PUBLIC';
 EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA socio_app REVOKE ALL ON SEQUENCES FROM PUBLIC';

 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
  EXECUTE 'REVOKE ALL ON SCHEMA socio_app FROM anon';
  EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA socio_app FROM anon';
  EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA socio_app FROM anon';
 END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
  EXECUTE 'REVOKE ALL ON SCHEMA socio_app FROM authenticated';
  EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA socio_app FROM authenticated';
  EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA socio_app FROM authenticated';
 END IF;

 FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='socio_app' LOOP
  EXECUTE format('ALTER TABLE socio_app.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  EXECUTE format('REVOKE ALL ON TABLE socio_app.%I FROM PUBLIC', t.tablename);
 END LOOP;
 FOR t IN SELECT sequencename FROM pg_sequences WHERE schemaname='socio_app' LOOP
  EXECUTE format('REVOKE ALL ON SEQUENCE socio_app.%I FROM PUBLIC', t.sequencename);
 END LOOP;
END $$;
