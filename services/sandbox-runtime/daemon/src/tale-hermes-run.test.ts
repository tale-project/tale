// tale-hermes-run result + resume semantics. The pinned SDK reports most
// failures by RETURNING {completed:false, failed?:true, error} rather than
// raising, and carries no history behind a bare session id — so the wrapper
// must (a) end a returned failure as an error run, and (b) hand the agent a
// session store and, on --resume, the stored conversation. These drive the
// real wrapper against a fake `run_agent` / `hermes_state` on PYTHONPATH that
// record what they were handed.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const WRAPPER = resolve(import.meta.dir, '../../tale-hermes-run');
const hasPython = spawnSync('python3', ['-V']).status === 0;
const pyTest = hasPython ? test : test.skip;

// Fake SDK: records the constructor kwargs and the run_conversation call,
// answers with the result the test chose.
const FAKE_RUN_AGENT = `
import json, os

class AIAgent:
    def __init__(self, **kwargs):
        self.kwargs = kwargs
        self.session_id = kwargs.get("session_id") or "fresh-session"

    def run_conversation(self, user_message, conversation_history=None, **_kw):
        plain = (str, int, float, bool, type(None))
        record = {
            "ctor": {
                k: (v if isinstance(v, plain) else type(v).__name__)
                for k, v in self.kwargs.items()
            },
            "user_message": user_message,
            "conversation_history": conversation_history,
        }
        with open(os.environ["FAKE_SEEN"], "w", encoding="utf-8") as f:
            json.dump(record, f)
        return json.loads(os.environ["FAKE_RESULT"])
`;

const FAKE_HERMES_STATE = `
import json, os

class SessionDB:
    def __init__(self, db_path=None, read_only=False):
        if os.environ.get("FAKE_DB_FAIL"):
            raise RuntimeError("state.db is locked")

    def resolve_resume_session_id(self, session_id):
        return os.environ.get("FAKE_TIP") or session_id

    def get_messages_as_conversation(self, session_id, **_kw):
        return json.loads(os.environ.get("FAKE_HISTORY") or "[]")
`;

let root: string;
let seenPath: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'tale-hermes-')));
  seenPath = join(root, 'seen.json');
  for (const dir of ['workspace', 'sdk', 'home']) {
    mkdirSync(join(root, dir), { recursive: true });
  }
  writeFileSync(join(root, 'sdk', 'run_agent.py'), FAKE_RUN_AGENT);
  writeFileSync(join(root, 'sdk', 'hermes_state.py'), FAKE_HERMES_STATE);
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

interface RunOutcome {
  code: number | null;
  events: Array<Record<string, unknown>>;
  stderr: string;
  seen: {
    ctor: Record<string, unknown>;
    user_message: string;
    conversation_history: unknown;
  } | null;
}

function runWrapper(
  result: Record<string, unknown>,
  opts: { resume?: string; env?: Record<string, string> } = {},
): RunOutcome {
  const argv = [WRAPPER, '--workdir', join(root, 'workspace'), '--model', 'm'];
  if (opts.resume !== undefined) argv.push('--resume', opts.resume);
  const proc = spawnSync('python3', argv, {
    input: JSON.stringify({ prompt: 'hello', system_prompt: 'be brief' }),
    encoding: 'utf8',
    env: {
      ...process.env,
      PYTHONPATH: join(root, 'sdk'),
      HOME: join(root, 'home'),
      FAKE_SEEN: seenPath,
      FAKE_RESULT: JSON.stringify(result),
      ...opts.env,
    },
  });
  const events: Array<Record<string, unknown>> = proc.stdout
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line));
  const seen: RunOutcome['seen'] = existsSync(seenPath)
    ? JSON.parse(readFileSync(seenPath, 'utf8'))
    : null;
  return { code: proc.status, events, stderr: proc.stderr, seen };
}

const runEnd = (events: RunOutcome['events']) =>
  events.find((event) => event.type === 'run_end');

describe('tale-hermes-run result semantics', () => {
  pyTest('ends a returned API failure as an error run', () => {
    const out = runWrapper({
      final_response: 'HTTP 401: review synthetic unauthorized',
      completed: false,
      failed: true,
      error: 'HTTP 401: review synthetic unauthorized',
      api_calls: 1,
    });

    expect(out.code).toBe(1);
    expect(runEnd(out.events)).toMatchObject({
      status: 'error',
      error: 'HTTP 401: review synthetic unauthorized',
      final_text: 'HTTP 401: review synthetic unauthorized',
      api_error_status: 401,
    });
    // The error text is not posted as a reply.
    expect(out.events.some((e) => e.type === 'assistant_message')).toBe(false);
  });

  pyTest('ends a partial (incomplete) turn as an error run', () => {
    const out = runWrapper({
      final_response: 'Response truncated due to output length limit',
      completed: false,
      partial: true,
      error: 'Response truncated due to output length limit',
    });

    expect(out.code).toBe(1);
    expect(runEnd(out.events)).toMatchObject({
      status: 'error',
      error: 'Response truncated due to output length limit',
    });
    expect(runEnd(out.events)?.api_error_status).toBeUndefined();
  });

  pyTest(
    'reports a completed turn as ok and hands the agent a session store',
    () => {
      const out = runWrapper({
        final_response: 'Done.',
        completed: true,
        api_calls: 2,
      });

      expect(out.code).toBe(0);
      expect(runEnd(out.events)).toMatchObject({
        status: 'ok',
        final_text: 'Done.',
        session_id: 'fresh-session',
      });
      expect(out.events.some((e) => e.type === 'assistant_message')).toBe(true);
      // Persistence: the SDK only stores messages through the session_db it
      // is handed.
      expect(out.seen?.ctor.session_db).toBe('SessionDB');
      expect(out.seen?.conversation_history).toBeNull();
    },
  );
});

describe('tale-hermes-run resume', () => {
  pyTest(
    'restores the stored conversation and follows a compression tip',
    () => {
      const history = [
        { role: 'session_meta', content: 'ignored' },
        { role: 'user', content: 'Remember the code first-turn-code.' },
        { role: 'assistant', content: 'Remembered first-turn-code.' },
      ];
      const out = runWrapper(
        { final_response: 'first-turn-code', completed: true },
        {
          resume: 'sess-1',
          env: {
            FAKE_HISTORY: JSON.stringify(history),
            FAKE_TIP: 'sess-1-tip',
          },
        },
      );

      expect(out.code).toBe(0);
      expect(out.seen?.ctor.session_id).toBe('sess-1-tip');
      expect(out.seen?.conversation_history).toEqual(history.slice(1));
      expect(runEnd(out.events)?.session_id).toBe('sess-1-tip');
    },
  );

  pyTest(
    'continues under the same id with a fresh conversation when nothing is stored',
    () => {
      const out = runWrapper(
        { final_response: 'ok', completed: true },
        { resume: 'sess-empty' },
      );

      expect(out.code).toBe(0);
      expect(out.seen?.ctor.session_id).toBe('sess-empty');
      expect(out.seen?.conversation_history).toBeNull();
      expect(out.stderr).toContain('no stored history');
    },
  );

  pyTest('still runs the turn when the session store cannot be opened', () => {
    const out = runWrapper(
      { final_response: 'ok', completed: true },
      { resume: 'sess-1', env: { FAKE_DB_FAIL: '1' } },
    );

    expect(out.code).toBe(0);
    expect(out.seen?.ctor.session_db).toBeNull();
    expect(out.stderr).toContain('session store unavailable');
  });
});
