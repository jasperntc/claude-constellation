import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import type { Session, Sky, Turn } from '../src/extract.ts';
import type { ReplayEvent } from '../src/replay.ts';
import { openReplay } from './replay.ts';
import { demoReplay } from './demo-replay.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);
// ?embed is the sky with no controls or HUD, for an iframe such as a portfolio hero.
const embed = params.has('embed');
// (index.html sets the .embed class itself, before any script loads, so the HUD stays hidden even if this file fails.)
// ?t=0..1 opens the sky at that point in time, still, with no intro: for links, embeds and screenshots.
const fixedT = params.has('t') ? Math.min(1, Math.max(0, Number(params.get('t')) || 0)) : null;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const still = reduced || fixedT !== null;
const PLAY_SECONDS = embed ? 7 : 18; // a hero has seconds, not minutes, of attention

// ---------- small helpers

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (s: string) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
const fmt = (n: number) =>
  n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? Math.round(n / 1e3) + 'k' : n.toLocaleString('en');
const span = (ms: number) => { const m = Math.max(1, Math.round(ms / 6e4)); return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`; };
const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

const FAMILIES = [
  { re: /opus/i, name: 'Opus', hex: '#ffb547' },
  { re: /sonnet/i, name: 'Sonnet', hex: '#7cc4ff' },
  { re: /haiku/i, name: 'Haiku', hex: '#6ee7c8' },
  { re: /fable/i, name: 'Fable', hex: '#d6a4ff' },
];
const OTHER = { re: /./, name: 'Other', hex: '#e8e6e1' };
const PROJECT_HUES = ['#ffb547', '#7cc4ff', '#6ee7c8', '#d6a4ff', '#ff8a7a', '#f5e07a', '#ff9ccf', '#9fb4ff', '#b8f27c'];
const family = (model: string) => FAMILIES.find((f) => f.re.test(model)) ?? OTHER;

// ---------- data: validation (a dropped file is untrusted) and the demo sky

function validate(raw: unknown): Session[] {
  const list = (raw as { sessions?: unknown })?.sessions;
  if (!Array.isArray(list)) throw new Error('No sessions list in that file. Make one with: npx github:jasperntc/claude-constellation --out constellation.json');
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
  const date = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v));
  const out: Session[] = [];
  // Times are re-written as ISO strings because the sky sorts them as text.
  const iso = (v: string) => new Date(v).toISOString();
  let budget = 50_000; // stars: past this the layout's spread calls and the GPU both give out
  for (const s of list.slice(0, 5000)) {
    if (budget <= 0) break;
    if (!s || !date(s.start) || !date(s.end) || !Array.isArray(s.turns)) continue;
    const turns: Turn[] = s.turns.slice(0, 3000)
      .filter((x: any) => x && date(x.t) && n(x.tokens) > 0)
      .slice(0, budget)
      .map((x: any) => ({ t: iso(x.t), tokens: n(x.tokens), output: n(x.output), tools: Math.min(n(x.tools), 5000) }));
    if (!turns.length) continue;
    budget -= turns.length;
    out.push({
      project: String(s.project ?? 'unknown').slice(0, 60), start: iso(s.start), end: iso(s.end), model: String(s.model ?? '').slice(0, 60),
      input: n(s.input), output: n(s.output), cacheRead: n(s.cacheRead), cacheWrite: n(s.cacheWrite),
      tools: n(s.tools), prompts: n(s.prompts) || turns.length, turns,
      ...(typeof s.key === 'string' && /^\d{1,6}$/.test(s.key) ? { key: s.key } : {}),
    });
  }
  if (!out.length) throw new Error('That file has no sessions with tokens in it.');
  return out;
}

function demoSky(): Session[] {
  const r = rng(7);
  const gauss = () => Math.sqrt(-2 * Math.log(r() + 1e-9)) * Math.cos(2 * Math.PI * r());
  const names = ['portfolio', 'api-gateway', 'pixel-garden', 'recipe-box', 'weather-bot', 'dotfiles', 'notes-sync', 'tide-tables', 'habit-loop'];
  const endOfDemo = Date.parse('2026-11-08T12:00:00Z');
  const sessions: Session[] = [];
  names.forEach((project, p) => {
    const from = endOfDemo - (100 - p * 9) * 864e5;
    const count = 3 + Math.floor(r() * 10);
    for (let i = 0; i < count; i++) {
      let t = from + r() * (endOfDemo - from);
      const pick = r();
      const model = pick < 0.68 ? 'claude-opus-5-5' : pick < 0.88 ? 'claude-sonnet-5-5' : pick < 0.96 ? 'claude-haiku-5-5' : 'claude-fable-5-1';
      const turns: Turn[] = [];
      const len = 2 + Math.floor(Math.pow(r(), 1.6) * 45);
      for (let k = 0; k < len; k++) {
        const tokens = Math.round(Math.exp(Math.log(7e5) + gauss() * 0.9));
        turns.push({ t: new Date(t).toISOString(), tokens, output: Math.round(tokens * (0.015 + r() * 0.03)), tools: Math.floor(Math.pow(r(), 1.8) * 40) });
        t += (2 + r() * 22) * 6e4;
      }
      const sum = (f: (x: Turn) => number) => turns.reduce((a, x) => a + f(x), 0);
      const all = sum((x) => x.tokens);
      sessions.push({
        project, model, start: turns[0]!.t, end: new Date(t).toISOString(),
        input: Math.round(all * 0.002), output: sum((x) => x.output), cacheRead: Math.round(all * 0.9), cacheWrite: Math.round(all * 0.07),
        tools: sum((x) => x.tools), prompts: len, turns,
      });
    }
  });
  return sessions;
}

// ---------- renderer

const canvas = $<HTMLCanvasElement>('sky');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#04050a');
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 4000);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.autoRotate = !still;
controls.enabled = !embed; // an embedded sky must not trap the host page's scroll
controls.autoRotateSpeed = 0.25;
controls.minDistance = 4;
controls.maxDistance = 900;

const labels = new CSS2DRenderer();
labels.setSize(innerWidth, innerHeight);
Object.assign(labels.domElement.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '1' });
document.body.appendChild(labels.domElement);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.7, 0.5, 0.12);
composer.addPass(bloom);
composer.addPass(new OutputPass());

const uniforms = {
  uNow: { value: 0 },
  uClock: { value: 0 },
  uScale: { value: 1 },
  uHover: { value: -1 },
};
const setScale = () => (uniforms.uScale.value = innerHeight * renderer.getPixelRatio() * 0.32);
setScale();

// Far background stars, so the sky has depth before any session appears.
{
  const r = rng(1);
  const pos = new Float32Array(3000 * 3);
  for (let i = 0; i < 3000; i++) {
    const v = new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize().multiplyScalar(1200 + r() * 1200);
    pos.set([v.x, v.y, v.z], i * 3);
  }
  const g = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({ size: 1, sizeAttenuation: false, color: '#7c86a6', transparent: true, opacity: 0.35, depthWrite: false })));
}

const glowTexture = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
})();

// ---------- shaders

const STAR_VS = /* glsl */ `
  uniform float uNow, uClock, uScale, uHover;
  attribute float aSize, aBirth, aSeed, aIndex;
  attribute vec3 aColor;
  varying vec3 vColor;
  varying float vOn;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float age = uNow - aBirth;
    float on = step(0.0, age);
    float flare = on * exp(-age * 90.0);
    float twinkle = 1.0 + 0.14 * sin(uClock * (1.2 + aSeed * 2.4) + aSeed * 40.0);
    float hover = abs(aIndex - uHover) < 0.5 ? 1.9 : 1.0;
    gl_PointSize = on * min(90.0, aSize * twinkle * hover * (1.0 + 3.5 * flare) * uScale / -mv.z);
    vColor = mix(aColor, vec3(1.0), 0.08 + 0.7 * flare);
    vOn = on;
    gl_Position = projectionMatrix * mv;
  }`;
const STAR_FS = /* glsl */ `
  varying vec3 vColor;
  varying float vOn;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float d = length(p) * 2.0;
    if (d > 1.0 || vOn < 0.5) discard;
    float core = smoothstep(0.28, 0.0, d);
    float glow = pow(1.0 - d, 3.0) * 0.6;
    float spikes = max(0.0, 1.0 - abs(p.x) * 26.0) * max(0.0, 1.0 - d) + max(0.0, 1.0 - abs(p.y) * 26.0) * max(0.0, 1.0 - d);
    gl_FragColor = vec4(vColor * (core * 1.1 + glow + spikes * 0.3), 1.0);
  }`;
const DUST_VS = /* glsl */ `
  uniform float uNow, uClock, uScale;
  attribute vec3 aCenter, aColor;
  attribute float aBirth, aSpeed;
  varying vec3 vColor;
  varying float vOn;
  void main() {
    float a = uClock * aSpeed;
    float c = cos(a), s = sin(a);
    vec3 o = vec3(position.x * c - position.z * s, position.y, position.x * s + position.z * c);
    float grow = clamp((uNow - aBirth) * 50.0, 0.0, 1.0);
    vec4 mv = modelViewMatrix * vec4(aCenter + o * (0.2 + 0.8 * grow), 1.0);
    vOn = step(aBirth, uNow);
    gl_PointSize = vOn * max(1.0, min(6.0, 0.3 * uScale / -mv.z));
    vColor = aColor;
    gl_Position = projectionMatrix * mv;
  }`;
const DUST_FS = /* glsl */ `
  varying vec3 vColor;
  varying float vOn;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0 || vOn < 0.5) discard;
    gl_FragColor = vec4(vColor * (1.0 - d) * 0.5, 1.0);
  }`;
const LINE_VS = /* glsl */ `
  uniform float uNow;
  attribute float aBirth;
  attribute vec3 aColor;
  varying vec3 vColor;
  varying float vOn;
  void main() {
    vOn = step(aBirth, uNow);
    vColor = aColor;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const LINE_FS = /* glsl */ `
  varying vec3 vColor;
  varying float vOn;
  void main() {
    if (vOn < 0.5) discard;
    gl_FragColor = vec4(vColor * 0.2, 1.0);
  }`;
const additive = (vertexShader: string, fragmentShader: string) => new THREE.ShaderMaterial({
  uniforms, vertexShader, fragmentShader, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
});

// ---------- building the sky

type Star = { session: Session; turn: Turn; index: number; pos: THREE.Vector3; project: Project };
type Project = {
  name: string; center: THREE.Vector3; radius: number; firstBirth: number; color: THREE.Color;
  label: CSS2DObject; nebula: THREE.Sprite; sessions: Session[];
};

let stars: Star[] = [];
let projects: Project[] = [];
let starPoints: THREE.Points | null = null;
let world = new THREE.Group();
scene.add(world);
// Running totals by star index, so the HUD can count up as the timeline plays.
let cum = { tokens: [0], tools: [0], sessions: [0], projects: [0] };
let home = { pos: new THREE.Vector3(), target: new THREE.Vector3() };

function build(sessions: Session[]) {
  for (const p of projects) p.label.element.remove(); // CSS2D labels nested in a group outlive its removal
  scene.remove(world);
  world.traverse((o) => {
    if (o instanceof THREE.Points || o instanceof THREE.LineSegments || o instanceof THREE.Sprite) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); }
  });
  world = new THREE.Group();
  scene.add(world);

  // Every prompt gets a rank in time; the timeline plays by rank so quiet weeks don't stall the show.
  const flat = sessions.flatMap((session) => session.turns.map((turn) => ({ session, turn })))
    .sort((a, b) => a.turn.t.localeCompare(b.turn.t));
  const rankOf = new Map(flat.map((x, i) => [x.turn, i]));
  const N = flat.length;
  const birth = (i: number) => (N > 1 ? i / (N - 1) : 0);

  const byProject = new Map<string, Session[]>();
  for (const s of [...sessions].sort((a, b) => a.start.localeCompare(b.start))) {
    byProject.set(s.project, [...(byProject.get(s.project) ?? []), s]);
  }

  // When every session used one model, colour by project instead, or the whole sky is one colour.
  const single = new Set(sessions.map((s) => family(s.model))).size < 2;
  const projectNames = [...byProject.keys()];
  const colorOf = (s: Session) => single ? PROJECT_HUES[projectNames.indexOf(s.project) % PROJECT_HUES.length]! : family(s.model).hex;

  // Lay out each project around its own origin first. Sessions sit on a sunflower spiral; prompts in a
  // session take a random walk pulled back to its centre, so long sessions become dense knots, not threads.
  const local = [...byProject].map(([name, list]) => {
    const placed: { s: Session; turn: Turn; pos: THREE.Vector3 }[] = [];
    list.forEach((s, j) => {
      const r = rng(hash(name + s.start));
      const rr = 7 * Math.sqrt(j + 0.5);
      const a = j * 2.39996 + r() * 0.5;
      const sc = new THREE.Vector3(Math.cos(a) * rr, (r() - 0.5) * 6, Math.sin(a) * rr);
      const walk = sc.clone();
      for (const turn of s.turns) {
        walk.add(new THREE.Vector3(r() - 0.5, (r() - 0.5) * 0.6, r() - 0.5).normalize().multiplyScalar(1.6 + r() * 1.4)).lerp(sc, 0.05);
        placed.push({ s, turn, pos: walk.clone() });
      }
    });
    return { name, list, placed, radius: Math.max(...placed.map((x) => x.pos.length())) + 4 };
  });

  // Then put projects on a sunflower spiral. Its closest pairs sit about 1.55 x spacing apart, so this spacing
  // keeps even the two biggest clusters from touching.
  const spacing = 1.3 * Math.max(...local.map((l) => l.radius)) + 4;
  projects = [];
  stars = new Array(N);
  const linePos: number[] = [], lineBirth: number[] = [], lineColor: number[] = [];
  local.forEach(({ name, list, placed, radius }, i) => {
    const R = spacing * Math.sqrt(i + 0.5);
    const a = i * 2.39996;
    const center = new THREE.Vector3(Math.cos(a) * R, (rng(hash(name))() - 0.5) * spacing * 0.4, Math.sin(a) * R);
    const counts = new Map<string, number>();
    for (const s of list) counts.set(colorOf(s), (counts.get(colorOf(s)) ?? 0) + s.turns.length);
    const color = new THREE.Color([...counts].sort((x, y) => y[1] - x[1])[0]![0]);

    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'label';
    el.textContent = name;
    el.insertAdjacentHTML('beforeend', `<small>${list.length} session${list.length > 1 ? 's' : ''} · ${placed.length} prompts</small>`);
    el.style.pointerEvents = 'auto';
    const label = new CSS2DObject(el);
    label.position.copy(center).add(new THREE.Vector3(0, radius * 0.6 + 3, 0));
    world.add(label);

    const nebula = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    nebula.position.copy(center);
    nebula.scale.setScalar(radius * 2.6);
    world.add(nebula);

    const firstBirth = Math.min(...list.map((s) => birth(rankOf.get(s.turns[0]!)!)));
    const p: Project = { name, center, radius, firstBirth, color, label, nebula, sessions: list };
    el.addEventListener('click', () => flyTo(p));
    projects.push(p);

    placed.forEach(({ s, turn, pos }, k) => {
      pos.add(center);
      const index = rankOf.get(turn)!;
      stars[index] = { session: s, turn, index, pos, project: p };
      const prev = placed[k - 1]; // already moved into place on the previous step
      if (prev?.s !== s) return;
      const c = new THREE.Color(colorOf(s));
      linePos.push(prev.pos.x, prev.pos.y, prev.pos.z, pos.x, pos.y, pos.z);
      lineBirth.push(birth(index), birth(index));
      lineColor.push(c.r, c.g, c.b, c.r, c.g, c.b);
    });
  });

  const sPos = new Float32Array(N * 3), sCol = new Float32Array(N * 3);
  const sSize = new Float32Array(N), sBirth = new Float32Array(N), sSeed = new Float32Array(N), sIdx = new Float32Array(N);
  const dPos: number[] = [], dCenter: number[] = [], dBirth: number[] = [], dSpeed: number[] = [], dCol: number[] = [];
  const r = rng(42);
  // Dust thins out evenly on huge skies so the particle count stays drawable.
  const dustScale = Math.min(1, 300_000 / stars.reduce((a, st) => a + Math.min(st.turn.tools, 120), 0) || 1);
  stars.forEach((st, i) => {
    const c = new THREE.Color(colorOf(st.session));
    sPos.set([st.pos.x, st.pos.y, st.pos.z], i * 3);
    sCol.set([c.r, c.g, c.b], i * 3);
    sSize[i] = THREE.MathUtils.clamp(1.6 + 1.8 * Math.log10(st.turn.tokens / 2e4), 1.2, 9);
    sBirth[i] = birth(i);
    sSeed[i] = r();
    sIdx[i] = i;
    const dust = Math.round(Math.min(st.turn.tools, 120) * dustScale);
    const spread = 0.35 + 0.1 * Math.sqrt(dust);
    for (let k = 0; k < dust; k++) {
      const o = new THREE.Vector3(r() - 0.5, (r() - 0.5) * 0.5, r() - 0.5).normalize().multiplyScalar(spread * (0.5 + r()));
      dPos.push(o.x, o.y, o.z);
      dCenter.push(st.pos.x, st.pos.y, st.pos.z);
      dBirth.push(birth(i));
      dSpeed.push((0.15 + r() * 0.5) * (r() < 0.5 ? -1 : 1));
      dCol.push(0.6 + c.r * 0.4, 0.6 + c.g * 0.4, 0.6 + c.b * 0.4);
    }
  });

  const attr = (g: THREE.BufferGeometry, name: string, a: ArrayLike<number>, size: number) =>
    g.setAttribute(name, new THREE.BufferAttribute(a instanceof Float32Array ? a : new Float32Array(a), size));

  const sg = new THREE.BufferGeometry();
  attr(sg, 'position', sPos, 3); attr(sg, 'aColor', sCol, 3); attr(sg, 'aSize', sSize, 1);
  attr(sg, 'aBirth', sBirth, 1); attr(sg, 'aSeed', sSeed, 1); attr(sg, 'aIndex', sIdx, 1);
  starPoints = new THREE.Points(sg, additive(STAR_VS, STAR_FS));

  const dg = new THREE.BufferGeometry();
  attr(dg, 'position', dPos, 3); attr(dg, 'aCenter', dCenter, 3); attr(dg, 'aBirth', dBirth, 1);
  attr(dg, 'aSpeed', dSpeed, 1); attr(dg, 'aColor', dCol, 3);
  const dust = new THREE.Points(dg, additive(DUST_VS, DUST_FS));

  const lg = new THREE.BufferGeometry();
  attr(lg, 'position', linePos, 3); attr(lg, 'aBirth', lineBirth, 1); attr(lg, 'aColor', lineColor, 3);
  const lines = new THREE.LineSegments(lg, additive(LINE_VS, LINE_FS));

  // Dust positions are offsets around its star, so the default bounding sphere would cull it wrongly.
  for (const o of [starPoints, dust, lines]) { o.frustumCulled = false; world.add(o); }

  // Running totals for the HUD.
  const seenS = new Set<Session>(), seenP = new Set<string>();
  cum = { tokens: [], tools: [], sessions: [], projects: [] };
  let tk = 0, tl = 0;
  for (const st of stars) {
    tk += st.turn.tokens; tl += st.turn.tools;
    seenS.add(st.session); seenP.add(st.project.name);
    cum.tokens.push(tk); cum.tools.push(tl); cum.sessions.push(seenS.size); cum.projects.push(seenP.size);
  }

  // Frame the whole sky from above and to the side.
  const box = new THREE.Box3().setFromPoints(stars.map((s) => s.pos));
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  // Narrow screens need to back off further so the sky's width still fits.
  const dist = Math.max(30, sphere.radius * 1.15) * Math.max(1, 1.4 / camera.aspect) * (embed ? 1.5 : 1);
  // Aim a little low so the sky sits above the timeline bar.
  const aim = sphere.center.clone().add(new THREE.Vector3(0, embed ? 0 : -dist * 0.12, 0));
  home = { target: aim, pos: aim.clone().add(new THREE.Vector3(0, dist * 0.4, dist)) };
  controls.target.copy(home.target);
  camera.position.copy(home.pos).multiplyScalar(still ? 1 : 1.8);
  controls.maxDistance = dist * 4;
  tween = still ? null : { from: camera.position.clone(), to: home.pos.clone(), fromT: home.target.clone(), toT: home.target.clone(), t: 0, dur: 6 };

  // ?focus=<project> opens close to one project.
  const focus = projects.find((p) => p.name.toLowerCase() === params.get('focus')?.toLowerCase());
  if (focus) { flyTo(focus); if (still) { tween!.t = 1; camera.position.copy(tween!.to); controls.target.copy(tween!.toT); tween = null; } }

  renderLegend(sessions, single);
  setNow(fixedT ?? (reduced ? 1 : 0));
  setPlaying(!still);
}

