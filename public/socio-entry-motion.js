/* Sócio entrance motion: progressive, composited and view-aware.
 * No animation while loading, on background refresh, or for reduced motion.
 * Navigation remains owned by app.js and socio-glass-motion.js.
 */
(function socioEntryMotion(){
 'use strict';
 const shell=document.getElementById('appShell');
 const view=document.getElementById('view');
 if(!shell||!view)return;
 const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)');
 const cheapMotion=window.matchMedia?.('(max-width: 650px)');
 const key=()=>String(shell.dataset.workspace||'production')+'|'+String(location.hash||'#/overview');
 let presented='',scheduled=false,observer=null;
 const matchesSkeleton=()=>{
  const first=view.firstElementChild;
  return !first||first.matches('.loading,.px-loading,.master-loading,.px-overview-loading,.px-screen-loading,[aria-busy="true"]');
 };
 const stopObserver=()=>{observer?.disconnect();observer=null;};
 function entrance(node,index){
  if(!node?.isConnected||reduced?.matches||document.hidden||typeof node.animate!=='function')return;
  if(node.hasAttribute('data-socio-entered'))return;
  node.setAttribute('data-socio-entered','');
  const duration=cheapMotion?.matches?240:360;
  // Only opacity and transform: no layout, page-sized blur or heavy filters.
  node.animate([
   {opacity:.44,transform:'translate3d(0,10px,0)'},
   {opacity:1,transform:'translate3d(0,0,0)'}
  ],{duration,delay:Math.min(index,5)*(cheapMotion?.matches?24:39),
    easing:'cubic-bezier(.22,.82,.23,1)',fill:'backwards'});
 }
 function start(){
  if(shell.classList.contains('hidden')||matchesSkeleton())return;
  const next=key();
  if(next===presented)return; // E.g. Meta/WhatsApp automatic refresh, no jitter.
  presented=next;stopObserver();
  if(reduced?.matches)return;
  const nodes=[...view.querySelectorAll(
   '.px-page-heading,.px-budget-top,.px-kpi,.px-section-heading,.px-ads-metric,'+
   '.px-panel,.px-conn-card,.master-kpi,.master-panel,.socio-clean-section,'+
   '.wa-inbox-side,.wa-inbox-main,.socio-training-center'
  )].filter(n=>n.getClientRects().length>0).slice(0,25);
  if(!nodes.length){
   const first=view.firstElementChild;
   if(first)entrance(first,0);
   return;
  }
  let order=0;
  if(typeof IntersectionObserver!=='function'){
   nodes.filter(n=>n.getBoundingClientRect().top<window.innerHeight+80)
     .forEach(node=>entrance(node,order++));
   return;
  }
  observer=new IntersectionObserver(entries=>{
   for(const entry of entries){
    if(!entry.isIntersecting)continue;
    observer?.unobserve(entry.target);
    entrance(entry.target,order++);
   }
  },{root:null,rootMargin:'0px 0px 65px 0px',threshold:.09});
  nodes.forEach(node=>observer?.observe(node));
 }
 function schedule(){
  if(scheduled)return;
  scheduled=true;
  requestAnimationFrame(()=>{scheduled=false;start();});
 }
 new MutationObserver(schedule).observe(view,{childList:true});
 window.addEventListener('hashchange',schedule,{passive:true});
 reduced?.addEventListener?.('change',()=>{stopObserver();schedule();});
 schedule();
 window.SocioEntryMotion=Object.freeze({version:'2026-11-12',reveal:schedule});
})();
