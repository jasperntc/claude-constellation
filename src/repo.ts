import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { projectName } from './extract.ts';

const cache = new Map<string, string>();

/**
 * Names a folder by the git repo that contains it, so work in `repo/site` counts as `repo`.
 * Falls back to projectName() for folders that aren't in a repo or no longer exist.
 */
export function repoName(cwd: string, home = homedir()): string {
  const hit = cache.get(cwd);
  if (hit) return hit;
  let name = projectName(cwd);
  if (name !== 'scratch') {
    const path = cwd.split(/[\\/]\.claude[\\/]worktrees[\\/]/)[0]!;
    // Git Bash records C:\x as /c/x.
    const native = process.platform === 'win32' ? path.replace(/^\/([a-z])(?=\/|$)/i, (_, d: string) => `${d.toUpperCase()}:`) : path;
    // Stop below the home folder: a dotfiles repo there would otherwise claim every folder.
    for (let dir = resolve(native); dir !== dirname(dir) && dir !== resolve(home); dir = dirname(dir)) {
      if (existsSync(join(dir, '.git'))) { name = basename(dir); break; }
    }
  }
  cache.set(cwd, name);
  return name;
}
