import test from 'node:test';
import assert from 'node:assert/strict';
import {extractWhatsAppZip} from '../zip-import.mjs';

import {zipStore} from './zip-helper.mjs';

const sample='[03/11/2026, 10:00] Cliente: Bom dia, gostaria de um orçamento\n[03/11/2026, 10:01] Vendas: Posso ajudar!\n[03/11/2026, 10:02] Cliente: Ótimo, pode fechar.';
test('WhatsApp ZIP imports two conversations and ignores non-text media',()=>{
 const archive=zipStore([['_chat1.txt',sample],['_chat2.txt',sample],['media.jpg','binary']]);
 const result=extractWhatsAppZip(archive);
 assert.equal(result.length,2);assert.equal(result[0].content,sample);
 assert.equal(result[1].filename,'_chat2.txt');
});
test('rejects paths, non-ZIP and very large content before extraction',()=>{
 assert.throws(()=>extractWhatsAppZip(zipStore([['../_chat.txt',sample]])),/diretório principal/);
 assert.throws(()=>extractWhatsAppZip('abc'),/ZIP inválido/);
 assert.throws(()=>extractWhatsAppZip(zipStore([['_chat.txt','a'.repeat(700001)]])),/grandes demais/);
});
test('returns no text error for media-only ZIP',()=>{
 assert.throws(()=>extractWhatsAppZip(zipStore([['foto.jpeg','teste']])),/Nenhuma conversa/);
});
