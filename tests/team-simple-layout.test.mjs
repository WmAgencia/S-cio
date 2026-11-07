import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const ui=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const team=ui.slice(ui.indexOf('async function team(){'),ui.indexOf('function featureChecks('));

test('Equipe shows only company users and invitations, without audit or integrity cards',()=>{
 assert.match(team,/Usuários da empresa/);
 assert.match(team,/id="teamInviteToggle"/);
 assert.match(team,/data-team-select/);
 assert.match(team,/data-team-toggle/);
 assert.doesNotMatch(team,/Auditoria da empresa/);
 assert.doesNotMatch(team,/Isolamento de dados/);
 assert.doesNotMatch(team,/\/api\/ops\/audit/);
 assert.doesNotMatch(team,/\/api\/ops\/tenant-integrity/);
});

test('Equipe handles missing or empty member lists without failing rendering',()=>{
 assert.match(team,/Array\.isArray\(teamResponse\)\?teamResponse:\[\]/);
 assert.match(team,/people\.map\(member=>/);
 assert.match(team,/mayView\?await api\('\/api\/team'\):\[\]/);
});
