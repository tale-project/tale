import { useMemo } from 'react';
import { z } from 'zod';

/**
 * How a JSON input a person types is read and checked against an
 * automation's `inputs` schema — the run dialog's and the trigger's fixed
 * input's one way, so both refuse the same text with the same words.
 *
 * The check is feedback, not the authority: the server validates the
 * original input with the engine's own validator. A schema the client
 * converter cannot read is therefore not held against an input.
 */

/** What checking an input against the schema found. */
export type JsonInputCheck =
  | { valid: true; input: unknown }
  | {
      valid: false;
      /** The fields the input breaks, dotted (`$` is the input itself),
       * once each, at most {@link INPUT_PATH_LIMIT}. */
      paths: string[];
    };

/** At most this many refused fields are named. */
const INPUT_PATH_LIMIT = 20;

/** JSON text as its value, or `ok: false` when it does not parse. */
export function parseJsonText(
  text: string,
): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    // A SyntaxError is the answer "this is not JSON"; anything else is not
    // a verdict on the text.
    if (!(error instanceof SyntaxError)) throw error;
    return { ok: false };
  }
}

/**
 * The validator of an `inputs` JSON Schema, or null when there is none or
 * the client converter cannot read it. Ajv compiles with `new Function`,
 * which the production CSP forbids; zod's converter is CSP-safe.
 */
export function inputSchemaValidator(
  schema: Record<string, unknown> | undefined,
): z.ZodType | null {
  if (schema === undefined) return null;
  try {
    return z.fromJSONSchema(schema);
  } catch (error) {
    // Author schemas may use keywords the client converter cannot handle.
    // A server-valid schema is not refused for that: the start endpoint
    // validates the input with the engine's own validator.
    console.warn(
      '[automations] the client cannot read an inputs schema',
      error,
    );
    return null;
  }
}

/** `input` checked by `validator`; without one every input passes. */
export function checkJsonInput(
  validator: z.ZodType | null,
  input: unknown,
): JsonInputCheck {
  const checked = validator?.safeParse(input);
  if (checked === undefined || checked.success) {
    // The original value goes on, not a converter's transformed copy.
    return { valid: true, input };
  }
  const paths = [
    ...new Set(
      checked.error.issues.map((issue) =>
        issue.path.length === 0 ? '$' : issue.path.join('.'),
      ),
    ),
  ].slice(0, INPUT_PATH_LIMIT);
  return { valid: false, paths };
}

/**
 * The checker of one `inputs` schema: its validator, built once per schema,
 * and `check`, which reads an input against it.
 */
export function useJsonInputDraft(
  schema: Record<string, unknown> | undefined,
): {
  validator: z.ZodType | null;
  check: (input: unknown) => JsonInputCheck;
} {
  const validator = useMemo(() => inputSchemaValidator(schema), [schema]);
  return useMemo(
    () => ({
      validator,
      check: (input: unknown) => checkJsonInput(validator, input),
    }),
    [validator],
  );
}
