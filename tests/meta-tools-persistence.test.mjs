import test from 'node:test';
import {Pool} from 'pg';
import {randomBytes} from 'node:crypto';
import {metaToolsScenario} from './helpers/meta-tools-fixture.mjs';
test('ads tools scope reads, require confirmation, create paused entities and never retry uncertain writes',{skip:!process.env.DATABASE_URL},async()=>{
 const schema='meta_tools_test_'+randomBytes(6).toString('hex'),root=new Pool({connectionString:process.env.DATABASE_URL});
 await root.query('CREATE SCHEMA '+schema);
 const pool=new Pool({connectionString:process.env.DATABASE_URL,options:'-c search_path='+schema+',pg_catalog'});
 try{await metaToolsScenario(pool);}finally{await pool.end();await root.query('DROP SCHEMA '+schema+' CASCADE');await root.end();}
});
