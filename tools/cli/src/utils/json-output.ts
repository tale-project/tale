/**
 * The `--json` surface: a single machine-readable envelope on stdout (human
 * chrome goes to stderr via the reporter, which is silenced in `--json` mode).
 * A piped consumer (`tale status --json | jq`) sees exactly one JSON object.
 */

import { causeText, type FailInfo } from './fail';

interface JsonEnvelope<T> {
  ok: boolean;
  command: string;
  data?: T;
  error?: { summary: string; code: number; cause?: string };
}

/** Emit a success envelope (one line) to stdout. */
export function emitJson<T>(command: string, data: T): void {
  const envelope: JsonEnvelope<T> = { ok: true, command, data };
  process.stdout.write(`${JSON.stringify(envelope)}\n`);
}

/** Emit a failure envelope to stdout and exit with the failure's code. */
export function emitJsonError(info: FailInfo, command = 'tale'): never {
  const envelope: JsonEnvelope<never> = {
    ok: false,
    command,
    error: {
      summary: info.summary,
      code: info.code ?? 1,
      cause: info.cause ? causeText(info.cause) : undefined,
    },
  };
  process.stdout.write(`${JSON.stringify(envelope)}\n`);
  process.exit(info.code ?? 1);
}
