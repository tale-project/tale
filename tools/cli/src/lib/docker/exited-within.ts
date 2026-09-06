/** The subset of `Bun.Subprocess` the timeout race needs. */
interface Exitable {
  readonly exited: Promise<number>;
  kill(): void;
}

/**
 * Resolves with the child's exit code, or kills it and rejects once
 * `timeoutS` seconds have passed. The timer is cleared as soon as the child
 * exits: a pending ref'd timer keeps the Bun event loop alive, so without this
 * every `tale` command lingered after its last output until the longest
 * timeout fired (10 s for the daemon probe, hours for the snapshot archives)
 * and then killed an already-exited process.
 */
export async function exitedWithin(
  proc: Exitable,
  timeoutS: number,
): Promise<number> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      proc.exited,
      new Promise<number>((_, reject) => {
        timer = setTimeout(() => {
          proc.kill();
          reject(new Error(`Command timed out after ${timeoutS}s`));
        }, timeoutS * 1000);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
