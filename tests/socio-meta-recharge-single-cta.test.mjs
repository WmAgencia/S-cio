import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const load=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const ui=load('public/socio-workspace-ui.js');
const css=load('public/socio-premium-polish.css');
const app=load('public/app.js');
const html=load('public/index.html');

test('Meta budget shows exactly one recharge CTA and no duplicate billing actions',()=>{
 assert(ui.includes('px-budget-recharge-cta'));
 assert(ui.includes('Abrir recarga na Meta <span'));
 assert(ui.includes('px-budget-recharge-footer'));
 assert(ui.includes('href="'+ "'+esc(paymentUrl)+'" + '" target="_blank" rel="noopener noreferrer"'));
 assert(ui.includes("url.protocol==='https:'&&url.hostname==='adsmanager.facebook.com'"));
 assert(!ui.includes('Adicionar saldo por Pix'));
 assert(!ui.includes('Conectar faturamento e ler saldo'));
 assert(!ui.includes('data-px-billing="pix"'));
 assert(!ui.includes('data-px-billing="balance"'));
 assert(!ui.includes("querySelectorAll('[data-px-billing]')"));
 assert(ui.includes("provider==='meta_ads'&&paymentUrl"));
 assert(ui.includes("provider!=='meta_ads'"));
});

test('Meta balance descriptions no longer direct the user to removed buttons',()=>{
 assert(ui.includes('Consulte o saldo e faça recargas no faturamento oficial da Meta.'));
 assert(ui.includes('O saldo ainda não foi confirmado.'));
 assert(!ui.includes('use Atualizar saldo'));
 assert(!ui.includes('Use Conectar faturamento'));
});

test('while provider data loads, show skeleton rather than false zero or partial card',()=>{
 assert(ui.includes("if(progressive&&ads){"));
 assert(ui.includes('px-budget-provider-pending'));
 assert(ui.includes('aria-busy="true"'));
 assert(ui.includes("px-overview-loading"));
 assert(ui.includes("px-load-card"));
 assert(ui.includes("Consultando dados confirmados"));
 assert(css.includes('.px-budget-provider-pending .px-budget-stats'));
 assert(css.includes('.px-overview-loading .px-kpi.px-load-card'));
 assert(css.includes('@media(prefers-reduced-motion:reduce)'));
});

test('all initial and route loading states share a polished dark loader',()=>{
 assert(app.includes('loading socio-page-loading'));
 assert(html.includes('loading socio-page-loading'));
 assert(html.includes('/socio-premium-polish.css?v=20261112b'));
 assert(html.includes('/socio-workspace-ui.js?v=20261112b'));
 assert(html.includes('/app.js?v=20261112b'));
 assert(css.includes('.loading.socio-page-loading'));
 assert(css.includes('.socio-loading-title'));
});

test('recharge button has high contrast, keyboard focus and no layout mutation',()=>{
 assert(css.includes('a.px-budget-recharge-cta'));
 assert(css.includes('color:#243118!important'));
 assert(css.includes('background:linear-gradient(135deg,#ddf99d,#c9f16d)'));
 assert(css.includes('a.px-budget-recharge-cta:focus-visible'));
 assert.doesNotThrow(()=>new vm.Script(ui,{filename:'socio-workspace-ui.js'}));
 assert.doesNotThrow(()=>new vm.Script(app,{filename:'app.js'}));
});
