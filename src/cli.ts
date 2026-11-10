#!/usr/bin/env node
import { createReadStream, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { addLine, newAcc, toSession, type Acc, type Session, type Sky } from './extract.ts';
import { repoName } from './repo.ts';
import { buildReplay, makeRedact, type ReplayEvent } from './replay.ts';

const fail = (msg: string): never => { console.error(msg); process.exit(1); };

const { values: args } = (() => {
  try {
    return parseArgs({ options: {
    out: { type: 'string', short: 'o' },
    exclude: { type: 'string', short: 'x' },
    dir: { type: 'string' },
    port: { type: 'string', default: '4173' },
    'no-open': { type: 'boolean' },
    demo: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
    } });
  } catch (err) {
    return fail(`${(err as Error).message}
Run with --help to see the options.`);
  }
})();

const port = Number(args.port);
if (!Number.isInteger(port) || port < 1 || port > 65535) fail(`--port must be a whole number from 1 to 65535, not "${args.port}".`);

if (args.help) {
  console.log(`claude-constellation: your Claude Code sessions as a 3D night sky

  (no flags)          read ~/.claude/projects and open your sky on http://localhost:4173
  -o, --out <file>    write the session totals to a JSON file instead of serving
  -x, --exclude a,b   leave these projects out (for example client work)
  --dir <path>        read transcripts from another folder
  --port <n>          port for the local page (default 4173)
  --no-open           don't open a browser
  --demo              serve the page with made-up demo data

Only totals leave your transcripts: token counts, dates, model and folder name. No prompts, code or paths.`);
  process.exit(0);
}

async function readLines(file: string, acc: Acc, sidechain: boolean) {
  try {
    const rl = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity });
    for await (const line of rl) if (line) addLine(acc, line, sidechain);
  } catch (err) {
    // One locked or unreadable transcript shouldn't cost you the whole sky.
    console.warn(`Skipped ${file}: ${(err as Error).message}`);
  }
}

const jsonl = (dir: string) =>
  existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => join(dir, f)) : [];

const fileOf = new Map<Session, string>(); // where each session's transcript lives, for replays

async function extract(root: string): Promise<Session[]> {
  const sessions: Session[] = [];
  for (const folder of readdirSync(root, { withFileTypes: true })) {
    if (!folder.isDirectory()) continue;
    const projectDir = join(root, folder.name);
    const fallback = folder.name.split('-').at(-1) || 'unknown';
    for (const file of jsonl(projectDir)) {
      const acc = newAcc();
      await readLines(file, acc, false);
      // Subagent transcripts live in <session id>/subagents/ and add to their parent session's cost.
      for (const sub of jsonl(join(file.slice(0, -'.jsonl'.length), 'subagents'))) await readLines(sub, acc, true);
      const s = toSession(acc, fallback, repoName);
      if (s) { sessions.push(s); fileOf.set(s, file); }
    }
  }
  return sessions.sort((a, b) => a.start.localeCompare(b.start));
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};

function serve(sky: Sky | null) {
  const site = resolve(import.meta.dirname, '..', 'site');
  // The local page gets a key per session so it can ask for that session's replay; --out files never carry keys.
  const files = sky?.sessions.map((s) => fileOf.get(s)) ?? [];
  const served = sky && JSON.stringify({ ...sky, sessions: sky.sessions.map((s, i) => ({ ...s, key: String(i) })) });
  const mask = makeRedact(homedir());
  const replays = new Map<string, string>();
  const hosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`]);
  const server = createServer((req, res) => {
    // DNS rebinding guard: a web page that points its own hostname at 127.0.0.1 still sends its own Host header.
    if (!hosts.has(req.headers.host ?? '')) return void res.writeHead(403).end('Forbidden');
    const headers = { 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' };
    try {
      const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
      if (path === '/sessions.json') {
        if (!served) return void res.writeHead(404, headers).end();
        return void res.writeHead(200, { ...headers, 'content-type': TYPES['.json']! }).end(served);
      }
      const replay = /^\/replay\/(\d{1,6})\.json$/.exec(path);
      if (replay) {
        const file = files[Number(replay[1])];
        if (!file) return void res.writeHead(404, headers).end();
        let body = replays.get(file);
        if (!body) {
          const events: ReplayEvent[] = buildReplay(readFileSync(file, 'utf8').split('\n'), mask);
          replays.set(file, (body = JSON.stringify(events)));
        }
        return void res.writeHead(200, { ...headers, 'content-type': TYPES['.json']! }).end(body);
      }
      const file = resolve(site, '.' + (path.endsWith('/') ? path + 'index.html' : path));
      if (!file.startsWith(site + sep) || !existsSync(file) || !statSync(file).isFile()) return void res.writeHead(404, headers).end('Not found');
      res.writeHead(200, { ...headers, 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
    } catch {
      res.writeHead(400, headers).end('Bad request'); // a malformed URL must not take the server down
    }
  });
  server.on('error', (err) => fail(`Could not start the page on port ${port}: ${err.message}`));
  // Loopback only: the page carries your usage, so nothing else on the network should reach it.
  server.listen(port, '127.0.0.1', () => {
    const url = `http://localhost:${port}/`;
    console.log(`Your sky is at ${url}  (Ctrl+C to stop)`);
    if (args['no-open']) return;
    const [cmd, ...rest] = process.platform === 'win32' ? ['cmd', '/c', 'start', '""', url]
      : process.platform === 'darwin' ? ['open', url] : ['xdg-open', url];
    spawn(cmd!, rest, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
  });
}

if (args.demo) {
  serve(null);
} else {
  const root = args.dir ?? join(homedir(), '.claude', 'projects');
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    console.error(`No transcripts at ${root}. Run Claude Code once, or pass --dir.`);
    process.exit(1);
  }
  const skip = new Set((args.exclude ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
  const sessions = (await extract(root)).filter((s) => !skip.has(s.project.toLowerCase()));
  const sky: Sky = { generatedAt: new Date().toISOString(), sessions };
  const projects = new Set(sessions.map((s) => s.project)).size;
  console.log(`Found ${sessions.length} sessions across ${projects} projects.`);
  if (args.out) {
    writeFileSync(args.out, JSON.stringify(sky, null, 2));
    console.log(`Wrote ${args.out}. Drop it on the page to view it.`);
  } else {
    serve(sky);
  }
}
