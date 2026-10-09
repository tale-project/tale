/**
 * Bounded parallelism and progress lines for the seed's long loops.
 */

/**
 * Run `fn` over `items` with at most `limit` calls in flight, results in
 * input order. A rejection stops new work from starting and rejects the
 * whole call once the in-flight calls settle; callers that must survive a
 * per-item failure return it as a value instead of throwing.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, position: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const failures: unknown[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    while (failures.length === 0 && next < items.length) {
      const position = next;
      next += 1;
      try {
        results[position] = await fn(items[position] as T, position);
      } catch (error) {
        failures.push(error);
      }
    }
  };
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    worker,
  );
  await Promise.all(workers);
  if (failures.length > 0) throw failures[0];
  return results;
}

export interface Progress {
  /** Count `amount` more units done; prints at most every `everyMs`. */
  tick(amount?: number): void;
  /** Print the final line. */
  done(): void;
}

/**
 * A rate-limited progress printer: `[seed] users 120000/1000000 (40213/s)`.
 * Lines go to stderr so a caller piping the summary is not interleaved.
 */
export function createProgress(
  label: string,
  total: number,
  options: { everyMs?: number; write?: (line: string) => void } = {},
): Progress {
  const everyMs = options.everyMs ?? 2000;
  const write =
    options.write ?? ((line: string) => process.stderr.write(`${line}\n`));
  const started = performance.now();
  let count = 0;
  let lastPrint = started;
  const line = (): string => {
    const seconds = (performance.now() - started) / 1000;
    const rate = seconds > 0 ? Math.round(count / seconds) : count;
    return `[seed] ${label} ${count}/${total} (${rate}/s, ${seconds.toFixed(1)} s)`;
  };
  return {
    tick(amount = 1) {
      count += amount;
      const now = performance.now();
      if (now - lastPrint >= everyMs) {
        lastPrint = now;
        write(line());
      }
    },
    done() {
      write(line());
    },
  };
}
