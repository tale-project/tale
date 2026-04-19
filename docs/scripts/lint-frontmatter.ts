#!/usr/bin/env bun
// Verifies every Mintlify doc file has a YAML frontmatter block with `title` and
// `description` keys. Exits non-zero on failure so it can gate CI.

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = dirname(fileURLToPath(import.meta.url));
const DOCS = dirname(currentDir);

const SKIP_DIRS = new Set(['node_modules', 'scripts', 'images']);
// Meta files under docs/ that are not Mintlify pages and should not need frontmatter.
const SKIP_FILES = new Set(['AGENTS.md', 'README.md', 'CONTRIBUTING.md']);

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, out);
    else if (
      (entry.name.endsWith('.md') || entry.name.endsWith('.mdx')) &&
      !SKIP_FILES.has(entry.name)
    )
      out.push(full);
  }
  return out;
}

const errors: string[] = [];
for (const file of await walk(DOCS)) {
  // Normalize CRLF → LF so Windows-authored files don't trip the checks below.
  const content = (await readFile(file, 'utf8')).replaceAll('\r\n', '\n');
  if (!content.startsWith('---\n')) {
    errors.push(`${file}: missing frontmatter block`);
    continue;
  }
  const end = content.indexOf('\n---\n', 4);
  if (end === -1) {
    errors.push(`${file}: unterminated frontmatter block`);
    continue;
  }
  const frontmatter = content.slice(4, end);
  if (!/^title:\s*\S/m.test(frontmatter))
    errors.push(`${file}: missing 'title'`);
  if (!/^description:\s*\S/m.test(frontmatter))
    errors.push(`${file}: missing 'description'`);
}

if (errors.length > 0) {
  console.error(`Frontmatter lint failed (${errors.length} issue(s)):`);
  for (const e of errors) console.error('  ' + e);
  process.exit(1);
}
console.log('Frontmatter lint passed.');
