/**
 * Structural validator for the JSON-Schema subset `z.toJSONSchema` emits
 * (the shape of the per-version config checkpoints), plus the mapping from
 * org-config file paths to checkpoint schema keys.
 *
 * Deliberately validates STRUCTURE only — types, object properties/required/
 * additionalProperties, array items, unions (`anyOf`), literals
 * (`enum`/`const`), `$defs` refs. Value constraints (min/max lengths, ranges,
 * formats) are ignored: version truth is about shapes a release could hold,
 * not about which strings were pretty.
 *
 * Two-dot basename keeps this out of the Convex push bundle.
 */

export type JsonSchemaNode = Record<string, unknown>;

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'integer' : 'number';
  }
  return typeof value;
}

function typeMatches(declared: string, actual: string): boolean {
  if (declared === actual) return true;
  // JSON Schema: every integer is a number.
  return declared === 'number' && actual === 'integer';
}

function resolveRef(ref: string, root: JsonSchemaNode): JsonSchemaNode | null {
  if (!ref.startsWith('#/')) return null;
  let node: unknown = root;
  for (const seg of ref.slice(2).split('/')) {
    if (typeof node !== 'object' || node === null) return null;
    node = (node as Record<string, unknown>)[seg];
  }
  return typeof node === 'object' && node !== null
    ? (node as JsonSchemaNode)
    : null;
}

/**
 * Validate `value` against `schema`; returns the first violation as a
 * human-readable string (with `path` as the location prefix), or null.
 */
export function validateJsonValue(
  value: unknown,
  schema: JsonSchemaNode,
  path: string,
  root: JsonSchemaNode = schema,
): string | null {
  if (typeof schema.$ref === 'string') {
    const resolved = resolveRef(schema.$ref, root);
    // An unresolvable ref is treated as `any` — never a false positive.
    return resolved ? validateJsonValue(value, resolved, path, root) : null;
  }

  if (Array.isArray(schema.anyOf)) {
    const errors: string[] = [];
    for (const member of schema.anyOf) {
      const err = validateJsonValue(
        value,
        member as JsonSchemaNode,
        path,
        root,
      );
      if (err === null) return null;
      errors.push(err);
    }
    return `${path}: no union member matches (${errors[0]})`;
  }

  if (schema.const !== undefined) {
    return Object.is(value, schema.const)
      ? null
      : `${path}: expected literal ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`;
  }
  if (Array.isArray(schema.enum)) {
    return schema.enum.some((v) => Object.is(v, value))
      ? null
      : `${path}: ${JSON.stringify(value)} not in enum ${JSON.stringify(schema.enum)}`;
  }

  const declared = schema.type;
  const actual = typeOf(value);
  if (typeof declared === 'string') {
    if (!typeMatches(declared, actual)) {
      return `${path}: expected ${declared}, got ${actual}`;
    }
  } else if (Array.isArray(declared)) {
    if (!declared.some((d) => typeMatches(String(d), actual))) {
      return `${path}: expected one of ${declared.join('|')}, got ${actual}`;
    }
  }

  if (actual === 'object' && typeof value === 'object' && value !== null) {
    const properties =
      typeof schema.properties === 'object' && schema.properties !== null
        ? (schema.properties as Record<string, JsonSchemaNode>)
        : {};
    const required = Array.isArray(schema.required)
      ? (schema.required as string[])
      : [];
    const record = value as Record<string, unknown>;

    for (const key of required) {
      if (record[key] === undefined) {
        return `${path}.${key}: required field missing`;
      }
    }
    for (const [key, fieldValue] of Object.entries(record)) {
      if (fieldValue === undefined) continue;
      const fieldSchema = properties[key];
      if (fieldSchema) {
        const err = validateJsonValue(
          fieldValue,
          fieldSchema,
          `${path}.${key}`,
          root,
        );
        if (err) return err;
        continue;
      }
      // `additionalProperties: false` is NOT enforced: Zod emits it for
      // plain z.object too, whose parse STRIPS unknown keys rather than
      // rejecting them — an undeclared field never broke that release. A
      // declared field with an era-invalid VALUE is still a violation.
      if (
        typeof schema.additionalProperties === 'object' &&
        schema.additionalProperties !== null
      ) {
        const err = validateJsonValue(
          fieldValue,
          schema.additionalProperties as JsonSchemaNode,
          `${path}.${key}`,
          root,
        );
        if (err) return err;
      }
    }
  }

  if (actual === 'array' && Array.isArray(value)) {
    const items = schema.items;
    if (typeof items === 'object' && items !== null && !Array.isArray(items)) {
      for (let i = 0; i < value.length; i++) {
        const err = validateJsonValue(
          value[i],
          items as JsonSchemaNode,
          `${path}[${i}]`,
          root,
        );
        if (err) return err;
      }
    }
  }

  return null;
}

function kebabToCamel(name: string): string {
  return name.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/**
 * Org-relative config path → the checkpoint schema keys that may govern it,
 * in preference order (a version validates with its FIRST present key; a
 * version where none exists did not know the shape yet and skips the file).
 */
export function configSchemaCandidates(relPath: string): string[] {
  const rules: Array<[RegExp, (m: RegExpExecArray) => string[]]> = [
    [/^branding\/branding\.json$/, () => ['branding.brandingJsonSchema']],
    [/^agents\/.+\.json$/, () => ['agents.agentJsonSchema']],
    [/^apps\/[^/]+\/app\.json$/, () => ['apps.appManifestSchema']],
    [/^apps\/[^/]+\/agents\/.+\.json$/, () => ['agents.agentJsonSchema']],
    [
      /^apps\/[^/]+\/workflows\/.+\.json$/,
      () => ['workflows.workflowJsonSchema'],
    ],
    [/^workflows\/.+\.json$/, () => ['workflows.workflowJsonSchema']],
    [
      /^providers\/[^/]+\.secrets\.json$/,
      () => ['providers.providerSecretsSchema'],
    ],
    [/^providers\/[^/]+\.json$/, () => ['providers.providerJsonSchema']],
    [/^prompts\/[^/]+\.json$/, () => ['prompts.promptJsonSchema']],
    [
      /^governance\/sso\/connection\.secrets\.json$/,
      () => ['enterprise_sso.ssoConnectionSecretsSchema'],
    ],
    [
      /^governance\/sso\/connection\.json$/,
      () => ['enterprise_sso.ssoConnectionFileSchema'],
    ],
    [
      /^governance\/([a-z0-9-]+)\.json$/,
      (m) => {
        const camel = kebabToCamel(m[1]);
        return [
          `governance.${camel}ConfigSchema`,
          `governance.${camel}PolicyConfigSchema`,
          `governance.${camel}Schema`,
        ];
      },
    ],
  ];
  for (const [pattern, keys] of rules) {
    const match = pattern.exec(relPath);
    if (match) return keys(match);
  }
  return [];
}
