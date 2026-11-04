import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/socio-ux.css',import.meta.url),'utf8');

test('AI view binds restore controls to a collection, never to the first matching element',()=>{
 assert.match(app,/\$\$\('\[data-restore-version\]'\)\.forEach\(/);
 assert.doesNotMatch(app,/(?<!\$)\$\('\[data-restore-version\]'\)\.forEach\(/);
});

test('AI-only tenant can open training without requesting a disabled WhatsApp API',()=>{
 assert.match(app,/featureAvailable\('whatsapp'\)\?api\('\/api\/waakg\/channels'\):Promise\.resolve\(\[\]\)/);
 assert.match(app,/WhatsApp está desabilitado para esta empresa/);
});

test('Training and agent screens expose navigable tabs and responsive focus states',()=>{
 assert.match(app,/data-ai-tab="training"/);
 assert.match(app,/data-ai-tab="agent"/);
 assert.match(css,/\.ai-guide-tabs button:focus-visible/);
 assert.match(css,/@media\(max-width:420px\)/);
});
