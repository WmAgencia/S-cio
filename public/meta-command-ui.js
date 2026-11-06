// Panel command console: authenticated and review-first, never runs WhatsApp/group commands.
(()=>{
 const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);return n;};
 async function render({root,api,canManage,account}){
  const section=el('section');section.className='card card-pad';root.append(section);
  section.append(el('h2','Comandos do Sócio para Meta Ads'),
   el('p','Peça resultados ou prepare alterações na conta '+account.account_id+'. Ações que geram gastos só ocorrem depois da sua confirmação.'));
  const field=el('textarea');field.rows=3;field.maxLength=1000;
  field.placeholder='Ex.: quais Pixels existem na conta?; crie um Pixel chamado Loja Consecom; mostre os resultados dos últimos 7 dias; pause a campanha ID 123456.';
  field.setAttribute('aria-label','Comando para a Meta Ads');section.append(field);
  const preview=el('button','Analisar comando');preview.className='btn primary';preview.type='button';section.append(preview);
  const status=el('p');status.setAttribute('role','status');section.append(status);
  const result=el('div');section.append(result);
  preview.addEventListener('click',async()=>{
   const text=field.value.trim();
   if(!text){status.textContent='Digite um pedido.';return;}
   preview.disabled=true;status.textContent='Analisando sem modificar campanhas…';result.replaceChildren();
   try{
    const data=await api('/api/marketing/commands/preview','POST',{text});
    const command=data.command;
    if(data.readOnly&&data.data){
     const sum=data.data.summary;
     result.append(el('h3','Resultados consultados na Meta'));
     if(sum)result.append(el('p','Investimento: '+sum.spend+' '+sum.currency+' · Cliques: '+sum.clicks+
      ' · Impressões: '+sum.impressions+' · CPC: '+(sum.cpc??'não disponível')));
     result.append(el('p','Os resultados não comprovam mensagens recebidas nem vendas.'));
     for(const entry of (data.data.items||[]).slice(0,20)){
      if(command.kind==='pixels'){
       result.append(el('p',(entry.name||'Pixel')+' · ID: '+entry.id+
        (entry.last_fired_time?' · Última atividade: '+entry.last_fired_time:'')));
      }else{
       const item=el('p',(entry.campaign_name||entry.adset_name||entry.ad_name||'Indicador')+
        ': '+(entry.spend||'0')+' gastos · '+(entry.clicks||'0')+' cliques');result.append(item);
      }
     }
     status.textContent='Consulta concluída. Nenhuma campanha alterada.';return;
    }
    if(data.preview&&data.plan){
     const plan=data.plan,summary=plan.summary;
     result.append(el('h3','Prévia pendente de aprovação'),el('p',summary.description));
     result.append(el('p','Conta: '+summary.account.id));
     if(summary.pixelName)result.append(el('p','Novo Pixel: '+summary.pixelName));
     if(summary.object)result.append(el('p','Item: '+summary.object.name+' · '+summary.object.id));
     if(summary.changes)result.append(el('p','Mudanças: '+JSON.stringify(summary.changes)));
     const confirmation=el('label');const checkbox=el('input');checkbox.type='checkbox';
     confirmation.append(checkbox,document.createTextNode('Conferi a conta, os limites e autorizo esta operação.'));result.append(confirmation);
     const send=el('button','Confirmar e executar na Meta');send.className='btn primary';send.type='button';send.disabled=true;
     result.append(send);
     checkbox.addEventListener('change',()=>{send.disabled=!checkbox.checked||!canManage;});
     if(!canManage){status.textContent='Você não possui permissão para executar alterações.';return;}
     send.addEventListener('click',async()=>{
      if(!checkbox.checked)return;
      send.disabled=true;status.textContent='Enviando operação confirmada à Meta…';
      try{
       const executed=await api('/api/marketing/tools/execute','POST',{planId:plan.id,confirmed:true});
       result.replaceChildren(el('p',executed.status==='succeeded'?'Operação confirmada pela Meta.':'Resultado incerto ou recusado.'));
       if(executed.error)result.append(el('p',executed.error));
       if(executed.result?.id)result.append(el('p','ID: '+executed.result.id));
       if(executed.result?.pixelId)result.append(el('p','ID do Pixel criado: '+executed.result.pixelId+' · Instale os eventos no site e configure CAPI antes de considerar o rastreamento ativo.'));
       status.textContent='Confirme o status no Gerenciador de Anúncios antes de repetir.';
      }catch(e){status.textContent=e.message+' Não repita sem revisar o histórico.';}
     });
     status.textContent='Prévia gerada, sem alterações. Revise antes de confirmar.';return;
    }
    result.append(el('p',command.note||'Informação incompleta para criar uma operação.'));
    for(const item of command.missing||[])result.append(el('p','• '+item));
    status.textContent='Complete as informações pelo construtor de anúncios da conta. Nenhuma alteração foi executada.';
   }catch(e){status.textContent='Não foi possível preparar o comando: '+e.message;}
   finally{preview.disabled=false;}
  });
 }
 globalThis.SocioMetaCommandUI={render};
})();
