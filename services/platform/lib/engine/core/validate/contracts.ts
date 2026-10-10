/**
 * Contract validation against the registry and the store, plus document
 * quality.
 *
 * Connector inputs are checked statically against their JSON Schemas:
 * value judgments are skipped exactly where a template resolves at runtime,
 * while missing required fields and unknown properties are always decidable.
 * Subautomation references must parse and, when the caller supplies a store,
 * resolve — to the document a run executes (the pinned version, else the
 * deployed one, else the latest), whose body and inputs are then checked.
 *
 * The output-typing rule guards the one bridge from text to data: an
 * unstructured node exposes only `.output.text`, and an llm node becomes
 * structured exactly by declaring an `outputSchema`.
 */

import type { ErrorObject } from 'ajv';

import { isRecord } from '../../../utils/type-utils';
import { err, warn } from '../errors';
import { nodeTypes, type ConnectorLike } from '../slots';
import { pointerFromAjv, pointerTokens, ptr } from '../syntax/pointer';
import type { ExprSource } from '../syntax/sources';
import { exprSegments, tokenizeTemplate } from '../syntax/tokens';
import type { Issue, NodeDef } from '../types';
import { parseAutomationRef } from '../typing/children';
import { normalizeSchema } from '../typing/normalize';
import { toTs } from '../typing/shape';
import type { ValidationContext } from './context';
import { compileSchema, describeSchemaErrors } from './schema';
import { closestName } from './similar';
import { analyzable } from './syntax-check';
import { type InputsCheck, triggerInputWarnings } from './trigger-input';

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

/**
 * The Ajv instance paths of an input mapping that hold a template. Their
 * values resolve at run time, so they are statically unknowable: value
 * keywords are skipped there, structural ones still judge.
 */
function templatePathsOf(input: unknown): Set<string> {
  const templatePaths = new Set<string>();
  const collect = (v: unknown, path: string): void => {
    if (typeof v === 'string') {
      if (v.includes('{{') && exprSegments(tokenizeTemplate(v)).length > 0) {
        templatePaths.add(path);
      }
    } else if (Array.isArray(v)) {
      for (const [i, item] of v.entries()) collect(item, `${path}/${i}`);
    } else if (isRecord(v)) {
      for (const [k, item] of Object.entries(v)) collect(item, `${path}/${k}`);
    }
  };
  collect(input, '');
  return templatePaths;
}