function renderLegend(sessions: Session[], single: boolean) {
  const used = new Set(sessions.map((s) => family(s.model)));
  if (single) {
    const li = document.createElement('li');
    li.textContent = `All ${[...used][0]!.name} · colour is project`;
    return void $('legend').replaceChildren(li);
  }
  $('legend').replaceChildren(...[...FAMILIES, OTHER].filter((f) => used.has(f)).map((f) => {
    const li = document.createElement('li');
    li.textContent = f.name;
    const dot = document.createElement('i');
    dot.style.color = f.hex;
    li.append(dot);
    return li;
  }));
}

// ---------- camera moves

let tween: { from: THREE.Vector3; to: THREE.Vector3; fromT: THREE.Vector3; toT: THREE.Vector3; t: number; dur: number } | null = null;
const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

function flyTo(p: Project) {
  const dir = camera.position.clone().sub(controls.target).normalize();
  const to = p.center.clone().add(dir.multiplyScalar(p.radius * 2.6 + 10));
  tween = { from: camera.position.clone(), to, fromT: controls.target.clone(), toT: p.center.clone(), t: 0, dur: reduced ? 0.001 : 1.4 };
}
function resetView() {
  tween = { from: camera.position.clone(), to: home.pos.clone(), fromT: controls.target.clone(), toT: home.target.clone(), t: 0, dur: reduced ? 0.001 : 1.4 };
}
controls.addEventListener('start', () => { if (tween && tween.dur > 2) tween = null; }); // let the user grab the intro

