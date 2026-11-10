// Turns Claude Code transcript lines into per-session, per-prompt totals.
// Only numbers, dates, a model name and a folder name come out: never prompts, paths or ids.

/** One prompt you typed, and everything Claude spent answering it. */
export type Turn = {
  t: string; // ISO timestamp of the prompt
  tokens: number; // input + output + cache read + cache write
  output: number;
  tools: number;
};

export type Session = {
  project: string;
  start: string;
  end: string;
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  tools: number;
  prompts: number;
  turns: Turn[];
};

export type Sky = { generatedAt: string; sessions: Session[] };

type Spend = { t: string; tokens: number; output: number; tools: number };

export type Acc = {
  cwd?: string;
  start?: string;
  end?: string;
  seen: Set<string>;
  models: Map<string, number>;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  turns: Turn[];
  prompts: number;
  sub: Spend[]; // subagent spend, placed onto turns by time in toSession
};

export const newAcc = (): Acc => ({
  seen: new Set(), models: new Map(), input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: [], prompts: 0, sub: [],
});

/** Last folder of the launch directory. Worktrees count as their parent repo; scratch folders collapse to one. */
export function projectName(cwd: string): string {
  const path = cwd.replace(/\\/g, '/').split('/.claude/worktrees/')[0] ?? '';
  const parts = path.split('/').filter(Boolean);
  if (parts.includes('scratch-workspaces')) return 'scratch';
  return parts.at(-1) ?? 'unknown';
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function spend(acc: Acc, s: Spend, sidechain: boolean) {
  if (sidechain) return void acc.sub.push(s);
  // Work before the first typed prompt (a slash command, a resumed session) gets a turn of its own.
  const turn = acc.turns.at(-1) ?? (acc.turns[0] = { t: s.t, tokens: 0, output: 0, tools: 0 });
  turn.tokens += s.tokens; turn.output += s.output; turn.tools += s.tools;
}

/** sidechain: the line comes from a subagent transcript, which adds cost but not prompts or the cwd. */
export function addLine(acc: Acc, line: string, sidechain = false): void {
  let e: any;
  try { e = JSON.parse(line); } catch { return; } // a session still being written can end mid-line
  if (!e || typeof e !== 'object' || typeof e.timestamp !== 'string' || Number.isNaN(Date.parse(e.timestamp))) return;
  const t: string = e.timestamp;
  if (!acc.start || t < acc.start) acc.start = t;
  if (!acc.end || t > acc.end) acc.end = t;
  if (!sidechain && !acc.cwd && typeof e.cwd === 'string') acc.cwd = e.cwd;

  const msg = e.message;
  if (!msg) return;
  const content: any[] = Array.isArray(msg.content) ? msg.content : [];

  if (e.type === 'assistant') {
    // One API message is streamed as several lines: each carries one content block but repeats the same usage.
    const tools = content.filter((c) => c?.type === 'tool_use').length;
    const u = msg.usage;
    const key = msg.id ?? e.requestId ?? e.uuid;
    const fresh = u && key && !acc.seen.has(key);
    if (!fresh) return void (tools && spend(acc, { t, tokens: 0, output: 0, tools }, sidechain));
    acc.seen.add(key);
    const [i, o, r, w] = [u.input_tokens, u.output_tokens, u.cache_read_input_tokens, u.cache_creation_input_tokens].map(num) as [number, number, number, number];
    acc.input += i; acc.output += o; acc.cacheRead += r; acc.cacheWrite += w;
    if (typeof msg.model === 'string' && msg.model !== '<synthetic>') {
      acc.models.set(msg.model, (acc.models.get(msg.model) ?? 0) + o + 1);
    }
    spend(acc, { t, tokens: i + o + r + w, output: o, tools }, sidechain);
  } else if (e.type === 'user' && !sidechain && !e.isMeta) {
    const typed = typeof msg.content === 'string' ||
      (content.length > 0 && content.every((c) => c?.type === 'text' || c?.type === 'image'));
    if (typed) { acc.prompts++; acc.turns.push({ t, tokens: 0, output: 0, tools: 0 }); }
  }
}

export function toSession(acc: Acc, fallbackProject: string): Session | null {
  const total = acc.input + acc.output + acc.cacheRead + acc.cacheWrite;
  if (!total || !acc.start || !acc.end) return null;
  for (const s of acc.sub) {
    // The prompt that launched the subagent is the latest one before its work started.
    const turn = acc.turns.findLast((x) => x.t <= s.t) ?? acc.turns[0] ?? (acc.turns[0] = { ...s, tokens: 0, output: 0, tools: 0 });
    turn.tokens += s.tokens; turn.output += s.output; turn.tools += s.tools;
  }
  const turns = acc.turns.filter((x) => x.tokens > 0);
  const model = [...acc.models].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'unknown';
  return {
    project: acc.cwd ? projectName(acc.cwd) : fallbackProject,
    start: acc.start, end: acc.end, model,
    input: acc.input, output: acc.output, cacheRead: acc.cacheRead, cacheWrite: acc.cacheWrite,
    tools: turns.reduce((a, x) => a + x.tools, 0), prompts: acc.prompts, turns,
  };
}
