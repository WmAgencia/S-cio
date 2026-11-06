import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {nextDailyMetaReport} from '../meta-report-schedules.mjs';

test('daily report respects Sao Paulo timezone and advances only once per local day',()=>{
 const before=nextDailyMetaReport('20:00','America/Sao_Paulo',new Date('2026-11-06T16:00:00Z'));
 assert.equal(before.toISOString(),'2026-11-06T23:00:00.000Z');
 const after=nextDailyMetaReport('20:00','America/Sao_Paulo',new Date('2026-11-06T23:05:00Z'));
 assert.equal(after.toISOString(),'2026-11-07T23:00:00.000Z');
 assert.throws(()=>nextDailyMetaReport('99:00','America/Sao_Paulo'));
 assert.throws(()=>nextDailyMetaReport('20:00','America/Unknown'));
});
test('report worker is opt in, stores only dashboard snapshots and does not call WA-AKG',()=>{
 const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 const jobs=readFileSync(new URL('../meta-report-schedules.mjs',import.meta.url),'utf8');
 const ui=readFileSync(new URL('../public/meta-report-schedule-ui.js',import.meta.url),'utf8');
 assert.match(server,/SOCIO_META_REPORTS_ENABLED/);
 assert.match(server,/\/api\/marketing\/report-schedule/);
 assert.match(jobs,/REPORTS_DISABLED/);
 assert.match(jobs,/delivery:'panel_only'/);
 assert.doesNotMatch(jobs,/sendGatewayText|deliverToConversation|sendWhatsApp/);
 assert.match(ui,/Relatórios automáticos da Meta Ads/);
});