// ---------- timeline and HUD

let now = 0;
let playing = false;
const slider = $<HTMLInputElement>('time');
const playBtn = $<HTMLButtonElement>('play');

function setNow(v: number) {
  now = THREE.MathUtils.clamp(v, 0, 1);
  uniforms.uNow.value = now + 1e-6;
  slider.value = String(Math.round(now * 1000));
  slider.style.setProperty('--p', `${now * 100}%`);
  const i = Math.round(now * (stars.length - 1));
  const st = stars[i];
  if (!st) return;
  $('date').textContent = `${day(st.turn.t)} · ${time(st.turn.t)}`;
  $('s-projects').textContent = String(cum.projects[i]);
  $('s-sessions').textContent = String(cum.sessions[i]);
  $('s-prompts').textContent = (i + 1).toLocaleString('en');
  $('s-tools').textContent = fmt(cum.tools[i]!);
  $('s-tokens').textContent = fmt(cum.tokens[i]!);
}
function setPlaying(v: boolean) {
  playing = v;
  playBtn.textContent = v ? '❚❚' : '▶';
  playBtn.setAttribute('aria-label', v ? 'Pause' : 'Play');
}
playBtn.addEventListener('click', () => { if (!playing && now >= 1) setNow(0); setPlaying(!playing); });
slider.addEventListener('input', () => { setPlaying(false); setNow(Number(slider.value) / 1000); });
$('reset').addEventListener('click', resetView);
addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).closest('input, button, label')) return;
  if (e.code === 'Space') { e.preventDefault(); playBtn.click(); }
  if (e.key === 'r' || e.key === 'R') resetView();
  if (e.key === 'Escape') hideTip();
});

