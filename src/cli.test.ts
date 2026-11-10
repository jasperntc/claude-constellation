import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { once } from 'node:events';

const PORT = 4199;
const get = (path: string, host = `localhost:${PORT}`) =>
  new Promise<number>((done, fail) => {
    // node:http, not fetch: fetch won't send a raw malformed path or a forged Host header.
    request({ host: '127.0.0.1', port: PORT, path, headers: { host } }, (res) => { res.resume(); done(res.statusCode!); })
      .on('error', fail).end();
  });

test('local page server refuses rebinding, survives bad URLs, stays inside the site folder', async (t) => {
  const cli = spawn(process.execPath, ['src/cli.ts', '--demo', '--no-open', '--port', String(PORT)]);
  t.after(() => cli.kill());
  await once(cli.stdout, 'data'); // "Your sky is at ..."

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
