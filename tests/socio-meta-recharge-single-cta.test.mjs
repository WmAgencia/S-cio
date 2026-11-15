import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const load=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const ui=load('public/socio-workspace-ui.js');
const css=load('public/socio-stripe-system.css');
const boardCss=load('public/socio-ethereal.css');
const dialog=load('public/meta-billing-ui.js');
const app=load('public/app.js');
const html=load('public/index.html');

const overview=()=>{
 const start=ui.indexOf('async function overview(');
 return ui.slice(start,ui.indexOf('async function marketing(',start));
};

test('the dashboard renders no Meta budget, recharge CTA or billing action',()=>{
 const screen=overview();
 for(const gone of ['px-budget-recharge-cta','px-budget-meta-ribbon','px-budget-meta-summary',
  'px-budget-meta-action','px-budget-top','Abrir recarga na Meta','Adicionar saldo por Pix',
  'data-px-billing','spendCapRemainingMinor','Limite disponível','Gasto hoje','Saldo disponível'])
  assert.equal(screen.indexOf(gone),-1,gone+' must not appear on the dashboard');
 assert(!screen.includes('href="'+ "'+esc(paymentUrl)+'" + '"'));
 assert.doesNotMatch(screen,/hostname==='adsmanager\.facebook\.com'/);
});

test('billing and balance guidance lives in the billing dialog, not the board',()=>{
 assert(!overview().includes('Consulte o saldo e faça recargas no faturamento oficial da Meta.'));
 assert(!overview().includes('O saldo ainda não foi confirmado.'));
 assert.match(dialog,/Salvar sessão de faturamento/);
 assert.doesNotMatch(ui,/use Atualizar saldo|Use Conectar faturamento/);
});

test('while provider data loads, the board shows a skeleton rather than false zeros',()=>{
 assert.match(ui,/px-overview-loading/);
 assert.match(ui,/px-load-card/);
 assert.match(ui,/Consultando dados confirmados/);
 assert.match(css,/\.px-load-line/);
 assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
});

test('all initial and route loading states share the new skeleton loader',()=>{
 assert(app.includes('loading socio-page-loading'));
 assert(html.includes('loading socio-page-loading'));
 assert(html.includes('/socio-stripe-system.css?v='));
 assert(!html.includes('href="/socio-premium-polish.css'));
 assert.match(html,/\/socio-workspace-ui\.js\?v=20\d{6}[a-z]/);
 assert.match(html,/\/app\.js\?v=[0-9a-z]+/);
 assert(css.includes('.loading.socio-page-loading'));
 assert(css.includes('.socio-loading-title'));
});

test('board actions keep keyboard focus styles and every script parses',()=>{
 assert(boardCss.includes(':focus-visible'));
 assert.match(boardCss,/\.et-pill:focus-visible/);
 assert.match(boardCss,/\.et-open:focus-visible/);
 assert.doesNotThrow(()=>new vm.Script(ui,{filename:'socio-workspace-ui.js'}));
 assert.doesNotThrow(()=>new vm.Script(app,{filename:'app.js'}));
});
