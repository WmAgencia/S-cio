import { createServer } from 'node:http';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const messages = {
  review_required: 'O envio pode ter ocorrido. Confira no Flow antes de criar outro pedido.',
  auth: 'Reconecte a conta do proprietário no Flow.',
  rate: 'O Flow atingiu uma cota ou limite temporário. Aguarde antes de gerar novamente.',
  blocked: 'O Flow bloqueou esta solicitação. Verifique a sessão no navegador.',
  not_configured: 'A operação autenticada do Flow ainda precisa ser capturada e validada.',
  upstream: 'O Flow não devolveu uma imagem válida.',
  image_unavailable: 'Pode haver uma imagem no Flow, mas não foi possível baixar o arquivo. Confira no Flow antes de gerar novamente.',
};
export function createApp({key, dbPath, provider, minIntervalMs=5000, maxQueue=100}) {
  if (typeof key !== 'string' || key.length < 32) throw Error('FLOW_API_KEY deve ter pelo menos 32 caracteres.');
  mkdirSync(dirname(dbPath),{recursive:true,mode:0o700});
  const db = new DatabaseSync(dbPath);
  chmodSync(dbPath,0o600);
  db.exec(`PRAGMA journal_mode=DELETE;
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY, idem TEXT UNIQUE NOT NULL, digest TEXT NOT NULL, prompt TEXT NOT NULL,
      status TEXT NOT NULL, image TEXT, error TEXT, created TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
    UPDATE jobs SET status='unknown', error='review_required' WHERE status='running';`);
  let active=false, stopping=false, timer;
  const get = id=>db.prepare('SELECT * FROM jobs WHERE id=?').get(id);
  const publicImage=row=>{const img=JSON.parse(row.image);return img.b64_json?
    {content_url:`/v1/images/${row.id}/content`,mime_type:img.mime_type}:img;};
  const view = row=>({id:row.id,status:row.status,created_at:row.created,
    ...(row.image?{image:publicImage(row)}:{}),
    ...(row.error?{error:{code:row.error,message:messages[row.error]??messages.upstream}}:{})});
  const state = name=>Number(db.prepare('SELECT value FROM state WHERE key=?').get(name)?.value??0);
  const setState = (name,value)=>db.prepare('INSERT OR REPLACE INTO state VALUES (?,?)').run(name,value);
  function wake() {
    if (active||stopping) return;
    clearTimeout(timer);
    const nextAt=Math.max(state('cooldown'),state('nextCall'));
    if (nextAt>Date.now()) {timer=setTimeout(wake,Math.min(nextAt-Date.now(),2147483647)); timer.unref(); return;}
    const row=db.prepare("SELECT * FROM jobs WHERE status='queued' ORDER BY rowid LIMIT 1").get();
    if (!row) return;
    active=true;
    db.prepare("UPDATE jobs SET status='running' WHERE id=?").run(row.id);
    setState('nextCall',Date.now()+minIntervalMs);
    Promise.resolve().then(()=>provider.generate(row.prompt)).then(image=>{
      if (!image || (!image.url&&!image.b64_json)) throw Object.assign(Error(),{code:'review_required'});
      db.prepare("UPDATE jobs SET status='succeeded',image=? WHERE id=?").run(JSON.stringify(image),row.id);
    }).catch(error=>{
      const code=Object.hasOwn(messages,error?.code)?error.code:'review_required';
      const status=['review_required','image_unavailable'].includes(code)?'unknown':'failed';
      if (code==='rate') setState('cooldown',Date.now()+Math.max(60000,Math.min(Number(error.retryAfterMs)||3600000,86400000)));
      if (code==='auth'||code==='blocked') {
        db.prepare("UPDATE jobs SET status='failed',error=? WHERE status='queued'").run(code);
      }
      db.prepare('UPDATE jobs SET status=?,error=? WHERE id=?').run(status,code,row.id);
    }).finally(()=>{active=false;wake();});
  }
  const tokenHash=createHash('sha256').update(`Bearer ${key}`).digest();
  const server=createServer(async(req,res)=>{
    res.setHeader('cache-control','no-store');
    res.setHeader('x-content-type-options','nosniff');
    const reply=(status,body)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8'});res.end(JSON.stringify(body));};
    const fail=(status,code)=>reply(status,{error:{code,message:messages[code]??code}});
    try {
      const path=new URL(req.url,'http://localhost').pathname;
      if (req.method==='GET'&&path==='/healthz') return reply(200,{status:'alive'});
      const supplied=createHash('sha256').update(req.headers.authorization??'').digest();
      if (!timingSafeEqual(tokenHash,supplied)) return fail(401,'unauthorized');
      if (req.headers.origin) return fail(403,'backend_only');
      if (req.method==='GET'&&path==='/readyz') {
        const ready=await provider.ready(); return reply(ready?200:503,{ready,model:'Nano Banana 2.1',...(ready?{}:{error:messages.not_configured})});
      }
      if(req.method==='GET'&&/^\/v1\/images\/[a-f0-9-]{36}\/content$/.test(path)) {
        const row=get(path.split('/')[3]);
        if(!row)return fail(404,'not_found');
        if(row.status!=='succeeded'||!row.image)return fail(409,'image_not_ready');
        const img=JSON.parse(row.image);
        if(!img.b64_json||!['image/png','image/jpeg','image/webp'].includes(img.mime_type))return fail(409,'image_unavailable');
        const bytes=Buffer.from(img.b64_json,'base64');
        const ext={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[img.mime_type];
        res.writeHead(200,{'content-type':img.mime_type,'content-length':bytes.length,
          'content-disposition':`attachment; filename="${row.id}.${ext}"`});
        return res.end(bytes);
      }
      if (req.method==='GET'&&/^\/v1\/images\/[a-f0-9-]{36}$/.test(path)) {
        const row=get(path.split('/').at(-1)); return row?reply(200,view(row)):fail(404,'not_found');
      }
      if (req.method!=='POST'||path!=='/v1/images') return fail(404,'not_found');
      if (!(req.headers['content-type']??'').toLowerCase().startsWith('application/json')) return fail(415,'json_required');
      const chunks=[];let size=0;
      for await(const chunk of req) {
        size+=chunk.length;
        if (size>32768) return fail(413,'body_too_large');
        chunks.push(chunk);
      }
      let body; try {body=JSON.parse(Buffer.concat(chunks).toString('utf8'));} catch {return fail(400,'invalid_json');}
      if (!body||Array.isArray(body)||typeof body!=='object'||Object.keys(body).length!==1||
        typeof body.prompt!=='string'||!body.prompt.trim()||body.prompt.length>8000) return fail(400,'prompt_only_required');
      const prompt=body.prompt.trim(), digest=createHash('sha256').update(prompt).digest('hex');
      const idem=req.headers['idempotency-key'];
      if (idem!==undefined && (typeof idem!=='string'||!/^[a-zA-Z0-9_.:-]{1,128}$/.test(idem))) return fail(400,'invalid_idempotency_key');
      const old=idem?db.prepare('SELECT * FROM jobs WHERE idem=?').get(idem):undefined;
      if (old) return old.digest===digest?reply(202,view(old)):fail(409,'idempotency_conflict');
      if (!(await provider.ready())) return fail(503,'not_configured');
      if (state('cooldown')>Date.now()) {
        res.setHeader('retry-after',Math.ceil((state('cooldown')-Date.now())/1000));return fail(429,'rate');
      }
      // Readiness may await disk or transport; recheck idempotency before the synchronous insert.
      const concurrent=idem?db.prepare('SELECT * FROM jobs WHERE idem=?').get(idem):undefined;
      if (concurrent) return concurrent.digest===digest?reply(202,view(concurrent)):fail(409,'idempotency_conflict');
      if (db.prepare("SELECT count(*) AS n FROM jobs WHERE status IN ('queued','running')").get().n>=maxQueue) return fail(429,'queue_full');
      const id=randomUUID();
      db.prepare("INSERT INTO jobs(id,idem,digest,prompt,status,created) VALUES (?,?,?,?,'queued',?)")
        .run(id,idem??id,digest,prompt,new Date().toISOString());
      res.setHeader('location',`/v1/images/${id}`);reply(202,view(get(id)));wake();
    } catch { if(!res.headersSent) fail(500,'internal_error'); else res.end(); }
  });
  server.requestTimeout=30000;server.headersTimeout=15000;
  wake();
  return {server, async close(){stopping=true;clearTimeout(timer);
    await new Promise(r=>server.close(r));
    while(active) await new Promise(r=>setTimeout(r,10));
    db.close();
  }};
}
