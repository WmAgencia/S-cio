// Sócio phase 4: centrally described per-role capabilities.
// Server routes must enforce permissions; the UI only reflects them.
const owner=['inbox.read','inbox.write','catalog.read','catalog.manage','sales.read','sales.manage',
 'channels.manage','marketing.read','marketing.manage','training.manage','team.read','team.invite','team.manage','team.promote','audit.read'];
const admin=owner.filter(x=>x!=='team.manage'&&x!=='team.promote');
const agent=['inbox.read','inbox.write','catalog.read','account.manage'];
const byRole={owner:[...owner,'account.manage'],admin:[...admin,'account.manage'],agent};
const denied=(message)=>Object.assign(new Error(message),{status:403});
export function permissionsFor(role,platformOwner=false){
 return platformOwner?[...new Set([...byRole.owner,'platform.manage'])]:[...(byRole[role]||[])];
}
export function allowed(auth,permission){
 return permissionsFor(auth?.role,auth?.platform_owner===true).includes(permission);
}
export function requirePermission(auth,permission){
 if(!allowed(auth,permission))throw denied('Você não tem permissão para esta operação.');
}
export function allowedNewMemberRole(auth,role){
 if(!['admin','agent'].includes(role))return false;
 return role==='agent'?allowed(auth,'team.invite'):allowed(auth,'team.promote');
}
export function validateMemberPatch(input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Object.assign(new Error('Alteração de acesso inválida.'),{status:422});
 const keys=Object.keys(input);
 if(!keys.length||keys.some(x=>x!=='role'&&x!=='active'))throw Object.assign(new Error('Alteração de acesso inválida.'),{status:422});
 if('role' in input&&!['admin','agent'].includes(input.role))throw Object.assign(new Error('Papel inválido; proprietários não são alterados por esta operação.'),{status:422});
 if('active' in input&&typeof input.active!=='boolean')throw Object.assign(new Error('Estado de acesso inválido.'),{status:422});
 return {role:input.role,active:input.active,changeRole:keys.includes('role'),changeActive:keys.includes('active')};
}
