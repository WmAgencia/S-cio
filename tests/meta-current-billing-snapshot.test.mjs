import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {metaBillingDetailsURL,parseObservedMetaBalance,assessMetaFunds} from '../meta-billing-state.mjs';

const id='act_12345678901',name='Conta Exemplo';
const url=metaBillingDetailsURL(id,{businessId:'98765432100'});
// Sanitized test fixture structured like the actual billing page, not a live charge.
const body=[
 'Cobrança e pagamentos','Outra conta','Contas','Formas de pagamento','Atividade de pagamento',
 name,'Fundos disponíveis','Adicionar saldo','R$ 0,06','Mais opções',
 'Como você pagará','Saldo disponível',
 'Limite de gastos diário (definido pela Meta): R$ 109,69',
 'Atividade de pagamento','R$ 6,56','R$ 10,00','Pago',
].join('\n');

test('Meta billing URL opens the account details view, never an obsolete payment settings page',()=>{
 const u=new URL(url);
 assert.equal(u.origin,'https://adsmanager.facebook.com');
 assert.equal(u.pathname,'/adsmanager/billing_hub/accounts/details/');
 assert.equal(u.searchParams.get('asset_id'),id.slice(4));
 assert.equal(u.searchParams.get('payment_account_id'),id.slice(4));
 assert.equal(u.searchParams.get('business_id'),'98765432100');
 assert(!url.includes('session_id='));
 assert.throws(()=>metaBillingDetailsURL('act_NOTNUMERIC'));
});
test('current Meta page snapshot extracts the 6-cent wallet, not invoice, spend cap or transactions',()=>{
 const result=parseObservedMetaBalance({url,body,accountId:id,accountName:name,currency:'BRL'});
 assert.equal(result.availableFundsMinor,6);
 assert.equal(result.source,'meta_billing_browser');
 assert.equal(result.currency,'BRL');
 assert.equal(assessMetaFunds(result,{dailySpendMinor:768}).state,'critical');
 assert.equal(Date.parse(result.validUntil)-Date.parse(result.observedAt),900000);
});
test('billing snapshot rejects account mismatch, mismatched payment ID and spoofed wallet values',()=>{
 const payload={url,body,accountId:id,accountName:name,currency:'BRL'};
 for(const bad of [
   {...payload,url:url.replace('payment_account_id='+id.slice(4),'payment_account_id=1234567')},
   {...payload,url:url+'&asset_id=1234567'},
   {...payload,body:body.replace(name+'\nFundos disponíveis','Outra Empresa\nFundos disponíveis')},
   {...payload,body:body.replace('R$ 0,06','R$ 0,06\nR$ 1.000,00')},
   {...payload,body:body.replace('Fundos disponíveis','Orçamento da campanha')},
   {...payload,url:'https://adsmanager.facebook.com.attacker.invalid/adsmanager/billing_hub/accounts/details/?asset_id='+id.slice(4)}
 ])assert.throws(()=>parseObservedMetaBalance(bad));
});
test('billing worker visits current page and parses the rendered account snapshot only',()=>{
 const code=readFileSync(new URL('../meta-browser/remote-worker.js',import.meta.url),'utf8');
 assert(code.includes('metaBillingDetailsURL(data.accountId)'));
 assert(code.includes("getByText('Fundos disponíveis',{exact:true})"));
 assert(code.includes('parseObservedMetaBalance({...snapshot'));
 assert(!code.includes("new URL('https://adsmanager.facebook.com/billing_hub/payment_settings/')"));
 assert(code.includes("NEVER click Avançar/Pagar"));
});
test('overview syncs a saved billing session no more than once per five minutes, and shows stale readings as unavailable',()=>{
 const ui=readFileSync(new URL('../public/socio-workspace-ui.js',import.meta.url),'utf8');
 const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 assert(ui.includes("'/api/marketing/browser/status'"));
 assert(ui.includes("state.data?.session_present!==true"));
 assert(ui.includes("'/api/marketing/billing/refresh','POST',{background:true}"));
 assert(ui.includes('now-lastAttempt>=5*60000'));
 assert(ui.includes("getCache.delete('/api/marketing/tools/finance')"));
 assert(server.includes("background:billingRoute[1]==='refresh'&&data.background===true"));
 assert(ui.includes("fundsAvailable?moneyMinor(funds,currencyCode):'Não disponível'"));
});
