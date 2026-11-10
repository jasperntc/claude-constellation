// Made-up replays for the demo sky, so the public page can show the feature without anyone's transcripts.
import type { Session } from '../src/extract.ts';
import type { ReplayEvent } from '../src/replay.ts';

type Script = { ask: string; plan: string; file: string; del: string[]; add: string[]; test: string; done: string };

const SCRIPTS: Script[] = [
  { ask: 'The settings page flashes white before dark mode kicks in. Can you fix that?',
    plan: "The theme is applied after hydration, so the first paint is light. I'll set it before the page renders.",
    file: 'app/layout.tsx', del: ['<html lang="en">'], add: ['<html lang="en" suppressHydrationWarning>', '  <script dangerouslySetInnerHTML={{ __html: themeScript }} />'],
    test: '✓ 23 passed (1.4s)', done: 'Fixed: the theme now loads before first paint, so there is no flash. Tests pass.' },
  { ask: 'The retry test is flaky on CI. Find out why?',
    plan: "It waits on a real timer, and CI machines are slower. I'll switch it to fake timers.",
    file: 'src/retry.test.ts', del: ['await sleep(1000);'], add: ['vi.useFakeTimers();', 'await vi.advanceTimersByTimeAsync(1000);'],
    test: '✓ 41 passed (0.9s)', done: 'The test used a real one-second sleep. With fake timers it is deterministic, and 41 tests pass.' },
  { ask: 'Move the CSV parsing out of the upload handler into its own module, with tests.',
    plan: "I'll pull parseRows into src/csv.ts, keep the handler thin, and cover quoted commas and empty lines.",
    file: 'src/upload.ts', del: ['const rows = text.split("\\n").map((l) => l.split(","));'], add: ['import { parseRows } from "./csv";', 'const rows = parseRows(text);'],
    test: '✓ 18 passed (0.6s)', done: 'Parsing lives in src/csv.ts now, with tests for quoted commas, CRLF and blank lines.' },
  { ask: 'The forecast screen takes four seconds on my phone. Make it faster.',
    plan: 'Every card fetches on its own. One batched request should fix most of it.',
    file: 'src/forecast.ts', del: ['for (const day of days) await getDay(day);'], add: ['const all = await getDays(days); // one request, not seven'],
    test: '✓ 12 passed (0.4s)', done: 'One request instead of seven. The screen loads in under a second on a throttled 4G profile.' },
  { ask: 'Pagination skips the last item when the count divides evenly. Off by one somewhere?',
    plan: "Yes: the last page is computed with Math.floor. I'll use Math.ceil and add the edge case.",
    file: 'src/paginate.ts', del: ['const pages = Math.floor(total / size);'], add: ['const pages = Math.ceil(total / size);'],
    test: '✓ 9 passed (0.2s)', done: 'Math.floor dropped the final page whenever total divided evenly by size. Fixed and tested.' },
];

const at = (iso: string, plusSeconds: number) => new Date(Date.parse(iso) + plusSeconds * 1000).toISOString();

export function demoReplay(session: Session, seed: number): ReplayEvent[] {
  const out: ReplayEvent[] = [];
  session.turns.forEach((turn, k) => {
    const s = SCRIPTS[(seed + k) % SCRIPTS.length]!;
    const file = `${session.project}/${s.file}`;
    out.push(
      { t: turn.t, kind: 'prompt', text: s.ask },
      { t: at(turn.t, 4), kind: 'text', text: s.plan },
      { t: at(turn.t, 6), kind: 'tool', name: 'Read', summary: file },
      { t: at(turn.t, 7), kind: 'result', text: `${40 + ((seed + k) % 90)} lines`, error: false },
      { t: at(turn.t, 12), kind: 'tool', name: 'Edit', summary: file, diff: { del: s.del, add: s.add } },
      { t: at(turn.t, 13), kind: 'result', text: 'The file has been updated.', error: false },
      { t: at(turn.t, 15), kind: 'tool', name: 'Bash', summary: 'Run the tests', body: 'npm test' },
      { t: at(turn.t, 22), kind: 'result', text: s.test, error: false },
      { t: at(turn.t, 25), kind: 'text', text: s.done },
    );
  });
  return out;
}
