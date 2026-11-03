import test from 'node:test';
import assert from 'node:assert/strict';
import {extractWhatsAppZip} from '../zip-import.mjs';

export function zipStore(files){
 const locals=[],centrals=[];let offset=0;
 for(const [filename,text] of files){
  const name=Buffer.from(filename),data=Buffer.from(text);
  const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt32LE(0,14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(name.length,26);
  locals.push(local,name,data);
  const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);
  central.writeUInt32LE(data.length,20);central.writeUInt32LE(data.length,24);central.writeUInt16LE(name.length,28);central.writeUInt32LE(offset,42);
  centrals.push(central,name);
  offset+=local.length+name.length+data.length;
 }
 const dir=Buffer.concat(centrals),footer=Buffer.alloc(22);
 footer.writeUInt32LE(0x06054b50,0);footer.writeUInt16LE(files.length,8);footer.writeUInt16LE(files.length,10);footer.writeUInt32LE(dir.length,12);footer.writeUInt32LE(offset,16);
 return Buffer.concat([...locals,dir,footer]).toString('base64');
}
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
