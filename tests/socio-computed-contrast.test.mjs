import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {chromium} from 'playwright-core';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const html=read('public/index.html');
const paths=[...html.matchAll(/<link rel="stylesheet" href="(\/[^"]+\.css(?:\?[^"]*)?)"/g)]
 .map(m=>m[1].split('?')[0]);
const css=paths.map(p=>read('public'+p)).join('\n');
const chrome=[
 process.env.CHROME_PATH,
 '/usr/bin/google-chrome',
 '/usr/bin/google-chrome-stable',
 '/usr/bin/chromium',
 '/usr/bin/chromium-browser',
 '/opt/google/chrome/chrome'
].find(p=>p&&existsSync(p));

test('computed, rendered CSS has AA-contrast text across representative real components', {timeout:40000}, async t=>{
 if(!chrome){t.skip('Installed Chromium not found; static palette audit still runs');return;}
 let browser;
 try{browser=await chromium.launch({executablePath:chrome,headless:true,args:['--no-sandbox']});}
 catch(e){t.skip('Chromium unavailable on this runner: '+String(e).slice(0,120));return;}
 try{
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  await page.setContent('<!doctype html><html lang="pt-BR"><head><style>'+css+'</style></head><body>'+
  '<div id="appShell" class="app-shell" data-workspace="production">'+
   '<aside class="sidebar"><div class="support-block"><strong>Ajuda</strong><small>Suporte e configurações</small></div></aside>'+
   '<div class="app-main"><div class="topbar">Sua empresa</div><main id="view">'+
    '<div class="px-workspace px-overview">'+
     '<section class="px-panel">'+
      '<div class="px-panel-head"><div><h2>Atividade de conversas</h2><p>Mensagens recebidas e enviadas</p></div>'+
       '<div class="px-chart-actions"><button class="px-range-btn">7 dias</button>'+
       '<button class="px-range-btn active" aria-pressed="true">30 dias</button>'+
       '<button class="px-range-btn">90 dias</button></div></div>'+
      '<div class="px-graph-counts"><div><span>Recebidas</span><strong>98</strong></div></div>'+
      '<div class="px-chart-wrap"><div class="px-axis"><span>2026-11-12</span></div></div>'+
      '<div class="px-legend"><span>Recebidas</span></div></section>'+
     '<div class="lucid-filter"><button>Opção</button><button class="is-active">Selecionado</button></div>'+
     '<div class="ai-guide-tabs"><button>Teste</button><button class="active">Treinamento</button></div>'+
     '<div class="settings-tabs"><button>Geral</button><button class="active">Conta</button></div>'+
     '<div class="ps-mode"><strong>Modo de treinamento</strong><small>Aprenda a conversar</small></div>'+
     '<div class="ps-choices"><button><strong>Enviar proposta</strong><small>Continuar diálogo</small></button></div>'+
     '<div class="ps-bubble"><p>Olá, tudo bem?</p></div>'+
     '<div class="lucid-intelligence-panel"><h2>Inteligência</h2><p>Insights da sua empresa</p></div>'+
     '<div class="wa-status-strip"><div><strong>1</strong><small>Conectado</small></div></div>'+
     '<div class="file-drop"><small>Arraste um arquivo</small></div>'+
     '<div class="px-campaign-picker"><label>Campanha</label><select><option>Meta Ads</option></select></div>'+
     '<div class="px-dialog-help">Confirme antes de publicar</div>'+
     '<div class="master-company-filters"><select><option>Empresas</option></select></div>'+
     '<div class="master-company-edit-note">Alterações de clientes</div>'+
     '<div class="ps-error">Não foi possível carregar</div>'+
    '</div></main></div></div>'+
   '<dialog class="ps-card-dialog" open><form><header><h4>Editar conversa</h4></header>'+
    '<label for="edit">Mensagem</label><textarea id="edit">Texto de exemplo</textarea></form></dialog>'+
  '</body></html>',{waitUntil:'domcontentloaded'});
  const sels=[
   '.px-chart-actions .px-range-btn:not(.active)',
   '.px-chart-actions .px-range-btn.active',
   '.px-panel-head p','.px-graph-counts span','.px-graph-counts strong',
   '.px-axis span','.px-legend span',
   '.lucid-filter button:not(.is-active)','.lucid-filter button.is-active',
   '.ai-guide-tabs button:not(.active)','.ai-guide-tabs button.active',
   '.settings-tabs button.active','.ps-mode strong','.ps-mode small',
   '.ps-choices strong','.ps-choices small','.ps-bubble p',
   '.lucid-intelligence-panel h2','.lucid-intelligence-panel p',
   '.wa-status-strip small','.file-drop small',
   '.px-campaign-picker label','.px-campaign-picker select',
   '.px-dialog-help','.master-company-filters select',
   '.master-company-edit-note','.ps-error',
   '.ps-card-dialog h4','.ps-card-dialog label','.ps-card-dialog textarea'
  ];
  const results=await page.evaluate(selectors=>{
   const rgba=s=>{
    const m=s?.match(/rgba?\(([^)]+)\)/);
    if(!m)return [0,0,0,0];
    const a=m[1].replaceAll(',',' ').replace('/',' ').split(/\s+/).filter(Boolean).map(Number);
    return [a[0],a[1],a[2],a.length>=4?a[3]:1];
   };
   const blend=(fg,bg)=>fg.slice(0,3).map((v,i)=>Math.round(v*(fg[3]??1)+bg[i]*(1-(fg[3]??1))));
   const luminance=a=>{
    const b=a.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
    return .2126*b[0]+.7152*b[1]+.0722*b[2];
   };
   return selectors.map(selector=>{
    const node=document.querySelector(selector);
    if(!node)return {selector,error:'missing element'};
    const fg=rgba(getComputedStyle(node).color);
    let chain=[],at=node;
    while(at){chain.push(at);at=at.parentElement;}
    let bg=[255,255,255];
    for(const el of chain.reverse())bg=blend(rgba(getComputedStyle(el).backgroundColor),bg);
    const x=luminance(fg.slice(0,3)),y=luminance(bg);
    return {selector,fg:fg.slice(0,3),bg,ratio:Math.round(100*(Math.max(x,y)+.05)/(Math.min(x,y)+.05))/100};
   });
  },sels);
  const low=results.filter(x=>x.error||x.ratio<4.5);
  assert.deepEqual(low,[], 'Below WCAG AA, computed styles: '+JSON.stringify(low));
  console.log('Computed contrast audit: '+results.length+' component texts, minimum ratio '+Math.min(...results.map(x=>x.ratio))+':1');
 }finally{await browser.close();}
});
