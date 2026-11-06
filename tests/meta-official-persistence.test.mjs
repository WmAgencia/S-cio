import test from 'node:test';
import {Pool} from 'pg';
import {randomBytes} from 'node:crypto';
import {officialPersistenceScenario} from './helpers/meta-official-fixture.mjs';
test('official OAuth persists isolated grants, consumes states and handles signed removal', {skip:!process.env.DATABASE_URL},async()=>{
 const schema='meta_official_test_'+randomBytes(6).toString('hex');
 const root=new Pool({connectionString:process.env.DATABASE_URL});
 await root.query('CREATE SCHEMA '+schema);
 const pool=new Pool({connectionString:process.env.DATABASE_URL,options:'-c search_path='+schema+',pg_catalog'});
 try{await officialPersistenceScenario(pool);}finally{await pool.end();await root.query('DROP SCHEMA '+schema+' CASCADE');await root.end();}
});
