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
export const ENGINE_PROTOCOL = 1;
