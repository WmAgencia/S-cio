import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildAiInstructions} from '../ai-replies.mjs';
import {socioCompactSalesGuide} from '../socio-sales-guide.mjs';

const contentOf=relative=>readFileSync(new URL(relative,import.meta.url),'utf8');

test('stage1 preserves per-tenant instructions and catalog and never promotes the shared guide to tenant facts',()=>{
 const first=buildAiInstructions({name:'Sócio',tenantName:'Loja 1',tone:'Natural',instructions:'Não dar desconto',
  knowledge:'Lojas 1 em Sorocaba',products:[{name:'Blusa',price_cents:3000,stock_quantity:3}]});
 const second=buildAiInstructions({name:'Sócio',tenantName:'Loja 2',tone:'Natural',instructions:'Somente retirada local',
  knowledge:'Lojas 2 em Campinas',products:[{name:'Sapato',price_cents:5000,stock_quantity:2}]});
 assert.match(first,/Blusa/);assert.doesNotMatch(first,/Sapato|Campinas|Somente retirada local/);
 assert.match(second,/Sapato/);assert.doesNotMatch(second,/Blusa|Sorocaba|Não dar desconto/);
 assert.match(first,/Método comercial global/);assert.match(second,/Método comercial global/);
 assert.match(socioCompactSalesGuide(),/Nunca prometa|Nunca invente|Não use falsa urgência/i);
});
test('stage1 keeps safety gates for owner WhatsApp commands and financial workers',()=>{
 const source=contentOf('../server.mjs'),wa=contentOf('../socio-owner-skill-inbox.mjs');
 assert.match(source,/SOCIO_OWNER_COMMANDS_ENABLED!=='true'/);
 assert.match(source,/SOCIO_ATTRIBUTION_ENABLED!=='true'/);
 assert.match(source,/SOCIO_META_REPORTS_ENABLED!=='true'/);
 assert.match(wa,/m\.provider_id LIKE 'waakg:%'/);
 assert.match(wa,/u\.role IN \('owner','admin'\)/);
 assert.match(wa,/m\.direction='inbound'/);
 assert.match(wa,/regexp_replace\(u\.phone/);
 assert.match(wa,/clientRequestId:receiptId/);
 assert.match(source,/\/api\/marketing\/skills\/chat/);
});
test('stage1 does not silently activate ads or claim pixel tracking on WhatsApp',()=>{
 const tools=contentOf('../meta-ads-tools.mjs'),skills=contentOf('../socio-ad-skills.mjs');
 assert.match(tools,/status:'PAUSED'/);
 assert.match(skills,/campanha PAUSADA|campanha PAUSADOS|criados PAUSADOS|PAUSADOS/);
 assert.match(skills,/Pixel não é instalado automaticamente/);
 assert.match(skills,/Conversa WhatsApp não recebe Pixel/);
 assert.doesNotMatch(socioCompactSalesGuide(),/R\$\s*550/);
});
