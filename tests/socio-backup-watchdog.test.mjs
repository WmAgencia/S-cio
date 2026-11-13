import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const helper=read('backup-runner/watchdog.mjs');
const postgres=read('backup-runner/run.mjs');
const mysql=read('backup-runner/mysql.mjs');
const docker=read('backup-runner/Dockerfile');
const ci=read('.github/workflows/ci.yml');

test('backup runners have bounded lifetime and emit stage-only progress',()=>{
 for(const [scope,worker] of [['postgres',postgres],['mysql',mysql]]){
  assert(worker.includes("import {createBackupWatchdog} from './watchdog.mjs'"));
  assert(worker.includes("scope:'"+scope+"'"));
  assert.match(worker,/watchdog\.progress\(stage\)/);
  assert.match(worker,/\.finally\(\(\)=>watchdog\.stop\(\)\)/);
 }
 assert.match(helper,/BACKUP_TIMEOUT/);
 assert.match(helper,/process\.exit\(124\)/);
 assert.match(helper,/40\*60\*1000/);
 assert.match(helper,/console\.info\(JSON\.stringify\(\{event:'BACKUP_STAGE'/);
 assert.doesNotMatch(helper,/(?:PASSWORD|TOKEN|SECRET_ACCESS|DATABASE_URL|Key|connectionString)/);
 assert.match(docker,/COPY backup-runner\/watchdog.mjs/);
 assert.match(ci,/--check backup-runner\/watchdog.mjs/);
});
test('watchdog terminates a stalled isolated backup, without exposing values',{
 timeout:7000
},()=>{
 const script="import {createBackupWatchdog} from './backup-runner/watchdog.mjs';"+
  "const guard=createBackupWatchdog({scope:'postgres',getStage:()=> 's3-readback',timeoutMs:35});"+
  "guard.progress('s3-readback');await new Promise(()=>{});";
 const result=spawnSync(process.execPath,['--input-type=module','-e',script],{
  cwd:root,encoding:'utf8',timeout:2500
 });
 assert.equal(result.status,124,'timeout must be reported as failed');
 assert.match(result.stdout,/BACKUP_STAGE/);
 const logs=result.stderr.trim().split('\n');
 const last=JSON.parse(logs.at(-1));
 assert.equal(last.code,'BACKUP_TIMEOUT');
 assert.equal(last.scope,'postgres');
 assert.equal(last.stage,'s3-readback');
 assert(last.elapsedSeconds>=0);
 assert(!JSON.stringify(last).includes('postgresql://'));
});
test('successful backup clears watchdog without spurious failures',{
 timeout:7000
},()=>{
 const script="import {createBackupWatchdog} from './backup-runner/watchdog.mjs';"+
  "const w=createBackupWatchdog({scope:'mysql',getStage:()=> 'done',timeoutMs:80});"+
  "w.progress('done');w.stop();console.log('success');";
 const result=spawnSync(process.execPath,['--input-type=module','-e',script],{
  cwd:root,encoding:'utf8',timeout:2500
 });
 assert.equal(result.status,0);
 assert.match(result.stdout,/success/);
 assert.doesNotMatch(result.stderr,/BACKUP_TIMEOUT/);
});
