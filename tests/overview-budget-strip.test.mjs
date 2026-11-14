import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const ui=readFileSync(new URL('../public/socio-workspace-ui.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/socio-executive.css',import.meta.url),'utf8');

test('dashboard shows the headline first, then compact advertising budget and business KPIs',()=>{
 const start=ui.indexOf("async function overview(");
 const end=ui.indexOf("async function marketing(",start);
 const screen=ui.slice(start,end);
 const header=screen.indexOf("root.innerHTML='<div class=\"px-workspace px-overview\">'+");
 assert(header>0);
 const body=screen.slice(header,header+1200);
 // The strip is built by a local helper; the template must still render it
 // before the KPI board.
 const helperStart=screen.indexOf('const budgetTopHtml=');
 assert(helperStart>0,'the budget strip is rendered from one helper');
 const helper=screen.slice(helperStart,header);
 assert(helper.indexOf("px-budget-top")>=0);
 assert.equal(helper.indexOf("px-page-heading"),-1,'the overview opens straight on the numbers, with no title block above them');
 assert(body.indexOf("budgetTopHtml()+")>=0);
 assert(body.indexOf("budgetTopHtml()+")<body.indexOf("ov-board"));
 assert(helper.includes("budgetHeaderItem('meta_ads'"));
 assert(helper.includes("budgetHeaderItem('google_ads'"));
 assert(helper.includes("googleAdsVisible()?budgetHeaderItem('google_ads'"));
 assert(screen.includes("px-budget-meter"));
});
test('no unverified balance or exhaustion date is presented as financial fact',()=>{
 const beginning=ui.indexOf("  // A prepaid balance is not the Meta account's");
 const end=ui.indexOf("  root.innerHTML='<div class=\"px-workspace px-overview\">'+",beginning);
 const card=ui.slice(beginning,end);
 assert(beginning>0);
 assert(card.includes('Saldo disponível'));
 assert(card.includes("fundsAvailable?moneyMinor(funds,currencyCode):'Não disponível'"));
 assert(card.includes('Saldo pré-pago confirmado'));
 assert(card.includes('Abrir recarga na Meta'));
 assert(card.includes('Duração estimada'));
 assert(card.includes("balanceAlert?.state!=='unknown'"));
 assert(card.includes("?esc(balanceAlert.daysLeft)+' dias':'—'"));
 assert.doesNotMatch(card,/Math\.round\([^)]*balance|spend_cap|balance\s*[-+]/);
});
test('budget line stays compact, mobile compatible, and does not imply a fake percentage',()=>{
 assert.match(css,/\.px-budget-top-grid\{display:grid/);
 assert.match(css,/\.px-budget-account\{[^}]*padding:10px 14px 9px/);
 assert.match(css,/\.px-budget-meter\{height:4px/);
 assert.match(css,/@media\(max-width:800px\)\{\.px-budget-top-grid\{grid-template-columns:1fr/);
 assert.doesNotMatch(css,/\.px-budget-meter\s*>\s*span/);
});
