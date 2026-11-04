import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateUiPatch,validReaction,allowedInboxFilters,inboxCapabilities} from '../inbox-api.mjs';

test('tenant inbox metadata validates every writable field and internal reaction',()=>{
 assert.equal(validateUiPatch({pinned:true,draft:'Oi'}).pinned,true);
 assert.deepEqual(validateUiPatch({labels:['VIP','VIP','Retorno']}).labels,['VIP','Retorno']);
 assert.equal(validateUiPatch({read:true}).marked_unread,false);
 assert.equal(validateUiPatch({handling_mode:'ai_assist'}).handling_mode,'ai_assist');
 for(const payload of [
  {},{pinned:'yes'},{draft:'x'.repeat(3001)},{labels:['']},
  {labels:Array(7).fill('foo')},{handling_mode:'autonomous'},
  {assigned_user_id:'outside-the-tenant'}
 ]) assert.throws(()=>validateUiPatch(payload),/PATCH_INVALID/);
 assert.equal(validReaction('👍'),true);
 assert.equal(validReaction('❤️'),true);
 assert.equal(validReaction(null),true);
 assert.equal(validReaction('remote network effect'),false);
 assert(allowedInboxFilters.has('archived'));
 assert(allowedInboxFilters.has('unread'));
 assert.equal(inboxCapabilities.whatsappSend,false);
 assert.equal(inboxCapabilities.whatsappMedia,false);
 assert.equal(inboxCapabilities.internalNotes,true);
 assert.equal(inboxCapabilities.quotedNotes,true);
});
test('WhatsApp-like inbox has real keyboard/mouse/touch handlers and never claims remote sending',()=>{
 const js=readFileSync(new URL('../public/inbox.js',import.meta.url),'utf8');
 const css=readFileSync(new URL('../public/inbox.css',import.meta.url),'utf8');
 const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 for(const event of ['dblclick','contextmenu','pointerdown','pointerup','keydown'])
  assert.match(js,new RegExp(event));
 for(const feature of ['replyTo','toggleSelect','saveDraft','showForward','showHelp','mark-read','star-selected','wa-inbox-dialog','aria-live="polite"'])
  assert.ok(js.includes(feature),'Expected functional inbox feature '+feature);
 assert.match(js,/Não enviada ao cliente/);
 assert.match(js,/internalOnly|internamente|nota interna/i);
 assert.match(js,/api\('\/api\/inbox\/v2/);
 assert.match(css,/\.wa-inbox\{/);
 assert.match(css,/@media\(max-width:780px\)/);
 assert.match(css,/prefers-reduced-motion/);
 assert.ok(html.indexOf('/inbox.css')>html.indexOf('/ember-theme.css'));
 assert.ok(html.indexOf('/inbox.js')<html.indexOf('/app.js'));
});

test('Sócio inbox offers exactly three handling filters, including both in Todas',()=>{
 const js=readFileSync(new URL('../public/inbox.js',import.meta.url),'utf8');
 const css=readFileSync(new URL('../public/inbox.css',import.meta.url),'utf8');
 const start=js.indexOf('const filters=[');
 const end=js.indexOf('];',start);
 assert(start>=0&&end>start,'Inbox must expose visible filters');
 const list=[...js.slice(start,end).matchAll(/\['([^']+)','([^']+)'\]/g)].map(x=>[x[1],x[2]]);
 assert.deepEqual(list,[
  ['all','Todas'],
  ['ai_assist','IA respondendo'],
  ['human','Humano respondendo']
 ]);
 assert.match(js,/handling_mode:'human'/);
 assert.match(js,/handling_mode:'ai_assist'/);
 assert.match(js,/Object\.hasOwn\(patch,'handling_mode'\)\)\{[\s\S]*?await refreshList\(\)/);
 assert.match(js,/data-inbox-connect>Conectar WhatsApp/);
 assert.match(css,/grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
 assert.doesNotMatch(css,/\.wa-filters\{[^}]*overflow-x:auto/);
});
