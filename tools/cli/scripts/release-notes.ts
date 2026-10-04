/** Maintainer-written release outcomes precede generated API and PR details. */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

const ROOT = resolve(import.meta.dir, '../../..');

export function releaseNotesPath(version: string): string {
  if (!/^v\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version)) {
    throw new Error('Release notes require an exact version such as v1.2.3');
  }
  return `.github/release-notes/${version}.md`;
}

export function validateReleaseNotes(raw: string): string {
  const notes = raw.replace(/\r\n/g, '\n').trim();
  const headings = [...notes.matchAll(/^## (.+)$/gm)];
  for (const name of ['Highlights', 'Upgrade notes']) {
    const matches = headings.filter((heading) => heading[1] === name);
    if (matches.length !== 1) {
      throw new Error(`Release notes need exactly one "## ${name}" section`);
    }
    const match = matches[0];
    const next = headings.find((heading) => heading.index > match.index);
    const body = notes.slice(match.index + match[0].length, next?.index).trim();
    if (
      !body.replace(/<!--[\s\S]*?-->/g, '').replace(/[\s*_-]/g, '') ||
      /\b(?:TODO|TBD)\b/.test(body)
    ) {
      throw new Error(`Release notes need authored text in "## ${name}"`);
    }
  }
  if (notes.indexOf('## Highlights') > notes.indexOf('## Upgrade notes')) {
    throw new Error('Highlights must precede Upgrade notes');
  }
  return `${notes}\n`;
}

export function composeReleaseNotes(
  authored: string,
  contract: string,
): string {
  if (!contract.trim())
    throw new Error('Generated API contract notes are empty');
  return `${validateReleaseNotes(authored).trim()}\n\n${contract.trim()}\n`;
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      version: { type: 'string' },
      contract: { type: 'string' },
      out: { type: 'string' },
    },
    strict: true,
  });
  if (Boolean(values.contract) !== Boolean(values.out)) {
    throw new Error('--contract and --out must be supplied together');
  }
  const path = releaseNotesPath(values.version ?? '');
  const authored = validateReleaseNotes(
    await readFile(resolve(ROOT, path), 'utf8'),
  );
  if (values.contract && values.out) {
    await writeFile(
      values.out,
      composeReleaseNotes(authored, await readFile(values.contract, 'utf8')),
    );
  } else {
    console.log(`Validated ${path}`);
  }
}
