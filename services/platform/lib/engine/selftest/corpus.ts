/**
 * The automation documents the repository ships, for the suites that hold a
 * rule over every one of them: each pack under
 * configs/platform/custom/automations (read by THE pack reader), the worked
 * example of get_docs, the documents the blank-automation wizard saves, and
 * every complete document (a named one with nodes) in the English platform
 * docs. Each comes back as plain JSON data, a copy its suite may change.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { blankAutomationDocument } from '../../automations/blank-document';
import { loadAutomationPacks } from '../../automations/packs';
import { parseYaml } from '../../shared/config/yaml';
import { isRecord } from '../../utils/type-utils';
import { DOC_EXAMPLE } from '../api/docs';

const REPO = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../..',
);

export interface ShippedDocument {
  label: string;
  document: Record<string, unknown>;
}

function plain(value: unknown): Record<string, unknown> | null {
  const copy: unknown = JSON.parse(JSON.stringify(value));
  return isRecord(copy) &&
    typeof copy.name === 'string' &&
    Array.isArray(copy.nodes)
    ? copy
    : null;
}

function markdownFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...markdownFiles(full));
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out.sort();
}

/** Every shipped document, labelled by where it comes from. */
export function shippedDocuments(): ShippedDocument[] {
  const out: ShippedDocument[] = [];
  const labels = new Map<string, number>();
  const push = (label: string, document: Record<string, unknown>): void => {
    // Two snippets of one page may show the same document name.
    const seen = (labels.get(label) ?? 0) + 1;
    labels.set(label, seen);
    out.push({ label: seen === 1 ? label : `${label} #${seen}`, document });
  };
  const add = (label: string, value: unknown): void => {
    const document = plain(value);
    if (document === null) throw new Error(`${label} is not a document`);
    push(label, document);
  };
  for (const pack of loadAutomationPacks({
    root: path.join(REPO, 'configs/platform/custom'),
  })) {
    add(`pack ${pack.slug}`, pack.automation);
  }
  add('get_docs example', DOC_EXAMPLE.automation);
  const wizard = {
    slug: 'support/triage-inbox',
    model: 'openai/gpt-4o',
    modelProvider: '',
    prompt: 'Sort the new messages and draft a reply to each.',
    skills: [],
    connectors: [],
    tools: [],
    secrets: [],
  };
  add('blank wizard scaffold', blankAutomationDocument(wizard));
  add(
    'blank wizard scaffold, equipped',
    blankAutomationDocument({
      ...wizard,
      modelProvider: 'openrouter',
      skills: ['reply-style'],
      connectors: ['gmail'],
      tools: ['web_search'],
      secrets: ['SUPPORT_SIGNATURE'],
    }),
  );
  for (const file of markdownFiles(path.join(REPO, 'docs/en/platform'))) {
    const text = readFileSync(file, 'utf8');
    for (const block of text.matchAll(/```ya?ml\n([\s\S]*?)```/g)) {
      // A snippet that is not YAML on its own (an excerpt) is no document.
      const parsed = parseYaml(block[1] ?? '');
      const document = parsed.ok ? plain(parsed.data) : null;
      if (document !== null) {
        push(
          `docs ${path.relative(REPO, file)} ${String(document.name)}`,
          document,
        );
      }
    }
  }
  return out;
}
