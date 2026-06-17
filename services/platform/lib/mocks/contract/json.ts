/**
 * Parse a mock `Response` body as JSON for test assertions.
 *
 * `Response.json()` is typed `Promise<unknown>` here (no DOM lib), which makes
 * nested field access in assertions noisy. `JSON.parse` returns `any`, so this
 * helper's inferred return is `Promise<any>` — letting tests read deeply nested
 * fields without per-call generics, assertions, or an explicit `any`.
 */
export async function readJson(res: Response) {
  return JSON.parse(await res.text());
}
