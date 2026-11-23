import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  harnessDefinitionSchema,
  type HarnessDefinition,
} from '@tale/shared/schemas/providers';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

import { parseJsonLine } from '../../../lib/harnesses/jsonl';
import { composeHarnessGlue } from '../../../lib/harnesses/registry';
import type {
  HarnessEvent,
  HarnessExec,
  HarnessRunSpec,
  HarnessSlug,
} from '../../../lib/harnesses/types';
import { harnessToolCallingWire } from '../../../lib/shared/providers/resolve_execution';
import { capture, projectRoot } from './exec';

// A runtime run past its context window (tale-project/tale#5417): the exec
// is built from the shipped harness YAML by the platform's own builder, with
// a catalog window of W tokens and an output limit, and runs against a
// loopback stand-in model of that window. The stand-in counts every request,
// refuses one that does not fit the way the wire refuses it, and asks for one
// long file after another until the runtime has compacted its conversation;
// then a second exec resumes the session and reads on from the summary.
// What a runtime needs beyond its YAML is one entry below.

/** The window every runtime runs against: none of the 32,768, 128,000 or
 * 200,000 tokens a default would produce. */
export const WINDOW_REACH_TOKENS = 49_152;

/** The catalog output limit staged beside the window: neither Pi's own
 * 16,384 nor the window itself, so a request asking for exactly this many
 * output tokens shows the staged limit reached the CLI, and one asking for
 * fewer shows it fitted its answer into the room the window leaves. */
const WINDOW_REACH_OUTPUT_LIMIT = 24_576;

/** What the probe needs to know of a runtime that its harness YAML does not
 * say. The exec, the wire its managed lane speaks and the stream parser come
 * from the YAML. */
export interface WindowReachRuntime {
  /** The harness whose shipped YAML builds both execs. */
  readonly slug: HarnessSlug;
  /** Text that only the runtime's compaction request carries: the stand-in
   * answers that request with a summary instead of the next step. */
  readonly compactionMarker: string;
  /** The runtime's file-read tool and its path argument. Each call reads one
   * part of a long report, which grows the conversation. */
  readonly readTool: { readonly name: string; readonly pathArgument: string };
  /** The stdout event that names the session a later exec resumes, and the
   * field that holds its id. */
  readonly sessionEvent: { readonly type: string; readonly field: string };
  /** The stdout event after which nothing follows: a held stdin is closed
   * there, as the platform closes it. */
  readonly settledEvent: string;
  /** The stdout event a compaction starts with, its field saying why, and
   * the value that field takes when the runtime compacts at its own
   * threshold. Any other value (Pi's `overflow`) means it compacted only
   * after a request had been refused. */
  readonly compactionStart: {
    readonly type: string;
    readonly field: string;
    readonly planned: string;
  };
  /** Whether the harness stages the catalog output limit: its requests then
   * ask for that limit while the window leaves room for it, and never for
   * more. */
  readonly stagesOutputLimit: boolean;
}

/** Pi 1.6.0 through `tale-pi-run --rpc`. It summarizes in a request of its
 * own under this system prompt, with no tools offered
 * (`dist/core/compaction/utils.js`); the wrapper names the session on its
 * first output line; Pi reports why it compacts on `compaction_start`. */
const PI_WINDOW_REACH: WindowReachRuntime = {
  slug: 'pi',
  compactionMarker: 'You are a context summarization assistant.',
  readTool: { name: 'read', pathArgument: 'path' },
  sessionEvent: { type: 'session', field: 'id' },
  settledEvent: 'agent_settled',
  compactionStart: {
    type: 'compaction_start',
    field: 'reason',
    planned: 'threshold',
  },
  stagesOutputLimit: true,
};

/** Every runtime the image lane runs past its window. Claude Code and its
 * compact-prompt variant are #5417's own entries still to come: each needs
 * an entry here and, for the Anthropic wire, an answerer in `WIRES` of the
 * program below. */
