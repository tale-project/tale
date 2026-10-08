// @vitest-environment node

/**
 * The parser-based graph on every automation document the repository ships:
 * the canvas draws exactly the edges the executor orders by, the ordering is
 * the one the pattern scanners produced before (no shipped automation runs in
 * a different order), and every shipped document still validates clean.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { deriveEdges } from '@/app/features/automations/lib/graph';

import { loadConnectors } from '../../../connectors/registry';
import { DOC_EXAMPLE } from '../../api/docs';
import { nodeVmRunner } from '../../runners/node-vm';
import { refsOf, topoSort } from '../execute/controlflow';
import { setCodeRunner } from '../runner';
import type { Automation, NodeDef } from '../types';
import { validate } from '../validate';

const REPO = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../../..',
);
const PACKS = path.join(REPO, 'configs/platform/custom/automations');

function shippedDocuments(): Array<[string, Automation]> {
  const out: Array<[string, Automation]> = [];
  const dirs = (dir: string) =>
    readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  for (const provider of dirs(PACKS)) {
    for (const pack of dirs(path.join(PACKS, provider))) {
      const file = path.join(PACKS, provider, pack, 'workflow.yml');
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shipped packs are v1 documents; validate() below re-checks every one
      out.push([
        `${provider}/${pack}`,
        parse(readFileSync(file, 'utf8')) as Automation,
      ]);
    }
  }
  out.push(['DOC_EXAMPLE', DOC_EXAMPLE.automation]);
  return out;
}

/** The pattern scanners the parser replaced, kept as the ordering oracle. */
function legacyRefsOf(n: NodeDef): { order: Set<string>; data: Set<string> } {
  const tpl = /\{\{([\s\S]+?)\}\}/g;
  const dot = /\bnodes\s*\.\s*([A-Za-z_$][\w$]*)/g;
  const bracket = /\bnodes\s*\[\s*["']([^"']+)["']\s*\]/g;
  const exprsIn = (v: unknown): string[] => {
    if (typeof v === 'string') return [...v.matchAll(tpl)].map((m) => m[1]);
    if (Array.isArray(v)) return v.flatMap(exprsIn);
    if (v !== null && typeof v === 'object')
      return Object.values(v).flatMap(exprsIn);
    return [];
  };
  const order = new Set<string>();
  const data = new Set<string>();
  const add = (src: string, control: boolean) => {
    for (const m of [...src.matchAll(dot), ...src.matchAll(bracket)]) {
      order.add(m[1]);
      if (!control) data.add(m[1]);
    }
  };
  for (const e of exprsIn(n.input)) add(e, false);
  for (const e of exprsIn(n.prompt)) add(e, false);
  for (const e of exprsIn(n.system)) add(e, false);
  if (typeof n.code === 'string') add(n.code, false);
  for (const e of exprsIn(n.forEach)) add(e, false);
  for (const f of [n.when, n.repeatUntil]) {
    if (typeof f !== 'string') continue;
    const exprs = exprsIn(f);
    for (const e of exprs.length > 0 ? exprs : [f]) add(e, true);
  }
  if (typeof n.elseOf === 'string') order.add(n.elseOf);
  return { order, data };
}

const sorted = (s: Set<string>) => [...s].sort();

beforeAll(() => {
  setCodeRunner(nodeVmRunner());
  loadConnectors(path.join(REPO, 'configs/platform/system'));
});

describe('the shipped automation corpus', () => {
  const corpus = shippedDocuments();

  it('is not empty', () => {
    expect(corpus.length).toBeGreaterThan(5);
  });

  it.each(corpus)(
    '%s: the canvas draws exactly the edges the executor orders by',
    (_, doc) => {
      const ids = new Set(doc.nodes.map((n) => n.id));
      const drawn = new Map<string, string[]>();
      for (const edge of deriveEdges(doc.nodes)) {
        drawn.set(edge.target, [
          ...(drawn.get(edge.target) ?? []),
          edge.source,
        ]);
      }
      for (const n of doc.nodes) {
        const ordered = [...refsOf(n).order].filter(
          (r) => ids.has(r) && r !== n.id,
        );
        expect(sorted(new Set(drawn.get(n.id) ?? []))).toEqual(
          sorted(new Set(ordered)),
        );
      }
      expect(topoSort(doc.nodes)).not.toBeNull();
    },
  );

  it.each(corpus)(
    '%s: runs in the order the pattern scanners gave it',
    (_, doc) => {
      for (const n of doc.nodes) {
        const now = refsOf(n);
        const before = legacyRefsOf(n);
        expect({
          node: n.id,
          order: sorted(now.order),
          data: sorted(now.data),
        }).toEqual({
          node: n.id,
          order: sorted(before.order),
          data: sorted(before.data),
        });
      }
      expect(topoSort(doc.nodes)?.map((n) => n.id)).toEqual(
        // The legacy order, recomputed with the legacy references.
        legacyTopoSort(doc.nodes),
      );
    },
  );

  it.each(corpus)(
    '%s: validates without errors or unterminated templates',
    async (_, doc) => {
      const { errors, warnings } = await validate(doc);
      expect(errors).toEqual([]);
      expect(
        warnings.filter((w) => w.code === 'TEMPLATE_UNTERMINATED'),
      ).toEqual([]);
    },
  );
});

function legacyTopoSort(nodes: NodeDef[]): string[] | undefined {
  const ids = new Set(nodes.map((n) => n.id));
  const deps = new Map(
    nodes.map((n) => [
      n.id,
      [...legacyRefsOf(n).order].filter((r) => ids.has(r) && r !== n.id),
    ]),
  );
  const done = new Set<string>();
  const out: string[] = [];
  while (out.length < nodes.length) {
    const next = nodes.find(
      (n) =>
        !done.has(n.id) && (deps.get(n.id) ?? []).every((d) => done.has(d)),
    );
    if (next === undefined) return undefined;
    done.add(next.id);
    out.push(next.id);
  }
  return out;
}
