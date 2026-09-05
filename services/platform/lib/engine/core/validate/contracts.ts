/**
 * Contract validation against the registry and the store, plus document
 * quality.
 *
 * Connector inputs are checked statically against their JSON Schemas:
 * value judgments are skipped exactly where a template resolves at runtime,
 * while missing required fields and unknown properties are always decidable.
 * Subautomation references must parse and, when a store is installed, resolve.
 *
 * The output-typing rule guards the one bridge from text to data: an
 * unstructured node exposes only `.output.text`, and an llm node becomes
 * structured exactly by declaring an `outputSchema`.
 */

import type { ErrorObject } from 'ajv';

import { isRecord } from '../../../utils/type-utils';
import { err, warn } from '../errors';
import { nodeTypes, storeAdapter, type ConnectorLike } from '../slots';
import { refsInSource, templateExprsIn, TPL_RE } from '../template';
import type { Issue, NodeDef } from '../types';
import { NAME_RE } from './document';
import { exprSourcesOf } from './references';
import { compileSchema } from './schema';
import { closestName } from './similar';

/** ajv keywords that judge a VALUE — unknowable where the value is still a
 * template; structural keywords (required, additionalProperties) stay. */
const VALUE_KEYWORDS = new Set([
  'type',
  'enum',
  'const',
  'pattern',
  'format',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'minLength',
  'maxLength',
  'multipleOf',
  'minItems',
  'maxItems',
]);

/** `nodes.x.output.<field>` — the shape the output-typing rule inspects. */
const OUTPUT_PATH_RE =
  /\bnodes\s*\.\s*([A-Za-z_$][\w$]*)\s*\??\.\s*output\s*\??\.\s*([A-Za-z_$][\w$]*)/g;

function parseAutomationRef(
  ref: string,
): { name: string; version?: number } | null {
  const [name, version, ...rest] = ref.split('@');
  if (rest.length > 0 || !NAME_RE.test(name)) return null;
  if (version === undefined) return { name };
  if (!/^\d+$/.test(version)) return null;
  return { name, version: Number(version) };
}

function checkConnectorInput(
  n: NodeDef,
  input: Record<string, unknown>,
  connector: ConnectorLike,
  issues: Issue[],
): void {
  // Every path holding a template string is resolved at runtime — its value
  // is statically unknowable, so value keywords are skipped there.
  const templatePaths = new Set<string>();
  const collect = (v: unknown, path: string): void => {
    if (typeof v === 'string') {
      if ([...v.matchAll(TPL_RE)].length > 0) templatePaths.add(path);
    } else if (Array.isArray(v)) {
      for (const [i, item] of v.entries()) collect(item, `${path}/${i}`);
    } else if (isRecord(v)) {
      for (const [k, item] of Object.entries(v)) collect(item, `${path}/${k}`);
    }
  };
  collect(input, '');

  let check;
  try {
    check = compileSchema(connector.inputSchema);
  } catch (e) {
    console.warn(
      `[engine] skipping input check for "${n.type}" (invalid connector schema):`,
      e instanceof Error ? e.message : e,
    );
    return;
  }
  if (check(input)) return;

  const schemaProps = isRecord(connector.inputSchema.properties)
    ? Object.keys(connector.inputSchema.properties)
    : [];
  for (const e of check.errors ?? []) {
    if (templatePaths.has(e.instancePath) && VALUE_KEYWORDS.has(e.keyword)) {
      continue;
    }
    const extra = additionalProperty(e);
    const close =
      extra === undefined ? undefined : closestName(extra, schemaProps);
    issues.push(
      err(
        'CONNECTOR_INPUT_INVALID',
        `node "${n.id}" (${n.type}): input${e.instancePath} ${e.message ?? 'is invalid'}${extra === undefined ? '' : ` ("${extra}")`}`,
        {
          nodeId: n.id,
          path: e.instancePath || undefined,
          hint: `${close === undefined ? '' : `did you mean "${close}"? `}schema: ${JSON.stringify(connector.inputSchema)}`,
        },
      ),
    );
  }
}

