// Signed control client for the deploy's in-container drain calls.
//
// `tale deploy` reaches the spawner's control routes from INSIDE the container
// (`docker exec <spawner> bun /app/src/control-cli.ts drain|drain-status`, see
// tools/cli/src/lib/actions/drain-sandbox.ts). The routes are HMAC-gated like
// every other route (control-routes.ts), and the only place the shared secret
// already exists is the spawner's own environment — so the signature is minted
// here, from `SANDBOX_TOKEN` as the container sees it, and the secret never
// crosses the CLI's process boundary, its argv, or its logs. Same shape as the
// backend tier's control door, which expands `$TALE_CONTROL_TOKEN` inside its
// own container (tools/cli/src/lib/docker/control-call.ts).
//
//   bun src/control-cli.ts drain          → {"draining":true}
//   bun src/control-cli.ts drain-status   → {"draining":…,"sessions":n,"sessionIds":[…]}
//
// stdout: the response body. Exit 0 on 2xx, 1 on any other status, 2 on a
// usage error or a missing token.
//
// The call rides `node:http`, NOT `fetch`: Bun's fetch honors HTTP(S)_PROXY
// from the environment (read at process start — neither NO_PROXY juggling nor
// deleting the vars in-process can be relied on from inside this script), and a
// fenced deployment's .env carries exactly those vars, which would route this
// loopback call into the egress proxy. Bun's node:http client ignores the
// proxy env, so the call always goes straight to the spawner's own listener.

import { randomBytes } from 'node:crypto';
import { request as httpRequest } from 'node:http';

import {
  NONCE_HEADER,
  SIGNATURE_HEADER,
  sign,
  TIMESTAMP_HEADER,
} from './auth.ts';

export const CONTROL_COMMANDS = {
  drain: { method: 'POST', path: '/v1/drain' },
  'drain-status': { method: 'GET', path: '/v1/drain-status' },
} as const;

export type ControlCommand = keyof typeof CONTROL_COMMANDS;

export function isControlCommand(value: string): value is ControlCommand {
  return Object.hasOwn(CONTROL_COMMANDS, value);
}

/** The HMAC headers for one control call (empty body, fresh nonce). */
export function signedControlHeaders(
  command: ControlCommand,
  token: string,
  nowMs: number = Date.now(),
  nonce: string = randomBytes(16).toString('hex'),
): Record<string, string> {
  const { method, path } = CONTROL_COMMANDS[command];
  const timestamp = String(nowMs);
  return {
    [SIGNATURE_HEADER]: sign(method, path, timestamp, '', token, nonce),
    [TIMESTAMP_HEADER]: timestamp,
    [NONCE_HEADER]: nonce,
  };
}

/** Sign + send one control call (proxy-immune, see header); returns the raw
 * status and body. */
export function runControlCommand(
  command: ControlCommand,
  opts: { token: string; baseUrl: string },
): Promise<{ status: number; body: string }> {
  const { method, path } = CONTROL_COMMANDS[command];
  const target = new URL(path, opts.baseUrl);
  const headers = signedControlHeaders(command, opts.token);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: target.hostname,
        port: Number(target.port || '80'),
        path: target.pathname,
        method,
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.end();
  });
}

async function main(argv: string[]): Promise<number> {
  const command = argv[0] ?? '';
  if (!isControlCommand(command)) {
    console.error(
      `usage: control-cli <${Object.keys(CONTROL_COMMANDS).join('|')}>`,
    );
    return 2;
  }
  // Trimmed like loadConfig, so the key matches what the server verifies with.
  const token = process.env.SANDBOX_TOKEN?.trim() ?? '';
  if (token.length === 0) {
    console.error(
      '[sandbox.control] SANDBOX_TOKEN is unset in this container — cannot sign the control call',
    );
    return 2;
  }
  // Same env the server reads its port from (the image sets SANDBOX_PORT=8003).
  const port = process.env.SANDBOX_PORT?.trim() || '8003';
  const { status, body } = await runControlCommand(command, {
    token,
    baseUrl: `http://127.0.0.1:${port}`,
  });
  if (status < 200 || status >= 300) {
    console.error(`[sandbox.control] ${command} failed (${status}): ${body}`);
    return 1;
  }
  process.stdout.write(body);
  return 0;
}

if (import.meta.main) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error('[sandbox.control] failed:', err);
      process.exit(1);
    },
  );
}
