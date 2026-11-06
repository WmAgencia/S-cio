// Server operator only. No publication, cookie import or shared profile.
import {spawn} from 'node:child_process';
import {createHmac} from 'node:crypto';
import {createRequire} from 'node:module';
import {resolve,join,dirname,relative,isAbsolute} from 'node:path';
const [id,verb,...args]=process.argv.slice(2);
if(!/^[a-f0-9]{32}$/.test(id||'')||!['capture','inspect','add','ops','check','verify','call','status'].includes(verb))throw Error('Informe o ID do perfil e um comando de aprendizado api-anything.');
if(String(process.env.CHANNEL_ENCRYPTION_KEY||'').length<32)throw Error('CHANNEL_ENCRYPTION_KEY indisponível.');
const root=resolve(process.env.SOCIO_META_BROWSER_DIR||'data/meta-browser'),home=join(root,id),inside=relative(root,home);
if(!inside||inside.startsWith('..')||isAbsolute(inside))throw Error('Perfil inválido.');
const require=createRequire(import.meta.url),cli=join(dirname(require.resolve('api-anything')),'cli.js');
const env={...process.env,API_ANYTHING_HOME:home,API_ANYTHING_LOCAL_ONLY:'1',API_ANYTHING_ALLOW_IMPORT:'',API_ANYTHING_KEY:createHmac('sha256',process.env.CHANNEL_ENCRYPTION_KEY).update(id).digest('hex')};
delete env.API_ANYTHING_PLAINTEXT;
const child=spawn(process.execPath,[cli,verb,...args],{env,stdio:'inherit',windowsHide:true});child.on('exit',code=>{process.exitCode=code??1;});
