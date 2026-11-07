import {createHash} from 'node:crypto';
import {requirePermission} from './team-permissions.mjs';
import {createFlowRuntime} from './flow-images/runtime.mjs';
const fail=(status,message)=>Object.assign(Error(message),{status});
const digest=x=>createHash('sha256').update(x).digest('hex');
export function createFlowImages({runtime=createFlowRuntime()}={}){
 const safeResult=value=>{
  const out={id:value.id,status:value.status,created_at:value.created_at};
  if(value.error)out.error={code:value.error.code,message:value.error.message};
  if(value.image?.content_url)out.image={content_url:`/api/flow/images/${value.id}/content`,mime_type:value.image.mime_type};
  return out;
 };
 async function response(path,options){
  const r=await runtime.request(path,options);
  const data=await r.json();
  if(!r.ok)throw fail(r.status,data.error?.message||'A conexão com o Google Flow ainda não está pronta.');
  return data;
 }
 async function owned(pool,a,id){
  requirePermission(a,'training.manage');
  if(!/^[a-f0-9-]{36}$/.test(id))throw fail(404,'Imagem não encontrada.');
  const result=await pool.query('SELECT job_id FROM flow_image_jobs WHERE job_id=$1 AND tenant_id=$2',[id,a.active_tenant_id]);
  if(!result.rows[0])throw fail(404,'Imagem não encontrada.');
 }
 return {
  async status(a){
   requirePermission(a,'training.manage');
   let ready=false;
   try{const r=await runtime.request('/readyz');ready=(await r.json()).ready===true;}catch{}
   return {ready,model:'Nano Banana 2.1',outputs:1,liveValidated:false,
    message:ready?'Operação configurada. Uma geração real ainda precisa confirmar sessão, cota e retorno da imagem.':
     'Aguardando conexão da conta Google e validação da geração no servidor. Nenhuma imagem será cobrada ou simulada nesta etapa.'};
  },
  async create(pool,a,data,key){
   requirePermission(a,'training.manage');
   if(!data||Array.isArray(data)||Object.keys(data).length!==1||typeof data.prompt!=='string'||!data.prompt.trim()||data.prompt.length>8000)
    throw fail(422,'Informe somente o prompt, com até 8.000 caracteres.');
   if(!/^[a-zA-Z0-9_.:-]{8,128}$/.test(key||''))throw fail(422,'Envie uma chave Idempotency-Key de 8 a 128 caracteres.');
   const scoped=digest(a.active_tenant_id+':'+key);
   const result=await response('/v1/images',{method:'POST',headers:{'idempotency-key':scoped},body:{prompt:data.prompt}});
   await pool.query('INSERT INTO flow_image_jobs(job_id,tenant_id,user_id) VALUES($1,$2,$3) ON CONFLICT(job_id) DO NOTHING',
    [result.id,a.active_tenant_id,a.user_id]);
   return safeResult(result);
  },
  async read(pool,a,id){await owned(pool,a,id);return safeResult(await response('/v1/images/'+id));},
  async content(pool,a,id){
   await owned(pool,a,id);
   const r=await runtime.request('/v1/images/'+id+'/content');
   if(!r.ok){const d=await r.json();throw fail(r.status,d.error?.message||'A imagem ainda não está disponível.');}
   const mime=r.headers.get('content-type');
   if(!['image/png','image/jpeg','image/webp'].includes(mime))throw fail(502,'Resposta de imagem inválida.');
   return {mime,bytes:Buffer.from(await r.arrayBuffer())};
  },
  async close(){await runtime.close?.();}
 };
}
