import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sealMarketingSecret} from '../marketing-integrations.mjs';
import {readAdsTool,normalizeMetaAccountFinance} from '../meta-ads-tools.mjs';

test('Meta prepaid stored balance is distinguished from amount due and spend cap',()=>{
 const result=normalizeMetaAccountFinance({
  currency:'BRL',is_prepay_account:true,account_status:1,
  amount_spent:'4500',spend_cap:'40000',balance:'8000',
  funding_source_details:{type:20,amount:'30560',original_amount:'50000'}
 });
 assert.equal(result.isPrepaid,true);
 assert.equal(result.availableFundsMinor,30560);
 assert.equal(result.availableFundsSource,'meta_stored_balance');
 assert.equal(result.spendCapRemainingMinor,35500);
 assert.equal(result.amountDueMinor,8000);
 assert.notEqual(result.availableFundsMinor,result.amountDueMinor);
});
test('postpaid accounts do not report invoice balance as available prepaid funds',()=>{
 const result=normalizeMetaAccountFinance({
  currency:'BRL',is_prepay_account:false,balance:'10000',spend_cap:'0',
  funding_source_details:{type:1,amount:'10000'}
 });
 assert.equal(result.availableFundsMinor,null);
 assert.equal(result.amountDueMinor,10000);
 assert.equal(result.spendCapRemainingMinor,null);
});
test('unverified, ambiguous, or non-stored funding is never shown as wallet money',()=>{
 for(const sources of [
  null,{type:1,amount:'20000'},{type:20,original_amount:'20000'},
  [{type:20,amount:'100'},{type:20,amount:'200'}],
  {type:20,amount:'not-money'}
 ])assert.equal(normalizeMetaAccountFinance({
  currency:'BRL',is_prepay_account:true,funding_source_details:sources
 }).availableFundsMinor,null);
});
test('payment link opens official Meta billing, never claims a Pix was generated',()=>{
 const source=readFileSync(new URL('../meta-ads-tools.mjs',import.meta.url),'utf8');
 const ui=readFileSync(new URL('../public/socio-workspace-ui.js',import.meta.url),'utf8');
 assert.match(source,/https:\/\/adsmanager\.facebook\.com\/billing_hub\/payment_settings\//);
 assert.match(source,/paymentLinkType:'meta_billing_settings',pixCodeAvailable:false/);
 assert.match(ui,/url\.hostname==='adsmanager\.facebook\.com'/);
 assert.match(ui,/Abrir recarga na Meta/);
 assert.doesNotMatch(ui,/Pix gerado|QR Pix gerado/);
});

function financeFixture({outage=false}={}){
 const env={SOCIO_PUBLIC_URL:'https://socio.example',SOCIO_META_APP_SECRET:'mock-secret',
  SOCIO_META_GRAPH_VERSION:'v26.0',CHANNEL_ENCRYPTION_KEY:'unit-test-only-key-at-least-32-characters'};
 const actor={active_tenant_id:'finance-tenant',user_id:'finance-owner',role:'owner',tenant_status:'active',
  token_hash:'test-session',features:{meta_ads:true}};
 const grant=sealMarketingSecret(JSON.stringify({tenant:actor.active_tenant_id,user:actor.user_id,token:'private-token'}),env);
 const calls=[];
 const pool={query:async(sql,args)=>{
  assert.equal(args[0],actor.active_tenant_id);
  if(sql.includes('meta_official_account_selections'))return {rows:[{account_id:'act_123456'}]};
  if(sql.includes('meta_official_grants'))return {rows:[{token_encrypted:grant,scopes:['ads_read']}]};
  throw Error('Unexpected query');
 }};
 const request=async(url,opts)=>{
  const u=new URL(url);calls.push(u);
  assert.equal(opts.method,'GET');
  const ok=data=>({ok:true,json:async()=>data});
  const rejected=()=>({ok:false,json:async()=>({error:{message:'Field restricted'}})});
  if(u.pathname.endsWith('/me/adaccounts'))return ok({data:[{id:'act_123456',name:'Conta teste',currency:'BRL'}]});
  assert(u.pathname.endsWith('/act_123456'));
  const fields=u.searchParams.get('fields');
  if(fields.includes('funding_source_details')){
   if(outage)throw Error('network failure');
   return rejected();
  }
  if(fields==='id,is_prepay_account')return ok({id:'act_123456',is_prepay_account:true});
  if(fields==='id,balance')return ok({id:'act_123456',balance:'110'});
  return ok({id:'act_123456',name:'Conta teste',currency:'BRL',amount_spent:'500',spend_cap:'1000',account_status:1});
 };
 return {env,actor,pool,request,calls};
}
test('restricted funding source does not discard readable prepaid status and spending cap',async()=>{
 const f=financeFixture();
 const result=await readAdsTool(f.pool,f.actor,'finance',{}, {env:f.env,request:f.request});
 assert.equal(result.finance.isPrepaid,true);
 assert.equal(result.finance.availableFundsMinor,null);
 assert.equal(result.finance.amountDueMinor,110);
 assert.equal(result.finance.spendCapRemainingMinor,500);
 assert.deepEqual(result.finance.unavailableFields,['funding_source_details']);
 assert.equal(result.finance.availableFundsStatus,'field_restricted');
 assert.equal(result.finance.pix.generationSupported,false);
 assert.equal(result.pixCodeAvailable,false);
 assert(!JSON.stringify(result).includes('private-token'));
 assert.equal(new URL(result.paymentsUrl).searchParams.get('asset_id'),'123456');
});
test('transient Meta finance outage does not fan out into optional field requests',async()=>{
 const f=financeFixture({outage:true});
 await assert.rejects(readAdsTool(f.pool,f.actor,'finance',{}, {env:f.env,request:f.request}),{status:503});
 assert.equal(f.calls.filter(u=>u.pathname.endsWith('/act_123456')).length,1);
});
test('missing account status is unknown, not a fabricated zero status',()=>{
 assert.equal(normalizeMetaAccountFinance({account_status:null}).accountStatus,null);
 assert.equal(normalizeMetaAccountFinance({}).accountStatus,null);
});
