import test from 'node:test';
import assert from 'node:assert/strict';
import {permissionsFor,allowed,requirePermission,allowedNewMemberRole,validateMemberPatch} from '../team-permissions.mjs';

test('permissions are derived from a fixed server-side role matrix',()=>{
 const agent=permissionsFor('agent');
 assert(agent.includes('inbox.read'));
 assert(agent.includes('catalog.read'));
 for(const restricted of ['catalog.manage','sales.read','training.manage','team.invite','team.promote','team.manage','audit.read','platform.manage'])
  assert(!agent.includes(restricted),'agent unexpectedly received '+restricted);
 const admin=permissionsFor('admin');
 assert(admin.includes('team.invite'));
 assert(!admin.includes('team.promote'));
 assert(!admin.includes('team.manage'));
 assert(!admin.includes('platform.manage'));
 const owner=permissionsFor('owner');
 assert(owner.includes('team.manage')&&owner.includes('audit.read'));
 assert(!owner.includes('platform.manage'));
 assert(permissionsFor('owner',true).includes('platform.manage'));
 assert.deepEqual(permissionsFor('invalid'),[]);
});
test('server rejects forbidden privilege escalation regardless of submitted role',()=>{
 assert.equal(allowed({role:'agent'},'sales.manage'),false);
 assert.throws(()=>requirePermission({role:'agent'},'training.manage'),e=>e.status===403);
 assert.equal(allowedNewMemberRole({role:'admin'},'agent'),true);
 assert.equal(allowedNewMemberRole({role:'admin'},'admin'),false);
 assert.equal(allowedNewMemberRole({role:'owner'},'admin'),true);
 assert.equal(allowedNewMemberRole({role:'owner'},'owner'),false);
});
test('member update API accepts only supported status and roles',()=>{
 assert.deepEqual(validateMemberPatch({active:false}),{role:undefined,active:false,changeRole:false,changeActive:true});
 assert.deepEqual(validateMemberPatch({role:'agent'}),{role:'agent',active:undefined,changeRole:true,changeActive:false});
 assert.throws(()=>validateMemberPatch({role:'owner'}),e=>e.status===422);
 assert.throws(()=>validateMemberPatch({platform_owner:true}),e=>e.status===422);
 assert.throws(()=>validateMemberPatch({role:'admin',active:'false'}),e=>e.status===422);
 assert.throws(()=>validateMemberPatch({}),e=>e.status===422);
});
