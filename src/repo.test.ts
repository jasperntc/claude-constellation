import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { repoName } from './repo.ts';

test('repoName walks up to the git repo, but never to the home folder', () => {
  const home = mkdtempSync(join(tmpdir(), 'cc-home-'));
  const repo = join(home, 'code', 'my-app');
  mkdirSync(join(repo, '.git'), { recursive: true });
  mkdirSync(join(repo, 'site', 'deep'), { recursive: true });
  mkdirSync(join(repo, '.claude', 'worktrees', 'wt'), { recursive: true });
  writeFileSync(join(repo, '.claude', 'worktrees', 'wt', '.git'), 'gitdir: elsewhere'); // worktrees have a .git file
  mkdirSync(join(home, '.git')); // a dotfiles repo in home
  mkdirSync(join(home, 'notes', 'sub'), { recursive: true });

  assert.equal(repoName(repo, home), 'my-app');
  assert.equal(repoName(join(repo, 'site', 'deep'), home), 'my-app');
  assert.equal(repoName(join(repo, '.claude', 'worktrees', 'wt'), home), 'my-app');
  assert.equal(repoName(join(home, 'notes', 'sub'), home), 'sub', 'home dotfiles repo must not claim it');
  assert.equal(repoName(join(home, 'gone', 'deleted-folder'), home), 'deleted-folder');
  assert.equal(repoName('C:/Users/me/AppData/Claude/scratch-workspaces/a/scratch-1', home), 'scratch');
});
