import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseObservedMetaBalance,assessMetaFunds,topupAmount,verifyMetaPixCode} from '../meta-billing-state.mjs';

const accountId='act_1347914770832022';
const page={url:'https://adsmanager.facebook.com/adsmanager/billing_hub/accounts/details/?asset_id=1347914770832022',
 accountId,accountName:'Consecom',currency:'BRL',
 body:'Cobrança e pagamentos\nConsecom\nFundos disponíveis\nAdicionar saldo\nR$ 0,51\nMais opções\nComo você pagará\nSaldo disponível\nLimite de gastos diário\nR$ 109,69'};
test('wallet observation identifies the exact account and available-funds region, not a limit or history value',()=>{
 const o=parseObservedMetaBalance(page);
 assert.equal(o.availableFundsMinor,51);
 assert.equal(o.source,'meta_billing_browser');
 assert.equal(Date.parse(o.validUntil)-Date.parse(o.observedAt),15*60000);
 assert.equal(assessMetaFunds(o,{dailySpendMinor:1000}).state,'critical');
});
test('ambiguous amount, wrong account, expired reading or unsupported currency cannot become a wallet balance',()=>{
 for(const input of [
  {...page,url:page.url.replace('1347914770832022','999999')},
  {...page,accountName:'Another business'},
  {...page,currency:'USD'},
  {...page,body:page.body.replace('R$ 0,51','R$ 0,51\nR$ 50,00')},
  {...page,body:page.body.replace('Fundos disponíveis','Orçamento diário')},
  {...page,observedAt:new Date(Date.now()-3*60000).toISOString()},
  {...page,url:'https://attacker.example/?asset_id=1347914770832022'}
 ])assert.throws(()=>parseObservedMetaBalance(input));
});
test('a stale reading is unknown; it is never treated as zero available or an active low-funds alert',()=>{
 const o=parseObservedMetaBalance(page);
 assert.equal(assessMetaFunds(o,{now:Date.parse(o.validUntil)+1}).state,'unknown');
 const funded={...o,availableFundsMinor:10000};
 assert.equal(assessMetaFunds(funded,{dailySpendMinor:500}).state,'ok');
 assert.equal(assessMetaFunds(funded,{dailySpendMinor:4000}).state,'low');
 assert.equal(assessMetaFunds({...o,availableFundsMinor:0}).state,'critical');
 assert.equal(assessMetaFunds({...o,availableFundsMinor:2500}).state,'low');
 assert.equal(assessMetaFunds({...o,availableFundsMinor:5000}).daysLeft,null);
});
test('topup amounts are integer BRL cents and bounded without claiming the Meta payment minimum',()=>{
 for(const invalid of ['1000',0,-100,100.1,10000001,NaN])assert.throws(()=>topupAmount(invalid));
 assert.equal(topupAmount(10000),10000);
});
const tlv=(id,value)=>id+String(value.length).padStart(2,'0')+value;
function pix(amount){
 const raw=tlv('00','01')+tlv('01','12')+tlv('26',tlv('00','br.gov.bcb.pix')+tlv('25','provider.example/charge/test'))+
  tlv('52','0000')+tlv('53','986')+tlv('54',amount)+tlv('58','BR')+tlv('59','META TEST')+tlv('60','SAO PAULO')+'6304';
 let crc=0xffff;
 for(const char of raw){crc^=char.charCodeAt(0)<<8;for(let i=0;i<8;i++)crc=crc&0x8000?(crc<<1)^0x1021:crc<<1;crc&=0xffff;}
 return raw+crc.toString(16).toUpperCase().padStart(4,'0');
}
test('only a rendered Pix with matching amount, BRL and valid checksum can be copied',()=>{
 const code=pix('100.00');
 assert.equal(verifyMetaPixCode(code,10000).amountVerified,true);
 assert.throws(()=>verifyMetaPixCode(code,5000));
 assert.throws(()=>verifyMetaPixCode(code.slice(0,-1)+'X',10000));
 assert.throws(()=>verifyMetaPixCode(code.replace('986','840'),10000));
 assert.throws(()=>verifyMetaPixCode('000201 forged payment',10000));
});
test('assisted worker never automatically clicks final Meta payment/generation controls',()=>{
 const worker=readFileSync(new URL('../meta-browser/remote-worker.js',import.meta.url),'utf8');
 assert(worker.includes("name:'Fundos disponíveis'"));
 assert(worker.includes("name:data.accountName"));
 assert(worker.includes("verifyMetaPixCode(candidate,intent.amountMinor)"));
 assert(!/getByRole\('button',\{name:['"](?:Avançar|Pagar|Confirmar pagamento)/.test(worker));
 const ui=readFileSync(new URL('../public/meta-billing-ui.js',import.meta.url),'utf8');
 assert(ui.includes('os comandos serão enviados ao navegador isolado'));
 assert(ui.includes('Nenhum pagamento é feito automaticamente'));
});
