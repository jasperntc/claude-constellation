import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 4199;
// Resolves on the CLI's "Your sky is at" line; fails fast instead of hanging if it exits first.
const started = (cli: ReturnType<typeof spawn>) => Promise.race([
  new Promise<void>((done) => {
    let out = '';
    cli.stdout!.on('data', (d) => { out += d; if (out.includes('Your sky is at')) done(); });
  }),
  once(cli, 'exit').then(() => { throw new Error('CLI exited before serving'); }),
]);
const fetchRaw = (path: string, host = `localhost:${PORT}`, port = PORT) =>
  new Promise<{ status: number; body: string }>((done, fail) => {
    // node:http, not fetch: fetch won't send a raw malformed path or a forged Host header.
    request({ host: '127.0.0.1', port, path, headers: { host } }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d)).on('end', () => done({ status: res.statusCode!, body }));
    }).on('error', fail).end();
  });
const get = async (path: string, host?: string) => (await fetchRaw(path, host)).status;

test('local page server refuses rebinding, survives bad URLs, stays inside the site folder', async (t) => {
  const cli = spawn(process.execPath, ['src/cli.ts', '--demo', '--no-open', '--port', String(PORT)]);
  t.after(() => cli.kill());
  await started(cli);

  assert.equal(await get('/'), 200);
  assert.equal(await get('/', `evil.example:${PORT}`), 403, 'foreign Host header (DNS rebinding)');
  assert.equal(await get('/%E0%A4%A'), 400, 'malformed URL');
  assert.equal(await get('/..%2f..%2fpackage.json'), 404, 'path traversal');
  assert.equal(await get('/sessions.json'), 404, 'demo mode serves no data');
  assert.equal(await get('/'), 200, 'still up after the bad requests');
});

test('a bad --port is a message, not a stack trace', async () => {
  const cli = spawn(process.execPath, ['src/cli.ts', '--demo', '--no-open', '--port', 'abc']);
  let err = '';
  cli.stderr.on('data', (d) => (err += d));
  const [code] = await once(cli, 'exit');
  assert.equal(code, 1);
  assert.match(err, /--port must be a whole number/);
});

test('replays: served by key with secrets masked, and never written into --out files', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'cc-tx-'));
  mkdirSync(join(dir, 'proj'));
  const line = (o: object) => JSON.stringify({ timestamp: '2026-11-01T10:00:00Z', cwd: '/x/demo-app', ...o });
  writeFileSync(join(dir, 'proj', 's1.jsonl'), [
    line({ type: 'user', message: { content: 'deploy with key sk-ant-api03-SECRETSECRETSECRET' } }),
    line({ type: 'assistant', message: { id: 'm1', model: 'claude-opus-5-5', usage: { input_tokens: 10, output_tokens: 5 },
      content: [{ type: 'text', text: 'Done.' }] } }),
  ].join('\n'));

  const out = join(dir, 'sky.json');
  const writer = spawn(process.execPath, ['src/cli.ts', '--dir', dir, '--out', out]);
  await once(writer, 'exit');
  const saved = readFileSync(out, 'utf8');
  assert.equal(saved.includes('"key"'), false, '--out files carry no replay keys');
  assert.equal(saved.includes('deploy'), false, '--out files carry no prompt text');

  const port = PORT + 1;
  const cli = spawn(process.execPath, ['src/cli.ts', '--dir', dir, '--no-open', '--port', String(port)]);
  t.after(() => cli.kill());
  await started(cli);
  const sky = JSON.parse((await fetchRaw('/sessions.json', `localhost:${port}`, port)).body);
  assert.equal(sky.sessions[0].key, '0');
  const replay = await fetchRaw('/replay/0.json', `localhost:${port}`, port);
  assert.equal(replay.status, 200);
  assert.match(replay.body, /deploy with key \[secret\]/);
  assert.equal(replay.body.includes('SECRETSECRET'), false);
  assert.equal((await fetchRaw('/replay/7.json', `localhost:${port}`, port)).status, 404);
});