function additionalProperty(e: ErrorObject): string | undefined {
  if (e.keyword !== 'additionalProperties') return undefined;
  const name: unknown = e.params.additionalProperty;
  return typeof name === 'string' ? name : undefined;
}

export async function validateContracts(
  doc: Record<string, unknown>,
  validNodes: NodeDef[],
  issues: Issue[],
): Promise<void> {
  // Duplicate ids already carry their own error; contract checks run once
  // per id, on the first occurrence.
  const byId = new Map<string, NodeDef>();
  const unique: NodeDef[] = [];
  for (const n of validNodes) {
    if (byId.has(n.id)) continue;
    byId.set(n.id, n);
    unique.push(n);
  }

  const store = storeAdapter();
  // undefined = not fetched yet; null = no store, or the store failed (a
  // backend outage is not a document problem — resolution is skipped).
  let names: Array<{ name: string; latest: number }> | null | undefined;
  const storeNames = async (): Promise<typeof names> => {
    if (names !== undefined) return names;
    if (!store) {
      names = null;
      return names;
    }
    try {
      names = await store.list();
    } catch (e) {
      console.warn(
        '[engine] skipping subautomation resolution (store list failed):',
        e instanceof Error ? e.message : e,
      );
      names = null;
    }
    return names;
  };

  for (const n of unique) {
    const def = nodeTypes().get(n.type);

    if (def?.connector && isRecord(n.input)) {
      checkConnectorInput(n, n.input, def.connector, issues);
    }

    if (n.type === 'subautomation' && typeof n.automation === 'string') {
      const parsed = parseAutomationRef(n.automation);
      if (parsed === null) {
        issues.push(
          err(
            'SUBAUTOMATION_REF_INVALID',
            `node "${n.id}": "automation" must be "name" or "name@version" (got ${JSON.stringify(n.automation)})`,
            {
              nodeId: n.id,
              hint: 'e.g. "automation": "daily-digest" or "daily-digest@2"',
            },
          ),
        );
        continue;
      }
      const known = await storeNames();
      if (known === null || known === undefined) continue;
      const entry = known.find((w) => w.name === parsed.name);
      if (entry === undefined) {
        const close = closestName(
          parsed.name,
          known.map((w) => w.name),
        );
        issues.push(
          err(
            'SUBAUTOMATION_NOT_FOUND',
            `node "${n.id}": no saved automation named "${parsed.name}"`,
            {
              nodeId: n.id,
              hint:
                known.length > 0
                  ? `${close === undefined ? '' : `did you mean "${close}"? `}saved automations: ${known.map((w) => w.name).join(', ')}`
                  : 'no automations are saved yet',
            },
          ),
        );
      } else if (store) {
        try {
          const got = await store.get(parsed.name, parsed.version);
          if (got === null) {
            if (parsed.version !== undefined) {
              issues.push(
                err(
                  'SUBAUTOMATION_NOT_FOUND',
                  `node "${n.id}": automation "${parsed.name}" has no version ${parsed.version}`,
                  { nodeId: n.id, hint: `latest version: ${entry.latest}` },
                ),
              );
            }
          } else {
            checkSubautomationBody(n, parsed.name, got.automation, issues);
          }
        } catch (e) {
          console.warn(
            '[engine] skipping subautomation body check (store get failed):',
            e instanceof Error ? e.message : e,
          );
        }
      }
    }
  }

  // Every reference source in the document, node by node plus the output.
  const allSources: Array<{ src: string; nodeId?: string }> = [];
  for (const n of unique) {
    for (const { src } of exprSourcesOf(n))
      allSources.push({ src, nodeId: n.id });
  }
  if (doc.output !== undefined) {
    for (const e of templateExprsIn(doc.output)) allSources.push({ src: e });
  }

  // The output-typing rule: pathing into an unstructured output beyond
  // `.text` reads a field that will never exist.
  for (const { src, nodeId } of allSources) {
    for (const m of src.matchAll(OUTPUT_PATH_RE)) {
      const target = byId.get(m[1]);
      if (target === undefined) continue;
      const targetDef = nodeTypes().get(target.type);
      if (targetDef === undefined || targetDef.outputKind !== 'unstructured')
        continue;
      // An llm node with an outputSchema yields the schema-shaped object.
      if (target.outputSchema !== undefined) continue;
      if (m[2] === 'text') continue;
      issues.push(
        err(
          'REF_UNSTRUCTURED_PATH',
          `${nodeId === undefined ? 'output' : `node "${nodeId}"`}: "nodes.${m[1]}.output.${m[2]}" — node "${target.id}" (${target.type}) returns unstructured text; only .output.text exists`,
          {
            nodeId,
            hint:
              target.type === 'llm'
                ? `give "${target.id}" an outputSchema to get structured output, or read nodes.${target.id}.output.text`
                : `read nodes.${target.id}.output.text, or bridge through an llm node with an outputSchema`,
          },
        ),
      );
    }
  }

  // Document quality.
  if (doc.output === undefined) {
    issues.push(
      warn(
        'OUTPUT_MISSING',
        'automation has no "output" — it will return null',
        {
          hint: 'e.g. "output": "{{ nodes.<id>.output }}"',
        },
      ),
    );
  }

  const referenced = new Set<string>();
  for (const { src } of allSources) {
    for (const r of refsInSource(src)) referenced.add(r);
  }
  // An elseOf partner is structurally load-bearing even when nobody reads it.
  for (const n of unique) {
    if (typeof n.elseOf === 'string') referenced.add(n.elseOf);
  }

  const last = unique.at(-1);
  for (const n of unique) {
    // The final node conventionally feeds the output; flagging it while the
    // author is still wiring `output` would be noise.
    if (n === last) continue;
    if (referenced.has(n.id)) continue;
    if (nodeTypes().get(n.type)?.connector?.hasEffect) continue;
    issues.push(
      warn(
        'UNUSED_NODE',
        `output of node "${n.id}" is never used (not referenced by any node or by the automation output)`,
        {
          nodeId: n.id,
          hint: `reference nodes.${n.id}.output somewhere, or remove the node`,
        },
      ),
    );
  }
}

