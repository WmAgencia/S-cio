
import test from 'node:test';
import assert from 'node:assert/strict';
import {hashPassword,verifyPassword,hashToken,secureEqual,parseWhatsAppExport,buildTrainingMarkdown,slugify,emailOk,normalizeLoginPhone,loginIdentifier,clientIp,isPrivateAddress} from '../lib.mjs';
test('passwords use salted scrypt, not plaintext',async()=>{
 const a=await hashPassword('UmaSenhaForte@2026');
 const b=await hashPassword('UmaSenhaForte@2026');
 assert.notEqual(a,b);assert.ok(a.startsWith('scrypt:'));
 assert.equal(await verifyPassword('UmaSenhaForte@2026',a),true);
 assert.equal(await verifyPassword('senha-errada',a),false);
 await assert.rejects(hashPassword('fraca'));
});
test('timing safe comparison, tokens and email validation',()=>{
 assert.equal(secureEqual('segredo','segredo'),true);
 assert.equal(secureEqual('segredo','outro'),false);
 assert.equal(hashToken('segredo').length,64);
 assert.equal(emailOk('empresa@exemplo.com'),true);
 assert.equal(emailOk('invalido'),false);
 assert.equal(slugify('SÓCIO & PIZZARIA'),'socio-pizzaria');
});
test('imports WhatsApp export .txt, masks speaker identity, phone, email and links',()=>{
 const source=[
  '[03/11/2026, 14:20:00] João Silva: Olá, vocês entregam no bairro?',
  '[03/11/2026, 14:20:10] Atendente: Entregamos sim, deseja ver nosso cardápio?',
  '[03/11/2026, 14:20:30] João Silva: Pode falar com 15981142577 por favor?',
  '[03/11/2026, 14:21:00] Atendente: Escreva para atendente@pizzaria.com',
  '03/11/2026, 14:21 - João Silva: Beleza, vou fechar a compra!',
  '03/11/2026, 14:21 - Atendente: Obrigado, pedido registrado'
 ].join('\n');
 const parsed=parseWhatsAppExport(source);
 assert.equal(parsed.messageCount,6);
 assert.equal(parsed.speakers,2);
 assert.match(parsed.entries[2].text,/\[telefone\]/);
 assert.match(parsed.entries[3].text,/\[email\]/);
 const md=buildTrainingMarkdown(parsed,'conversa.txt');
 assert.doesNotMatch(md,/João Silva|atendente@pizzaria|15981142577/);
 assert.match(md,/Pessoa 1/);
});
test('multiline WhatsApp messages are normalized',()=>{
 const parsed=parseWhatsAppExport('[01/11/26, 09:00] Cliente: Primeira linha\nSegunda linha\n[01/11/26, 09:01] Loja: Pode deixar');
 assert.equal(parsed.messageCount,2);
 assert.match(parsed.entries[0].text,/Segunda linha/);
});

test('Brazilian phone numbers normalize and log in with same identifier regardless of formatting',()=>{
 assert.equal(normalizeLoginPhone('(15) 99999-9999'),'5515999999999');
 assert.equal(normalizeLoginPhone('15999999999'),'5515999999999');
 assert.equal(normalizeLoginPhone('+55 (15) 99999-9999'),'5515999999999');
 assert.equal(normalizeLoginPhone('5515999999999'),'5515999999999');
 assert.equal(normalizeLoginPhone('15 3333-4444'),'551533334444');
 assert.equal(normalizeLoginPhone('119999999'),null);
 assert.equal(normalizeLoginPhone('5515 abc 999999999'),null);
 assert.equal(normalizeLoginPhone(''),null);
 assert.equal(loginIdentifier(' Cliente@Exemplo.COM ' ).type,'email');
 assert.deepEqual(loginIdentifier(' Cliente@Exemplo.COM '),{type:'email',value:'cliente@exemplo.com'});
 assert.deepEqual(loginIdentifier('(15) 99999-9999'),{type:'phone',value:'5515999999999'});
 assert.equal(loginIdentifier('invalido'),null);
 assert.equal(loginIdentifier({phone:'5515999999999'}),null);
});

test('rate limiting sees the real client behind a private proxy and never trusts a public peer',()=>{
 const request=(peer,forwarded)=>({socket:{remoteAddress:peer},headers:forwarded===undefined?{}:{'x-forwarded-for':forwarded}});
 assert.equal(isPrivateAddress('10.0.0.5'),true);
 assert.equal(isPrivateAddress('::ffff:172.18.0.1'),true);
 assert.equal(isPrivateAddress('100.64.1.9'),true);
 assert.equal(isPrivateAddress('fd12:3456::1'),true);
 assert.equal(isPrivateAddress('203.0.113.9'),false);
 // Railway edge: private peer, real client in X-Forwarded-For.
 assert.equal(clientIp(request('10.0.0.5','203.0.113.9, 10.0.0.5'),{}),'203.0.113.9');
 assert.equal(clientIp(request('::ffff:10.0.0.5','203.0.113.9'),{}),'203.0.113.9');
 // A public peer cannot pick its own address.
 assert.equal(clientIp(request('203.0.113.9','198.51.100.7'),{}),'203.0.113.9');
 // Missing or malformed header falls back to the socket peer.
 assert.equal(clientIp(request('10.0.0.5'),{}),'10.0.0.5');
 assert.equal(clientIp(request('10.0.0.5','not-an-ip'),{}),'10.0.0.5');
 // Explicit opt-in and opt-out win over the heuristic.
 assert.equal(clientIp(request('203.0.113.9','198.51.100.7'),{SOCIO_TRUST_PROXY:'true'}),'198.51.100.7');
 assert.equal(clientIp(request('10.0.0.5','203.0.113.9'),{SOCIO_TRUST_PROXY:'false'}),'10.0.0.5');
});
