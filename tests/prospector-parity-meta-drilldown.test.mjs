import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {permissionsFor,allowedNewMemberRole} from '../team-permissions.mjs';
import {validateAdsPlan} from '../meta-ads-tools.mjs';

const ads=readFileSync(new URL('../public/socio-workspace-ui.js',import.meta.url),'utf8');
const inbox=readFileSync(new URL('../public/inbox.js',import.meta.url),'utf8');
const theme=readFileSync(new URL('../public/prospector-socio.css',import.meta.url),'utf8');
const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
const metaTools=readFileSync(new URL('../meta-ads-tools.mjs',import.meta.url),'utf8');

test('campaign-specific ad cards retain Meta account-scoped media retrieval and play controls',()=>{
 assert.match(ads,/data-px-open-campaign/);
 assert.match(ads,/data-px-campaign-back/);
 assert.match(ads,/data-px-ad-play/);
 assert.match(ads,/\/api\/marketing\/tools\/ad-media\?adId=/);
 assert.match(ads,/trustedVideoEmbed\(media.videoEmbedUrl\)/);
 assert.match(ads,/px-ad-creative-media video,\.px-ad-creative-media iframe/);
});
test('WhatsApp layout keeps functional Sócio inbox, styled like Prospector',()=>{
 assert.match(inbox,/wa-inbox-items/);
 assert.match(inbox,/wa-inbox-main/);
 assert.match(inbox,/Mensagens <span id="inboxCount"/);
 assert.match(theme,/Match Prospector's light, purple messenger proportions/);
});
test('company admins may delegate administrators but cannot change owner role',()=>{
 assert(permissionsFor('admin').includes('team.promote'));
 assert(allowedNewMemberRole({role:'admin'},'admin'));
 assert(!allowedNewMemberRole({role:'admin'},'owner'));
 assert(!permissionsFor('viewer').includes('team.manage'));
});


test('campaign > ad set > ad selection preserves scoped hierarchy and backs out one level',()=>{
 assert.match(ads,/data-px-open-campaign/);
 assert.match(ads,/data-px-open-adset/);
 assert.match(ads,/data-px-adset-back/);
 assert.match(ads,/data-px-campaign-back/);
 assert.match(ads,/campaignId,adsetId/);
 assert.match(ads,/Conjuntos de anúncios/);
 assert.match(ads,/Anúncios do conjunto/);
 assert.match(ads,/campaignAdsets\.length\?adsetRows\(campaignAdsets/);
 assert.match(ads,/visibleAds\.length\?adCards\(visibleAds,manage\)/);
 assert.match(ads,/scopedMetaItems/);
});
test('scoped Meta read endpoints validate parent ownership and retain pagination',()=>{
 assert.match(server,/campaignId:qs\.get\('campaignId'\),adsetId:qs\.get\('adsetId'\)/);
 assert.match(metaTools,/await owned\(c,input\.campaignId,'campaign'\)/);
 assert.match(metaTools,/await owned\(c,input\.adsetId,'adset'\)/);
 assert.match(metaTools,/graph\(c,'\/'\+parentId\+'\/'\+edge,params\)/);
 assert.match(metaTools,/after:result\.paging\?\.cursors\?\.after/);
});
test('ad pausing and activation use the same confirmed Meta workflow as campaigns',()=>{
 for(const status of ['ACTIVE','PAUSED']){
  assert.equal(validateAdsPlan('status',{entity:'ad',id:'123456',status}).status,status);
 }
 assert.throws(()=>validateAdsPlan('budget',{entity:'ad',id:'123456',dailyBudgetCents:1000}),{status:422});
 assert.match(ads,/actionButtons\('ad',ad,manage\)/);
 assert.match(ads,/visibleAds\.map\(item=>\(\{\.\.\.item,kind:'ad'\}\)\)/);
 assert.match(ads,/api\('\/api\/marketing\/tools\/plan','POST'/);
 assert.match(ads,/api\('\/api\/marketing\/tools\/execute','POST'/);
});
