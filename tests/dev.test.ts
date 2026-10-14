import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const launcher = fileURLToPath(new URL('../scripts/dev.ts', import.meta.url));
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const running = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function fixture(failApi = false) {
  const folder = await mkdtemp(join(tmpdir(), 'mcd-arena-dev-'));
  await writeFile(join(folder, 'package.json'), JSON.stringify({ scripts: { 'dev:api': 'node child.cjs api', 'dev:web': 'node child.cjs web' } }));
  await writeFile(join(folder, 'child.cjs'), `
    const fs = require('node:fs'); const {spawn} = require('node:child_process');
    const name = process.argv[2];
    const descendant = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {stdio: 'ignore'});
    fs.writeFileSync(name + '.json', JSON.stringify({pid: process.pid, descendant: descendant.pid}));
    process.on('SIGTERM', () => { descendant.kill(); process.exit(0); });
    process.on('SIGINT', () => { descendant.kill(); process.exit(0); });
    ${failApi ? "if (name === 'api') setTimeout(() => process.exit(7), 200);" : ''}
    setInterval(() => {}, 1000);
  `);
  const child = spawn(process.execPath, [launcher], { cwd: folder, env: { ...process.env, npm_config_userconfig: '/dev/null' }, stdio: 'pipe' });
  let output = ''; child.stdout?.on('data', chunk => { output += chunk; }); child.stderr?.on('data', chunk => { output += chunk; });
  const exited = once(child, 'exit');
  async function started(name: string): Promise<{pid: number; descendant: number}> {
    for (let attempt = 0; attempt < 200; attempt++) {
      try { return JSON.parse(await readFile(join(folder, name + '.json'), 'utf8')); } catch { /* Wait only for our fixture. */ }
      if (child.exitCode !== null) throw new Error(`Launcher exited ${child.exitCode} before ${name} started: ${output}`);
      await delay(10);
    }
    throw new Error(`Launcher did not start ${name}: ${output}`);
  }
  return { folder, child, exited, started, cleanup: async () => { if (child.exitCode === null) { child.kill('SIGTERM'); await exited; } await rm(folder, { recursive: true, force: true }); } };
}
async function waitStopped(pids: number[]) {
  for (let attempt = 0; attempt < 100 && pids.some(running); attempt++) await delay(10);
  assert.equal(pids.some(running), false, 'launcher must stop only its own complete process groups');
}
async function stop(child: ChildProcess) { if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; } }

test('combined dev starts both scripts and SIGTERM cleans owned children while another process survives', async () => {
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  const f = await fixture();
  try {
    const api = await f.started('api'); const web = await f.started('web');
    f.child.kill('SIGTERM'); const [code] = await f.exited; assert.equal(code, 0);
    await waitStopped([api.pid, api.descendant, web.pid, web.descendant]);
    assert.equal(running(unrelated.pid!), true);
  } finally { await f.cleanup(); await stop(unrelated); }
});

test('one dev script failing shuts down its sibling and descendants with a failing exit status', async () => {
  const f = await fixture(true);
  try {
    const api = await f.started('api'); const web = await f.started('web');
    const [code] = await f.exited; assert.equal(code, 7);
    await waitStopped([api.pid, api.descendant, web.pid, web.descendant]);
  } finally { await f.cleanup(); }
});