// ---------- hover and click

const tip = $('tip');
const ray = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let downAt: { x: number; y: number } | null = null;

function pick(e: PointerEvent): Star | null {
  if (!starPoints) return null;
  pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(pointer, camera);
  ray.params.Points.threshold = camera.position.distanceTo(controls.target) * 0.012;
  const visible = Math.round(now * (stars.length - 1));
  const hit = ray.intersectObject(starPoints).filter((h) => h.index! <= visible).sort((a, b) => a.distanceToRay! - b.distanceToRay!)[0];
  return hit ? stars[hit.index!] ?? null : null;
}
function hideTip() { tip.hidden = true; uniforms.uHover.value = -1; }
function showTip(st: Star, e: PointerEvent) {
  const f = family(st.session.model);
  const k = st.session.turns.indexOf(st.turn) + 1;
  const cache = st.session.cacheRead / Math.max(1, st.session.input + st.session.cacheRead + st.session.cacheWrite);
  tip.innerHTML = `
    <div class="t-head" style="color:${f.hex}"><i></i><span></span></div>
    <div class="t-big">${fmt(st.turn.tokens)} tokens</div>
    <div><b>${fmt(st.turn.output)}</b> written · <b>${st.turn.tools}</b> tool call${st.turn.tools === 1 ? '' : 's'}</div>
    <div>${day(st.turn.t)}, ${time(st.turn.t)}</div>
    <div>Prompt <b>${k}</b> of ${st.session.turns.length} in a <b>${span(Date.parse(st.session.end) - Date.parse(st.session.start))}</b> session</div>
    <div>Session cache hits <b>${Math.round(cache * 100)}%</b></div>
    <div class="t-hint">${controls.target.distanceTo(st.project.center) > 1 ? 'Click to fly here'
      : canReplay(st) ? 'Click to replay this session' : 'Replays need the local CLI'}</div>`;
  tip.querySelector('.t-head span')!.textContent = `${st.project.name} · ${f.name}`; // project names come from files: text only
  tip.hidden = false;
  const w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = `${Math.min(e.clientX + 16, innerWidth - w - 12)}px`;
  tip.style.top = `${Math.min(e.clientY + 16, innerHeight - h - 12)}px`;
  uniforms.uHover.value = st.index;
}
canvas.addEventListener('pointermove', (e) => {
  if (document.body.classList.contains('replaying')) return; // the replay owns the highlighted star
  if (e.buttons) return hideTip();
  const st = pick(e);
  st ? showTip(st, e) : hideTip();
  canvas.style.cursor = st ? 'pointer' : '';
});
canvas.addEventListener('pointerleave', hideTip);
canvas.addEventListener('pointerdown', (e) => (downAt = { x: e.clientX, y: e.clientY }));
canvas.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 6) return;
  const st = pick(e);
  if (!st) return hideTip();
  // First tap flies to the project; once there, a tap replays that session (or shows the numbers if it can't).
  if (controls.target.distanceTo(st.project.center) > 1) { hideTip(); flyTo(st.project); }
  else if (canReplay(st)) { hideTip(); replay(st); }
  else showTip(st, e);
});

