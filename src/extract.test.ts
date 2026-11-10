import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addLine, newAcc, projectName, toSession } from './extract.ts';

const L = (o: object) => JSON.stringify(o);
const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 20 };

test('projectName: last folder, worktrees fold into repo, scratch collapses', () => {
  assert.equal(projectName('C:\\Users\\me\\GitHub\\portfolio'), 'portfolio');
  assert.equal(projectName('/c/Users/me/GitHub/portfolio/'), 'portfolio');
  assert.equal(projectName('C:\\code\\built4you\\.claude\\worktrees\\kraft-label-9585'), 'built4you');
  assert.equal(projectName('C:\\Users\\me\\AppData\\Claude\\scratch-workspaces\\a\\b\\scratch-2026'), 'scratch');
});

test('streamed lines of one message count usage once but every tool call', () => {
  const acc = newAcc();
  addLine(acc, L({ type: 'user', cwd: '/x/repo', timestamp: '2026-11-01T10:00:00.000Z', message: { role: 'user', content: 'hi' } }));
  for (const block of [{ type: 'thinking' }, { type: 'tool_use' }, { type: 'tool_use' }]) {
    addLine(acc, L({ type: 'assistant', timestamp: '2026-11-01T10:00:05.000Z',
      message: { id: 'm1', model: 'claude-opus-5-5', usage, content: [block] } }));
  }
  addLine(acc, L({ type: 'user', timestamp: '2026-11-01T10:00:06.000Z',
    message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } }));
  addLine(acc, '{"type":"assistant","trunc'); // half-written last line

  const s = toSession(acc, 'fallback');
  assert.deepEqual(s, {
    project: 'repo', start: '2026-11-01T10:00:00.000Z', end: '2026-11-01T10:00:06.000Z', model: 'claude-opus-5-5',
    input: 10, output: 5, cacheRead: 100, cacheWrite: 20, tools: 2, prompts: 1,
    turns: [{ t: '2026-11-01T10:00:00.000Z', tokens: 135, output: 5, tools: 2 }],
  });
});

test('subagent spend lands on the prompt that was active when it ran', () => {
  const acc = newAcc();
  const prompt = (t: string) => addLine(acc, L({ type: 'user', cwd: '/x/repo', timestamp: t, message: { content: 'go' } }));
  const reply = (t: string, id: string, side = false) =>
    addLine(acc, L({ type: 'assistant', timestamp: t, message: { id, model: 'claude-sonnet-5-5', usage, content: [{ type: 'tool_use' }] } }), side);
  prompt('2026-11-01T10:00:00Z'); reply('2026-11-01T10:00:01Z', 'a');
  prompt('2026-11-01T11:00:00Z'); reply('2026-11-01T11:00:01Z', 'b');
  reply('2026-11-01T10:30:00Z', 's1', true); // subagent launched during the first prompt
  const s = toSession(acc, 'f')!;
  assert.deepEqual(s.turns.map((x) => [x.tokens, x.tools]), [[270, 2], [135, 1]]);
  assert.equal(s.tools, 3);
});

test('subagent lines add cost, not prompts or cwd; synthetic model is ignored', () => {
  const acc = newAcc();
  addLine(acc, L({ type: 'user', cwd: '/x/sub', timestamp: '2026-11-01T09:00:00Z', message: { content: 'task' } }), true);
  addLine(acc, L({ type: 'assistant', timestamp: '2026-11-01T09:01:00Z', message: { id: 'a', model: 'claude-haiku-5-5', usage, content: [] } }), true);
  addLine(acc, L({ type: 'assistant', timestamp: '2026-11-01T09:02:00Z', message: { id: 'b', model: '<synthetic>', usage, content: [] } }), true);
  const s = toSession(acc, 'fallback');
  assert.equal(s?.project, 'fallback');
  assert.equal(s?.prompts, 0);
  assert.equal(s?.model, 'claude-haiku-5-5');
  assert.equal(s?.output, 10);
});

test('a session with no tokens is dropped', () => {
  const acc = newAcc();
  addLine(acc, L({ type: 'user', cwd: '/x/repo', timestamp: '2026-11-01T10:00:00Z', message: { content: 'hi' } }));
  assert.equal(toSession(acc, 'f'), null);
});
