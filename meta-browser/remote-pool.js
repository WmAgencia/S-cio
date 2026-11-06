import { fork } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { ApiError } from './errors.js';

export function createRemotePool({ root, encryptionKey, maxWorkers = 8 }) {
  const absoluteRoot = resolve(root); mkdirSync(absoluteRoot, { recursive: true });
  const workers = new Map(); let counter = 0;
  function worker(connectionId) {
    if (!/^[a-f0-9]{32}$/.test(connectionId)) throw new ApiError(400, 'INVALID_CONNECTION', 'Conexão inválida.');
    let entry = workers.get(connectionId); if (entry) return entry;
    if (workers.size >= maxWorkers) throw new ApiError(429, 'BROWSER_CAPACITY', 'Capacidade de navegadores atingida. Tente mais tarde.');
    const home = join(absoluteRoot, connectionId); const within = relative(absoluteRoot, home);
    if (!within || within.startsWith('..') || isAbsolute(within)) throw new Error('Invalid profile path');
    mkdirSync(home, { recursive: true });
    const osNames = ['PATH','Path','SystemRoot','WINDIR','TEMP','TMP','TMPDIR','HOME','USERPROFILE','LOCALAPPDATA','APPDATA','PROGRAMFILES','ProgramFiles','ProgramFiles(x86)','COMSPEC','LANG','LC_ALL','DISPLAY','XDG_RUNTIME_DIR','PLAYWRIGHT_BROWSERS_PATH','BROWSER_EXECUTABLE_PATH','SOCIO_META_BROWSER_SANDBOX','NODE_EXTRA_CA_CERTS','SSL_CERT_FILE'];
    const osEnvironment = Object.fromEntries(osNames.filter(name=>process.env[name]!==undefined).map(name=>[name,process.env[name]]));
    const env = { ...osEnvironment, API_ANYTHING_HOME: home, API_ANYTHING_LOCAL_ONLY: '1', API_ANYTHING_ALLOW_IMPORT: '',
      API_ANYTHING_KEY: createHmac('sha256', encryptionKey).update(connectionId).digest('hex') };
    for (const name of Object.keys(env)) if (name.startsWith('META_') || ['API_KEY', 'TOKEN_ENCRYPTION_KEY', 'API_ANYTHING_PLAINTEXT'].includes(name)) delete env[name];
    const child = fork(new URL('./remote-worker.js', import.meta.url), [], { env, execArgv: [], windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    entry = { child, waiting: new Map(), lastUsed: Date.now() }; workers.set(connectionId, entry);
    child.on('message', response => {
      const pending = entry.waiting.get(response.id); if (!pending) return;
      clearTimeout(pending.timer); entry.waiting.delete(response.id);
      response.ok ? pending.resolve(response.result) : pending.reject(new ApiError(409, response.code, 'Não foi possível concluir. Confira o navegador, as verificações da Meta e a instalação do Chromium.'));
    });
    const fail = () => {
      workers.delete(connectionId);
      for (const pending of entry.waiting.values()) { clearTimeout(pending.timer); pending.reject(new ApiError(502, 'WORKER_STOPPED', 'Processo encerrado. Confira o resultado antes de repetir alterações.')); }
      entry.waiting.clear();
    };
    child.once('exit', fail); child.once('error', fail);
    return entry;
  }
  const call = (id, method, data = {}) => {
    const entry = worker(id); entry.lastUsed = Date.now();
    if (entry.waiting.size >= 10) throw new ApiError(429, 'BROWSER_BUSY', 'Aguarde a operação atual.');
    return new Promise((resolve, reject) => {
      const requestId = ++counter;
      const timer = setTimeout(() => {
        entry.waiting.delete(requestId);
        reject(new ApiError(504, 'BROWSER_TIMEOUT', 'Resultado incerto. Verifique antes de repetir.'));
      }, 90000);
      entry.waiting.set(requestId, { resolve, reject, timer });
      entry.child.send({ id: requestId, method, data }, error => {
        if (error) { clearTimeout(timer); entry.waiting.delete(requestId); reject(new ApiError(502, 'WORKER_STOPPED', 'Processo indisponível.')); }
      });
    });
  };
  const stop = async id => {
    const entry = workers.get(id); if (!entry) return;
    try { await call(id, 'shutdown'); } finally { entry.child.disconnect(); }
  };
  const cleanup = setInterval(() => {
    for (const [id, entry] of workers) if (!entry.waiting.size && Date.now() - entry.lastUsed > 25 * 60000) void stop(id).catch(() => {});
  }, 60000);
  cleanup.unref();
  return { call, stop, async close() { clearInterval(cleanup); await Promise.allSettled([...workers.keys()].map(stop)); } };
}