// ---------- replays

let source: 'demo' | 'yours' | 'file' | 'public' = 'demo';
const canReplay = (st: Star) => !embed && (source === 'demo' || (source === 'yours' && !!st.session.key));

async function replay(st: Star) {
  let events: ReplayEvent[];
  if (source === 'demo') {
    events = demoReplay(st.session, hash(st.session.project + st.session.start));
  } else {
    try {
      const res = await fetch(`./replay/${st.session.key}.json`, { cache: 'no-store' });
      const body: unknown = res.ok ? await res.json() : null;
      if (!Array.isArray(body)) throw new Error();
      events = body as ReplayEvent[];
    } catch {
      return toast('Could not load that replay. Is the local CLI still running?');
    }
  }
  const own = stars.filter((s) => s.session === st.session); // in time order
  openReplay({
    session: st.session, events, startAt: st.turn.t,
    title: `${st.project.name} · ${family(st.session.model).name}`,
    // Light up the prompt the replay has reached.
    onMove: (e) => { uniforms.uHover.value = (own.findLast((s) => s.turn.t <= e.t) ?? own[0])!.index; },
    onClose: () => { uniforms.uHover.value = -1; },
  });
}

// ---------- loading data

const toast = (msg: string) => {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout((toast as any).timer);
  (toast as any).timer = setTimeout(() => (t.hidden = true), 6000);
};
function setMode(kind: typeof source) {
  source = kind;
  const m = $('mode');
  m.className = `mode ${kind}`;
  m.textContent = {
    demo: 'Demo data · click a star twice to replay · load your own →',
    yours: 'Your sky · local only · click a star twice to replay',
    file: 'Loaded file · stays in this tab',
    public: 'Public sky · totals only',
  }[kind];
}
async function loadFile(file: File) {
  try {
    build(validate(JSON.parse(await file.text())));
    setMode('file');
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Could not read that file.');
  }
}
$<HTMLInputElement>('file').addEventListener('change', (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (f) loadFile(f);
});
const drop = $('drop');
addEventListener('dragover', (e) => { e.preventDefault(); drop.hidden = false; });
addEventListener('dragleave', (e) => { if (!e.relatedTarget) drop.hidden = true; });
addEventListener('drop', (e) => {
  e.preventDefault();
  drop.hidden = true;
  const f = e.dataTransfer?.files[0];
  if (f) loadFile(f);
});

