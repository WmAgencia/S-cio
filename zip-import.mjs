import {inflateRawSync} from 'node:zlib';

// Parses exported WhatsApp ZIPs without unpacking media to disk. ZIP64,
// encrypted entries, paths and unusually large archives are rejected.
const reject = message => Object.assign(new Error(message),{status:422});
const uint32=(b,i)=>b.readUInt32LE(i);
export function extractWhatsAppZip(base64){
 if(typeof base64!=='string'||base64.length>2_800_000||base64.length<12||!(/^[A-Za-z0-9+/]*={0,2}$/.test(base64)))throw reject('ZIP inválido ou maior que 2 MB.');
 const zip=Buffer.from(base64,'base64');
 if(zip.length<22||zip.length>2_000_000)throw reject('ZIP inválido ou maior que 2 MB.');
 let end=-1;
 for(let i=zip.length-22;i>=Math.max(0,zip.length-65557);i--){
  if(uint32(zip,i)===0x06054b50){end=i;break;}
 }
 if(end<0||end+22>zip.length)throw reject('Arquivo ZIP corrompido.');
 if(zip.readUInt16LE(end+4)||zip.readUInt16LE(end+6))throw reject('ZIP com múltiplos volumes não é aceito.');
 const count=zip.readUInt16LE(end+10),dirSize=uint32(zip,end+12),dirOffset=uint32(zip,end+16);
 if(!count||count>100||dirSize===0xffffffff||dirOffset===0xffffffff||dirOffset+dirSize>zip.length)throw reject('ZIP inválido ou com arquivos demais.');
 let at=dirOffset,total=0;
 const files=[];
 for(let i=0;i<count;i++){
  if(at+46>zip.length||uint32(zip,at)!==0x02014b50)throw reject('Diretório ZIP inválido.');
  const flags=zip.readUInt16LE(at+8),compression=zip.readUInt16LE(at+10);
  const compressed=uint32(zip,at+20),uncompressed=uint32(zip,at+24);
  const nameLength=zip.readUInt16LE(at+28),extra=zip.readUInt16LE(at+30),comment=zip.readUInt16LE(at+32),local=uint32(zip,at+42);
  const endEntry=at+46+nameLength+extra+comment;
  if(endEntry>zip.length)throw reject('Entrada ZIP inválida.');
  const name=zip.subarray(at+46,at+46+nameLength).toString('utf8');
  at=endEntry;
  if(!/\.(txt|md)$/i.test(name)||name.endsWith('/')||name.startsWith('__MACOSX/')||/\0/.test(name))continue;
  if(name.includes('..')||name.includes('\\')||name.startsWith('/')||name.includes('/'))throw reject('O ZIP deve conter conversas no diretório principal.');
  if((flags&1)!==0||![0,8].includes(compression)||compressed===0xffffffff||uncompressed===0xffffffff)throw reject('ZIP criptografado ou incompatível.');
  if(uncompressed>700_000||total+uncompressed>2_500_000||files.length>=25)throw reject('O ZIP contém textos grandes demais (máximo 25 conversas e 2,5 MB de texto).');
  if(local+30>zip.length||uint32(zip,local)!==0x04034b50)throw reject('Cabeçalho do ZIP inválido.');
  const localName=zip.readUInt16LE(local+26),localExtra=zip.readUInt16LE(local+28);
  const start=local+30+localName+localExtra;
  if(start+compressed>zip.length)throw reject('Conteúdo ZIP truncado.');
  let content;
  try{
   const compressedData=zip.subarray(start,start+compressed);
   content=compression===0?compressedData:inflateRawSync(compressedData,{maxOutputLength:700_001});
  }catch{throw reject('Falha ao extrair conversa ou tamanho descompactado excessivo.');}
  if(content.length!==uncompressed||content.length>700_000)throw reject('Tamanho do texto no ZIP não confere.');
  total+=content.length;
  files.push({filename:name,content:content.toString('utf8').replace(/^\uFEFF/,'')});
 }
 if(!files.length)throw reject('Nenhuma conversa .txt ou .md encontrada no ZIP.');
 return files;
}
