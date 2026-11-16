/* Sócio motion: one reveal language for every screen, applied after each paint.
 * Numbers count up from zero, bars grow from the baseline, donuts draw their
 * arc and panels expand. Only opacity/transform and text are touched, so the
 * page never reflows. A 60s background refresh stays silent when the values did
 * not change, and prefers-reduced-motion turns everything off.
 */
(function socioMotion(){
 'use strict';
 if(globalThis.SocioMotion?.version)return;
 const reduced=()=>window.matchMedia?.('(prefers-reduced-motion: reduce)').matches===true;
 const cheap=()=>window.matchMedia?.('(max-width: 650px)').matches===true;
 const easeOut=t=>1-Math.pow(1-t,3);

 // ── Number parsing/formatting ────────────────────────────────────────────
 const parseDisplay=text=>{
  const clean=String(text||'').replace(/[^\d.,]/g,'');
  if(!/\d/.test(clean))return null;
  const comma=clean.lastIndexOf(','),dot=clean.lastIndexOf('.');
  const sep=Math.max(comma,dot);
  let decimal=-1;
  if(sep>=0){
   const tail=clean.length-sep-1;
   const grouped=sep===dot&&tail===3||sep===comma&&tail===3;
   if(tail>0&&tail<=2&&!grouped)decimal=sep;
  }
  const intPart=decimal>=0?clean.slice(0,decimal):clean;
  const decPart=decimal>=0?clean.slice(decimal+1):'';
  const value=Number(intPart.replace(/[^\d]/g,'')||'0'+(decPart?'.'+decPart.replace(/[^\d]/g,''):''));
  if(!Number.isFinite(value))return null;
  return {value,decimals:decPart.replace(/[^\d]/g,'').length};
 };
 const formatLike=(value,decimals)=>{
  try{return new Intl.NumberFormat('pt-BR',{minimumFractionDigits:decimals,maximumFractionDigits:decimals}).format(value);}
  catch{return String(Math.round(value));}
 };
 // "R$ 2.438,00" → prefix "R$ ", suffix ""; counting keeps both ends intact.
 const splitAffixes=text=>{
  const raw=String(text);
  const first=raw.search(/\d/);
  if(first<0)return null;
  let last=raw.length-1;
  while(last>first&&!/\d/.test(raw[last]))last--;
  return {prefix:raw.slice(0,first),suffix:raw.slice(last+1),body:raw.slice(first,last+1)};
 };
 const countTo=(node,target,duration)=>{
  const parts=splitAffixes(target);
  const parsed=parts?parseDisplay(parts.body):null;
  if(!parsed||parsed.value===0)return false;
  node.dataset.socioCounted=target;
  // The real value stays on screen until the first animation frame: showing 0
  // and then counting made every tile flash a false zero on return.
  const t0=performance.now();
  const step=now=>{
   if(!node.isConnected)return;
   const p=Math.min(1,(now-t0)/duration);
   node.textContent=parts.prefix+formatLike(parsed.value*easeOut(p),parsed.decimals)+parts.suffix;
   if(p<1)requestAnimationFrame(step);
   else node.textContent=target;
  };
  requestAnimationFrame(step);
  return true;
 };

 // ── Selectors ────────────────────────────────────────────────────────────
 const NUMBER_SELECTORS=[
  '.et-hero-value strong','.et-kpi-value','.et-metric-value','.et-stat-value',
  '.master-kpi strong','.metric strong','.ov-rev-value','[data-socio-count]'
 ];
 const PANEL_SELECTOR=[
  '.view-heading','.px-panel','.px-kpi','.px-conn-card','.master-kpi','.master-panel',
  '.socio-clean-section','.wa-inbox-side','.wa-inbox-main','.inbox-layout > *',
  '.grid.stats > *','.two-pane > *','.et-card','.et-kpi','.et-block','.et-hero','.card',
  '.ai-guide-head','.socio-training-center','.catalog-product','.master-company-filters'
 ].join(',');
 const countNodes=root=>{
  const seen=new Set();
  for(const selector of NUMBER_SELECTORS)
   for(const node of root.querySelectorAll(selector))seen.add(node);
  return [...seen];
 };

 // ── The three gestures ───────────────────────────────────────────────────
 const expandPanels=(root,indexBase=0)=>{
  const nodes=[...root.querySelectorAll(PANEL_SELECTOR)].filter(node=>node.getClientRects().length>0);
  nodes.forEach((node,index)=>{
   if(node.dataset.socioExpanded||typeof node.animate!=='function')return;
   node.dataset.socioExpanded='';
   // One short, composited entrance: fade leads, a tiny rise settles. No bounce
   // overshoot (it read as jitter) and no long stagger (it read as slow).
   // `fill:'backwards'` froze the card at opacity 0 during its delay, so a card
   // waiting its turn painted as an empty hole over the layout. Animate from
   // opacity .999 toward 1 instead: the card is fully laid out and legible on
   // the first frame, and only the small lift reads as motion.
   node.animate([
    {opacity:0.999,transform:'translate3d(0,8px,0)'},
    {opacity:1,transform:'translate3d(0,0,0)'}
   ],{duration:cheap()?170:240,delay:Math.min(index+indexBase,7)*(cheap()?10:22),
      easing:'cubic-bezier(.22,.8,.3,1)'});
  });
 };
 const growBars=root=>{
  for(const bar of root.querySelectorAll('svg rect[height]')){
   // Any height above 1 (thin empty-month stubs included) grows from the base.
   if(bar.dataset.socioGrown||bar.dataset.socioUnchanged||bar.closest('.px-load-card'))continue;
   const height=Number(bar.getAttribute('height'));
   if(!Number.isFinite(height)||height<=1)continue;
   bar.dataset.socioGrown='';
   if(typeof bar.animate!=='function')continue;
   const x=Number(bar.getAttribute('x'))||0,y=Number(bar.getAttribute('y'))||0;
   bar.style.transformOrigin=x+'px '+(y+height)+'px';
   bar.animate([{transform:'scaleY(0)'},{transform:'scaleY(1)'}],
    {duration:cheap()?380:520,delay:Math.min(x/6,120),easing:'cubic-bezier(.25,.8,.3,1)'});
  }
  for(const fill of root.querySelectorAll('[class*="bar-fill"],.px-kpi-meter > span,.bi-bar-fill')){
   if(fill.dataset.socioGrown)continue;
   fill.dataset.socioGrown='';
   if(typeof fill.animate==='function')
    fill.animate([{transform:'scaleX(0)'},{transform:'scaleX(1)'}],
     {duration:520,easing:'cubic-bezier(.25,.8,.3,1)',transformOrigin:'left center'});
  }
 };
 const drawDonuts=root=>{
  for(const circle of root.querySelectorAll('svg circle[stroke-dasharray]')){
   if(circle.dataset.socioDrawn)continue;
   const dash=String(circle.getAttribute('stroke-dasharray')||'');
   const [len,rest]=dash.split(/\s+/);
   if(!/^[\d.]+$/.test(len)||!rest||!/^\d+(\.\d+)?$/.test(rest))continue;
   circle.dataset.socioDrawn='';
   if(typeof circle.animate!=='function')continue;
   const offset=circle.getAttribute('stroke-dashoffset')||'0';
   circle.animate([{strokeDasharray:'0 '+rest,strokeDashoffset:offset},
    {strokeDasharray:dash,strokeDashoffset:offset}],
    {duration:620,easing:'cubic-bezier(.3,.7,.2,1)'});
  }
 };

 // ── Fresh screen vs. silent refresh ──────────────────────────────────────
 // Same screen repainted by a background refresh keeps the same signature, so
 // its numbers and bars stay still; only a different screen starts a reveal.
 let lastSignature='';
 const signature=root=>{
  const first=root.firstElementChild;
  return String(first?(first.className||first.tagName):'')+'|'+String(location.hash||'');
 };
 const play=(root=document.getElementById('view'),fresh=true,force=false)=>{
  if(!root||(reduced()&&!force))return;
  // Taking a screen off the page counts as leaving it: coming back is a new
  // arrival and must animate again.
  if(!root.querySelector('.px-workspace,.wa-inbox,.view-heading,.et-board'))lastSignature='';
  // The skeleton is a screen too: its cards enter once, and the real content
  // replaces them in place without a second entrance.
  if(fresh)expandPanels(root);
  if(!fresh)return;
  const targets=[];
  for(const node of countNodes(root)){
   const text=String(node.textContent||'').trim();
   if(!text||node.dataset.socioCounted===text)continue;
   targets.push([node,text]);
  }
  // Wait for one frame so the first paint is visible before numbers reset.
  requestAnimationFrame(()=>{
   for(const [node,text] of targets)countTo(node,text,cheap()?420:620);
  });
  growBars(root);
  drawDonuts(root);
  // Charts and threads finish a moment after the first paint: revisit briefly
  // so nothing that arrived late appears fully drawn with no motion.
  clearTimeout(play.settle);
  play.settle=setTimeout(()=>{if(root.isConnected)growBars(root);drawDonuts(root);},420);
 };
 const watch=()=>{
  const root=document.getElementById('view');
  if(!root)return;
  let frame=0;
  new MutationObserver(()=>{
   if(frame)return;
   frame=requestAnimationFrame(()=>{
    frame=0;
    if(root.querySelector('.loading,.px-loading,.master-loading,.px-overview-loading,.px-screen-loading,[aria-busy="true"]'))return;
    const next=signature(root);
    const fresh=next!==lastSignature;
    lastSignature=next;
    play(root,fresh);
   });
  }).observe(root,{childList:true});
  window.addEventListener('hashchange',()=>{lastSignature='';},{passive:true});
 };
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',watch,{once:true});
 else watch();

 globalThis.SocioMotion=Object.freeze({version:'2026-11-16',play,reveal:play,replay:(root=document.getElementById('view'))=>play(root,true,true)});
})();
