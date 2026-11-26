import test from 'node:test';
import assert from 'node:assert/strict';
import {parseMetaCommand,previewMetaCommand,extractTargetName,matchEntityByName} from '../meta-ads-commands.mjs';

const campaigns={items:[
 {id:'1200000000001',name:'TEL | VENDAS CBO | ADD TO CART | LISINHA | NOV26'},
 {id:'1200000000002',name:'TEL | TRAFEGO ABERTO | MULHERES 45-64 | SITE | NOV26'},
 {id:'1200000000003',name:'Sócio · Bolos caseiros · Conversas no WhatsApp · Sorocaba · 13/11/2026'},
 {id:'1200000000004',name:'Sócio | sistema | todo o Brasil'}
]};
const actor={active_tenant_id:'t',user_id:'u'};
const deps=(overrides={})=>({readAds:async()=>campaigns,prepare:async(pool,a,kind,input)=>({id:'plan-1',kind,input,
 summary:{account:{id:'act_1'},object:{id:input.id,name:input.id},changes:{status:input.status||null,id:input.id}}}),...overrides});

test('o nome sai da frase depois da palavra campanha',()=>{
 assert.equal(extractTargetName('pausa a campanha TEL | VENDAS CBO','campaign'),'TEL | VENDAS CBO');
 assert.equal(extractTargetName('pausa a campanha do bolos','campaign'),'bolos');
 assert.equal(extractTargetName('ativa a campanha "Sócio | sistema"','campaign'),'Sócio | sistema');
 assert.equal(extractTargetName('aumenta o orçamento da campanha Sócio | sistema para 20 reais','campaign'),'Sócio | sistema');
 assert.equal(extractTargetName('pausar a campanha','campaign'),'');
});

test('o casamento por nome exige unicidade e aceita trecho só quando é inequívoco',()=>{
 assert.equal(matchEntityByName(campaigns.items,'TEL | VENDAS CBO | ADD TO CART | LISINHA | NOV26').status,'ok');
 assert.equal(matchEntityByName(campaigns.items,'bolos').status,'ok');
 assert.equal(matchEntityByName(campaigns.items,'TEL').status,'ambiguous');
 assert.equal(matchEntityByName(campaigns.items,'inexistente').status,'none');
});

test('pausar pelo nome prepara o plano com o ID encontrado',async()=>{
 const result=await previewMetaCommand({},actor,'pausa a campanha TEL | VENDAS CBO',deps());
 assert.equal(result.preview,true);
 assert.equal(result.command.input.id,'1200000000001');
 assert.equal(result.command.input.status,'PAUSED');
 assert.equal(result.plan.input.id,'1200000000001');
});

test('ativar pelo nome também funciona e continua exigindo confirmação',async()=>{
 const result=await previewMetaCommand({},actor,'ativa a campanha Sócio | sistema | todo o Brasil',deps());
 assert.equal(result.preview,true);
 assert.equal(result.command.input.status,'ACTIVE');
 assert.equal(result.plan.input.id,'1200000000004');
});

test('nome ambíguo devolve as opções em vez de agir',async()=>{
 const result=await previewMetaCommand({},actor,'pausa a campanha TEL',deps());
 assert.equal(result.preview,false);
 assert.equal(result.resolution.status,'ambiguous');
 assert.equal(result.resolution.candidates.length,2);
 assert.match(result.command.missing.join(' '),/nome completo ou o ID/);
});

test('nome inexistente não inventa campanha',async()=>{
 const result=await previewMetaCommand({},actor,'pausa a campanha de pizzas',deps());
 assert.equal(result.preview,false);
 assert.equal(result.resolution.status,'none');
});

test('sem nome nem ID o comando pede o alvo, sem tocar na conta',async()=>{
 let listed=false;
 const result=await previewMetaCommand({},actor,'pausar a campanha',deps({readAds:async()=>{listed=true;return campaigns;}}));
 assert.equal(result.preview,false);
 assert.equal(result.resolution.status,'none');
 assert.match(result.command.missing.join(' '),/nome completo ou o ID/);
 assert.equal(listed,false,'não lista a conta quando não há nome para procurar');
});

test('orçamento pelo nome usa o valor falado e o ID resolvido',async()=>{
 const result=await previewMetaCommand({},actor,'aumenta o orçamento da campanha bolos para 20 reais',deps());
 assert.equal(result.preview,true);
 assert.equal(result.plan.input.id,'1200000000003');
 assert.equal(result.plan.input.dailyBudgetCents,2000);
});

test('orçamento sem valor não lista a conta',async()=>{
 let listed=false;
 const result=await previewMetaCommand({},actor,'aumenta o orçamento da campanha bolos',deps({readAds:async()=>{listed=true;return campaigns;}}));
 assert.equal(result.preview,false);
 assert.equal(listed,false);
 assert.match(result.command.missing.join(' '),/orçamento/);
});

test('ID explícito continua ignorando a busca por nome',async()=>{
 const parsed=parseMetaCommand('pausa a campanha ID 1234567890');
 assert.deepEqual([parsed.intent,parsed.kind,parsed.input.status,parsed.input.id],['plan','status','PAUSED','1234567890']);
 assert.deepEqual(parsed.missing,[]);
});
