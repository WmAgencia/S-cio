import test from 'node:test';
import assert from 'node:assert/strict';
import {purgeDeliveredAdVideos,adVideoRetentionDays,AD_VIDEO_RETENTION_DAYS,readAdVideoBytes,adVideoExportUrl} from '../ads-media.mjs';

const T='8a3179c7-9174-4c34-ae3f-038a1081727b';
const OTHER='2af90123-8ab7-40db-9471-2d1f225511d9';
const DAY=86400000;
const uuid=()=>crypto.randomUUID();
const media=(over={})=>({id:uuid(),tenant_id:T,object_key:'ads-private/'+T+'/'+uuid()+'/source.mp4',
 status:'ready',created_at:new Date(Date.now()-30*DAY),...over});
const receipt=(row,ageDays)=>({tenant_id:row.tenant_id,media_id:row.id,created_at:Date.now()-ageDays*DAY});

// Mirrors the SQL the purge issues, so the test exercises the function's
// selection, deletion and state transition rather than a stub of the result.
class Pool {
 constructor(rows=[],receipts=[]){this.rows=rows;this.receipts=receipts;this.updates=[];}
 async query(sql,values=[]){
  if(sql.startsWith('SELECT m.id,m.tenant_id,m.object_key')){
   const days=values[0],limit=values[1],cutoff=Date.now()-days*DAY;
   const rows=this.rows.filter(r=>r.status==='ready'&&
    this.receipts.some(u=>u.tenant_id===r.tenant_id&&u.media_id===r.id)&&
    !this.receipts.some(u=>u.tenant_id===r.tenant_id&&u.media_id===r.id&&u.created_at>cutoff))
    .sort((a,b)=>a.created_at-b.created_at).slice(0,limit)
    .map(r=>({id:r.id,tenant_id:r.tenant_id,object_key:r.object_key}));
   return {rows,rowCount:rows.length};
  }
  if(sql.startsWith("UPDATE ads_media SET status='expired'")){
   const row=this.rows.find(r=>r.tenant_id===values[0]&&r.id===values[1]);
   if(!row||row.status!=='ready')return {rows:[],rowCount:0};
   row.status='expired';this.updates.push(row.id);return {rows:[],rowCount:1};
  }
  if(sql.startsWith('SELECT id,tenant_id,filename')){
   const row=this.rows.find(r=>r.tenant_id===values[0]&&r.id===values[1]);
   return {rows:row?[row]:[],rowCount:row?1:0};
  }
  throw Error('Unexpected SQL '+sql);
 }
}
const env={SOCIO_AD_VIDEO_RETENTION_DAYS:'7'};

test('retention window defaults to a week and stays between 1 and 30 days',()=>{
 assert.equal(AD_VIDEO_RETENTION_DAYS,7);
 assert.equal(adVideoRetentionDays({}),7);
 assert.equal(adVideoRetentionDays({SOCIO_AD_VIDEO_RETENTION_DAYS:'3'}),3);
 assert.equal(adVideoRetentionDays({SOCIO_AD_VIDEO_RETENTION_DAYS:'0'}),7);
 assert.equal(adVideoRetentionDays({SOCIO_AD_VIDEO_RETENTION_DAYS:'31'}),7);
 assert.equal(adVideoRetentionDays({SOCIO_AD_VIDEO_RETENTION_DAYS:'abc'}),7);
});

test('a delivered video past the window is deleted and marked expired',async()=>{
 const row=media(),pool=new Pool([row],[receipt(row,10)]),deleted=[];
 const result=await purgeDeliveredAdVideos(pool,{env,deleteObject:async key=>{deleted.push(key);}});
 assert.deepEqual(deleted,[row.object_key]);
 assert.equal(row.status,'expired');
 assert.deepEqual(result,{scanned:1,expired:1,failed:0,days:7});
});

test('undelivered or recent videos are left untouched',async()=>{
 const noReceipt=media(),recent=media();
 const pool=new Pool([noReceipt,recent],[receipt(recent,1)]),deleted=[];
 const result=await purgeDeliveredAdVideos(pool,{env,deleteObject:async key=>{deleted.push(key);}});
 assert.deepEqual(deleted,[]);
 assert.equal(noReceipt.status,'ready');
 assert.equal(recent.status,'ready');
 assert.deepEqual(result,{scanned:0,expired:0,failed:0,days:7});
});

test('a newer receipt postpones deletion of the whole video',async()=>{
 const row=media(),pool=new Pool([row],[receipt(row,10),receipt(row,0)]),deleted=[];
 const result=await purgeDeliveredAdVideos(pool,{env,deleteObject:async key=>{deleted.push(key);}});
 assert.deepEqual(deleted,[]);
 assert.equal(row.status,'ready');
 assert.equal(result.scanned,0);
});

test('a failed deletion keeps the row ready so the next run retries',async()=>{
 const row=media(),pool=new Pool([row],[receipt(row,10)]);
 const result=await purgeDeliveredAdVideos(pool,{env,deleteObject:async()=>{throw Error('S3 down');}});
 assert.equal(row.status,'ready');
 assert.deepEqual(pool.updates,[]);
 assert.deepEqual(result,{scanned:1,expired:0,failed:1,days:7});
});

test('each run respects the batch limit and the next run continues',async()=>{
 const rows=[1,2,3,4,5].map(()=>media());
 const pool=new Pool(rows,rows.map(r=>receipt(r,10))),deleted=[];
 const first=await purgeDeliveredAdVideos(pool,{env,limit:2,deleteObject:async key=>{deleted.push(key);}});
 assert.equal(first.expired,2);
 assert.equal(rows.filter(r=>r.status==='expired').length,2);
 await purgeDeliveredAdVideos(pool,{env,limit:2,deleteObject:async key=>{deleted.push(key);}});
 assert.equal(rows.filter(r=>r.status==='expired').length,4);
 assert.equal(rows.filter(r=>r.status==='ready').length,1);
});

test('an expired video answers 410 instead of offering another upload link',async()=>{
 const row=media({status:'expired',bytes:1000,content_type:'video/mp4',filename:'promo.mp4'});
 const pool=new Pool([row]);
 await assert.rejects(readAdVideoBytes(pool,T,row.id,{env:{NODE_ENV:'test',SOCIO_STORAGE_DRIVER:'memory'}}),
  {status:410});
 await assert.rejects(adVideoExportUrl(pool,T,row.id,{NODE_ENV:'test'}),{status:410});
});

test('the purge never reaches another tenant through a receipt',async()=>{
 const mine=media(),theirs=media({tenant_id:OTHER});
 const pool=new Pool([mine,theirs],[{...receipt(mine,10),tenant_id:OTHER}]),deleted=[];
 const result=await purgeDeliveredAdVideos(pool,{env,deleteObject:async key=>{deleted.push(key);}});
 assert.deepEqual(deleted,[]);
 assert.equal(mine.status,'ready');
 assert.equal(result.scanned,0);
});