async function start() {
  // ?sky=<name> shows a published totals file from ./skies/, such as the portfolio hero's.
  const name = params.get('sky');
  if (name && /^[a-z0-9-]{1,40}$/.test(name)) {
    try {
      const res = await fetch(`./skies/${name}.json`);
      if (res.ok) { build(validate(await res.json())); setMode('public'); return; }
    } catch { /* fall through to the demo */ }
  }
  // The local CLI serves your totals at ./sessions.json; GitHub Pages has none, so it shows the demo.
  if (!params.has('demo')) {
    try {
      const res = await fetch('./sessions.json', { cache: 'no-store' });
      if (res.ok) { build(validate((await res.json()) as Sky)); setMode('yours'); return; }
    } catch { /* no local data: fall through to the demo */ }
  }
  build(demoSky());
  setMode('demo');
}

// ---------- loop

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  labels.setSize(innerWidth, innerHeight);
  setScale();
});

let last = performance.now();
renderer.setAnimationLoop((t: number) => {
  const dt = Math.min(0.05, (t - last) / 1000);
  last = t;
  if (playing) {
    setNow(now + dt / PLAY_SECONDS);
    if (now >= 1) setPlaying(false);
  }
  if (!reduced) uniforms.uClock.value = t / 1000;
  if (tween) {
    tween.t = Math.min(1, tween.t + dt / tween.dur);
    const k = ease(tween.t);
    camera.position.lerpVectors(tween.from, tween.to, k);
    controls.target.lerpVectors(tween.fromT, tween.toT, k);
    if (tween.t >= 1) tween = null;
  }
  for (const p of projects) {
    const on = now + 1e-6 >= p.firstBirth;
    p.label.element.classList.toggle('on', on);
    const m = p.nebula.material;
    m.opacity += ((on ? 0.045 : 0) - m.opacity) * Math.min(1, dt * 2);
  }
  controls.update();
  composer.render();
  labels.render(scene, camera);
});

start();
