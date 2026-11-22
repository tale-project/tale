import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { harnessDefinitionSchema } from '@tale/shared/schemas/providers';
import { parse as parseYaml } from 'yaml';

import { buildHarnessExec } from '../../../lib/harnesses/exec-builder';
import { createParser } from '../../../lib/harnesses/parsers/pi-jsonl';
import { capture, projectRoot } from './exec';

// Pi reaches the workspace tools only through the platform's bridge, the MCP
// server it mounts over HTTP from the staged mcp.json — no relay process
// starts. One loopback server stands in for both ends: the gateway's chat
// completions (it asks for the bridge's workspace_status, then reads the
// tool's answer in the next request) and the platform's MCP server at
// /api/connectors/mcp, stateless Streamable HTTP answering in JSON, which
// checks the session key on every request. A model that never saw the tool,
// a server Pi never reached or a call that never arrived each fail the probe.
// Every request must also carry the exec's own instructions in its system
// prompt, though the workspace holds a .pi/APPEND_SYSTEM.md of its own.
const PROBE = String.raw`
import http.server, json, os, signal, subprocess, sys, threading, time

spec = json.loads(sys.argv[1])
requests, platform_calls, errors = [], [], []
marker = 'PI_BRIDGE_ROUND_TRIP_OK'
final_text = 'Pi synthetic bridge round trip completed.'
token = 'synthetic-probe-only'

def chunk(delta, finish=None, usage=None):
    body = dict(id='chat_' + str(len(requests)), object='chat.completion.chunk',
                created=int(time.time()), model='claude-probe',
                choices=[dict(index=0, delta=delta, finish_reason=finish)])
    if usage is not None:
        body['usage'] = usage
    return body

tools = [dict(name=name, description='Synthetic ' + name, inputSchema=dict(type='object', properties={}))
         for name in ('connector', 'connector_status', 'workspace_tool', 'workspace_status')]

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        # The bridge opens no stream of its own: POST is the whole transport.
        self.send_response(405)
        self.send_header('Allow', 'POST')
        self.end_headers()

    def do_POST(self):
        try:
            body = json.loads(self.rfile.read(int(self.headers['Content-Length'])) or b'{}')
            if self.path == '/api/connectors/mcp':
                assert self.headers.get('Authorization') == 'Bearer ' + token, 'Pi sent the bridge no session key'
                self.mcp(body)
            elif self.path == '/openai/v1/chat/completions':
                self.chat(body)
            else:
                raise AssertionError('unexpected path ' + self.path)
        except Exception as error:
            errors.append(str(error))
            self.send_error(400, 'Synthetic protocol assertion failed')

    def mcp(self, message):
        if 'id' not in message:
            self.send_response(202)
            self.send_header('Content-Length', '0')
            self.end_headers()
            return
        method = message.get('method')
        if method == 'initialize':
            params = message.get('params') or {}
            result = dict(protocolVersion=params.get('protocolVersion', '2024-11-05'),
                          capabilities=dict(tools={}), serverInfo=dict(name='tale-connectors', version='1.0.0'))
        elif method == 'tools/list':
            result = dict(tools=tools)
        elif method == 'ping':
            result = {}
        elif method == 'tools/call':
            platform_calls.append(message)
            result = dict(content=[dict(type='text', text=json.dumps({'probe': marker, 'tools': []}))], isError=False)
        else:
            raise AssertionError('unexpected MCP method ' + str(method))
        self.answer_json(dict(jsonrpc='2.0', id=message['id'], result=result))

    def answer_json(self, payload):
        data = json.dumps(payload).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def chat(self, body):
        requests.append(body)
        assert len(requests) <= 2, 'unexpected model request'
        system = '\n'.join(
            message['content'] if isinstance(message.get('content'), str) else json.dumps(message.get('content'))
            for message in body.get('messages', []) if message.get('role') in ('system', 'developer'))
        assert 'PI_TALE_INSTRUCTIONS_OK' in system, "the exec's instructions are not in the system prompt"
        assert 'WORKSPACE_APPEND_TEXT' not in system, "the workspace's APPEND_SYSTEM.md reached the system prompt"
        usage = dict(prompt_tokens=11, completion_tokens=7, total_tokens=18)
        if len(requests) == 1:
            names = [tool.get('function', {}).get('name', '') for tool in body.get('tools', [])]
            status = [name for name in names if name.endswith('workspace_status')]
            assert status, 'the bridge tools were not offered: ' + ', '.join(names)
            assert any(name.endswith('workspace_tool') for name in names), 'workspace_tool missing'
            call = dict(index=0, id='call_1', type='function',
                        function=dict(name=status[0], arguments='{}'))
            chunks = [chunk(dict(role='assistant', content=None, tool_calls=[call])),
                      chunk({}, 'tool_calls', usage)]
            message = dict(role='assistant', content=None, tool_calls=[
                dict(id='call_1', type='function', function=call['function'])])
            finish = 'tool_calls'
        else:
            answers = [message for message in body.get('messages', [])
                       if message.get('role') == 'tool' and message.get('tool_call_id') == 'call_1']
            assert answers and marker in json.dumps(answers), 'the platform answer did not come back'
            chunks = [chunk(dict(role='assistant', content=final_text)), chunk({}, 'stop', usage)]
            message = dict(role='assistant', content=final_text)
            finish = 'stop'
        if body.get('stream'):
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream')
            self.end_headers()
            for event in chunks:
                self.wfile.write(('data: ' + json.dumps(event) + '\n\n').encode())
            self.wfile.write(b'data: [DONE]\n\n')
            self.wfile.flush()
        else:
            self.answer_json(dict(id='chat_' + str(len(requests)), object='chat.completion',
                                  created=int(time.time()), model='claude-probe', usage=usage,
                                  choices=[dict(index=0, message=message, finish_reason=finish)]))

server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
origin = 'http://127.0.0.1:' + str(server.server_port)
local = lambda value: value.replace('http://127.0.0.1:0', origin)
env = dict(PATH=os.environ['PATH'], HOME='/agent/.runtime/home', NO_PROXY='127.0.0.1',
           **{key: local(value) for key, value in spec['env'].items()})
os.makedirs(env['HOME'], exist_ok=True)
os.makedirs(os.path.join(spec['cwd'], '.pi'), exist_ok=True)
with open(os.path.join(spec['cwd'], '.pi', 'APPEND_SYSTEM.md'), 'w') as handle:
    handle.write('WORKSPACE_APPEND_TEXT')
proc = subprocess.Popen([local(arg) for arg in spec['argv']], cwd=spec['cwd'], env=env,
                        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                        text=True, start_new_session=True)
held = spec.get('stdinMode') == 'hold'
err_lines = []
threading.Thread(target=lambda: err_lines.extend(proc.stderr), daemon=True).start()
try:
    # A held stdin (Pi over RPC) stays open until Pi settles, as the platform
    # keeps it: an EOF before then aborts the run. Then its EOF ends Pi.
    proc.stdin.write(local(spec['stdin']))
    proc.stdin.flush()
    if not held:
        proc.stdin.close()
    out_lines = []
    for line in proc.stdout:
        out_lines.append(line)
        try:
            event = json.loads(line)
        except ValueError:
            continue
        if held and isinstance(event, dict) and event.get('type') == 'agent_settled':
            proc.stdin.close()
    proc.wait(timeout=15)
    sys.stdout.write(''.join(out_lines))
    sys.stderr.write(''.join(err_lines))
    assert proc.returncode == 0, f'Pi exited {proc.returncode}'
    assert not errors, errors
    assert len(requests) == 2, f'expected a tool round trip, got {len(requests)} model requests'
    assert len(platform_calls) == 1, f'expected one bridge call, got {len(platform_calls)}'
finally:
    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    proc.communicate(timeout=5)
    server.shutdown()
`;

