import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const ui=read('public/socio-workspace-ui.js');
const css=read('public/socio-premium-polish.css');

function renderMeta({cap=1317,spend=0,url='https://adsmanager.facebook.com/adsmanager/manage/billing'}={}){
 const a=ui.indexOf('const budgetHeaderItem='),b=ui.indexOf('\n  };',a);
 assert(a>0&&b>a,'Budget component must exist');
 const fn=ui.slice(a,b+5);
 const scope="const progressive=false,ads=true,billingSession='disconnected',me={};"+
 "const esc=v=>String(v??'');const can=()=>true;"+
 "const money=(v,c)=>Number(v).toLocaleString('pt-BR',{style:'currency',currency:c||'BRL'});"+
 "const moneyMinor=(v,c)=>money(Number(v)/100,c);";
 const call="budgetHeaderItem('meta_ads','Meta Ads','meta',true,"+
 JSON.stringify(spend)+",'BRL',{finance:{spendCapRemainingMinor:"+
 JSON.stringify(cap)+",currency:'BRL'},paymentsUrl:"+JSON.stringify(url)+"})";
 return vm.runInNewContext(scope+fn+';'+call);
}

test('Meta thin ribbon uses remaining spending cap, not unverified prepaid balance',()=>{
 const html=renderMeta();
 assert.match(html,/Limite disponível/);
 assert.match(html,/R\$\s?13,17/);
 assert.match(html,/Gasto hoje/);
 assert.match(html,/R\$\s?0,00/);
 assert.doesNotMatch(html,/Saldo disponível|Duração estimada|Faturamento ainda não conectado|Consultado às/);
 assert.match(html,/title="Limite de gastos restante na conta de anúncios\. Não representa saldo pré-pago\."/);
 assert.match(html,/px-budget-meta-ribbon/);
 assert.match(html,/px-budget-meta-summary/);
 assert.equal((html.match(/<a\s/g)||[]).length,1);
 assert.match(html,/target="_blank" rel="noopener noreferrer"/);
 assert.equal((html.match(/Abrir recarga na Meta/g)||[]).length,1);
});

test('unavailable cap is not guessed; one disabled recharge control remains when link is absent',()=>{
 const html=renderMeta({cap:null,spend:5.75,url:null});
 assert.match(html,/Limite disponível<\/span><strong>Não disponível<\/strong>/);
 assert.match(html,/R\$\s?5,75/);
 assert.match(html,/<button class="px-budget-recharge-cta" type="button" disabled/);
 assert.equal((html.match(/Abrir recarga na Meta/g)||[]).length,1);
 assert.equal((html.match(/<a\s/g)||[]).length,0);
});

test('ribbon overrides old tall card and keeps compact CTA below two metrics',()=>{
 assert.match(css,/\.px-budget-account\[data-budget-provider="meta_ads"\]\.px-budget-meta-ribbon\{/);
 assert.match(css,/min-height:0!important/);
 assert.match(css,/\.px-budget-meta-ribbon \.px-budget-meta-action\{/);
 assert.match(css,/margin-top:9px!important/);
 assert.match(css,/min-height:34px!important/);
 assert.match(css,/@media\(max-width:540px\)/);
 assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
});