export const WINDOW_REACH_RUNTIMES: readonly WindowReachRuntime[] = [
  PI_WINDOW_REACH,
];

/** The wires the stand-in answers in (`WIRES` in the program). */
const STAND_IN_WIRES = ['openai-chat'] as const;

/** Stands in the second exec's resume slot until the first exec has named
 * its session; the program puts the real id in its place. */
const RESUME_HANDLE = 'window-reach-resume-handle';
/** Each exec's instructions carry their own marker: every request of an
 * exec must carry its marker, after a compaction and after the resume too. */
const INSTRUCTIONS = [
  'WINDOW_REACH_INSTRUCTIONS_1',
  'WINDOW_REACH_INSTRUCTIONS_2',
] as const;
const FINALS = [
  'WINDOW_REACH_FINAL_1: the first turn read past its window.',
  'WINDOW_REACH_FINAL_2: the resumed turn read on from its summary.',
] as const;
const PROMPTS = [
  'Read the long report under window-reach/, one part per call, as the synthetic responses ask.',
  'Read on from where you left off, as the synthetic responses ask.',
] as const;

/** The parts written to the workspace, and their size: one part is 4,692
 * tokens by the stand-in's count, so the first exec outgrows the window in
 * eleven reads. */
const PARTS = 30;
const PART_LINES = 200;
/** One exec's bound, then the container's, so a runtime that never settles
 * fails the probe with what it did instead of hanging the lane. Pi 1.6.0
 * runs either exec in about a second. */
const EXEC_DEADLINE_SECONDS = 60;
const CONTAINER_TIMEOUT_SECONDS = 2 * EXEC_DEADLINE_SECONDS + 30;

