import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const ui=readFileSync(new URL('../public/socio-workspace-ui.js',import.meta.url),'utf8');
const boardCss=readFileSync(new URL('../public/socio-ethereal.css',import.meta.url),'utf8');

const overviewScreen=()=>{
 const start=ui.indexOf('async function overview(');
 return ui.slice(start,ui.indexOf('async function marketing(',start));
};

test('the board opens on the headline revenue, with no advertising budget strip',()=>{
 const screen=overviewScreen();
 const header=screen.indexOf("root.innerHTML='<div class=\"px-workspace px-overview et-board\">'+");
 assert(header>0);
 const body=screen.slice(header,header+1400);
 assert.equal(body.indexOf('budgetTopHtml'),-1,'no budget strip is rendered on the overview');
 assert.equal(screen.indexOf('const budgetTopHtml='),-1,'the budget helper is gone from the overview');
 assert(body.indexOf('et-title')>=0,'the board opens with its own title');
 assert(body.indexOf('et-title')<body.indexOf('hero+'),'the title comes before the headline card');
 assert(body.indexOf('hero+')<body.indexOf('flowCard+'),'revenue comes before the charts');
 // The board is one 5/3/4 grid: headline, leads and campaign on the first rows,
 // then the charts and the conversation list.
 assert(body.indexOf('incomeCard+')>body.indexOf('hero+'));
 assert(body.indexOf('recsBlock+')<body.indexOf('flowCard+'));
 assert.equal(screen.indexOf('px-page-heading'),-1,'the overview has no page heading block');
 assert.match(screen,/data-period-preset/);
 assert.match(screen,/data-period-custom/);
});

test('no unverified balance, spending cap or exhaustion date is presented as financial fact',()=>{
 const screen=overviewScreen();
 for(const claim of ['Saldo disponível','Saldo pré-pago confirmado','Abrir recarga na Meta',
  'Duração estimada','Limite disponível','spendCapRemainingMinor','availableFundsMinor'])
  assert.equal(screen.indexOf(claim),-1,claim+' must not appear on the dashboard');
 assert.doesNotMatch(screen,/Math\.round\([^)]*balance|spend_cap|balance\s*[-+]/);
 assert.doesNotMatch(screen,/\/api\/marketing\/(tools\/finance|browser\/status|official\/status|billing\/refresh)/,
  'the dashboard reads no Meta billing or finance endpoint');
});

test('the board grid, hero and side rail stay mobile compatible',()=>{
 assert.match(boardCss,/\.et-stage\{[^}]*display:grid/);
 assert.match(boardCss,/\.et-rail\{[^}]*display:flex/);
 assert.match(boardCss,/\.et-hero\{[^}]*border-radius:24px/);
 assert.match(boardCss,/\.et-pill\{[^}]*border-radius:999px/);
 assert.match(boardCss,/@media\(max-width:1020px\)\{[^}]*\.et-stage\{grid-template-columns:1fr\}/);
 assert.match(boardCss,/@media\(max-width:760px\)/);
});
