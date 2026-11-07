import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { hostSite, planCall, callPlanned } from 'api-anything/host';
import { loadSite } from 'api-anything';
import { materializeImage } from './images.js';

const failure=code=>Object.assign(Error(code),{code});
export function createProvider(bindingPath) {
  function binding() {
    try {
      const b=JSON.parse(readFileSync(bindingPath,'utf8'));
      if (b.model!=='Nano Banana 2.1'||b.outputs!==1||b.site!=='flow.google.com'||b.op!=='generateImage'||
        !/^[a-f0-9]{64}$/.test(b.specSha256)) return null;
      const resolved=loadSite(b.site);
      if (!resolved||resolved.source!=='user') return null;
      const sha=createHash('sha256').update(JSON.stringify(resolved.site)).digest('hex');
      if (sha!==b.specSha256) return null;
      const site=hostSite(b.site);
      const operation=site?.operations.find(o=>o.op===b.op);
      if (!operation||operation.readOnly||Object.keys(operation.params.properties??{}).join(',')!=='prompt') return null;
      const hosts=site.site.hosts;
      if (!hosts.every(h=>h==='google.com'||h.endsWith('.google.com')||h==='googleapis.com'||h.endsWith('.googleapis.com'))) return null;
      return b;
    } catch {return null;}
  }
  return {
    async ready(){return Boolean(binding());},
    async generate(prompt){
      const b=binding();if(!b)throw failure('not_configured');
      const plan=planCall(b.site,b.op,{prompt},{maxTier:2});
      if (!plan.ok) throw failure(plan.result.class==='auth'?'auth':'not_configured');
      // No learning, healing, tier-3 UI replay or overrides of the upstream duplicate guard.
      const r=await callPlanned(plan,{allowWrites:true,maxTier:2,timeoutMs:120000,minIntervalMs:5000});
      if (r.write==='may_have_applied') throw failure('review_required');
      if (!r.ok) {
        if (r.class==='duplicate'||(r.write&&r.write!=='not_sent'&&r.write!=='not_applied')) throw failure('review_required');
        const code=['auth','rate','blocked'].includes(r.class)?r.class:'upstream';
        throw Object.assign(failure(code),{retryAfterMs:r.retryAfterMs});
      }
      const data=Array.isArray(r.data)&&r.data.length===1?r.data[0]:r.data;
      if (!data||Array.isArray(data)||typeof data!=='object') throw failure('review_required');
      if (typeof data.url==='string') {
        let url;try{url=new URL(data.url);}catch{throw failure('review_required');}
        if (url.protocol!=='https:'||url.username||url.password) throw failure('review_required');
        try{return await materializeImage({url:url.href});}catch{throw failure('image_unavailable');}
      }
      if (typeof data.b64_json==='string'&&data.b64_json.length<28_000_000&&
        /^[A-Za-z0-9+/]+={0,2}$/.test(data.b64_json)) {
        try{return await materializeImage({b64_json:data.b64_json});}catch{throw failure('image_unavailable');}
      }
      // An operation ID / accepted write is not a generated image.
      throw failure('review_required');
    }
  };
}