// The stand-in model and both execs, in the image. It counts each request's
// tokens as one per 3.5 bytes of its body, rounded up: the rate Pi assumes
// for text (pi-ai's estimate), counted here over the whole body — JSON, tool
// schemas and all — so the stand-in never counts a request as smaller than
// its text. It refuses a request whose messages, or messages and output cap,
// exceed the window, with the wire's context-length error counted the way
// OpenAI and vLLM count it. It reports each request's count as the usage, as
// a provider reports its own. A summary request (the runtime's compaction
// marker) gets a summary with a marker of its own; every other request reads
// the next part, until the exec has compacted and read once more — the first
// exec also until its reads add up to more than the window — and then gets
// the exec's final answer. Every request is recorded; the report goes to
// stdout as one JSON line.
const PROGRAM = String.raw`
import http.server, json, os, signal, subprocess, sys, threading, time

spec = json.loads(sys.argv[1])
runtime, window = spec['runtime'], spec['window']
lock = threading.Lock()
requests, errors, summaries, part_tokens = [], [], [], []
state = dict(exec=0, compacted=0, after=0, read=0, part=0)


def tokens(data):
    return -(-len(data) * 2 // 7)


def part_marker(number):
    return 'WINDOW_REACH_PART_%02d' % number


def part_path(number):
    return os.path.join(spec['execs'][0]['cwd'], 'window-reach', 'part-%02d.txt' % number)


def part_text(number):
    lines = [part_marker(number)] + [
        'part %02d line %03d: the agent reads one more page of a long report into its window.'
        % (number, line) for line in range(1, spec['partLines'] + 1)]
    return '\n'.join(lines) + '\n'


SUMMARY = '''## Goal
Read the long report under window-reach/, one part per call (%s).

## Constraints & Preferences
- (none)

## Progress
### Done
- [x] Read %s.

### In Progress
- [ ] Read the next part.

### Blocked
- (none)

## Key Decisions
- **One part per call**: every part is long.

## Next Steps
1. Read the next part.

## Critical Context
- Earlier checkpoints: %s'''


class OpenAIChat:
    path = '/openai/v1/chat/completions'

    def system(self, body):
        return '\n'.join(
            message['content'] if isinstance(message.get('content'), str)
            else json.dumps(message.get('content'))
            for message in body.get('messages', [])
            if message.get('role') in ('system', 'developer'))

    def cap(self, body):
        for field in ('max_completion_tokens', 'max_tokens'):
            if isinstance(body.get(field), int):
                return body[field]
        return None

    def refuse(self, handler, count, cap):
        message = ("This model's maximum context length is %d tokens. However, you requested "
                   '%d tokens (%d in the messages, %d in the completion). Please reduce the '
                   'length of the messages or completion.'
                   % (window, count + (cap or 0), count, cap or 0))
        handler.answer(400, 'application/json', json.dumps(dict(error=dict(
            message=message, type='invalid_request_error', param='messages',
            code='context_length_exceeded'))).encode())

    def reply(self, handler, body, count, message):
        made = tokens(json.dumps(message).encode())
        usage = dict(prompt_tokens=count, completion_tokens=made, total_tokens=count + made)
        finish = 'tool_calls' if message.get('tool_calls') else 'stop'
        name, created = 'chat_%d' % len(requests), int(time.time())
        if not body.get('stream'):
            return handler.answer(200, 'application/json', json.dumps(dict(
                id=name, object='chat.completion', created=created, model=body.get('model'),
                usage=usage, choices=[dict(index=0, message=message, finish_reason=finish)])).encode())
        delta = dict(message)
        if delta.get('tool_calls'):
            delta['tool_calls'] = [dict(call, index=index)
                                   for index, call in enumerate(delta['tool_calls'])]
        chunks = [dict(choices=[dict(index=0, delta=delta, finish_reason=None)]),
                  dict(choices=[dict(index=0, delta={}, finish_reason=finish)], usage=usage)]
        handler.answer(200, 'text/event-stream', b''.join(
            ('data: ' + json.dumps(dict(chunk, id=name, object='chat.completion.chunk',
                                        created=created, model=body.get('model'))) + '\n\n').encode()
            for chunk in chunks) + b'data: [DONE]\n\n')


WIRES = {'openai-chat': OpenAIChat}
wire = WIRES[runtime['wire']]()


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def answer(self, status, content_type, data):
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        try:
            raw = self.rfile.read(int(self.headers['Content-Length']))
            assert self.path == wire.path, 'unexpected path ' + self.path
            with lock:
                self.respond(raw, json.loads(raw))
        except Exception as error:
            errors.append('%s: %r' % (self.path, error))
            self.send_error(500, 'Window-reach stand-in failed')

    def respond(self, raw, body):
        text, system = raw.decode('utf-8'), wire.system(body)
        count, cap = tokens(raw), wire.cap(body)
        record = dict(
            n=len(requests) + 1, exec=state['exec'], tokens=count, cap=cap,
            compaction=runtime['compactionMarker'] in text,
            parts=[number for number in range(1, len(part_tokens) + 1)
                   if part_marker(number) in text],
            summaries=[marker for marker in summaries if marker in text],
            instructions=[index for index, marker in enumerate(spec['instructions'], 1)
                          if marker in system],
            reply='', summary=None, readPart=None)
        requests.append(record)
        if count > window or (cap is not None and count + cap > window):
            record['reply'] = 'refused'
            return wire.refuse(self, count, cap)
        if record['compaction']:
            state['compacted'] += 1
            state['after'] = 0
            marker = 'WINDOW_REACH_SUMMARY_%02d' % (len(summaries) + 1)
            summaries.append(marker)
            record['reply'], record['summary'] = 'summary', marker
            covered = record['parts']
            done = 'parts %d to %d' % (covered[0], covered[-1]) if covered else 'no part yet'
            content = SUMMARY % (marker, done, ', '.join(record['summaries']) or '(none)')
            return wire.reply(self, body, count, dict(role='assistant', content=content))
        index = state['exec'] - 1
        if (state['compacted'] and state['after'] >= spec['readsAfterCompaction']
                and (not spec['outgrow'][index] or state['read'] > window)):
            record['reply'] = 'final'
            return wire.reply(self, body, count, dict(role='assistant', content=spec['finals'][index]))
        if state['part'] >= len(part_tokens):
            record['reply'] = 'out-of-parts'
            return wire.reply(self, body, count, dict(role='assistant', content='WINDOW_REACH_OUT_OF_PARTS'))
        state['part'] += 1
        state['read'] += part_tokens[state['part'] - 1]
        if state['compacted']:
            state['after'] += 1
        record['reply'], record['readPart'] = 'read', state['part']
        call = dict(id='call_%d' % record['n'], type='function', function=dict(
            name=runtime['readTool']['name'],
            arguments=json.dumps({runtime['readTool']['pathArgument']: part_path(state['part'])})))
        return wire.reply(self, body, count, dict(role='assistant', content=None, tool_calls=[call]))


def parse(line):
    try:
        event = json.loads(line)
    except ValueError:
        return None
    return event if isinstance(event, dict) else None


def kill_group(proc):
    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except ProcessLookupError:
        return False
    return True


def run(index, exec_spec):
    with lock:
        state.update(exec=index, compacted=0, after=0, read=0)
    env = dict(PATH=os.environ['PATH'], HOME=spec['home'], NO_PROXY='127.0.0.1',
               **{key: local(value) for key, value in exec_spec['env'].items()})
    proc = subprocess.Popen([local(arg) for arg in exec_spec['argv']], cwd=exec_spec['cwd'],
                            env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, text=True, start_new_session=True)
    expired, out_lines, err_lines = [], [], []

    def expire():
        if kill_group(proc):
            expired.append(True)

    timer = threading.Timer(spec['deadlineSeconds'], expire)
    timer.start()
    reader = threading.Thread(target=lambda: err_lines.extend(proc.stderr), daemon=True)
    reader.start()
    held = exec_spec.get('stdinMode') == 'hold'
    try:
        # A held stdin (Pi over RPC) stays open until the turn settles, as the
        # platform keeps it: an EOF before then aborts the run.
        try:
            proc.stdin.write(local(exec_spec.get('stdin') or ''))
            proc.stdin.flush()
        except BrokenPipeError:
            err_lines.append('[window-reach] the exec closed its stdin before taking it\n')
        if not held:
            proc.stdin.close()
        for line in proc.stdout:
            out_lines.append(line)
            event = parse(line) if held and not proc.stdin.closed else None
            if event is not None and event.get('type') == runtime['settledEvent']:
                proc.stdin.close()
        try:
            proc.wait(timeout=15)
        except subprocess.TimeoutExpired:
            err_lines.append('[window-reach] the exec kept running after its output ended\n')
    finally:
        timer.cancel()
        kill_group(proc)
        proc.wait(timeout=5)
        reader.join(timeout=5)
    return dict(exit=proc.returncode, expired=bool(expired), stdout=''.join(out_lines),
                stderr=''.join(err_lines)[-4000:])


def session_handle(stdout):
    want = runtime['sessionEvent']
    for line in stdout.splitlines():
        event = parse(line)
        if (event is not None and event.get('type') == want['type']
                and isinstance(event.get(want['field']), str)):
            return event[want['field']]
    return None


server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
origin = 'http://127.0.0.1:' + str(server.server_port)
local = lambda value: value.replace('http://127.0.0.1:0', origin)
for exec_spec in spec['execs']:
    os.makedirs(exec_spec['cwd'], exist_ok=True)
os.makedirs(os.path.dirname(part_path(1)), exist_ok=True)
os.makedirs(spec['home'], exist_ok=True)
for number in range(1, spec['parts'] + 1):
    data = part_text(number)
    part_tokens.append(tokens(data.encode()))
    with open(part_path(number), 'w') as out:
        out.write(data)
execs = [run(1, spec['execs'][0])]
handle = session_handle(execs[0]['stdout'])
if handle is not None:
    resumed = dict(spec['execs'][1], argv=[handle if arg == spec['resumeHandle'] else arg
                                           for arg in spec['execs'][1]['argv']])
    execs.append(run(2, resumed))
server.shutdown()
sys.stdout.write(json.dumps(dict(requests=requests, errors=errors, execs=execs, handle=handle,
                                 partTokens=part_tokens)) + '\n')
`;

