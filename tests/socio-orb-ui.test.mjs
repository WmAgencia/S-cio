import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const html=read('public/index.html');
const server=read('server.mjs');
const app=read('public/app.js');
const css=read('public/socio-stripe-system.css');
const overview=read('public/socio-workspace-ui.js');
const orb=read('public/socio-orb-ui.js');
const mesh=read('public/socio-orb-mesh.js');

test('the orb page ships as its own script with a production nav entry',()=>{
 assert.match(html,/<script src="\/socio-orb-ui\.js\?v=20261113h" defer><\/script>/);
 assert.match(html,/<script src="\/socio-orb-mesh\.js\?v=20261113a" defer><\/script>/);
 assert(html.indexOf('/socio-orb-mesh.js')<html.indexOf('/socio-orb-ui.js'));
 assert(html.includes('<button data-view="orb" class="nav-item"><span class="nav-symbol">◉</span> Conversar com IA</button>'));
 assert(server.includes("'/socio-orb-ui.js'"));
 assert(server.includes("'/socio-orb-mesh.js'"));
 assert(!html.includes('/socio-orb-ui.js' + '" defer></script>\n <script src="/socio-master-dashboard.js'));
});

test('app routing exposes the orb view and tears it down on exit',()=>{
 assert(app.includes("['overview','orb','inbox','connections','marketing','products','training','team','settings'].includes(part)"));
 assert.match(app,/titles=\{overview:'Visão geral',orb:'Conversar com IA'/);
 assert.match(app,/orb:'<circle cx="12" cy="12" r="8\.5"\/>/);
 assert(app.includes("if(next!=='orb')globalThis.SocioOrbUI?.dispose();"));
 assert(app.includes("document.body?.classList?.toggle('socio-orb-view',next==='orb');"));
 assert(app.includes("if(next==='orb'&&globalThis.SocioOrbUI){"));
 assert.match(app,/globalThis\.SocioOrbUI\.render\(\{root:view,api,me:state\.me,csrfToken:state\.csrf,navigate:changeView\}\)/);
 assert(app.includes('globalThis.SocioOrbUI?.dispose();')&&
  app.includes("document.body?.classList?.remove('socio-orb-view');"));
});

test('the overview entry is the orb itself, not a plain button',()=>{
 assert(overview.includes('data-px-orb'));
 assert(overview.includes('Conversar com IA'));
 assert(overview.includes('<span class="px-orb-entry-field" aria-hidden="true"><canvas class="px-orb-entry-canvas"></canvas></span>'));
 assert(!overview.includes('class="btn orb-cta"'));
 assert(overview.includes("globalThis.SocioOrbMesh?.create(root.querySelector('.px-orb-entry-canvas'),{light:true,density:.34,radius:.40,point:.011})"));
 assert(overview.includes("querySelector('[data-px-orb]')?.addEventListener('click',()=>navigate('orb'))"));
});

test('the floating launcher is the orb itself and opens the IA page',()=>{
 const dock=read('public/socio-thalita-ui.js');
 assert(dock.includes('<button class="thalita-orb" type="button" data-thalita-orb aria-label="Conversar com IA">'));
 assert(dock.includes('<canvas class="thalita-orb-canvas" aria-hidden="true"></canvas>'));
 assert(!dock.includes('px-assistant-fab'));
 assert(dock.includes("globalThis.SocioOrbMesh?.create(get('.thalita-orb-canvas'),{light:true,density:.34,radius:.40,point:.011})"));
 assert(dock.includes("fab.addEventListener('click',()=>navigate?.('orb'))"));
 assert(app.includes('globalThis.SocioThalitaUI?.mount({client:api,auth:state.me,csrfToken:state.csrf,navigate:changeView})'));
 assert.match(css,/\.thalita-orb\{/);
 assert.match(css,/\.thalita-orb-canvas\{/);
 assert.match(css,/body\.socio-orb-view #socioThalitaDock\{display:none!important\}/);
 assert(!/\.thalita-orb\{[^}]*background:(?!none)/.test(css),'the launcher must stay frameless');
});

test('orb module parses and exposes only render and dispose',()=>{
 const sandbox={globalThis:{}};
 vm.runInNewContext(orb,sandbox,{filename:'socio-orb-ui.js'});
 const api=sandbox.globalThis.SocioOrbUI;
 assert.equal(typeof api.render,'function');
 assert.equal(typeof api.dispose,'function');
 assert.deepEqual(Object.keys(api).sort(),['dispose','render']);
});

test('orb audio drives the animation through CSS variables, not inline styles',()=>{
 assert(orb.includes("s.style.setProperty('--orb-amp',amp.toFixed(3))"));
 assert(orb.includes("s.style.setProperty('--orb-scale',(1+amp*.34).toFixed(3))"));
 assert(orb.includes("s.style.setProperty('--orb-glow',(26+amp*54).toFixed(1)+'px')"));
 assert(orb.includes("s.style.setProperty('--orb-spin',(1-amp*.45).toFixed(3))"));
 assert(orb.includes('analyser.getByteFrequencyData(freq)'));
 assert(!/style\s*=\s*["']/i.test(orb.replace(/\.style\.setProperty/g,'')),'no inline style attributes');
});

test('the orb is a canvas point-cloud mesh with no external library',()=>{
 assert(orb.includes("'<canvas class=\"orb-canvas\" id=\"orbCanvas\"></canvas>'"));
 assert(orb.includes('function createOrbRenderer(canvas)'));
 assert(orb.includes('globalThis.SocioOrbMesh?.create(canvas,{amp:ampNow,light:true})'));
 assert(orb.includes('orbRenderer?.stop();orbRenderer=null;'));
 assert(mesh.includes('globalThis.SocioOrbMesh={create}'));
 assert(mesh.includes("ctx.globalCompositeOperation=light?'source-over':'lighter'"));
 assert(mesh.includes('buckets[hue[i]+band*HUES]'));
 assert(!/<script[^>]+src="https?:\/\//i.test(orb+mesh));
});

test('orb page shows a plan with per-step spinner, check and title',()=>{
 assert(orb.includes("li.className='orb-step'"));
 assert(orb.includes('li.dataset.status=status'));
 assert(orb.includes("li.style.setProperty('--i',String(list.children.length))"));
 assert(orb.includes('orb-step-mark'));
 assert(orb.includes('#orbPlanCount'));
 assert(css.includes('.orb-step[data-status="running"] .orb-step-mark::after'));
 assert(css.includes('animation:orb-spin .9s linear infinite'));
 assert(css.includes('.orb-step[data-status="done"] .orb-step-mark::after'));
 assert(css.includes('.orb-step-body strong'));
 assert(css.includes('animation-delay:calc(var(--i,0) * 45ms)'));
});

test('orb visual language is defined in the design system',()=>{
 for(const selector of ['.orb-page','.orb-field','.orb-aura','.orb-canvas',
  '.orb-plan-panel','.orb-composer','.px-orb-entry','.px-orb-entry-canvas','#view:has(> .orb-page)']){
  assert(css.includes(selector),selector+' should be styled');
 }
 assert(css.includes('body.socio-orb-view #socioThalitaDock{display:none!important}'));
 assert(css.includes('@media(prefers-reduced-motion:reduce)'));
 assert(css.includes('body.socio-orb-view{background:#f7f8fa!important}'),'orb stage uses the light canvas');
 assert(!/body\.socio-orb-view\{background:#03050a/.test(css));
});

test('orb media and plan wiring uses the real authenticated endpoints',()=>{
 assert(orb.includes('/api/ads-media/reserve'));
 assert(orb.includes("'/api/ads-media/'+reserved.id+'/upload'"));
 assert(orb.includes('/api/marketing/tools/image'));
 assert(orb.includes('/api/thalita/transcribe'));
 assert(orb.includes('/api/thalita/ask'));
 assert(orb.includes('/api/thalita/tts'));
 assert(orb.includes('/api/thalita/confirm'));
 assert(orb.includes('X-CSRF-Token'));
});

test('the orb greets by the registered company and never shows status pills',()=>{
 assert(orb.includes('me?.tenant?.name'));
 assert(orb.includes("greeting=who?'Olá, '+who+'! Como posso te ajudar hoje?'"));
 assert(!orb.includes('Arraste um vídeo ou foto para cá quando quiser'));
 assert(orb.includes('<span class="ps-sr-only" id="orbStatus" role="status" aria-live="polite"></span>'));
 assert(!orb.includes("statusText('Ouvindo')"));
 assert(!orb.includes("statusText('Voz desligada')"));
 assert(!orb.includes("statusText('Pensando')"));
});

test('the plan comes from the server and a campaign conversation keeps its run id',()=>{
 assert(orb.includes('renderPlan(result.plan)'));
 assert(orb.includes("runId=result.runId&&(result.status==='ready'||result.status==='collecting')?result.runId:null"));
 assert(orb.includes('imageHash:media.meta.imageHash'));
 assert(orb.includes("String(result.skillId||'')==='ads.campaign.launch'"));
});

test('barge-in stops the live audio source and the attachment leaves the orb face',()=>{
 assert(orb.includes('if(activeSource){const source=activeSource;activeSource=null;try{source.stop();}'));
 assert(orb.includes("get('#orbMediaChip')?.addEventListener('click',clearMedia)"));
 assert(orb.includes('class="orb-media-pill" type="button" id="orbMediaChip"'));
 assert(orb.includes('silenceMs:1500,maxTurnMs:30000,minVoicedMs:500'));
 assert(!css.includes('.orb-media-chip{'));
 assert(css.includes('.orb-media-pill[hidden]{display:none!important}'));
 assert(/\.orb-transcript\{[^}]*background:rgba\(255,255,255,\.9\)/.test(css));
});

test('app.js still parses after the orb wiring',()=>{
 new vm.Script(app,{filename:'app.js'});
});
