/**
 * The error envelope every failing route answers with.
 *
 * One shape for the panel's routes and the machine doors alike, so a client
 * reads a refusal the same way wherever it came from: a stable `code` to
 * branch on, and a sentence for a person.
 */
export function fail(code: string, message: string) {
  return { error: { code, message } } as const;
}
