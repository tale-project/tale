import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { harnessDefinitionSchema } from '@tale/shared/schemas/providers';
import { parse as parseYaml } from 'yaml';

import { buildHarnessExec } from '../../../lib/harnesses/exec-builder';
import { createParser } from '../../../lib/harnesses/parsers/codex-jsonl';
import { capture, projectRoot } from './exec';

// Codex 0.160.0 advertises native code-mode tools in input.additional_tools.
// Exercise that actual protocol, including the second request carrying the
// command's output; a first-request refusal cannot prove tool execution works.
const PROBE = String.raw`
import http.server, json, os, signal, subprocess, sys, threading, time

spec = json.loads(sys.argv[1])
requests, errors = [], []
marker = 'CODEX_ROUND_TRIP_OK'
final_text = 'Codex synthetic tool round trip completed.'

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        try:
            self.respond()
        except Exception as error:
            errors.append(str(error))
            self.send_error(400, 'Synthetic protocol assertion failed')

    def respond(self):
        assert self.path == '/openai/v1/responses', self.path
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        requests.append(body)
        assert body['model'] == 'gpt-6.1-sol', body['model']
        assert len(requests) <= 2, 'unexpected model request'
        if len(requests) == 1:
            namespaces = [tool for item in body['input']
                          if item.get('type') == 'additional_tools'
                          for tool in item.get('tools', [])]
            assert any(ns.get('name') == 'functions' and
                       any(tool.get('name') == 'exec' and tool.get('type') == 'custom'
                           for tool in ns.get('tools', [])) for ns in namespaces), 'native exec tool missing'
            source = 'text(await tools.exec_command(' + json.dumps({
                'cmd': 'printf ' + marker, 'login': False, 'yield_time_ms': 1000,
            }) + '));'
            item = dict(type='custom_tool_call', id='tool_1', call_id='call_1',
                        namespace='functions', name='exec', input=source, status='completed')
            events = [
                dict(type='response.output_item.added', output_index=0,
                     item=dict(item, input='', status='in_progress')),
                dict(type='response.custom_tool_call_input.delta', item_id=item['id'],
                     output_index=0, delta=source),
                dict(type='response.custom_tool_call_input.done', item_id=item['id'],
                     output_index=0, input=source),
            ]
        else:
            assert any(item.get('type') == 'custom_tool_call_output' and
                       item.get('call_id') == 'call_1' and marker in json.dumps(item)
                       for item in body['input']), 'successful tool output not returned'
            part = dict(type='output_text', text=final_text, annotations=[])
            item = dict(type='message', id='message_1', role='assistant',
                        content=[part], status='completed')
            events = [
                dict(type='response.output_item.added', output_index=0,
                     item=dict(item, content=[], status='in_progress')),
                dict(type='response.content_part.added', item_id=item['id'], output_index=0,
                     content_index=0, part=dict(part, text='')),
                dict(type='response.output_text.delta', item_id=item['id'], output_index=0,
                     content_index=0, delta=final_text),
                dict(type='response.output_text.done', item_id=item['id'], output_index=0,
                     content_index=0, text=final_text),
                dict(type='response.content_part.done', item_id=item['id'], output_index=0,
                     content_index=0, part=part),
            ]
        response = dict(id='response_' + str(len(requests)), object='response',
                        created_at=int(time.time()), status='completed', model=body['model'],
                        output=[item], usage=dict(input_tokens=11, output_tokens=7,
                        total_tokens=18, input_tokens_details=dict(cached_tokens=0),
                        output_tokens_details=dict(reasoning_tokens=0)))
        events.insert(0, dict(type='response.created',
                             response=dict(response, status='in_progress', output=[])))
        events.extend([
            dict(type='response.output_item.done', output_index=0, item=item),
            dict(type='response.completed', response=response),
        ])
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.end_headers()
        for sequence, event in enumerate(events):
            event.update(sequence_number=sequence, response_id=response['id'])
            self.wfile.write(('event: ' + event['type'] + '\ndata: ' +
                             json.dumps(event) + '\n\n').encode())
            self.wfile.flush()

server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
argv = [arg.replace('http://127.0.0.1:0', 'http://127.0.0.1:' + str(server.server_port))
        for arg in spec['argv']]
env = dict(PATH=os.environ['PATH'], HOME='/agent/.runtime/home',
           NO_PROXY='127.0.0.1', **spec['env'])
os.makedirs(env['CODEX_HOME'])
os.makedirs(spec['cwd'])
proc = subprocess.Popen(argv, cwd=spec['cwd'], env=env, stdin=subprocess.PIPE,
                        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                        text=True, start_new_session=True)
try:
    stdout, stderr = proc.communicate(spec['stdin'], timeout=45)
    sys.stdout.write(stdout)
    sys.stderr.write(stderr)
    assert proc.returncode == 0, f'Codex exited {proc.returncode}'
    assert not errors, errors
    assert len(requests) == 2, f'expected tool round trip, got {len(requests)} requests'
finally:
    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    proc.communicate(timeout=5)
    server.shutdown()
`;

/** Offline image proof: real native tool execution through the shipped exec
 * builder and stream parser, bounded even if the CLI or server stalls. */
export async function checkCodexRoundTrip(image: string): Promise<void> {
  const fact = harnessDefinitionSchema.parse(
    parseYaml(
      readFileSync(
        join(
          projectRoot(),
          'configs/platform/system/harnesses/codex/harness.yml',
        ),
        'utf8',
      ),
    ),
  );
  const exec = buildHarnessExec(fact, {
    prompt: 'Follow the synthetic local response to complete this probe.',
    model: 'gpt-6.1-sol',
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
    '60s',
    'python3',
    '-c',
    PROBE,
    JSON.stringify(exec),
  ]);
  assert.equal(result.exitCode, 0, result.combined.slice(-4000));
  const parser = createParser('codex');
  const events = [...parser.feed(result.stdout), ...parser.end()];
  assert.ok(events.some((event) => event.type === 'turn-started'));
  const call = events.find((event) => event.type === 'tool-use');
  assert.equal(call?.toolName, 'Bash');
  const output = events.find((event) => event.type === 'tool-result');
  assert.equal(output?.toolUseId, call?.toolUseId);
  assert.equal(output?.isError, false);
  assert.deepEqual(output?.output, {
    output: 'CODEX_ROUND_TRIP_OK',
    exitCode: 0,
  });
  const end = events.find((event) => event.type === 'turn-ended');
  assert.equal(end?.status, 'completed');
  assert.equal(end?.finalText, 'Codex synthetic tool round trip completed.');
  assert.deepEqual(end?.usageTotals, { inputTokens: 22, outputTokens: 14 });
}
