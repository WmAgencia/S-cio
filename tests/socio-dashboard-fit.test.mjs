import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {chromium} from 'playwright-core';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const html=read('public/index.html').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'')
 .replace(/<link rel="stylesheet" href="([^\"]+)"\s*\/?\s*>/g,(_,p)=>'<style>'+read('public'+p.split('?')[0])+'</style>');
const chrome=[process.env.CHROME_PATH,'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
 '/usr/bin/google-chrome','/usr/bin/chromium'].find(p=>p&&existsSync(p));

test('desktop dashboard and orb stay inside the window, including expanded controls', {timeout:60000},async t=>{
 if(!chrome){t.skip('Chromium unavailable');return;}
 const browser=await chromium.launch({executablePath:chrome,headless:true,args:['--no-sandbox','--disable-gpu']});
 try{
  for(const [width,height] of [[1900,900],[1536,730],[1440,640],[1280,650],[1280,600],[1100,700]]){
   const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'});
   await page.setContent(html);
   await page.addScriptTag({content:read('public/socio-workspace-ui.js')});
   await page.addScriptTag({content:read('public/socio-thalita-ui.js')});
   await page.evaluate(async()=>{
    document.querySelector('#appShell').classList.remove('hidden');
    document.querySelector('#workspaceSwitcher').classList.remove('hidden');
    const api=async p=>{
     if(p.includes('/dashboard/period'))return{period:{from:'2026-11-08',to:'2026-11-14'},sales:{revenueCents:123400,confirmed:4},leads:{campaign:56,previousCampaign:41}};
     if(p.includes('/dashboard/revenue'))return{months:[6,7,8,9,10,11].map(month=>({month:'2026-'+String(month).padStart(2,'0'),revenueCents:123400}))};
     if(p.includes('/official/status'))return{selectedAccount:{currency:'BRL'}};
     if(p.includes('/tools/campaigns'))return{items:[{id:'campaign',name:'TEL | TRÁFEGO ABERTO | MULHERES 45–64 | SITE | NOV26',status:'ACTIVE'}]};
     if(p.includes('/insights'))return{items:[{campaign_id:'campaign',spend:65.5,clicks:970}]};
     if(p.includes('/traffic'))return{items:[1,2,3].map(id=>({id:String(id),status:'awaiting_approval',action:'scale',question:'Aumentar o orçamento da campanha selecionada?',targetBudgetCents:5000}))};
     if(p.includes('/inbox/v2'))return{conversations:[1,2,3,4].map(id=>({id:String(id),customer_name:'Cliente '+id,handling_mode:'ai_assist',channel_provider:'waakg',last_message:'Quero saber mais sobre o produto.'}))};
     return{items:[]};
    };
    const me={tenant:{id:'fixture'},user:{id:'owner',platformOwner:true}};
    await SocioWorkspaceUI.overview({root:document.querySelector('#view'),api,me,navigate(){}});
    SocioThalitaUI.mount({client:api,auth:me,csrfToken:'fixture',navigate(){}});
   });
   for(const expanded of [false,true]){
    if(expanded){await page.locator('[data-period-custom]').click();await page.locator('.et-rec:first-child [data-rec-other]').click();}
    const result=await page.evaluate(()=>{
     const orb=document.querySelector('.thalita-orb').getBoundingClientRect();
     const spill=[...document.querySelectorAll('.et-board-grid input,.et-board-grid .et-legend li,.et-board-grid .et-sub-row,.et-board-grid .et-campaign-body,.et-rec:first-child .et-btn,[data-period-preset],[data-split-preset]')].filter(el=>{
      const r=el.getBoundingClientRect(),card=el.closest('.et-board-grid>section')?.getBoundingClientRect();
      return card&&r.width&&r.height&&(r.bottom>card.bottom+1||r.top<card.top-1||r.right>card.right+1||r.left<card.left-1);
     }).map(el=>{const r=el.getBoundingClientRect(),c=el.closest('.et-board-grid>section').getBoundingClientRect();return{element:el.className||el.tagName,top:r.top,bottom:r.bottom,left:r.left,right:r.right,card:{top:c.top,bottom:c.bottom,left:c.left,right:c.right}};});
     const overlaps=[...document.querySelectorAll('.et-board-grid button')].filter(el=>{const r=el.getBoundingClientRect();return r.width&&r.height&&r.left<orb.right&&r.right>orb.left&&r.top<orb.bottom&&r.bottom>orb.top;}).length;
     return{header:document.querySelector('.topbar').getBoundingClientRect().height,hero:document.querySelector('.et-hero').getBoundingClientRect().height,pageHeight:document.documentElement.scrollHeight,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth,orbInside:orb.left>=0&&orb.top>=0&&orb.right<=innerWidth&&orb.bottom<=innerHeight,spill,overlaps};
    });
    // Stripe's readable cards scroll vertically; the old one-screen dark mockup
    // intentionally compressed every metric into 600px, harming accessibility.
    assert(result.pageHeight<=height*3,JSON.stringify({width,height,expanded,...result}));
    assert.equal(result.overflow,false);assert.equal(result.orbInside,true);
    assert.deepEqual(result.spill,[],JSON.stringify({width,height,expanded,...result}));
    assert.equal(result.overlaps,0,'Orb must not cover dashboard buttons');
   }
   await page.close();
  }
 }finally{await browser.close();}
});