/** Where the program runs: the execs' workspace and HOME, and how it is
 * started — `run` takes `python3 -c <program> <argument>` and answers what
 * it printed. {@link windowReachInImage} runs it in the image; a local lab
 * runs the same probe against a CLI on its own PATH. */
export interface WindowReachHost {
  readonly workdir: string;
  readonly home: string;
  readonly run: (
    argv: string[],
  ) => Promise<{ exitCode: number; stdout: string; combined: string }>;
}

/** The program's one argument. */
interface WindowReachInput {
  readonly runtime: WindowReachRuntime & { readonly wire: string };
  readonly window: number;
  readonly home: string;
  readonly execs: readonly [HarnessExec, HarnessExec];
  readonly resumeHandle: string;
  readonly instructions: readonly string[];
  readonly finals: readonly string[];
  /** Per exec: read on until the exec's reads add up to more than the window. */
  readonly outgrow: readonly boolean[];
  readonly parts: number;
  readonly partLines: number;
  readonly readsAfterCompaction: number;
  readonly deadlineSeconds: number;
}

/** One run's setup: the runtime, its parsed harness fact, and the stand-in
 * program's argument. */
interface WindowReachProbe {
  readonly runtime: WindowReachRuntime;
  readonly fact: HarnessDefinition;
  readonly input: WindowReachInput;
}

