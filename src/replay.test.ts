import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReplay, makeRedact } from './replay.ts';

const BS = String.fromCharCode(92); // a backslash, spelled out so no tool or shell can eat it
const home = ['C:', 'Users', 'jas'].join(BS);
const mask = makeRedact(home);

test('redaction masks keys, tokens, passwords, emails and every spelling of the home folder', () => {
  const cases: [string, string][] = [
    [`ANTHROPIC_API_KEY=sk-ant-api03-abcdefghijklmnop`, 'ANTHROPIC_API_KEY=[secret]'],
    ['token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456', 'token [secret]'],
    ['Authorization: Bearer abc.def.ghijklmnopqrstuv', 'Authorization: Bearer [secret]'],
    ['password: "hunter2hunter2"', 'password: "[secret]"'],
    ['mail me@example.com now', 'mail [email] now'],
    [`${home}${BS}code${BS}app`, `~${BS}code${BS}app`],
    ['C:/Users/jas/code/app', '~/code/app'],
    ['/c/Users/jas/code/app', '~/code/app'],
    ['ls /Users/jas/code', 'ls ~/code'],
    ['-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----', '[private key]'],
  ];
  for (const [input, want] of cases) assert.equal(mask(input), want, input);
  assert.equal(mask('npm test passed: 14 of 14'), 'npm test passed: 14 of 14', 'ordinary text is untouched');
});

test('buildReplay keeps prompts, replies, tool calls and results in order, and drops what is not yours', () => {
  const L = (o: object) => JSON.stringify({ timestamp: '2026-11-01T10:00:00Z', ...o });
  const events = buildReplay([
    L({ type: 'user', message: { content: 'Fix the wheel<system-reminder>injected</system-reminder>' } }),
    L({ type: 'user', isMeta: true, message: { content: 'meta noise' } }),
    L({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'private' }] } }),
    L({ type: 'assistant', message: { content: [{ type: 'text', text: 'On it.' }] } }),
    L({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit',
      input: { file_path: 'C:/Users/jas/app/Wheel.tsx', old_string: 'const MS = 4000', new_string: 'const MS = 2600' } }] } }),
    L({ type: 'user', message: { content: [{ type: 'tool_result', content: 'ok', is_error: false }] } }),
    L({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'npm test', description: 'Run tests' } }] } }),
    L({ type: 'user', message: { content: [{ type: 'tool_result', content: [{ type: 'text', text: 'FAIL' }], is_error: true }] } }),
    L({ type: 'assistant', isSidechain: true, message: { content: [{ type: 'text', text: 'subagent chatter' }] } }),
    'not json',
  ], mask);

  assert.deepEqual(events.map((e) => e.kind), ['prompt', 'text', 'tool', 'result', 'tool', 'result']);
  assert.deepEqual(events[0], { t: '2026-11-01T10:00:00Z', kind: 'prompt', text: 'Fix the wheel' });
  assert.deepEqual(events[2], { t: '2026-11-01T10:00:00Z', kind: 'tool', name: 'Edit', summary: '~/app/Wheel.tsx',
    diff: { del: ['const MS = 4000'], add: ['const MS = 2600'] } });
  assert.deepEqual(events[4], { t: '2026-11-01T10:00:00Z', kind: 'tool', name: 'Bash', summary: 'Run tests', body: 'npm test' });
  assert.deepEqual(events[5], { t: '2026-11-01T10:00:00Z', kind: 'result', text: 'FAIL', error: true });
});
