// Turns one transcript into a replay: your prompts, Claude's replies and its tool calls, in order.
// Secrets, emails and your home path are masked. Only the local CLI serves this; it never goes into --out files.

export type Diff = { del: string[]; add: string[] };
export type ReplayEvent =
  | { t: string; kind: 'prompt' | 'text'; text: string }
  | { t: string; kind: 'tool'; name: string; summary: string; body?: string; diff?: Diff }
  | { t: string; kind: 'result'; text: string; error: boolean };

const SECRETS: [RegExp, string][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[private key]'],
  [/\b(?:sk-ant-[\w-]{10,}|sk-[\w-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_\w{20,}|AKIA[0-9A-Z]{16}|AIza[\w-]{30,}|xox[abprs]-[\w-]{10,}|eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,})/g, '[secret]'],
  [/\b(bearer\s+)[\w.~+/-]{12,}=*/gi, '$1[secret]'],
  [/\b((?:api[_-]?key|secret|token|password|passwd|pwd|authorization|client[_-]?secret)["']?\s*[:=]\s*["']?)(?!bearer\s|\[secret)[^\s"',;]{6,}/gi, '$1[secret]'],
  [/[\w.%+-]+@[\w-]+(?:\.[\w-]+)+/g, '[email]'],
];

/** A masker for one machine: your home folder in any of its spellings becomes ~. */
export function makeRedact(home: string) {
  const h = home.replace(/\\/g, '/').replace(/\/+$/, '');
  // C:/Users/x, Git Bash's /c/Users/x, and drive-less /Users/x in tool output. Longest first, so the drive goes too.
  const spellings = [h, h.replace(/^([A-Za-z]):/, (_, d: string) => `/${d}`), h.replace(/^[A-Za-z]:/, '')];
  const pattern = spellings.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\//g, '[\\\\/]+')).join('|');
  const homeRe = new RegExp(pattern, 'gi');
  return (s: string) => SECRETS.reduce((acc, [re, to]) => acc.replace(re, to), s.replace(homeRe, '~'));
}

const clip = (s: string, chars: number) => (s.length > chars ? `${s.slice(0, chars)}\n… ${s.length - chars} more characters` : s);
const clipLines = (s: string, n: number) => {
  const lines = s.split('\n');
  return lines.length > n ? [...lines.slice(0, n), `… ${lines.length - n} more lines`] : lines;
};
// Claude Code wraps some prompts in markup; reminders it injects aren't yours, so they go.
const cleanPrompt = (s: string) => s
  .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
  .replace(/<\/?(?:pasted_content|command-name|command-message|command-args|local-command-stdout)\b[^>]*>/g, '')
  .trim();
const str = (v: unknown) => (typeof v === 'string' ? v : '');

function tool(name: string, input: any, mask: (s: string) => string): Omit<Extract<ReplayEvent, { kind: 'tool' }>, 't' | 'kind'> {
  const path = mask(str(input?.file_path ?? input?.path ?? input?.notebook_path));
  switch (name) {
    case 'Bash': case 'PowerShell':
      return { name, summary: mask(str(input?.description)), body: clip(mask(str(input?.command)), 1500) };
    case 'Edit':
      return { name, summary: path, diff: { del: clipLines(mask(str(input?.old_string)), 40), add: clipLines(mask(str(input?.new_string)), 40) } };
    case 'Write':
      return { name, summary: path, diff: { del: [], add: clipLines(mask(str(input?.content)), 40) } };
    case 'Read':
      return { name, summary: path };
    case 'Grep': case 'Glob':
      return { name, summary: mask(`${str(input?.pattern)}${path ? `  in ${path}` : ''}`) };
    default:
      return { name, summary: clip(mask(JSON.stringify(input ?? {})), 240) };
  }
}

export function buildReplay(lines: Iterable<string>, mask: (s: string) => string, max = 6000): ReplayEvent[] {
  const out: ReplayEvent[] = [];
  for (const line of lines) {
    if (out.length >= max) break;
    let e: any;
    try { e = JSON.parse(line); } catch { continue; }
    const t = e?.timestamp, msg = e?.message;
    if (typeof t !== 'string' || !msg || e.isSidechain || e.isMeta) continue;
    const content: any[] = Array.isArray(msg.content) ? msg.content : [];

    if (e.type === 'user') {
      const results = content.filter((c) => c?.type === 'tool_result');
      for (const r of results) {
        const text = typeof r.content === 'string' ? r.content
          : Array.isArray(r.content) ? r.content.map((c: any) => (c?.type === 'text' ? str(c.text) : '[image]')).join('\n') : '';
        out.push({ t, kind: 'result', text: clipLines(clip(mask(text), 1500), 30).join('\n'), error: r.is_error === true });
      }
      if (results.length) continue;
      const raw = typeof msg.content === 'string' ? msg.content
        : content.map((c) => (c?.type === 'text' ? str(c.text) : c?.type === 'image' ? '[image]' : '')).join('\n');
      const text = cleanPrompt(raw);
      if (text) out.push({ t, kind: 'prompt', text: clip(mask(text), 4000) });
    } else if (e.type === 'assistant') {
      for (const c of content) {
        if (c?.type === 'text' && str(c.text).trim()) out.push({ t, kind: 'text', text: clip(mask(c.text), 4000) });
        else if (c?.type === 'tool_use') out.push({ t, kind: 'tool', ...tool(str(c.name), c.input, mask) });
      }
    }
  }
  return out;
}
