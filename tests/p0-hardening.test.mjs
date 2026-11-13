import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {applyPendingMigrations,schemaVersionStatus,migrationChecksum,migrationFiles,expectedSchemaVersion} from '../schema-migrations.mjs';

const files=[
 {version:'20260101_first',name:'20260101_first.sql',sql:'CREATE TABLE a();'},
 {version:'20260102_second',name:'20260102_second.sql',sql:'ALTER TABLE a ADD COLUMN b int;'}
];

function fakeDb(applied=[]){
 const state={applied:[...applied],calls:[],executed:[]};
 const db={state,query:async(sql,args=[])=>{
  state.calls.push({sql,args});
  if(/^CREATE TABLE IF NOT EXISTS socio_app\.schema_migrations/.test(sql))return {rowCount:0,rows:[]};
  if(/^SELECT version,checksum FROM socio_app\.schema_migrations$/.test(sql))
   return {rowCount:state.applied.length,rows:state.applied.map(row=>({...row}))};
  if(/^SELECT version FROM socio_app\.schema_migrations WHERE version=\$1$/.test(sql))
   return {rowCount:state.applied.some(row=>row.version===args[0])?1:0,rows:[]};
  if(/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql))return {rowCount:0,rows:[]};
  if(/^INSERT INTO socio_app\.schema_migrations/.test(sql)){
   state.applied.push({version:args[0],filename:args[1],checksum:args[2]});
   return {rowCount:1,rows:[]};
  }
  state.executed.push(sql);
  return {rowCount:0,rows:[]};
 }};
 return db;
}

test('Pending migrations run in order, each inside its own transaction',async()=>{
 const db=fakeDb();
 const result=await applyPendingMigrations(db,{files});
 assert.deepEqual(result,{baseline:false,applied:['20260101_first','20260102_second'],pending:[]});
 assert.deepEqual(db.state.executed,['CREATE TABLE a();','ALTER TABLE a ADD COLUMN b int;']);
 const statements=db.state.calls.map(call=>call.sql.trim());
 const order=statements.filter(sql=>['BEGIN','COMMIT'].includes(sql));
 assert.equal(order.filter(sql=>sql==='BEGIN').length,2);
 assert.equal(order.filter(sql=>sql==='COMMIT').length,2);
 const records=db.state.calls.filter(call=>/^INSERT INTO socio_app\.schema_migrations/.test(call.sql));
 assert.equal(records[0].args[2],migrationChecksum(files[0].sql),'checksum of the applied file is recorded');
});

test('Already applied migrations are not run again',async()=>{
 const db=fakeDb([{version:'20260101_first',checksum:migrationChecksum(files[0].sql)}]);
 const result=await applyPendingMigrations(db,{files});
 assert.deepEqual(result.applied,['20260102_second']);
 assert.deepEqual(db.state.executed,['ALTER TABLE a ADD COLUMN b int;']);
});

test('A file edited after being applied stops the migration',async()=>{
 const db=fakeDb([{version:'20260101_first',checksum:'not-the-current-checksum'}]);
 await assert.rejects(applyPendingMigrations(db,{files}),/modified after being applied/);
 assert.deepEqual(db.state.executed,[],'nothing runs when the ledger disagrees');
});

test('Check mode reports pending migrations without writing',async()=>{
 const db=fakeDb();
 const result=await applyPendingMigrations(db,{files,apply:false});
 assert.deepEqual(result.pending,['20260101_first','20260102_second']);
 assert.deepEqual(db.state.executed,[]);
 assert.ok(!db.state.calls.some(call=>/^INSERT/.test(call.sql)));
});

test('Baseline records the current files without executing them',async()=>{
 const db=fakeDb();
 const result=await applyPendingMigrations(db,{files,baseline:true});
 assert.deepEqual(result,{baseline:true,applied:[],pending:[]});
 assert.deepEqual(db.state.executed,[]);
 assert.equal(db.state.applied.length,2);
});

test('Readiness fails until the newest migration is recorded',async()=>{
 const db=fakeDb([{version:'20260101_first',checksum:migrationChecksum(files[0].sql)}]);
 assert.deepEqual(await schemaVersionStatus(db,{files}),{ok:false,version:'20260102_second'});
 const complete=fakeDb(files.map(file=>({version:file.version,checksum:migrationChecksum(file.sql)})));
 assert.deepEqual(await schemaVersionStatus(complete,{files}),{ok:true,version:'20260102_second'});
});

test('Unsafe schema names are refused',async()=>{
 await assert.rejects(applyPendingMigrations(fakeDb(),{schema:'public;drop',files}),/Unsafe schema name/);
});

test('The repository migrations are ordered and the ledger understands them',async()=>{
 const list=await migrationFiles();
 assert.ok(list.length>0);
 const versions=list.map(file=>file.version);
 assert.deepEqual(versions,[...versions].sort());
 assert.match(await expectedSchemaVersion(),/^\d{8}_[a-z0-9_]+$/);
});

test('Server hardening: pool errors, fatal handlers, schema readiness and session rotation',async()=>{
 const server=await readFile(new URL('../server.mjs',import.meta.url),'utf8');
 assert.match(server,/pool\.on\('error'/,'idle pool errors must not crash the process');
 assert.match(server,/process\.on\('uncaughtException'/);
 assert.match(server,/process\.on\('unhandledRejection'/);
 assert.match(server,/NODE_ENV must be production/);
 assert.match(server,/SameSite=Strict; Secure'/,'cookie is Secure unconditionally');
 assert.match(server,/schemaVersionStatus\(pool/,'health checks the migration ledger');
 assert.match(server,/applyPendingMigrations\(client/,'boot applies pending migrations');
 assert.match(server,/DELETE FROM sessions WHERE user_id=\$1',\[a\.user_id\]/,'password change revokes every session');
 assert.match(server,/allSessionsRevoked:true/);
 const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
 assert.match(app,/state\.csrf=result\.csrf/,'client adopts the rotated CSRF token');
});
