import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { harnessDefinitionSchema } from '@tale/shared/schemas/providers';
import { parse as parseYaml } from 'yaml';

import { buildHarnessExec } from '../../../lib/harnesses/exec-builder';
import { sleep } from './docker';
import { capture, projectRoot, stdoutOf } from './exec';

// Records every request in its own file. A CLI that finds its MCP tools by
// searching (OpenClaw: tool_search, tool_describe and tool_call stand in for
// them) is asked once to search for the workspace tools, so the answer it
// sends back shows what it found; every other request gets a non-retryable
// 400, which ends the turn.
const STUB = String.raw`import json, os, sys, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
cap = sys.argv[2]
os.makedirs(cap, exist_ok=True)
count = [0]
searched = [False]

def chunk(model, delta, finish=None):
    return {"id": "c1", "object": "chat.completion.chunk", "created": int(time.time()), "model": model,
            "choices": [{"index": 0, "delta": delta, "finish_reason": finish}]}

class Handler(BaseHTTPRequestHandler):
    def answer(self):
        count[0] += 1
        size = int(self.headers.get("content-length") or 0)
        raw = self.rfile.read(size) if size else b""
        with open(os.path.join(cap, "%03d" % count[0]), "wb") as out:
            out.write(self.path.encode() + b"\n" + raw)
        try:
            body = json.loads(raw or b"{}")
        except ValueError:
            body = {}
        tools = body.get("tools", []) if isinstance(body, dict) else []
        names = [(tool.get("function") or tool).get("name") or "" for tool in tools if isinstance(tool, dict)]
        if self.path.endswith("/chat/completions") and "tool_search" in names and not searched[0]:
            searched[0] = True
            call = {"index": 0, "id": "call_search", "type": "function",
                    "function": {"name": "tool_search", "arguments": json.dumps({"query": "workspace"})}}
            self.send_response(200)
            self.send_header("content-type", "text/event-stream")
            self.end_headers()
            for event in (chunk(body.get("model"), {"role": "assistant", "content": None, "tool_calls": [call]}),
                          chunk(body.get("model"), {}, "tool_calls")):
                self.wfile.write(("data: " + json.dumps(event) + "\n\n").encode())
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
            return
        data = json.dumps({"type": "error", "error": {"type": "invalid_request_error", "message": "stub", "code": "invalid_request_error"}}).encode()
        self.send_response(400)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)
    do_GET = do_POST = answer
    def log_message(self, *args):
        pass
ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), Handler).serve_forever()
`;

export interface BridgeReach {
  slug: string;
  /** The harness's YAML declares the MCP channel. */
  mcp: boolean;
  /** workspace_tool and workspace_status reached its model, declared or
   * found by its tool search. */
  reached: boolean;
  /** runnerd's last event for the run, for a failure's message. */
  runnerd: string;
}

/** Every harness the platform runs on a managed credential, as a task turn
 * runs it — a model and the platform bridge, through runnerd in a booted
 * session — against a stub model endpoint: whether the bridge's workspace
 * tools reached its model. */
export async function checkBridgeReach(image: string): Promise<BridgeReach[]> {
  const harnessesDir = join(projectRoot(), 'configs/platform/system/harnesses');
  const facts = readdirSync(harnessesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) =>
      harnessDefinitionSchema.parse(
        parseYaml(
          readFileSync(join(harnessesDir, entry.name, 'harness.yml'), 'utf8'),
        ),
      ),
    )
    .filter((fact) => fact.credentialPolicy.managed)
    .sort((a, b) => a.slug.localeCompare(b.slug));
  const cid = await stdoutOf([
    'docker',
    'run',
    '-d',
    '--user',
    '10001',
    '--tmpfs',
    '/agent:uid=10001,gid=10001',
    image,
    'daemon',
  ]);
  const inSession = (cmd: string, stdin?: string) =>
    capture(
      [
        'docker',
        'exec',
        ...(stdin === undefined ? [] : ['-i']),
        cid,
        'sh',
        '-c',
        cmd,
      ],
      stdin === undefined ? {} : { stdin },
    );
  try {
    let ready = false;
    for (let i = 0; i < 20 && !ready; i++) {
      ready =
        (await inSession('curl -fsS http://127.0.0.1:8200/readyz')).exitCode ===
        0;
      if (!ready) await sleep(500);
    }
    if (!ready) throw new Error('runnerd did not become ready');
    await inSession('cat > /agent/.runtime/tmp/bridge-stub.py', STUB);
    const results: BridgeReach[] = [];
    let port = 18300;
    for (const fact of facts) {
      port += 1;
      const stubUrl = `http://127.0.0.1:${port}`;
      const recorded = `/agent/.runtime/tmp/bridge-probe/${fact.slug}`;
      await capture([
        'docker',
        'exec',
        '-d',
        cid,
        'python3',
        '/agent/.runtime/tmp/bridge-stub.py',
        String(port),
        recorded,
      ]);
      await inSession(
        `for i in $(seq 50); do curl -s -o /dev/null ${stubUrl}/ready && exit 0; sleep 0.1; done; exit 1`,
      );
      const exec = buildHarnessExec(fact, {
        prompt: 'Use the workspace tools to answer.',
        model: 'claude-opus-4-6',
        credential: {
          mode: 'managed',
          gateway: {
            baseUrl: stubUrl,
            token: 'bridge-probe-session-key',
            streamIdleTimeoutMs: 30_000,
            requestTimeoutMs: 30_000,
          },
        },
        workdir: '/agent/workspace',
        posture: 'act',
        mcp: { bridgeUrl: 'http://platform.internal/api/connectors' },
      });
      const { stdout: ran } = await inSession(
        "curl -sS -N --max-time 180 -H 'content-type: application/json' --data-binary @- http://127.0.0.1:8200/execs",
        JSON.stringify({
          execId: `bridge-${fact.slug}`,
          command: exec.argv,
          cwd: exec.cwd,
          env: exec.env,
          stdinBase64: Buffer.from(exec.stdin ?? '').toString('base64'),
          stdinMode: 'close',
          timeoutMs: 120_000,
          stdoutMaxBytes: 1_000_000,
          stderrMaxBytes: 1_000_000,
        }),
      );
      const { stdout: seen } = await inSession(`cat ${recorded}/* 2>/dev/null`);
      results.push({
        slug: fact.slug,
        mcp: fact.capabilities.mcp,
        reached:
          seen.includes('workspace_tool') && seen.includes('workspace_status'),
        runnerd: (ran.trim().split('\n').at(-1) ?? '').slice(0, 200),
      });
    }
    return results;
  } finally {
    await capture(['docker', 'rm', '-f', cid]);
  }
}