/** The two execs, built from the runtime's shipped harness YAML by the
 * builder the platform runs turns with, as a managed turn on a model whose
 * catalog window is {@link WINDOW_REACH_TOKENS} and output limit
 * {@link WINDOW_REACH_OUTPUT_LIMIT}; the second resumes the first's session
 * under instructions of its own. */
function windowReachProbe(
  runtime: WindowReachRuntime,
  paths: Pick<WindowReachHost, 'workdir' | 'home'>,
): WindowReachProbe {
  const fact = harnessDefinitionSchema.parse(
    parseYaml(
      readFileSync(
        join(
          projectRoot(),
          'configs/platform/system/harnesses',
          runtime.slug,
          'harness.yml',
        ),
        'utf8',
      ),
    ),
  );
  const wire = harnessToolCallingWire(fact);
  if (!(STAND_IN_WIRES as readonly string[]).includes(wire)) {
    throw new Error(
      `the window-reach stand-in does not answer ${runtime.slug}'s ${wire} wire`,
    );
  }
  const glue = composeHarnessGlue(fact);
  const turn = (index: 0 | 1): HarnessRunSpec => ({
    prompt: PROMPTS[index],
    model: 'window-reach-model',
    contextWindow: WINDOW_REACH_TOKENS,
    maxOutputTokens: WINDOW_REACH_OUTPUT_LIMIT,
    credential: {
      mode: 'managed',
      gateway: {
        baseUrl: 'http://127.0.0.1:0',
        token: 'synthetic-probe-only',
        streamIdleTimeoutMs: 30_000,
        requestTimeoutMs: 30_000,
      },
    },
    workdir: paths.workdir,
    posture: 'act',
    instructions: `Probe instructions: ${INSTRUCTIONS[index]}`,
    ...(index === 1 ? { resume: RESUME_HANDLE } : {}),
  });
  const execs = [glue.buildExec(turn(0)), glue.buildExec(turn(1))] as const;
  if (execs[1].argv.filter((arg) => arg === RESUME_HANDLE).length !== 1) {
    throw new Error(
      `${runtime.slug}'s resumed exec does not carry its resume handle as one argument`,
    );
  }
  return {
    runtime,
    fact,
    input: {
      runtime: { ...runtime, wire },
      window: WINDOW_REACH_TOKENS,
      home: paths.home,
      execs,
      resumeHandle: RESUME_HANDLE,
      instructions: INSTRUCTIONS,
      finals: FINALS,
      outgrow: [true, false],
      parts: PARTS,
      partLines: PART_LINES,
      readsAfterCompaction: 1,
      deadlineSeconds: EXEC_DEADLINE_SECONDS,
    },
  };
}

