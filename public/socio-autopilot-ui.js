// Autonomous recommendations, as they happen. Sócio reviews the account every
// six hours and asks about each change here (and in the "Meu Sócio" group).
// Nothing is applied until the owner answers; every card has the same three
// choices the WhatsApp question has.
(()=>{
 const POLL_MS=60000;
 const brl=cents=>Number(cents||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
 const centsFrom=value=>{
  const clean=String(value||'').replace(/[^\d.,]/g,'').replace(/\.(?=\d{3}(\D|$))/g,'').replace(',','.');
  const number=Number(clean);
  return Number.isFinite(number)?Math.round(number*100):NaN;
 };
 let timer=null,api=null,me=null,root=null,answering=false,observer=null;
 const seen={};
 const known={};
 let primed=false;

 // A short chime when a new recommendation lands. Browsers only allow sound
 // after the owner has interacted with the page, so the first blocked attempt
 // arms a one-time listener that plays it on the next touch.
 const ALERT_SRC='/socio-new-recommendation.mp3';
 let alertEl=null;
 function alertAudio(){
  if(alertEl||typeof Audio==='undefined')return alertEl;
  alertEl=new Audio(ALERT_SRC);
  alertEl.preload='auto';
  alertEl.volume=.7;
  return alertEl;
 }
 function playAlert(){
  const el=alertAudio();
  if(!el?.play)return;
  try{el.currentTime=0;}catch{}
  el.play()?.catch?.(()=>{
   const unlock=()=>{
    document.removeEventListener?.('pointerdown',unlock);
    document.removeEventListener?.('keydown',unlock);
    const again=alertAudio();
    try{again.currentTime=0;}catch{}
    again?.play?.()?.catch?.(()=>{});
   };
   document.addEventListener?.('pointerdown',unlock);
   document.addEventListener?.('keydown',unlock);
  });
 }

 // The overview already shows every recommendation in its right column, so the
 // floating card is only for the other tabs. Without a real location (tests)
 // nothing is suppressed.
 function onOverview(){
  if(typeof location==='undefined')return false;
  const hash=String(location.hash||'');
  return hash===''||hash==='#'||/^#\/+overview(?:[?/]|$)/.test(hash);
 }
 function syncVisibility(){root?.classList?.toggle('is-suppressed',onOverview());}

 function cardFor(decision){
  const card=document.createElement('article');
  card.className='socio-autopilot-card';
  card.setAttribute('role','dialog');
  card.setAttribute('aria-label','Recomendação de tráfego');
  const title=document.createElement('strong');title.textContent='Recomendação de tráfego';
  const question=document.createElement('p');question.textContent=decision.question||'Posso aplicar essa mudança?';
  card.append(title,question);
  if(decision.explanation){
   const detail=document.createElement('small');detail.textContent=decision.explanation;card.append(detail);
  }
  const note=document.createElement('p');note.className='socio-autopilot-note';note.hidden=true;
  const actions=document.createElement('div');actions.className='socio-autopilot-actions';
  const button=(label,className)=>{
   const b=document.createElement('button');b.type='button';b.className=className;b.textContent=label;return b;
  };
  const yes=button('Sim','btn primary sm'),no=button('Não','btn soft sm'),
   other=button('Outro valor','btn soft sm');
  actions.append(yes,no,other);card.append(actions);

  const amountWrap=document.createElement('div');amountWrap.className='socio-autopilot-amount';amountWrap.hidden=true;
  const amount=document.createElement('input');amount.type='text';amount.inputMode='decimal';amount.maxLength=12;
  amount.placeholder='Valor diário em reais';
  amount.value=decision.targetBudgetCents?(decision.targetBudgetCents/100).toFixed(2).replace('.',','):'';
  const apply=button('Aplicar','btn primary sm');amountWrap.append(amount,apply);
  card.append(amountWrap,note);

  const say=(text,error=false)=>{note.hidden=!text;note.textContent=text;note.classList?.toggle('is-error',!!error);};
  const answer=async(payload)=>{
   if(answering)return;
   answering=true;
   yes.disabled=no.disabled=other.disabled=apply.disabled=true;
   try{
    const result=await api('/api/marketing/traffic/decision','POST',{id:decision.id,...payload});
    card.classList?.add('is-done');
    say(result?.dismissed?'Tudo bem. Não mexi na campanha.':
     'Feito. Mudança aplicada'+(result?.action?.targetBudgetCents?' — '+brl(result.action.targetBudgetCents)+' por dia':'')+'.');
    delete seen[decision.id];
    setTimeout(()=>{card.classList?.add('is-leaving');setTimeout(()=>card.remove(),340);},1300);
   }catch(error){
    say('Não consegui aplicar: '+String(error?.message||'tente novamente.'),true);
    yes.disabled=no.disabled=other.disabled=apply.disabled=false;
   }finally{answering=false;}
  };
  yes.addEventListener('click',()=>answer({resolution:'approve'}));
  no.addEventListener('click',()=>answer({resolution:'dismiss'}));
  other.addEventListener('click',()=>{amountWrap.hidden=false;other.disabled=true;amount.focus();});
  apply.addEventListener('click',()=>{
   const cents=centsFrom(amount.value);
   if(!Number.isFinite(cents)||cents<100){say('Informe um valor diário válido em reais (ex.: 10).',true);return;}
   answer({resolution:'approve',targetBudgetCents:cents});
  });
  return card;
 }

 async function poll(){
  if(answering||document.hidden)return;
  let data;
  try{data=await api('/api/marketing/traffic/pending');}
  catch{return;}
  if(!root?.isConnected)return;
  syncVisibility();
  const all=data?.items||[];
  const items=all.slice(0,3);
  const ids=new Set(all.map(item=>item.id));
  for(const id of Object.keys(known))if(!ids.has(id))delete known[id];
  let fresh=0;
  for(const item of all)if(!known[item.id]){known[item.id]=true;fresh++;}
  if(primed&&fresh>0)playAlert();
  primed=true;
  for(const card of [...root.children])if(!ids.has(card.dataset.decisionId))card.remove();
  for(const decision of items){
   if(root.querySelector('[data-decision-id="'+decision.id+'"]'))continue;
   if(seen[decision.id]==='answered')continue;
   const card=cardFor(decision);card.dataset.decisionId=decision.id;root.append(card);
  }
 }

 function dispose(){
  if(timer)clearInterval(timer);
  timer=null;
  primed=false;
  for(const id of Object.keys(known))delete known[id];
  navTarget()?.removeEventListener?.('hashchange',syncVisibility);
  navTarget()?.removeEventListener?.('popstate',syncVisibility);
  observer?.disconnect?.();observer=null;
  root?.remove();root=null;
 }

 function navTarget(){return typeof window!=='undefined'?window:undefined;}

 function start({api:apiImpl,me:meData}={}){
  const permissions=meData?.user?.permissions||[];
  if(!meData||(!meData.user?.platformOwner&&!permissions.includes('marketing.read')))return;
  dispose();
  api=apiImpl;me=meData;
  root=document.createElement('div');root.className='socio-autopilot';
  root.setAttribute('aria-live','polite');
  document.body.append(root);
  syncVisibility();
  // The Sócio router swaps the view with history.replaceState, which fires no
  // hash or popstate event, so the tab change is picked up from the view swap.
  navTarget()?.addEventListener?.('hashchange',syncVisibility);
  navTarget()?.addEventListener?.('popstate',syncVisibility);
  const view=document.getElementById?.('view');
  if(view&&typeof MutationObserver!=='undefined'){
   observer=new MutationObserver(syncVisibility);
   observer.observe(view,{childList:true});
  }
  poll();
  timer=setInterval(poll,POLL_MS);
 }

 globalThis.SocioAutopilotUI={start,dispose,poll};
})();