/**
 * What a subautomation's body may not contain. Its nodes run inline as ONE
 * step of the parent, on a sink that cannot park the run — so a live `agent`
 * node (an asynchronous turn spanning suspensions) can never run there, and
 * a connector write the approval policy gates fails the run instead of
 * waiting for a person. The runtime refuses both before spending anything;
 * this says so at save time, where the author can still move the node.
 *
 * One level only: the referenced document's own `nodes` are inspected, not
 * the subautomations THEY reference — a nested offender is still refused by
 * the runtime guards, just without the save-time hint.
 */
function checkSubautomationBody(
  n: NodeDef,
  name: string,
  body: unknown,
  issues: Issue[],
): void {
  if (!isRecord(body) || !Array.isArray(body.nodes)) return;
  for (const sub of body.nodes) {
    if (!isRecord(sub) || typeof sub.type !== 'string') continue;
    const subId = typeof sub.id === 'string' ? sub.id : '?';
    if (sub.type === 'agent') {
      issues.push(
        err(
          'SUBAUTOMATION_HAS_AGENT_NODE',
          `node "${n.id}": automation "${name}" contains an agent node ("${subId}") — a live agent turn cannot run inside a subautomation`,
          {
            nodeId: n.id,
            hint: 'hoist the agent node into the calling automation and pass its result to the subautomation as input',
          },
        ),
      );
      continue;
    }
    if (nodeTypes().get(sub.type)?.connector?.hasEffect === true) {
      issues.push(
        warn(
          'SUBAUTOMATION_HAS_WRITE',
          `node "${n.id}": automation "${name}" performs a write ("${subId}": ${sub.type}) — a subautomation cannot wait for approval, so the run fails when the approval policy asks a person to release it`,
          {
            nodeId: n.id,
            hint: `hoist the write into the calling automation, or allow ${sub.type} without approval in the approval policy`,
          },
        ),
      );
    }
  }
}
