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
   E('p','Consultas e diagnósticos da conta autorizada '+account.account_id+'. Recomendações são apenas leitura: mudanças e gastos precisam de uma aprovação separada.'));
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
    if(selected!=='diagnosis')for(const item of safe){
     const card=E('article');card.className='panel';list.append(card);
     card.append(E('strong',item.name||item.campaign_name||item.adset_name||item.ad_name||item.title||item.id||'Registro'));
     const table=E('dl');card.append(table);
     for(const [field,v] of Object.entries(item)){
      if(field==='object_story_spec'||field==='rule'||typeof v==='object')continue;
      if(v===null||v===undefined||String(v).length>220)continue;
      table.append(E('dt',field.replace(/_/g,' ')),E('dd',v));
     }
    }
    if(selected==='diagnosis'){
     const assessment=data.diagnosis;
     if(assessment){
      summary.append(E('p','Diagnóstico de '+assessment.totalCampaigns+' campanha(s); '+assessment.alerts+
       ' anúncio(s) com possível restrição. '+(assessment.partial?'Resultado parcial. ':'')+
       (assessment.adsUnavailable?'Não foi possível verificar o status dos anúncios.':'Status dos anúncios consultados quando disponíveis.')));
     }
     if(!data.diagnostics?.length)list.append(E('p','Nenhuma campanha com métricas ou status neste período. Isso não comprova que a conta não possui campanhas.'));
     for(const d of data.diagnostics||[]){
      const card=E('article');card.className='panel';list.append(card);
      card.append(E('strong',d.name+' (ID '+d.id+')'),
       E('p','Investimento: '+d.spend+' '+(assessment?.currency||'')+' · Impressões: '+d.impressions+
        ' · Cliques: '+d.clicks+' · CTR: '+(d.ctrPercent??'n/d')+'% · CPC: '+(d.cpc??'n/d')));
      if(!d.notices.length)card.append(E('p','Nenhum alerta suficiente para orientar alteração; valide leads e compras antes de otimizar.'));
      for(const notice of d.notices){
       card.append(E('p',notice.label+': '+notice.evidence),
        E('p','Próximo passo sugerido: '+notice.recommendation));
      }
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
