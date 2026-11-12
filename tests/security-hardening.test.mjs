import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {instagramOutboundEnabled} from '../instagram-integration.mjs';

const schema=await readFile(new URL('../schema.sql',import.meta.url),'utf8');
const lockdown=await readFile(new URL('../supabase/migrations/20261112_socio_app_private_lockdown.sql',import.meta.url),'utf8');

test('production schema revokes implicit access and enables row security',()=>{
 assert.match(schema,/ENABLE ROW LEVEL SECURITY/);
 assert.match(schema,/REVOKE ALL ON SCHEMA %I FROM PUBLIC/);
 assert.match(schema,/REVOKE ALL ON TABLE %I\.%I FROM PUBLIC/);
 assert.match(schema,/ALTER DEFAULT PRIVILEGES IN SCHEMA %I REVOKE ALL ON TABLES FROM PUBLIC/);
 assert.match(schema,/EXCEPTION WHEN insufficient_privilege/,'hardening must never abort boot');
});

test('private Supabase schema is locked down for anon and authenticated',()=>{
 assert.match(lockdown,/REVOKE ALL ON SCHEMA socio_app FROM anon/);
 assert.match(lockdown,/REVOKE ALL ON ALL TABLES IN SCHEMA socio_app FROM authenticated/);
 assert.match(lockdown,/ALTER TABLE socio_app\.%I ENABLE ROW LEVEL SECURITY/);
});

test('Instagram outbound obeys the central kill switch',()=>{
 assert.equal(instagramOutboundEnabled({}),false);
 assert.equal(instagramOutboundEnabled({SOCIO_OUTBOUND_ENABLED:'false'}),false);
 assert.equal(instagramOutboundEnabled({SOCIO_OUTBOUND_ENABLED:'TRUE'}),false);
 assert.equal(instagramOutboundEnabled({SOCIO_OUTBOUND_ENABLED:'true'}),true);
});
