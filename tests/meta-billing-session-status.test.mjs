import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const overview=readFileSync(new URL('../public/socio-workspace-ui.js',import.meta.url),'utf8');
const dialog=readFileSync(new URL('../public/meta-billing-ui.js',import.meta.url),'utf8');
const worker=readFileSync(new URL('../meta-browser/remote-worker.js',import.meta.url),'utf8');

test('dashboard surfaces no Meta balance or billing action, so OAuth and billing cannot be confused',()=>{
 assert.doesNotMatch(overview,/\/api\/marketing\/browser\/status/);
 assert.doesNotMatch(overview,/browserBilling/);
 assert.doesNotMatch(overview,/Faturamento ainda não conectado|Aguardando leitura do faturamento/);
 assert.doesNotMatch(overview,/Abrir recarga na Meta|Saldo disponível|Limite disponível/);
 assert.doesNotMatch(overview,/Conectar faturamento e ler saldo/);
 assert.doesNotMatch(overview,/Adicionar saldo por Pix/);
});
test('user is told to sign into private Meta billing browser, rather than external tab',()=>{
 assert.match(dialog,/Estar conectado em outra aba do Facebook não conecta esta sessão isolada/);
 assert.match(dialog,/Salvar sessão de faturamento/);
 assert.match(dialog,/void run\('refresh'\)/);
 assert.match(dialog,/Nenhum pagamento é feito automaticamente/);
});
test('worker reports missing login separately from a logged-in inaccessible wallet',()=>{
 assert.match(worker,/context\.cookies\('https:\/\/www\.facebook\.com'\)/);
 assert.match(worker,/state:'wallet_not_found'/);
 assert.match(worker,/state:'needs_login'/);
 assert.doesNotMatch(worker,/message:[^\n]*cookies/i);
 assert.match(worker,/parseObservedMetaBalance\(\{\.\.\.snapshot/);
});
