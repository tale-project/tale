/**
 * The run-state format this engine reads and writes: the shape of a run's
 * checkpoints and cursor, what a skipped node means, which node types exist.
 *
 * Bump it ONLY when a run stepped by this engine could be misread by the
 * previous one. A claim stamps the run with the higher of its own stamp and
 * this value, and an engine refuses a run stamped above its own: it hands the
 * run back to the queue for a worker of the newer release instead of reading
 * progress it does not understand.
 */
export const ENGINE_PROTOCOL = 2;

/**
 * The key a connector call presents as `ctx.idempotencyKey`: the run, the
 * node's path, its forEach item and, from the second `repeatUntil` pass on,
 * the pass. Retry-stable by construction — the run id is durable and the rest
 * is positional — so a re-attempted step presents the key its first attempt
 * used, while two passes of one repeat present two keys. A first pass carries
 * no pass suffix: for a top-level node that is the key earlier releases
 * presented, so a run interrupted on one presents the same key on the next.
 * A node inside a subautomation gets a new key: earlier releases keyed it by
 * its own id alone (`<run>:<id>:<item>`), which two items of the calling
 * node's loop shared, so a vendor that de-duplicates on the key does not
 * catch a nested write repeated across that upgrade.
 */
export function connectorIdempotencyKey(
  runId: string,
  path: string,
  itemIndex: number,
  pass: number,
): string {
  return pass > 0
    ? `${runId}:${path}:${itemIndex}:${pass}`
    : `${runId}:${path}:${itemIndex}`;
}

/**
 * The path prefix of the nodes a `subautomation` node walks: the node's own
 * path, the forEach item and the repeat pass it was walked for. A node's path
 * is its id at the top level and `<prefix><id>` inside a subautomation
 * (`batch[2:0]/send`), so every call a run makes has one stable address
 * however deep it sits.
 */
export function subautomationPathPrefix(
  path: string,
  itemIndex: number,
  pass: number,
): string {
  return `${path}[${itemIndex}:${pass}]/`;
}