const requestSchema = z.object({
  n: z.number(),
  exec: z.number(),
  tokens: z.number(),
  cap: z.number().nullable(),
  compaction: z.boolean(),
  parts: z.array(z.number()),
  summaries: z.array(z.string()),
  instructions: z.array(z.number()),
  reply: z.string(),
  summary: z.string().nullable(),
  readPart: z.number().nullable(),
});

const reportSchema = z.object({
  requests: z.array(requestSchema),
  errors: z.array(z.string()),
  execs: z.array(
    z.object({
      exit: z.number().nullable(),
      expired: z.boolean(),
      stdout: z.string(),
      stderr: z.string(),
    }),
  ),
  handle: z.string().nullable(),
  partTokens: z.array(z.number()),
});

/** The program's report: every request the stand-in took, as it recorded
 * it, and what each exec printed. */
type WindowReachReport = z.infer<typeof reportSchema>;

/** The report on the program's last stdout line. */
function readWindowReachReport(stdout: string): WindowReachReport {
  const line = stdout.trimEnd().split('\n').at(-1) ?? '';
  return reportSchema.parse(JSON.parse(line));
}

/** What a run that held showed, for its pass line. */
export interface WindowReachResult {
  readonly requests: number;
  /** The most tokens one request carried. */
  readonly largest: number;
  /** Each summary request: which request it was, in which exec. */
  readonly compactions: readonly {
    readonly n: number;
    readonly exec: number;
  }[];
  /** The tokens of the resumed exec's first request. */
  readonly resumedAt: number;
}

/** The ids a stream's events name, and how its turn ended, read with the
 * runtime's own parser. */
function readStream(
  fact: HarnessDefinition,
  stdout: string,
): {
  sessions: string[];
  ended?: Extract<HarnessEvent, { type: 'turn-ended' }>;
} {
  const parser = composeHarnessGlue(fact).createParser();
  const events = [...parser.feed(stdout), ...parser.end()];
  const sessions = events.flatMap((event) =>
    event.type === 'turn-started' && event.sessionId !== undefined
      ? [event.sessionId]
      : [],
  );
  const ended = events.find(
    (event): event is Extract<HarnessEvent, { type: 'turn-ended' }> =>
      event.type === 'turn-ended',
  );
  return { sessions, ...(ended === undefined ? {} : { ended }) };
}

/** Why each compaction a stream reports started, in order. */
function compactionReasons(
  runtime: WindowReachRuntime,
  stdout: string,
): string[] {
  return stdout.split('\n').flatMap((line) => {
    const event = line.startsWith('{') ? parseJsonLine(line) : null;
    return event?.type === runtime.compactionStart.type
      ? [String(event[runtime.compactionStart.field])]
      : [];
  });
}

/**
 * Hold a run to the window: no request exceeded it or asked for more output
 * than it left; the runtime compacted at its own threshold while the first
 * exec's reads outgrew the window, and again after the resume; every request
 * after a compaction carried its summary and left out what the summary
 * replaced; every request carried its own exec's instructions and no other's;
 * the resumed exec ran the first exec's session; both turns settled with
 * their final answers; and, where the harness stages the output limit, some
 * request asked for it and none for more. Throws one error naming the
 * failures.
 */
