import type { CDPSession } from '../../../packages/e2e/src/index.ts';

export interface TraceCompletion {
  stream?: string;
  dataLossOccurred?: unknown;
  traceFormat?: string;
  streamCompression?: string;
}
/** Subscribe before start. This is ownership hardening, not an explanation
 * for the retained app timeout: Chromium's successful End refutes an earlier
 * auto-completion in that run. */
export function observeTrace(cdp: CDPSession) {
  const events: { at: number; value: TraceCompletion }[] = [];
  let settle: (value: TraceCompletion) => void = () => {};
  const complete = new Promise<TraceCompletion>((resolve) => {
    settle = resolve;
  });
  const listener = (value: TraceCompletion) => {
    events.push({ at: Date.now(), value });
    settle(value);
  };
  cdp.on('Tracing.tracingComplete', listener);
  let disposed = false;
  return {
    events,
    async wait(timeoutMs: number) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          complete,
          new Promise<undefined>((resolve) => {
            timer = setTimeout(() => resolve(undefined), timeoutMs);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    },
    async dispose() {
      if (disposed) return [];
      disposed = true;
      cdp.off('Tracing.tracingComplete', listener);
      // Capture stream ownership from the event itself. End failure or an
      // exclusive-file failure must not orphan a stream already delivered.
      const handles = [
        ...new Set(
          events.flatMap(({ value }) =>
            typeof value.stream === 'string' && value.stream
              ? [value.stream]
              : [],
          ),
        ),
      ];
      const cleanup = await Promise.allSettled(
        handles.map((handle) => cdp.send('IO.close', { handle })),
      );
      return cleanup.flatMap((result) =>
        result.status === 'rejected' ? [String(result.reason)] : [],
      );
    },
  };
}
export type TraceOwner = ReturnType<typeof observeTrace>;
