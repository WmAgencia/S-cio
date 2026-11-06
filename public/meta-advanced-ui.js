// Advanced read-only Marketing API dashboard; never sends credentials or performs writes.
(()=>{
 const E=(tag,label)=>{const n=document.createElement(tag);if(label!==undefined)n.textContent=String(label);return n;};
 const KINDS=[['account','Conta'],['creatives','Criativos'],['videos','Vídeos'],['audiences','Públicos'],['pixels','Pixels'],['conversions','Conversões'],['reports','Relatórios'],['diagnosis','Diagnóstico']];
 function select(label,options,initial){
  const wrap=E('label',label),field=E('select');
  for(const [v,t] of options){const o=E('option',t);o.value=v;field.append(o);}
  field.value=initial;wrap.append(field);return {wrap,field};
 }
 async function render({root,api,account}){
  const section=E('section');section.className='card card-pad socio-meta-advanced';
  root.append(section);section.append(E('h2','Ferramentas avançadas da Marketing API'),
   E('p','Consultas da conta autorizada '+account.account_id+'. Nenhuma ferramenta desta seção altera campanhas ou gera gastos.'));
  const buttons=E('div');buttons.className='form-actions';section.append(buttons);
  const options=E('div');options.className='form-actions';section.append(options);
  const period=select('Período',[['today','Hoje'],['yesterday','Ontem'],['last_7d','7 dias'],['last_30d','30 dias']],'last_7d'),
   level=select('Agrupar por',[['campaign','Campanha'],['adset','Conjunto'],['ad','Anúncio'],['account','Conta']],'campaign'),
   breakdown=select('Detalhar por',[['none','Sem divisão'],['age','Idade'],['gender','Gênero'],['country','País'],
    ['region','Região'],['publisher_platform','Plataforma'],['platform_position','Posicionamento'],['device_platform','Dispositivo']],'none');
  options.append(period.wrap,level.wrap,breakdown.wrap);
  const daily=E('label');const check=E('input');check.type='checkbox';daily.append(check,document.createTextNode('Mostrar por dia'));options.append(daily);
  const feedback=E('p');feedback.setAttribute('role','status');section.append(feedback);
  const summary=E('div');section.append(summary);
  const list=E('div');list.className='socio-meta-advanced-results';section.append(list);
  const after=E('button','Ver mais registros');after.className='btn soft';after.type='button';after.hidden=true;section.append(after);
  let selected='reports',cursor=null,busy=false;
  const loading=()=>{feedback.textContent='Consultando a Meta…';buttons.querySelectorAll('button').forEach(b=>b.disabled=true);};
  async function load(next=false){
   if(busy)return;
   busy=true;loading();
   if(!next){cursor=null;list.replaceChildren();summary.replaceChildren();}
   try{
    const q=new URLSearchParams({period:period.field.value,level:level.field.value,breakdown:breakdown.field.value,daily:String(check.checked)});
    if(cursor&&next)q.set('after',cursor);
    const data=await api('/api/marketing/advanced/'+selected+'?'+q.toString());
    if(data.summary){
     summary.replaceChildren();
     const info=data.summary;
     summary.append(E('p','Investimento: '+info.spend+' '+(info.currency||'')+' · Impressões: '+info.impressions+
      ' · Cliques: '+info.clicks+' · CTR: '+info.ctrPercent+'% · CPC: '+(info.cpc===null?'indisponível':info.cpc)));
     summary.append(E('p',info.qualification));
    }
    const safe=data.items||[];
    if(!safe.length&&!next){list.append(E('p','Nenhum registro encontrado para esta consulta.'));}
    for(const item of safe){
     const card=E('article');card.className='panel';list.append(card);
     card.append(E('strong',item.name||item.campaign_name||item.adset_name||item.ad_name||item.title||item.id||'Registro'));
     const table=E('dl');card.append(table);
     for(const [field,v] of Object.entries(item)){
      if(field==='object_story_spec'||field==='rule'||typeof v==='object')continue;
      if(v===null||v===undefined||String(v).length>220)continue;
      table.append(E('dt',field.replace(/_/g,' ')),E('dd',v));
     }
    }
    if(data.diagnostics?.length){
     for(const d of data.diagnostics){
      const card=E('article');card.className='panel';list.append(card);
      card.append(E('strong',d.name),E('p','Gasto: '+d.spend+' · Cliques: '+d.clicks+' · CPC: '+(d.cpc??'n/d')),
       E('p',d.note));
     }
    }
    cursor=data.after||null;
    after.hidden=!data.hasMore||!cursor;
    feedback.textContent='Consulta concluída. '+(data.warning||'Dados da Meta não comprovam vendas WhatsApp.');
   }catch(err){feedback.textContent='Consulta indisponível: '+err.message;after.hidden=true;}
   finally{busy=false;buttons.querySelectorAll('button').forEach(b=>b.disabled=false);}
  }
  for(const [kind,title] of KINDS){
   const b=E('button',title);b.type='button';b.className='btn soft';buttons.append(b);
   b.addEventListener('click',()=>{selected=kind;options.hidden=!['reports','diagnosis'].includes(kind);void load();});
  }
  after.addEventListener('click',()=>void load(true));
  options.addEventListener('change',()=>{if(['reports','diagnosis'].includes(selected))void load();});
  await load();
 }
 globalThis.SocioMetaAdvanced={render};
})();
