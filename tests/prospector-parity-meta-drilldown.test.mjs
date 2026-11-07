import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {permissionsFor,allowedNewMemberRole} from '../team-permissions.mjs';

const ads=readFileSync(new URL('../public/socio-workspace-ui.js',import.meta.url),'utf8');
const inbox=readFileSync(new URL('../public/inbox.js',import.meta.url),'utf8');
const theme=readFileSync(new URL('../public/prospector-socio.css',import.meta.url),'utf8');

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
