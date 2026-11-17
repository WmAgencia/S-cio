import test from 'node:test';
import assert from 'node:assert/strict';
import {createOriginGuard,firstPartyHosts,allowedOrigin} from '../socio-origin-guard.mjs';

const RAILWAY='socio-app-production-762c.up.railway.app';
const CUSTOM='socio.consecom.com.br';
const guard=env=>createOriginGuard(env);

test('login pela URL do Railway continua permitido',()=>{
 const g=guard({});
 assert.doesNotThrow(()=>g({headers:{origin:'https://'+RAILWAY,host:RAILWAY}}));
});

test('login pelo domínio próprio atrás do proxy é aceito',()=>{
 // O proxy reescreve o Host: o navegador manda Origin do domínio próprio mas o
 // processo Node enxerga o host do Railway. Antes isso virava 403 e travava o
 // login inteiro no domínio próprio.
 const g=guard({});
 assert.doesNotThrow(()=>g({headers:{origin:'https://'+CUSTOM,host:RAILWAY}}));
 assert.doesNotThrow(()=>g({headers:{origin:'https://'+CUSTOM,host:'10.0.0.5'}}));
});

test('host repassado pelo proxy também vale',()=>{
 const g=guard({});
 assert.doesNotThrow(()=>g({headers:{
  origin:'https://socio.cliente.com.br',
  host:'socio-app-production-762c.up.railway.app',
  'x-forwarded-host':'socio.cliente.com.br'
 }}));
});

test('origem estrangeira continua bloqueada como CSRF',()=>{
 const g=guard({});
 for(const origin of ['https://evil.example','https://socio.consecom.com.br.evil.example',
  'http://socio.consecom.com.br']){
  assert.throws(()=>g({headers:{origin,host:RAILWAY}}),/Origem não permitida/);
 }
});

test('esquema não HTTP é recusado',()=>{
 assert.equal(allowedOrigin('file:///tmp/a',{host:RAILWAY,hosts:new Set([RAILWAY])}),false);
 assert.equal(allowedOrigin('null',{host:RAILWAY,hosts:new Set([RAILWAY])}),false);
});

test('requisição sem Origin (webhook, curl) segue adiante',()=>{
 const g=guard({});
 assert.doesNotThrow(()=>g({headers:{host:RAILWAY}}));
});

test('Sec-Fetch-Site cross-site é recusado mesmo sem Origin',()=>{
 const g=guard({});
 assert.throws(()=>g({headers:{host:RAILWAY,'sec-fetch-site':'cross-site'}}),/Origem não permitida/);
});

test('SOCIO_ALLOWED_ORIGINS e SOCIO_PUBLIC_URL entram na lista',()=>{
 const hosts=firstPartyHosts({SOCIO_ALLOWED_ORIGINS:'https://a.example, https://b.example/path',SOCIO_PUBLIC_URL:'https://c.example/'});
 for(const host of ['a.example','b.example','c.example',CUSTOM,RAILWAY])assert.ok(hosts.has(host),host);
 const g=guard({SOCIO_ALLOWED_ORIGINS:'https://a.example'});
 assert.doesNotThrow(()=>g({headers:{origin:'https://a.example',host:RAILWAY}}));
});
