(()=>{'use strict';
// Optional media library enhancement. Never modifies existing marketing OAuth or ad spend.
let mounted=null,csrf='',canManage=false,observer;
const view=document.querySelector('#view');
if(!view)return;
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function request(path,method='GET',payload){
 const headers={Accept:'application/json'};
 if(method!=='GET')headers['X-CSRF-Token']=csrf;
 if(payload!==undefined)headers['Content-Type']='application/json';
 const res=await fetch(path,{method,credentials:'same-origin',headers,
  ...(payload!==undefined?{body:JSON.stringify(payload)}:{})});
 const data=await res.json().catch(()=>({}));
 if(!res.ok)throw Error(data.error||'Falha ao acessar a biblioteca de anúncios.');
 return data;
}
function note(t,critical=false){const area=mounted?.querySelector('#adsMediaFeedback');if(area){area.textContent=t;area.style.color=critical?'#af3a50':'';}}
async function load(){
 const list=mounted?.querySelector('#adsMediaList');if(!list)return;
 const data=await request('/api/ads-media');list.replaceChildren();
 if(!data.configured){note('O armazenamento ainda não está configurado.',true);return;}
 note('Armazenamento privado conectado. Nenhum anúncio será publicado por esta biblioteca.');
 if(!data.items.length){list.textContent='Nenhum vídeo cadastrado ainda.';return;}
 for(const item of data.items){
  const row=document.createElement('div');
  row.style.cssText='display:flex;align-items:center;flex-wrap:wrap;gap:10px;padding:13px 0;border-bottom:1px solid #eae1e8';
  const label=document.createElement('strong');label.textContent=item.filename;
  const small=document.createElement('span');small.style.cssText='font-size:11px;color:#8d7b88';
  small.textContent=(item.status==='ready'?'Pronto':item.status)+' · '+item.source+
   (item.bytes?' · '+(item.bytes/1048576).toFixed(1)+' MB':'');
  row.append(label,small);
  if(item.status==='ready'&&canManage){
   const b=document.createElement('button');b.className='btn soft';b.textContent='URL para Meta';
   b.addEventListener('click',async()=>{
    b.disabled=true;
    try{
     const result=await request('/api/ads-media/'+item.id+'/export','POST',{});
     const field=document.createElement('input');field.readOnly=true;field.value=result.url;
     field.style.cssText='width:100%;min-width:250px;margin-top:6px';
     field.setAttribute('aria-label','URL temporária para upload na Meta');
     row.append(field);field.select();
     note('URL temporária gerada por 20 minutos. Passe-a à ferramenta oficial de upload da Meta.');
    }catch(error){note(error.message,true);}finally{b.disabled=false;}
   });row.append(b);
  }
  list.append(row);
 }
}
async function mount(){
 if(mounted&&view.contains(mounted))return;
 if(!view.querySelector('[data-marketing-oauth]'))return;
 const me=await request('/api/me');
 if(!view.querySelector('[data-marketing-oauth]'))return;
 csrf=me.csrf;
 canManage=(me.user?.permissions||[]).includes('marketing.manage');
 const section=document.createElement('section');section.className='card';
 section.style.cssText='padding:25px;margin-top:20px';
 section.innerHTML='<h2>Biblioteca de vídeos para Meta Ads</h2>'+
  '<p class="form-note">MP4/MOV até 90 MB. Arquivos privados por empresa. Gere uma URL temporária para enviar o vídeo ao MCP oficial da Meta, sem alterar orçamento ou publicar anúncios automaticamente.</p>'+
  '<p id="adsMediaFeedback" class="form-note" role="status" aria-live="polite">Conectando biblioteca…</p>'+
  '<form id="adsMediaForm" class="form-stack"><label>Selecionar vídeo '+
  '<input type="file" id="adsMediaFile" accept=".mp4,.mov,video/mp4,video/quicktime" required '+
  (canManage?'':'disabled')+'></label><button type="submit" class="btn primary" '+
  (canManage?'':'disabled')+'>Enviar vídeo</button></form>'+
  '<div id="adsMediaList" style="margin-top:18px"></div>'+
  '<div style="border-top:1px solid #eee;margin-top:22px;padding-top:18px"><h3>Extensão MCP de mídia</h3>'+
  '<p class="form-note">Chaves com validade de 30 dias. A extensão só acessa vídeos da empresa; não tem autorização para criar ou ativar campanhas na Meta.</p>'+
  '<button id="adsMediaMcpCreate" class="btn soft" '+(canManage?'':'disabled')+'>Gerar chave MCP</button> '+
  '<button id="adsMediaMcpRevoke" class="btn soft" '+(canManage?'':'disabled')+'>Revogar chave</button>'+
  '<div id="adsMediaMcpInfo" class="form-note" role="status"></div></div>';
 view.append(section);mounted=section;
 section.querySelector('#adsMediaForm').addEventListener('submit',async e=>{
  e.preventDefault();const file=section.querySelector('#adsMediaFile').files?.[0];
  if(!file||!/\.(mp4|mov)$/i.test(file.name)||file.size>90*1024*1024||file.size<512){
   note('Selecione um arquivo MP4/MOV entre 512 bytes e 90 MB.',true);return;
  }
  const b=e.currentTarget.querySelector('button');b.disabled=true;note('Enviando vídeo…');
  try{
   const reserved=await request('/api/ads-media/reserve','POST',{filename:file.name});
   const res=await fetch('/api/ads-media/'+reserved.id+'/upload',{method:'POST',credentials:'same-origin',
    headers:{'X-CSRF-Token':csrf,'Content-Type':file.name.toLowerCase().endsWith('.mov')?'video/quicktime':'video/mp4'},
    body:file});
   const ans=await res.json().catch(()=>({}));
   if(!res.ok)throw Error(ans.error||'Falha no envio.');
   note('Vídeo recebido e salvo na biblioteca privada.');e.currentTarget.reset();await load();
  }catch(error){note(error.message,true);}finally{b.disabled=false;}
 });
 section.querySelector('#adsMediaMcpCreate').addEventListener('click',async()=>{
  if(!confirm('Gerar nova chave MCP? A chave anterior será revogada.'))return;
  try{
   const result=await request('/api/ads-media/mcp-token','POST',{});
   const area=section.querySelector('#adsMediaMcpInfo');
   area.replaceChildren();
   const info=document.createElement('p');info.textContent='Servidor: '+result.endpoint+' · Expira: '+new Date(result.expiresAt).toLocaleDateString('pt-BR');
   const secret=document.createElement('input');secret.readOnly=true;secret.value=result.token;
   secret.style.cssText='width:100%;margin-top:9px';secret.setAttribute('aria-label','Chave secreta MCP');
   area.append(info,secret);secret.select();
   note('Chave criada. Copie em segurança; ela não será mostrada novamente.');
  }catch(error){note(error.message,true);}
 });
 section.querySelector('#adsMediaMcpRevoke').addEventListener('click',async()=>{
  if(!confirm('Revogar as chaves MCP de mídia deste usuário?'))return;
  try{await request('/api/ads-media/mcp-revoke','POST',{});
   section.querySelector('#adsMediaMcpInfo').replaceChildren();note('Chaves revogadas.');
  }catch(error){note(error.message,true);}
 });
 try{await load();}catch(error){note(error.message,true);}
}
let busy=false;
observer=new MutationObserver(()=>{
 if(busy||mounted&&view.contains(mounted))return;
 if(!view.querySelector('[data-marketing-oauth]')){mounted=null;return;}
 busy=true;
 Promise.resolve().then(mount).catch(()=>{}).finally(()=>{busy=false;});
});
observer.observe(view,{childList:true,subtree:false});
void mount().catch(()=>{});
})();