function checkConnectorInput(
  n: NodeDef,
  base: string,
  input: Record<string, unknown>,
  connector: ConnectorLike,
  issues: Issue[],
): void {
  const templatePaths = templatePathsOf(input);

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
    const missing = missingProperty(e);
    const close =
      extra === undefined ? undefined : closestName(extra, schemaProps);
    const detail = e.message ?? 'is invalid';
    const valuePointer = pointerFromAjv(base, e.instancePath);
    const at =
      missing !== undefined
        ? {
            pointer: valuePointer + ptr(missing),
            subject: 'missing' as const,
          }
        : extra !== undefined
          ? { pointer: valuePointer + ptr(extra), subject: 'key' as const }
          : { pointer: valuePointer };
    issues.push(
      err(
        'CONNECTOR_INPUT_INVALID',
        `node "${n.id}" (${n.type}): input${e.instancePath} ${detail}${extra === undefined ? '' : ` ("${extra}")`}`,
        {
          nodeId: n.id,
          path: e.instancePath || undefined,
          hint: `${close === undefined ? '' : `did you mean "${close}"? `}schema: ${JSON.stringify(connector.inputSchema)}`,
          at,
          params: {
            node: n.id,
            type: n.type,
            property:
              missing ?? extra ?? pointerTokens(e.instancePath).at(-1) ?? '',
            keyword: e.keyword,
            ...(close !== undefined && { suggestion: close }),
            detail,
          },
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

function missingProperty(e: ErrorObject): string | undefined {
  if (e.keyword !== 'required') return undefined;
  const name: unknown = e.params.missingProperty;
  return typeof name === 'string' ? name : undefined;
}

export async function validateContracts(
  ctx: ValidationContext,
  validNodes: NodeDef[],
): Promise<void> {
  const { doc, issues, store } = ctx;
  // Duplicate ids already carry their own error; contract checks run once
  // per id, on the first occurrence.
  const byId = new Map<string, NodeDef>();
  const unique: NodeDef[] = [];
  for (const n of validNodes) {
    if (byId.has(n.id)) continue;
    byId.set(n.id, n);
    unique.push(n);
  }

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

  // One answer per model per validation call: a document that names the
  // same model on five nodes asks the host once.
  const modelAnswers = new Map<string, Promise<boolean | undefined>>();
  const modelAvailable = async (
    modelId: string,
    nodeType: 'llm' | 'agent',
  ): Promise<boolean | undefined> => {
    if (store?.modelAvailable === undefined) return undefined;
    const key = `${nodeType}:${modelId}`;
    let pending = modelAnswers.get(key);
    if (pending === undefined) {
      pending = store.modelAvailable(modelId, nodeType).catch((e: unknown) => {
        // A provider outage is not a document problem — the check is skipped.
        console.warn(
          '[engine] skipping model availability (store lookup failed):',
          e instanceof Error ? e.message : e,
        );
        return undefined;
      });
      modelAnswers.set(key, pending);
    }
    return pending;
  };

  // Every distinct model is asked up front so the host answers them side by
  // side — the loop below awaits each in turn, which walked the catalogs one
  // model after another on a document naming several.
  for (const n of unique) {
    if (
      (n.type === 'llm' || n.type === 'agent') &&
      typeof n.model === 'string' &&
      n.model !== ''
    ) {
      void modelAvailable(n.model, n.type);
    }
  }

  for (const n of unique) {
    const def = nodeTypes().get(n.type);
    const base = ptr('nodes', ctx.indexOf(n));

    if (def?.connector && isRecord(n.input)) {
      checkConnectorInput(n, `${base}/input`, n.input, def.connector, issues);
    }

    // A model nobody serves fails the node on the first live run, and the
    // mock run answers for any model — so the author learns it here, as a
    // warning: the host's answer is a snapshot of its providers, never a
    // rule of the document (2026-09-26 evaluation, D-16).
    if (
      (n.type === 'llm' || n.type === 'agent') &&
      typeof n.model === 'string' &&
      n.model !== '' &&
      (await modelAvailable(n.model, n.type)) === false
    ) {
      issues.push(
        warn(
          'LLM_MODEL_UNAVAILABLE',
          `node "${n.id}": no connected provider of this organization serves model "${n.model}" — a live run would fail at this node`,
          {
            nodeId: n.id,
            path: 'model',
            hint: 'pick a model a connected provider serves (Settings → Providers lists them), or connect a provider that serves this one',
            at: { pointer: `${base}/model` },
            params: { node: n.id, model: n.model },
          },
        ),
      );
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
              at: { pointer: `${base}/automation` },
              params: { node: n.id, ref: n.automation },
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
              at: { pointer: `${base}/automation` },
              params: {
                node: n.id,
                automation: parsed.name,
                ...(parsed.version !== undefined && {
                  version: parsed.version,
                }),
                ...(close !== undefined && { suggestion: close }),
                known: known.map((w) => w.name),
              },
            },
          ),
        );
      } else if (store) {
        // The document a run of this reference executes, resolved once for
        // the whole call (`validate`). A reference that resolved to nothing
        // is asked for again, so a store outage (skipped) is told apart from
        // a version that does not exist (an error).
        const child = ctx.children?.get(n.automation);
        let body: { automation: unknown; version: number } | undefined;
        if (child !== undefined && child !== null) {
          body = { automation: child.automation, version: child.version };
        } else {
          try {
            const got = await store.get(parsed.name, parsed.version);
            if (got !== null) {
              body = { automation: got.automation, version: got.meta.version };
            } else if (parsed.version !== undefined) {
              issues.push(
                err(
                  'SUBAUTOMATION_NOT_FOUND',
                  `node "${n.id}": automation "${parsed.name}" has no version ${parsed.version}`,
                  {
                    nodeId: n.id,
                    hint: `latest version: ${entry.latest}`,
                    at: { pointer: `${base}/automation` },
                    params: {
                      node: n.id,
                      automation: parsed.name,
                      version: parsed.version,
                      latest: entry.latest,
                    },
                  },
                ),
              );
            }
          } catch (e) {
            console.warn(
              '[engine] skipping subautomation body check (store get failed):',
              e instanceof Error ? e.message : e,
            );
          }
        }
        if (body !== undefined) {
          checkSubautomationBody(n, base, parsed.name, body.automation, issues);
          checkSubautomationInput(n, base, parsed.name, body, issues);
        }
      }
    }
  }

  // Every reference source in the document, node by node plus the output.
  const allSources: ExprSource[] = [
    ...unique.flatMap((n) => ctx.sources(ctx.indexOf(n))),
    ...ctx.outputSources(),
  ];

  // The output-typing rule: pathing into an unstructured output beyond
  // `.text` reads a field that will never exist.
  for (const source of allSources) {
    const { nodeId, field, pointer } = source;
    for (const unit of source.units) {
      if (!analyzable(unit)) continue;
      for (const site of unit.refs) {
        const key = site.path.at(0)?.key;
        if (
          site.root !== 'nodes' ||
          site.nodeId === undefined ||
          site.member !== 'output' ||
          typeof key !== 'string'
        ) {
          continue;
        }
        const target = byId.get(site.nodeId);
        if (target === undefined) continue;
        const targetDef = nodeTypes().get(target.type);
        if (targetDef === undefined || targetDef.outputKind !== 'unstructured')
          continue;
        // An llm node with an outputSchema yields the schema-shaped object.
        if (target.outputSchema !== undefined) continue;
        if (key === 'text') continue;
        issues.push(
          err(
            'REF_UNSTRUCTURED_PATH',
            `${nodeId === undefined ? 'output' : `node "${nodeId}"`}: "nodes.${site.nodeId}.output.${key}" — node "${target.id}" (${target.type}) returns unstructured text; only .output.text exists`,
            {
              nodeId,
              hint:
                target.type === 'llm'
                  ? `give "${target.id}" an outputSchema to get structured output, or read nodes.${target.id}.output.text`
                  : `read nodes.${target.id}.output.text, or bridge through an llm node with an outputSchema`,
              at: { pointer, range: site.range },
              params: {
                ...(nodeId !== undefined && { node: nodeId }),
                field,
                source: target.id,
                sourceType: target.type,
                member: key,
              },
            },
          ),
        );
      }
    }
  }

  await checkTriggerInput(ctx);

  // Document quality.
  if (doc.output === undefined) {
    issues.push(
      warn(
        'OUTPUT_MISSING',
        'automation has no "output" — it will return null',
        {
          hint: 'e.g. "output": "{{ nodes.<id>.output }}"',
          at: { pointer: '/output', subject: 'missing' },
          params: {},
        },
      ),
    );
  }

  // Every named read counts, even one in code that does not parse yet — a
  // node being wired up is not dead.
  const referenced = new Set<string>();
  for (const source of allSources) {
    for (const unit of source.units) {
      for (const site of unit.refs) {
        if (site.root === 'nodes' && site.nodeId !== undefined) {
          referenced.add(site.nodeId);
        }
      }
    }
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
          at: { pointer: ptr('nodes', ctx.indexOf(n)) },
          params: { node: n.id, reason: 'unread' },
        },
      ),
    );
  }
}

