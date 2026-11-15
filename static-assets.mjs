// Cache immutable artifact bytes in memory per deployment and negotiate compression.
// Versioned URLs can use browser caching, while unversioned URLs revalidate by ETag.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gzipSync,brotliCompressSync,constants as zlibConstants} from 'node:zlib';

const assets=new Map();
export async function getStaticAsset(path,acceptEncoding=''){
 let value=assets.get(path);
 if(!value){
  value=readFile(new URL('./public'+path,import.meta.url)).then(body=>{
   const isText=/\.(?:css|js|mjs|html|svg)$/.test(path);
   const etag='"'+createHash('sha256').update(body).digest('hex').slice(0,24)+'"';
   return {body,etag,br:isText?brotliCompressSync(body,{
    params:{[zlibConstants.BROTLI_PARAM_QUALITY]:4}}):null,
    gzip:isText?gzipSync(body,{level:6}):null};
  }).catch(err=>{assets.delete(path);throw err;});
  assets.set(path,value);
 }
 const entry=await value;
 const br=/(?:^|,)\s*br(?:\s*;|\s*,|\s*$)/i.test(acceptEncoding);
 const gzip=/(?:^|,)\s*gzip(?:\s*;|\s*,|\s*$)/i.test(acceptEncoding);
 const encoding=entry.br&&br?'br':entry.gzip&&gzip?'gzip':null;
 return {body:encoding==='br'?entry.br:encoding==='gzip'?entry.gzip:entry.body,
  etag:entry.etag,encoding};
}
export function clearStaticAssetCache(){assets.clear();}
