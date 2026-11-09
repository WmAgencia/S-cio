import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildApprovedAdCreativeDrafts,primaryCreativeDraft} from '../socio-creative-studio.mjs';
import {classifySalesMoment,salesMomentGuidance} from '../socio-sales-conversation.mjs';
import {buildAiInstructions} from '../ai-replies.mjs';
import {skillAdCopy} from '../socio-ad-skills.mjs';

test('Meta copy offers three distinct drafts grounded only in provided briefing',()=>{
 const brief={category:'roupas femininas',cityName:'Sorocaba',destination:'whatsapp',dailyBudgetCents:2000};
 const c=buildApprovedAdCreativeDrafts(brief,'Loja Exemplo');
 assert.equal(c.variants.length,3);
 assert.deepEqual(c.variants.map(v=>v.style),['apresentacao','consultivo','objetivo']);
 assert(new Set(c.variants.map(v=>v.headline)).size===3);
 assert(c.variants.every(x=>x.headline.length<=120&&x.message.length<=500));
 assert(c.variants.every(x=>/roupas femininas/i.test(x.message)));
 assert(c.variants.every(x=>/WhatsApp|converse/i.test(x.message)));
 assert.equal(c.reviewRequired,false);
 assert.equal(c.executionAllowed,true);
 assert(!JSON.stringify(c).includes('R$ 20'));
 assert(!JSON.stringify(c).match(/garantia de venda|clientes garantidos|resultados comprovados/i));
 const actual=skillAdCopy(brief,'Loja Exemplo');
 assert.deepEqual(actual,primaryCreativeDraft(brief,'Loja Exemplo'));
 assert.deepEqual(Object.keys(actual).sort(),['headline','message','name']);
});

test('Meta copy follows destination without misleading WhatsApp or Pixel claims',()=>{
 const site=buildApprovedAdCreativeDrafts({category:'consertos automotivos',cityName:'Sorocaba',destination:'website'},'Oficina');
 assert(site.variants.every(x=>/site/.test(x.message)));
 assert(site.variants.every(x=>!/WhatsApp/.test(x.message)));
 assert(site.variants.every(x=>!/Pixel|CAPI|tracking|compra concluída/.test(x.message)));
 assert.equal(site.executionAllowed,true);
});

test('Unsafe brief claims are marked for human review before any ad plan creation',()=>{
 for(const category of ['produto 100% garantido','a melhor cura','desconto imperdível','grátis só hoje']){
  const c=buildApprovedAdCreativeDrafts({category,cityName:'Sorocaba',destination:'whatsapp'},'Empresa');
  assert.equal(c.reviewRequired,true,category);
  assert.equal(c.executionAllowed,false,category);
  assert.match(c.reviewReason,/não verificad/i);
 }
 const source=readFileSync(new URL('../socio-ad-skills.mjs',import.meta.url),'utf8');
 assert.match(source,/if\(creativeDrafts\.reviewRequired\)/);
 assert(source.indexOf('if(creativeDrafts.reviewRequired)')<source.indexOf("const plan=await (opts.prepare||prepareAdsPlan)"));
 assert.match(source,/creativeVariants:creativeDrafts\.variants/);
 const ui=readFileSync(new URL('../public/socio-ad-skills-ui.js',import.meta.url),'utf8');
 assert.match(ui,/answer\.creativeVariants/);
 assert.match(ui,/não serão publicadas automaticamente/);
});

test('Sales moments distinguish refusal, complaints and genuine buying interest',()=>{
 const cases={
  'Não quero comprar':'declined',
  'Desisti de contratar':'declined',
  'Quero comprar esse produto':'purchase',
  'Aceito a proposta':'purchase',
  'Achei caro, tem outra opção?':'objection',
  'Quanto custa?':'price',
  'Vocês têm Pix?':'payment',
  'Pode me passar um orçamento?':'quote',
  'O produto chegou errado e quero reembolso':'complaint',
  'Quero falar com atendente':'human',
  'Não me envie mensagens':'optout',
  'Como funciona o serviço?':'explore'
 };
 for(const [input,expected] of Object.entries(cases))
  assert.equal(classifySalesMoment(input),expected,input);
});

test('Sales prompt is consultative but does not authorize operations or pressure',()=>{
 const buying=salesMomentGuidance('Quero fechar a compra.');
 assert.equal(buying.moment,'purchase');
 assert.match(buying.prompt,/NÃO é compra concluída/);
 assert.match(buying.prompt,/não crie pedido, link ou cobrança/);
 const cost=salesMomentGuidance('Tá caro demais');
 assert.match(cost.prompt,/sem desconto inventado/);
 const opting=salesMomentGuidance('não quero receber mensagens');
 assert.equal(opting.moment,'optout');
 assert.equal(opting.requiresHumanOrStop,true);
 const continuation=salesMomentGuidance('Sim',{continuing:true,previousTopic:'price'});
 assert.match(continuation.prompt,/sem tratar sim\/pode como aprovação/);
 assert(!buying.prompt.includes('R$ 550'));
});

test('WhatsApp and lab share seller guidance without cross-tenant facts or permissions',()=>{
 const a=buildAiInstructions({name:'Assistente',tenantName:'Loja A',
  instructions:'A loja A vende canecas',knowledge:'Entrega local em Sorocaba',
  products:[{name:'Caneca',price_cents:2500,stock_quantity:5}],question:'Quero comprar'});
 const b=buildAiInstructions({name:'Assistente',tenantName:'Loja B',
  instructions:'A loja B vende camisetas',knowledge:'Entregamos em Campinas',
  products:[{name:'Camiseta',price_cents:4500,stock_quantity:2}],question:'Quanto custa?',simulation:true});
 assert.match(a,/Momento da conversa: purchase/);
 assert.match(b,/Momento da conversa: price/);
 assert.match(a,/não crie pedido, link ou cobrança/);
 assert.match(a,/R\$ 25,00/);
 assert.match(b,/R\$ 45,00/);
 assert.doesNotMatch(a,/Campinas|Camiseta|45,00/);
 assert.doesNotMatch(b,/Sorocaba|Caneca|25,00/);
 assert.match(b,/SOMENTE um laboratório/);
});

test('Owner media worker explicitly passes env to private session status verification',()=>{
 const source=readFileSync(new URL('../socio-owner-skill-media.mjs',import.meta.url),'utf8');
 assert.match(source,/getStatus\(owner\.session_id,\{env\}\)/);
 assert(source.indexOf('getStatus(owner.session_id,{env})')<source.indexOf('const active=await pool.query('));
 assert.match(source,/OWNER_MEDIA_TENANT_NOT_ALLOWED/);
 assert.match(source,/ON CONFLICT\(tenant_id,channel_id,provider_message_id\) DO NOTHING/);
 assert.match(source,/mode:'human'/);
});