/**
 * What the automation's own trigger starts runs with, against its inputs
 * schema, and its fixed input for a template: a run checks its input
 * before any node runs, so a trigger whose input the schema refuses never
 * starts a run — every start is refused. The host says what the trigger
 * sends, as far as it knows ahead (a webhook's body it does not). Warnings:
 * triggers change without a new version.
 */
async function checkTriggerInput(ctx: ValidationContext): Promise<void> {
  const { doc, store, issues } = ctx;
  if (store?.triggerInput === undefined || typeof doc.name !== 'string') {
    return;
  }
  let sample;
  try {
    sample = await store.triggerInput(doc.name);
  } catch (e) {
    console.warn(
      '[engine] skipping the trigger input check (store lookup failed):',
      e instanceof Error ? e.message : e,
    );
    return;
  }
  if (sample === null) return;
  let check: InputsCheck | null = null;
  if (isRecord(doc.inputs)) {
    try {
      check = compileSchema(doc.inputs);
    } catch (e) {
      // INPUTS_SCHEMA_INVALID reports it; there is nothing to check against.
      console.warn(
        '[engine] skipping the trigger input check (the inputs schema does not compile):',
        e instanceof Error ? e.message : e,
      );
    }
  }
  issues.push(...triggerInputWarnings(check, sample));
}

