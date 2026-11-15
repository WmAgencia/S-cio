import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const ui=read('public/socio-workspace-ui.js');
const boardCss=read('public/socio-ethereal.css');

const overview=()=>{
 const start=ui.indexOf('async function overview(');
 return ui.slice(start,ui.indexOf('async function marketing(',start));
};

test('the board shows no remaining-spending-cap ribbon and no prepaid balance claim',()=>{
 const screen=overview();
 assert.equal(screen.indexOf('spendCapRemainingMinor'),-1);
 assert.doesNotMatch(screen,/Saldo disponível|Limite disponível|Duração estimada|Saldo pré-pago/);
 assert.doesNotMatch(screen,/px-budget-meta-ribbon|px-budget-meta-summary|px-budget-meta-action/);
});

test('when Meta does not answer, the spend card says so instead of guessing a value',()=>{
 const screen=overview();
 assert.match(screen,/A Meta não respondeu agora/);
 assert.match(screen,/SEM INVESTIMENTO/);
 assert.doesNotMatch(screen,/Math\.round\([^)]*spend/);
 assert.doesNotMatch(screen,/Math\.max\([^)]*spend[^)]*\)\s*\//);
});

test('the dark board keeps its card materials and honors reduced motion',()=>{
 assert.match(boardCss,/body #appShell \.et-card\{/);
 assert.match(boardCss,/body #appShell \.et-hero\{/);
 assert.match(boardCss,/body #appShell \.et-rail\{/);
 assert.match(boardCss,/@media\(prefers-reduced-motion:reduce\)/);
 assert.match(boardCss,/@media\(max-width:760px\)/);
});
