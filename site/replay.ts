// The replay panel: plays one session's prompts, replies and tool calls in order, like a screen recording.
import type { Session } from '../src/extract.ts';
import type { ReplayEvent } from '../src/replay.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

const panel = $('replay');
const log = $('r-log');
const scrub = $<HTMLInputElement>('r-time');
const playBtn = $<HTMLButtonElement>('r-play');
const speedBtn = $<HTMLButtonElement>('r-speed');
const reelBtn = $<HTMLButtonElement>('r-reel');
const SPEEDS = [1, 2, 4, 8];

let events: ReplayEvent[] = [];
let pos = 0; // events[0..pos] are on screen
let speed = 1;
let playing = false;
let timer = 0;
let onMove: (e: ReplayEvent) => void = () => {};
let onClose = () => {};

/** How long an event stays the newest one, so reading pace roughly matches its length. */
const dwell = (e: ReplayEvent) => {
  const ms = e.kind === 'prompt' ? Math.min(3500, 1400 + e.text.length * 20)
    : e.kind === 'text' ? Math.min(3000, 900 + e.text.length * 12)
    : e.kind === 'tool' ? 750 : 450;
  return ms / speed;
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string) {
  const node = document.createElement(tag);
  node.className = cls;
  if (text !== undefined) node.textContent = text; // transcript text is data: never parsed as HTML
  return node;
}

function render(e: ReplayEvent): HTMLLIElement {
  const li = el('li', `r-ev r-${e.kind}`);
  if (e.kind === 'prompt' || e.kind === 'text') {
    li.append(el('span', 'r-who', e.kind === 'prompt' ? 'you' : 'claude'), el('p', 'r-text', e.text));
  } else if (e.kind === 'tool') {
    const head = el('div', 'r-tool-head');
    head.append(el('b', '', e.name.replace(/^mcp__[^_]+__/, '')), el('span', '', e.summary));
    li.append(head);
    if (e.body) li.append(el('pre', 'r-body', `$ ${e.body}`));
    if (e.diff) {
      const diff = el('pre', 'r-diff');
      for (const line of e.diff.del) diff.append(el('span', 'r-del', `- ${line}\n`));
      for (const line of e.diff.add) diff.append(el('span', 'r-add', `+ ${line}\n`));
      li.append(diff);
    }
  } else if (e.kind === 'result') {
    const lines = e.text.split('\n');
    li.classList.toggle('r-error', e.error);
    li.append(el('pre', 'r-out', lines.slice(0, 12).join('\n') + (lines.length > 12 ? `\n… ${lines.length - 12} more lines` : '')));
  }
  return li;
}

/** Types the newest prompt or reply out, so a recording reads like it's happening live. */
function typeOut(li: HTMLLIElement, e: ReplayEvent) {
  const p = li.querySelector<HTMLElement>('.r-text');
  if (!p || reduced || !('text' in e)) return;
  const full = e.text;
  const step = Math.max(1, Math.ceil(full.length / ((dwell(e) * 0.6) / 16)));
  let n = 0;
  const tick = () => {
    n = Math.min(full.length, n + step);
    p.textContent = full.slice(0, n);
    if (n < full.length && li.isConnected) requestAnimationFrame(tick);
  };
  tick();
}

function show(to: number, animate: boolean) {
  pos = Math.max(0, Math.min(events.length - 1, to));
  // Only the last stretch is kept on screen: a 5,000-event session would otherwise be 5,000 nodes.
  const from = Math.max(0, pos - 120);
  log.replaceChildren(...events.slice(from, pos + 1).map(render));
  const last = log.lastElementChild as HTMLLIElement | null;
  if (last && animate) typeOut(last, events[pos]!);
  log.scrollTop = log.scrollHeight;
  scrub.value = String(pos);
  scrub.style.setProperty('--p', `${(pos / Math.max(1, events.length - 1)) * 100}%`);
  $('r-count').textContent = `${pos + 1} / ${events.length}`;
  onMove(events[pos]!);
}

function setPlaying(v: boolean) {
  playing = v;
  clearTimeout(timer);
  playBtn.textContent = v ? '❚❚' : '▶';
  playBtn.setAttribute('aria-label', v ? 'Pause replay' : 'Play replay');
  if (v) schedule();
}
function schedule() {
  timer = window.setTimeout(() => {
    if (pos >= events.length - 1) return setPlaying(false);
    show(pos + 1, true);
    schedule();
  }, dwell(events[pos]!));
}

playBtn.addEventListener('click', () => { if (!playing && pos >= events.length - 1) show(0, false); setPlaying(!playing); });
scrub.addEventListener('input', () => { setPlaying(false); show(Number(scrub.value), false); });
speedBtn.addEventListener('click', () => {
  speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]!;
  speedBtn.textContent = `${speed}×`;
  if (playing) setPlaying(true);
});
reelBtn.addEventListener('click', () => {
  const on = document.body.classList.toggle('reel');
  reelBtn.setAttribute('aria-pressed', String(on));
});
$('r-close').addEventListener('click', () => closeReplay());
addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) closeReplay(); });

export function closeReplay() {
  setPlaying(false);
  panel.hidden = true;
  document.body.classList.remove('reel', 'replaying');
  reelBtn.setAttribute('aria-pressed', 'false');
  onClose();
}

export function openReplay(opts: {
  session: Session; events: ReplayEvent[]; startAt: string; title: string;
  onMove: (e: ReplayEvent) => void; onClose: () => void;
}) {
  events = opts.events;
  onMove = opts.onMove;
  onClose = opts.onClose;
  $('r-title').textContent = opts.title;
  const s = opts.session;
  $('r-sub').textContent = `${new Date(s.start).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} · ${s.turns.length} prompts · ${s.tools} tool calls`;
  scrub.max = String(Math.max(0, events.length - 1));
  panel.hidden = false;
  document.body.classList.add('replaying');
  if (!events.length) {
    log.replaceChildren(el('li', 'r-ev r-empty', 'Nothing to replay in this session.'));
    return;
  }
  // Start at the prompt that was clicked, with the conversation so far already on screen.
  const start = events.findIndex((e) => e.kind === 'prompt' && e.t >= opts.startAt);
  show(start === -1 ? 0 : start, true);
  setPlaying(!reduced);
  playBtn.focus();
}