/** Offline image proof: Pi, through the shipped exec builder, wrapper and
 * stream parser, calls a workspace tool over the platform's MCP server, which
 * it reaches over HTTP with no relay process, and reads its answer, with the
 * exec's own instructions in every request whatever the workspace holds,
 * bounded even if the CLI or the server stalls. */
export async function checkPiBridgeRoundTrip(image: string): Promise<void> {
  const fact = harnessDefinitionSchema.parse(
    parseYaml(
      readFileSync(
        join(projectRoot(), 'configs/platform/system/harnesses/pi/harness.yml'),
        'utf8',
      ),
    ),
  );
  const exec = buildHarnessExec(fact, {
    prompt: 'Follow the synthetic local responses to complete this probe.',
    model: 'claude-probe',
    credential: {
      mode: 'managed',
      gateway: {
        baseUrl: 'http://127.0.0.1:0',
        token: 'synthetic-probe-only',
        streamIdleTimeoutMs: 5000,
        requestTimeoutMs: 5000,
      },
    },
    workdir: '/agent/workspace',
    posture: 'act',
    instructions: 'Probe instructions: PI_TALE_INSTRUCTIONS_OK',
    mcp: { bridgeUrl: 'http://127.0.0.1:0/api/connectors' },
  });
  // The staged mcp.json mounts the platform's MCP server itself: a url and
  // the session key's reference, no relay command.
  const staged = JSON.parse((exec.stdin ?? '').split('\n')[0] ?? '{}') as {
    mcp?: { mcpServers?: { connectors?: Record<string, unknown> } };
  };
  assert.deepEqual(staged.mcp?.mcpServers?.connectors, {
    url: 'http://127.0.0.1:0/api/connectors/mcp',
    headers: { Authorization: 'Bearer ${TALE_GATEWAY_TOKEN}' },
    exposure: 'direct',
  });
  const result = await capture([
    'docker',
    'run',
    '--rm',
    '--network=none',
    '--read-only',
    '--cap-drop=ALL',
    '--user=10001:10001',
    '--tmpfs=/agent:uid=10001,gid=10001',
    '--tmpfs=/tmp:mode=1777',
    '--entrypoint=timeout',
    image,
    '90s',
    'python3',
    '-c',
    PROBE,
    JSON.stringify(exec),
  ]);
  assert.equal(result.exitCode, 0, result.combined.slice(-4000));
  const parser = createParser('pi');
  const events = [...parser.feed(result.stdout), ...parser.end()];
  const call = events.find((event) => event.type === 'tool-use');
  assert.ok(
    call?.type === 'tool-use' && call.toolName.endsWith('workspace_status'),
    `Pi called ${call?.type === 'tool-use' ? call.toolName : 'no tool'}`,
  );
  const output = events.find((event) => event.type === 'tool-result');
  assert.equal(
    output?.type === 'tool-result' && output.toolUseId,
    call.toolUseId,
  );
  assert.equal(output?.type === 'tool-result' && output.isError, false);
  assert.ok(
    JSON.stringify(output).includes('PI_BRIDGE_ROUND_TRIP_OK'),
    'the tool result does not carry the platform answer',
  );
  const end = events.find((event) => event.type === 'turn-ended');
  assert.equal(end?.type === 'turn-ended' && end.status, 'completed');
  assert.equal(
    end?.type === 'turn-ended' && end.finalText,
    'Pi synthetic bridge round trip completed.',
  );
}
