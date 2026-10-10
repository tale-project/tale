/**
 * Static-analysis warnings that describe the workflow's own control flow or
 * inferred data shape. They remain visible to operators, but do not block a
 * native release: the client owns the workflow and may deliberately carry
 * these advisory findings while its tests and review cover the behavior.
 */
export const ADVISORY_IMPORT_WARNINGS: ReadonlySet<string> = new Set([
  'CONDITION_CONSTANT',
  'EXPR_UNKNOWN_NAME',
  'MAYBE_NULL',
  'OUTPUT_MAYBE_EMPTY',
  'REF_UNKNOWN_FIELD',
  'REPEAT_NEVER_TRUE',
  'REPEAT_UNTIL_STATIC',
  'SUBAUTOMATION_INPUT_INVALID',
  'TEMPLATE_NULL_INTERPOLATION',
  'TEMPLATE_UNTERMINATED',
  'TESTS_EFFECT_UNKNOWN',
  'TESTS_EXPECT_TYPE',
  'TESTS_INPUT_INVALID',
  'TRIGGER_INPUT_MISMATCH',
  'TYPE_MISMATCH',
  'UNCAUGHT_FAILURE',
  'UNREACHABLE',
]);

/** A warning's code, from the `[CODE]` the native import writes into it. */
export function warningCode(warning: unknown): string | undefined {
  return typeof warning === 'string'
    ? /\[([A-Z][A-Z0-9_]*)\]/.exec(warning)?.[1]
    : undefined;
}

export function isAdvisoryImportWarning(warning: unknown): warning is string {
  const code = warningCode(warning);
  return code !== undefined && ADVISORY_IMPORT_WARNINGS.has(code);
}
