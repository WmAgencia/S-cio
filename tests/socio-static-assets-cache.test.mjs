import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {brotliDecompressSync,gunzipSync} from 'node:zlib';
import {getStaticAsset,clearStaticAssetCache} from '../static-assets.mjs';

test('static resources are cached and Brotli/gzip responses reconstruct exact source',async()=>{
 const source=readFileSync(new URL('../public/socio-stripe-system.css',import.meta.url));
 const plain=await getStaticAsset('/socio-stripe-system.css','');
 const br=await getStaticAsset('/socio-stripe-system.css','gzip, deflate, br');
 const gz=await getStaticAsset('/socio-stripe-system.css','gzip');
 assert.equal(plain.encoding,null);
 assert.equal(br.encoding,'br');
 assert.equal(gz.encoding,'gzip');
 assert.deepEqual(plain.body,source);
 assert.deepEqual(brotliDecompressSync(br.body),source);
 assert.deepEqual(gunzipSync(gz.body),source);
 assert(br.body.length<source.length*.4,'CSS should compress significantly');
 assert.equal(plain.etag,br.etag);
 assert.equal(br.etag,gz.etag);
 assert.match(br.etag,/^"[a-f0-9]{24}"$/);
 const again=await getStaticAsset('/socio-stripe-system.css','br');
 assert.strictEqual(again.body,br.body,'cache should reuse already-compressed artifact');
 clearStaticAssetCache();
});
test('static handler preserves HTML revalidation and sends versioned CSS browser caching',()=>{
 const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 assert.match(server,/getStaticAsset\(file,String\(req\.headers\['accept-encoding'\]/);
 assert.match(server,/if-none-match/);
 assert.match(server,/res\.writeHead\(304,headers\)/);
 assert.match(server,/public,max-age=86400/);
 assert.match(server,/Vary':'Accept-Encoding/);
 assert.match(html,/socio-stripe-shell\.css\?v=20261115a/);
 assert.doesNotMatch(html,/href="\/socio-(?:ethereal|reference)\.css/);
 assert.match(html,/<meta name="theme-color" content="#f7f8fa">/);
});