function judgeWindowReach(
  probe: WindowReachProbe,
  report: WindowReachReport,
): WindowReachResult {
  const { runtime, input } = probe;
  const { window } = input;
  // Each kind of failure is named once, by its first instance and a count.
  const failures = new Map<string, { first: string; count: number }>();
  const fail = (kind: string, failure: string): void => {
    const seen = failures.get(kind);
    if (seen === undefined) failures.set(kind, { first: failure, count: 1 });
    else seen.count += 1;
  };
  for (const error of report.errors) {
    fail('stand-in', `the stand-in model failed: ${error}`);
  }
  report.execs.forEach((exec, index) => {
    if (exec.exit === 0) return;
    const bound = exec.expired
      ? `, killed after ${input.deadlineSeconds} s without settling`
      : '';
    const said = exec.stderr.trim();
    fail(
      `exit ${index}`,
      `exec ${index + 1} exited ${exec.exit ?? 'without a status'}${bound}${said ? `: ${said.slice(-400)}` : ''}`,
    );
  });
  if (report.handle === null) {
    fail(
      'handle',
      `exec 1 named no session to resume (no ${runtime.sessionEvent.type} event)`,
    );
  }

  // The window: every request fits it, output cap included.
  for (const request of report.requests) {
    const at = `request #${request.n} (exec ${request.exec}${request.compaction ? ', a summary request' : ''})`;
    if (request.tokens > window) {
      fail(
        'refused',
        `a refused request: ${at} carried ${request.tokens} tokens, more than the window of ${window}`,
      );
    } else if (request.cap === null) {
      fail('no cap', `${at} set no output cap`);
    } else if (request.tokens + request.cap > window) {
      fail(
        'refused',
        `a refused request: ${at} asked for ${request.cap} output tokens, more than the ${window - request.tokens} its ${request.tokens} tokens leave of the window`,
      );
    }
    if (
      runtime.stagesOutputLimit &&
      request.cap !== null &&
      request.cap > WINDOW_REACH_OUTPUT_LIMIT
    ) {
      fail(
        'over limit',
        `${at} asked for ${request.cap} output tokens, more than the staged limit of ${WINDOW_REACH_OUTPUT_LIMIT}`,
      );
    }
    if (request.reply === 'out-of-parts') {
      fail(
        'out of parts',
        `the stand-in ran out of its ${input.parts} parts at request #${request.n} (exec ${request.exec})`,
      );
    }
  }
  if (
    runtime.stagesOutputLimit &&
    !report.requests.some((r) => r.cap === WINDOW_REACH_OUTPUT_LIMIT)
  ) {
    fail(
      'limit unseen',
      `the staged output limit never reached ${runtime.slug}: no request asked for ${WINDOW_REACH_OUTPUT_LIMIT} output tokens`,
    );
  }

  // Compaction: before the window ran out, in both execs.
  const firstRead = report.requests
    .filter((r) => r.exec === 1 && r.readPart !== null)
    .reduce(
      (sum, r) => sum + (report.partTokens[(r.readPart ?? 0) - 1] ?? 0),
      0,
    );
  if (firstRead <= window) {
    fail(
      'not outgrown',
      `the first exec's reads added up to ${firstRead} tokens, never more than the window: the run shows nothing about compaction`,
    );
  }
  report.execs.forEach((exec, index) => {
    const label = index === 0 ? 'the first exec' : 'the resumed exec';
    if (!report.requests.some((r) => r.compaction && r.exec === index + 1)) {
      fail(
        `no compaction ${index}`,
        `no compaction: ${runtime.slug} never asked for a summary in ${label}`,
      );
    }
    const late = compactionReasons(runtime, exec.stdout).filter(
      (reason) => reason !== runtime.compactionStart.planned,
    );
    if (late.length > 0) {
      fail(
        `late compaction ${index}`,
        `${label} compacted only after the window ran out, ${late.length} times (${runtime.compactionStart.type} ${runtime.compactionStart.field}: ${[...new Set(late)].join(', ')})`,
      );
    }
  });

  // The summary: carried from each compaction on, through the resume.
  let summary: string | null = null;
  const replaced = new Set<number>();
  const firstResumed = report.requests.find(
    (r) => !r.compaction && r.exec === 2,
  );
  for (const request of report.requests) {
    if (request.compaction) {
      for (const part of request.parts) replaced.add(part);
      summary = request.summary ?? summary;
      continue;
    }
    const at = `request #${request.n} (exec ${request.exec})`;
    if (summary !== null && !request.summaries.includes(summary)) {
      fail(
        'lost summary',
        request === firstResumed
          ? `a lost summary: the resumed exec's first request #${request.n} does not continue from ${summary}`
          : `a lost summary: ${at} does not carry ${summary}`,
      );
    }
    const again = request.parts.filter((part) => replaced.has(part));
    if (again.length > 0) {
      fail(
        'sent again',
        `${at} sent part ${again.join(', ')} again, after a summary replaced it`,
      );
    }
    if (!request.instructions.includes(request.exec)) {
      fail(
        'lost instructions',
        `${at} lost exec ${request.exec}'s instructions`,
      );
    }
    const stale = request.instructions.filter((exec) => exec !== request.exec);
    if (stale.length > 0) {
      fail(
        'stale instructions',
        `${at} still carries exec ${stale.join(', ')}'s instructions`,
      );
    }
  }
  if (report.execs.length > 1 && firstResumed === undefined) {
    fail('no resumed request', 'the resumed exec sent no request');
  }

  // Both turns end with their answers, the second in the first's session.
  const streams = report.execs.map((exec) =>
    readStream(probe.fact, exec.stdout),
  );
  streams.forEach(({ ended }, index) => {
    if (
      ended?.status === 'completed' &&
      ended.finalText === input.finals[index]
    ) {
      return;
    }
    const seen =
      ended === undefined
        ? 'no turn end'
        : `${ended.status}: ${JSON.stringify(ended.finalText ?? '')}`;
    fail(
      `final ${index}`,
      `exec ${index + 1} did not settle with its final answer (${seen})`,
    );
  });
  const [first, resumed] = streams;
  if (report.handle !== null && first?.sessions[0] !== report.handle) {
    fail(
      'session',
      `the first exec's stream names session ${first?.sessions[0] ?? 'none'}, not the ${report.handle} the probe resumed`,
    );
  }
  if (resumed !== undefined && resumed.sessions[0] !== first?.sessions[0]) {
    fail(
      'session',
      `the resumed exec ran session ${resumed.sessions[0] ?? 'none'}, not the first exec's ${first?.sessions[0] ?? 'none'}`,
    );
  }

  if (failures.size > 0) {
    const named = [...failures.values()].map(({ first: failure, count }) =>
      count > 1 ? `${failure} (and ${count - 1} more like it)` : failure,
    );
    throw new Error(
      `${runtime.slug} past a ${window}-token window: ${named.join('; ')}`,
    );
  }
  return {
    requests: report.requests.length,
    largest: Math.max(...report.requests.map((r) => r.tokens)),
    compactions: report.requests
      .filter((r) => r.compaction)
      .map((r) => ({ n: r.n, exec: r.exec })),
    resumedAt: firstResumed?.tokens ?? 0,
  };
}