/**
 * The parent's input against the inputs schema of the automation it calls:
 * the called run checks its input before any node runs, so a missing
 * required key or a key the schema refuses fails this node. Values that are
 * templates resolve at run time and are judged by their type in the
 * analysis pass (TYPE_MISMATCH), not here. A warning: the called automation
 * can change under this version.
 */
function checkSubautomationInput(
  n: NodeDef,
  base: string,
  name: string,
  body: { automation: unknown; version: number },
  issues: Issue[],
): void {
  if (!isRecord(body.automation) || !isRecord(body.automation.inputs)) return;
  const inputs = body.automation.inputs;
  let check;
  try {
    check = compileSchema(inputs);
  } catch (e) {
    console.warn(
      `[engine] skipping the input check for "${name}" (its inputs schema does not compile):`,
      e instanceof Error ? e.message : e,
    );
    return;
  }
  const input = isRecord(n.input) ? n.input : {};
  if (check(input)) return;
  const templatePaths = templatePathsOf(input);
  const errors = (check.errors ?? []).filter(
    (e) =>
      !(templatePaths.has(e.instancePath) && VALUE_KEYWORDS.has(e.keyword)),
  );
  if (errors.length === 0) return;
  const described = describeSchemaErrors(errors);
  const missing: string[] = [];
  const unknown: string[] = [];
  for (const [i, d] of described.entries()) {
    if (errors[i]?.keyword === 'required') missing.push(d.path);
    else if (errors[i]?.keyword === 'additionalProperties')
      unknown.push(d.path);
  }
  const problems = described.map((d) =>
    d.path === '' ? d.message : `${d.path} ${d.message}`,
  );
  issues.push(
    warn(
      'SUBAUTOMATION_INPUT_INVALID',
      `node "${n.id}": input does not fit the inputs of "${name}@${body.version}": ${problems.join('; ')}`,
      {
        nodeId: n.id,
        hint: `"${name}" expects ${toTs(normalizeSchema(inputs))}`,
        at: {
          pointer: `${base}/input`,
          ...(n.input === undefined && { subject: 'missing' as const }),
        },
        params: {
          node: n.id,
          automation: name,
          version: body.version,
          missing,
          unknown,
          problems,
        },
      },
    ),
  );
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
  base: string,
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
            at: { pointer: `${base}/automation` },
            params: { node: n.id, automation: name, childNode: subId },
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
            at: { pointer: `${base}/automation` },
            params: {
              node: n.id,
              automation: name,
              childNode: subId,
              childType: sub.type,
            },
          },
        ),
      );
    }
  }
}
