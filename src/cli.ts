#!/usr/bin/env node
import { createReadStream, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { addLine, newAcc, toSession, type Acc, type Session, type Sky } from './extract.ts';

const { values: args } = parseArgs({
  options: {
    out: { type: 'string', short: 'o' },
    exclude: { type: 'string', short: 'x' },
    dir: { type: 'string' },
    port: { type: 'string', default: '4173' },
    'no-open': { type: 'boolean' },
    demo: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
});

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
  const rl = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) if (line) addLine(acc, line, sidechain);
}

const jsonl = (dir: string) =>
  existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => join(dir, f)) : [];

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
      const s = toSession(acc, fallback);
      if (s) sessions.push(s);
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
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    if (path === '/sessions.json') {
      if (!sky) return void res.writeHead(404).end();
      return void res.writeHead(200, { 'content-type': TYPES['.json']! }).end(JSON.stringify(sky));
    }
    const file = resolve(site, '.' + (path.endsWith('/') ? path + 'index.html' : path));
    if (!file.startsWith(site + sep) || !existsSync(file)) return void res.writeHead(404).end('Not found');
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
  });
  // Loopback only: the page carries your usage, so nothing else on the network should reach it.
  server.listen(Number(args.port), '127.0.0.1', () => {
    const url = `http://localhost:${args.port}/`;
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
  if (!existsSync(root)) {
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