/** The program in the image, offline, as the agent user, bounded by the
 * container's timeout. */
export function windowReachInImage(image: string): WindowReachHost {
  return {
    workdir: '/agent/workspace',
    home: '/agent/.runtime/home',
    run: (argv) =>
      capture([
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
        `${CONTAINER_TIMEOUT_SECONDS}s`,
        ...argv,
      ]),
  };
}

/** Offline proof: the runtime's pinned CLI, through the shipped exec
 * builder, wrapper and stream parser, runs past a window of
 * {@link WINDOW_REACH_TOKENS} tokens against a loopback stand-in model,
 * compacts before the window runs out, and a resumed exec reads on from the
 * summary — bounded even if the CLI or the stand-in stalls. */
export async function checkWindowReach(
  runtime: WindowReachRuntime,
  host: WindowReachHost,
): Promise<WindowReachResult> {
  const probe = windowReachProbe(runtime, host);
  const result = await host.run([
    'python3',
    '-c',
    PROGRAM,
    JSON.stringify(probe.input),
  ]);
  if (result.exitCode !== 0) {
    throw new Error(
      `the window-reach program exited ${result.exitCode}: ${result.combined.slice(-4000)}`,
    );
  }
  return judgeWindowReach(probe, readWindowReachReport(result.stdout));
}
