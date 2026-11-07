import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseObservedMetaBalance,assessMetaFunds,topupAmount,verifyMetaPixCode}
 from '../meta-billing-state.mjs';

const accountId='act_12345678901';
const base={
 url:'https://adsmanager.facebook.com/billing_hub/payment_settings/?asset_id=12345678901',
 accountId,accountName:'Empresa de Teste',currency:'BRL',
 body:'Cobrança e pagamentos\nEmpresa de Teste\nFundos disponíveis\nAdicionar saldo\nR$ 1.234,56\nComo você pagará\nLimite de gastos\nR$ 99.999,99'
};

const tlv=(id,s)=>id+String(s.length).padStart(2,'0')+s;
const crc16=s=>{
 let crc=0xffff;
 for(const c of s){
  crc^=c.charCodeAt(0)<<8;
  for(let i=0;i<8;i++)crc=(crc&0x8000)?(crc<<1)^0x1021:crc<<1;
  crc&=0xffff;
 }
 return crc.toString(16).toUpperCase().padStart(4,'0');
};
// Synthetic fixtures. These are NOT live Pix codes or payments.
function makePix(amount,{currency='986',country='BR'}={}){
 const s=tlv('00','01')+tlv('01','12')+
  tlv('26',tlv('00','br.gov.bcb.pix')+tlv('25','test.invalid/charge'))+
  tlv('52','0000')+tlv('53',currency)+tlv('54',amount)+tlv('58',country)+
  tlv('59','PAGAMENTO TESTE')+tlv('60','SAO PAULO')+'6304';
 return s+crc16(s);
}

test('wallet parser reads only the single funds-available amount, even if the page lists large campaign limits',()=>{
 const found=parseObservedMetaBalance(base);
 assert.equal(found.availableFundsMinor,123456);
 assert.equal(found.source,'meta_billing_browser');
 assert.equal(found.currency,'BRL');
 assert.equal(Date.parse(found.validUntil)-Date.parse(found.observedAt),900000);
});
test('wallet reader rejects spoofed account, wrong URL, unsupported currency and ambiguous balance',()=>{
 for(const candidate of [
  {...base,accountId:'act_12345678902'},
  {...base,url:'https://adsmanager.facebook.com.evil.test/billing_hub/payment_settings/?asset_id=12345678901'},
  {...base,url:'http://adsmanager.facebook.com/billing_hub/payment_settings/?asset_id=12345678901'},
  {...base,url:'https://business.facebook.com/adsmanager/?asset_id=12345678901'},
  {...base,accountName:'Outra Empresa'},
  {...base,currency:'USD'},
  {...base,body:base.body.replace('R$ 1.234,56','R$ 1.234,56\nR$ 2.000,00')},
  {...base,body:base.body.replace('Fundos disponíveis','Saldo da campanha')},
  {...base,observedAt:new Date(Date.now()-150000).toISOString()}
 ])assert.throws(()=>parseObservedMetaBalance(candidate));
});
test('wallet alerts cannot treat stale observations as zero or predict lifespan with no historical spend',()=>{
 const o=parseObservedMetaBalance(base);
 assert.equal(assessMetaFunds(o,{now:Date.parse(o.validUntil)+1}).state,'unknown');
 assert.equal(assessMetaFunds(o,{dailySpendMinor:null}).daysLeft,null);
 assert.equal(assessMetaFunds(o,{dailySpendMinor:1000}).state,'ok');
 assert.equal(assessMetaFunds({...o,availableFundsMinor:0},{dailySpendMinor:1000}).state,'critical');
 assert.equal(assessMetaFunds({...o,availableFundsMinor:1500},{dailySpendMinor:null}).state,'low');
});
test('top-up validation requires cent-based integer BRL and bounds without creating a charge',()=>{
 for(const invalid of [NaN,Infinity,'100',0,99,10000001,-100,150.5])assert.throws(()=>topupAmount(invalid));
 assert.equal(topupAmount(100),100);
 assert.equal(topupAmount(10000),10000);
});
test('synthetic Pix EMV must have correct amount, currency, beneficiary country and checksum',()=>{
 const code=makePix('123.45');
 assert.equal(verifyMetaPixCode(code,12345).amountVerified,true);
 for(const invalid of [
  [code,12344],
  [makePix('123.45',{currency:'840'}),12345],
  [makePix('123.45',{country:'US'}),12345],
  [code.slice(0,-1)+'0',12345],
  ['000201not-a-real-pix',12345]
 ])assert.throws(()=>verifyMetaPixCode(invalid[0],invalid[1]));
});
test('dashboard checks OAuth state before trying the unavailable Google campaign endpoint',()=>{
 const ui=readFileSync(new URL('../public/socio-workspace-ui.js',import.meta.url),'utf8');
 const block=ui.slice(ui.indexOf('const googleOverview=async()=>'),ui.indexOf('const calls=[',ui.indexOf('const googleOverview=async()=>')));
 assert.match(block,/\/api\/google-ads\/status/);
 assert.match(block,/configured!==true/);
 assert.match(block,/connected!==true/);
 assert.match(block,/selectedCustomerId/);
 assert(block.indexOf('google_not_connected')<block.indexOf('/api/google-ads/campaigns?period=today'));
 assert.match(ui,/ads\?googleOverview\(\)/);
});
test('billing browser never performs final Meta payment click, and the billing UI labels it assisted',()=>{
 const worker=readFileSync(new URL('../meta-browser/remote-worker.js',import.meta.url),'utf8');
 const ui=readFileSync(new URL('../public/meta-billing-ui.js',import.meta.url),'utf8');
 assert.match(worker,/NEVER click Avançar\/Pagar/);
 assert.doesNotMatch(worker,/getByRole\('button',\{name:'(?:Pagar|Confirmar pagamento)'/);
 assert.match(ui,/Nenhum pagamento é feito automaticamente/);
 assert.match(ui,/Código lido da Meta e conferido com o valor solicitado/);
});
