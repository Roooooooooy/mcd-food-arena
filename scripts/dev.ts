import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

if (Number(process.versions.node.split('.')[0]) !== 24) {
  console.error('LOCAL_DEV_REQUIRES_NODE_24');
  process.exit(1);
}

const children: ChildProcess[] = [];
let stopping = false;
function signalOwned(signal: NodeJS.Signals) {
  for (const child of children) {
    if (!child.pid) continue;
    try {
      // Each child is the leader of a new process group, so npm's descendants are owned too.
      if (process.platform === 'win32') child.kill(signal);
      else process.kill(-child.pid, signal);
    } catch { /* An already-exited owned group needs no cleanup. */ }
  }
}
function stop(code: number) {
  if (stopping) return;
  stopping = true;
  signalOwned('SIGTERM');
  // Keep the grace period even if npm exits first: a descendant may still need the final signal.
  setTimeout(() => { signalOwned('SIGKILL'); process.exit(code); }, 1000);
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => stop(0));

for (const script of ['dev:api', 'dev:web']) {
  const npmPath = process.env.npm_execpath;
  const command = npmPath ? process.execPath : 'npm';
  const args = [...(npmPath ? [npmPath] : []), '--userconfig=/dev/null', 'run', script];
  const child = spawn(command, args, { stdio: 'inherit', detached: process.platform !== 'win32' });
  children.push(child);
  child.once('error', () => { console.error('LOCAL_DEV_START_FAILED'); stop(1); });
  child.once('exit', code => { if (!stopping) stop(code && code > 0 ? code : 1); });
}

console.log('Local development: API http://127.0.0.1:8787 · Web http://127.0.0.1:5173');
