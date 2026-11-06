import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildAiInstructions} from '../ai-replies.mjs';
import {socioGlobalSalesGuide,socioCompactSalesGuide} from '../socio-sales-guide.mjs';

test('sales guide is shared methodology without Prospector-specific pricing',()=>{
 const guide=socioGlobalSalesGuide();
 assert.match(guide,/método comercial global/i);
 assert.match(guide,/outra empresa/i);
 assert.doesNotMatch(guide,/R\$ ?550/);
 assert.match(socioCompactSalesGuide(),/Orçamento/i);
});

test('commercial method joins only authorized tenant catalog and approved knowledge',()=>{
 const prompt=buildAiInstructions({name:'Sócio',tenantName:'Loja Teste',tone:'Breve',instructions:'Sem descontos',knowledge:'Atendemos em Sorocaba',products:[{name:'Caneca',price_cents:2500,stock_quantity:3}]});
 assert.match(prompt,/Loja Teste/);
 assert.match(prompt,/Caneca — R\$ 25,00/);
 assert.match(prompt,/Atendemos em Sorocaba/);
 assert.match(prompt,/Método comercial global/);
 assert.match(prompt,/Sem descontos/);
 assert.doesNotMatch(prompt,/R\$ ?550/);
});

test('shared guidance cannot bypass safeguards for inbound-only supervised AI',()=>{
 const source=readFileSync(new URL('../ai-replies.mjs',import.meta.url),'utf8');
 assert.match(source,/handling_mode='ai_assist'/);
 assert.match(source,/canAutoReply\(env\)/);
 assert.match(source,/tenant_id/);
 assert.match(source,/Não invente valor, prazo, desconto/);
});
