/* Sócio visual motion layer. Never replaces routing, event handlers or dashboard HTML.
   Navigation pill reproduces the two-edge clip-path motion shown in the reference video. */
(function socioGlassMotion(){
  'use strict';
  const shell=document.getElementById('appShell');
  const view=document.getElementById('view');
  if(!shell||!view)return;
  const reduce=window.matchMedia('(prefers-reduced-motion: reduce)');
  const navs=[document.getElementById('productionNav'),document.getElementById('masterNav')].filter(Boolean);
  const easeOut=t=>1-Math.pow(1-t,3);
  const easeInOut=t=>t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;
  const tween=(a,b,t)=>a+(b-a)*t;
  const navRafs=new WeakMap();

  function rectFor(nav){
    const target=nav.querySelector('.nav-item.selected:not(.hidden)');
    if(!target||!target.getClientRects().length)return null;
    const width=nav.scrollWidth,height=nav.scrollHeight;
    const l=target.offsetLeft,t=target.offsetTop;
    return {l,r:Math.max(0,width-l-target.offsetWidth),
      t,b:Math.max(0,height-t-target.offsetHeight),width,height};
  }
  function clip(c){
    return 'inset('+c.t+'px '+c.r+'px '+c.b+'px '+c.l+'px round 12px)';
  }
  function movePill(nav,instant){
    const pill=nav.querySelector('.socio-glass-nav-pill');
    if(!pill)return;
    const next=rectFor(nav);
    if(!next)return;
    const prior=nav._socioGlassRect;
    const oldRaf=navRafs.get(nav);
    if(oldRaf)cancelAnimationFrame(oldRaf);
    pill.style.width=next.width+'px';
    pill.style.height=next.height+'px';
    nav._socioGlassRect=next;
    if(instant||!prior||reduce.matches){
      pill.style.clipPath=clip(next);return;
    }
    const movingRight=next.l>prior.l, movingDown=next.t>prior.t;
    const horizontal=next.l!==prior.l||next.r!==prior.r;
    const vertical=next.t!==prior.t||next.b!==prior.b;
    if(!horizontal&&!vertical){pill.style.clipPath=clip(next);return;}
    const origin=performance.now();
    const transition={l:horizontal?(movingRight?550:360):1,
      r:horizontal?(movingRight?360:550):1,
      t:vertical?(movingDown?550:360):1,
      b:vertical?(movingDown?360:550):1};
    function tick(now){
      const values={width:next.width,height:next.height};
      ['l','r','t','b'].forEach(edge=>{
        const dur=transition[edge];
        const progress=Math.min(1,(now-origin)/dur);
        const leading=edge==='l'||edge==='t';
        const towardsForward=edge==='l'?movingRight:edge==='t'?movingDown:
          edge==='r'?movingRight:movingDown;
        const easing=leading===towardsForward?easeInOut:easeOut;
        values[edge]=tween(prior[edge],next[edge],easing(progress));
      });
      pill.style.clipPath=clip(values);
      if(now-origin<550){navRafs.set(nav,requestAnimationFrame(tick));}
      else{pill.style.clipPath=clip(next);navRafs.delete(nav);}
    }
    navRafs.set(nav,requestAnimationFrame(tick));
  }

  navs.forEach(nav=>{
    if(nav.querySelector('.socio-glass-nav-pill'))return;
    const pill=document.createElement('span');
    pill.className='socio-glass-nav-pill';
    pill.setAttribute('aria-hidden','true');
    nav.prepend(pill);
    movePill(nav,true);
    const observer=new MutationObserver(()=>requestAnimationFrame(()=>movePill(nav,false)));
    observer.observe(nav,{subtree:true,attributes:true,attributeFilter:['class']});
    nav.addEventListener('scroll',()=>{if(reduce.matches)movePill(nav,true);},{passive:true});
  });
  window.addEventListener('resize',()=>navs.forEach(nav=>movePill(nav,true)),{passive:true});
  reduce.addEventListener?.('change',()=>navs.forEach(nav=>movePill(nav,true)));

  let displayedView=null;
  let pageAnimation=null;
  let revealToken=0;
  const keyOfView=()=>{
    try{return typeof state!=='undefined'&&state?state.view:null;}
    catch{return null;}
  };
  const isLoader=()=>view.children.length===1&&
    (view.firstElementChild?.classList.contains('loading')||
     view.firstElementChild?.classList.contains('px-loading')||
     view.firstElementChild?.classList.contains('master-loading'));

  function reveal(){
    if(shell.classList.contains('hidden')||isLoader())return;
    const key=keyOfView();
    if(!key||key===displayedView)return;
    displayedView=key;
    if(reduce.matches)return;
    const token=++revealToken;
    requestAnimationFrame(()=>{
      if(token!==revealToken||shell.classList.contains('hidden')||keyOfView()!==key)return;
      pageAnimation?.cancel();
      // Do not blur or clip a full dashboard with charts, videos and forms.
      // Compositor-friendly opacity + translation is faster on low-power devices.
      if(typeof view.animate!=='function')return;
      pageAnimation=view.animate([
        {opacity:.73,transform:'translate3d(0,7px,0)'},
        {opacity:1,transform:'translate3d(0,0,0)'}
      ],{duration:280,easing:'cubic-bezier(.22,.86,.2,1)',fill:'none'});
      pageAnimation.addEventListener('finish',()=>{pageAnimation=null;},{once:true});
    });
  }
  const pageObserver=new MutationObserver(reveal);
  pageObserver.observe(view,{childList:true});
  reveal();
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='visible')navs.forEach(nav=>movePill(nav,true));
  });
  window.SocioGlassMotion=Object.freeze({version:'2026-11-10',reposition:()=>navs.forEach(nav=>movePill(nav,true))});
})();
