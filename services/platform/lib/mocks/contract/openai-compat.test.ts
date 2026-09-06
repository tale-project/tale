/**
 * Contract tests for the OpenAI-compatible AI provider mocks.
 *
 * Boots the real gateway in-process on an ephemeral port and asserts that every
 * AI endpoint returns a deterministic, spec-shaped response — the guarantee the
 * hermetic e2e/manual stack and the platform's provider code rely on. The chat
 * route is served by the streaming override; everything else by Prism examples.
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { DEMO_PROJECTS } from '../../../tests/docs-screenshots/demo-content';
import { startGateway, type GatewayHandle } from '../gateway';
import {
  CANNED_ERROR_MESSAGE,
  CANNED_REPLY,
  MOCK_TRIGGERS,
} from '../overrides/canned';
import { DOCS_REPLIES } from '../overrides/docs-replies';
import { readJson } from './json';

let gw: GatewayHandle;
const post = (
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  fetch(`${gw.baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  gw = await startGateway(0);
});
afterAll(() => gw.stop());

describe('gateway health + routing', () => {
  test('GET /health returns ok', async () => {
    const res = await fetch(`${gw.baseUrl}/health`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });

  test('unknown route → 404', async () => {
    const res = await fetch(`${gw.baseUrl}/nope/nowhere`);
    expect(res.status).toBe(404);
  });
});

describe('chat/completions override', () => {
  test('default → canned reply (non-stream)', async () => {
    const res = await post('/v1/chat/completions', {
      model: 'e2e-chat-model',
      messages: [{ role: 'user', content: 'hello' }],
    });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.choices[0].message.content).toBe(CANNED_REPLY);
  });

  test('json response_format → empty object', async () => {
    const res = await post('/v1/chat/completions', {
      model: 'm',
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: 'route this' }],
    });
    const body = await readJson(res);
    expect(body.choices[0].message.content).toBe('{}');
  });

  test('error trigger → HTTP 500', async () => {
    const res = await post('/v1/chat/completions', {
      model: 'm',
      messages: [{ role: 'user', content: 'e2e:error now' }],
    });
    expect(res.status).toBe(500);
    const body = await readJson(res);
    expect(body.error.message).toBe(CANNED_ERROR_MESSAGE);
  });

  test('streaming emits assistant role delta then [DONE]', async () => {
    const res = await post('/v1/chat/completions', {
      model: 'm',
      stream: true,
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const text = await res.text();
    expect(text).toContain('"role":"assistant"');
    expect(text.trimEnd().endsWith('data: [DONE]')).toBe(true);
  });

  test('reasoning trigger streams reasoning_content', async () => {
    const res = await post('/v1/chat/completions', {
      model: 'm',
      stream: true,
      messages: [{ role: 'user', content: 'e2e:reasoning please' }],
    });
    expect(await res.text()).toContain('reasoning_content');
  });

  test('human-input trigger emits a request_human_input tool call', async () => {
    const res = await post('/v1/chat/completions', {
      model: 'm',
      stream: true,
      messages: [{ role: 'user', content: 'e2e:humaninput go' }],
    });
    const text = await res.text();
    expect(text).toContain('request_human_input');
    expect(text).toContain('"finish_reason":"tool_calls"');
  });

  test('file-write trigger emits file_write tool calls, then acks on resume (#2688)', async () => {
    const first = await post('/v1/chat/completions', {
      model: 'm',
      stream: true,
      messages: [{ role: 'user', content: 'e2e:filewrite go' }],
    });
    const firstText = await first.text();
    expect(firstText).toContain('file_write');
    expect(firstText).toContain('/agent/output/report.md');
    expect(firstText).toContain('"finish_reason":"tool_calls"');

    // Resume turn (a tool result is now in the conversation) streams the
    // plain-text ack instead of re-emitting the tool calls.
    const resume = await post('/v1/chat/completions', {
      model: 'm',
      stream: true,
      messages: [
        { role: 'user', content: 'e2e:filewrite go' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_e2e_fw_0',
              type: 'function',
              function: { name: 'file_write', arguments: '{}' },
            },
          ],
        },
        { role: 'tool', content: '{"ok":true}' },
      ],
    });
    const resumeText = await resume.text();
    expect(resumeText).not.toContain('"finish_reason":"tool_calls"');
    expect(resumeText).toContain('Canvas');
  });

  test('plan trigger emits an update_todos tool call (#2688)', async () => {
    const res = await post('/v1/chat/completions', {
      model: 'm',
      stream: true,
      messages: [{ role: 'user', content: 'e2e:plan go' }],
    });
    const text = await res.text();
    expect(text).toContain('update_todos');
    expect(text).toContain('in_progress');
    expect(text).toContain('"finish_reason":"tool_calls"');
  });

  test('docs phrase streams its scripted reply (reasoning first)', async () => {
    const scripted = DOCS_REPLIES.find((entry) => entry.reasoning);
    if (!scripted) throw new Error('expected a docs reply with reasoning');
    const res = await post('/v1/chat/completions', {
      model: 'm',
      stream: true,
      messages: [
        { role: 'user', content: `Please ${scripted.match} for the team.` },
      ],
    });
    const text = await res.text();
    expect(text).toContain('reasoning_content');
    // First words of the scripted reply arrive as content deltas.
    const firstWord = scripted.reply.split(/\s+/)[0];
    expect(text).toContain(firstWord);
    expect(text).not.toContain(CANNED_REPLY.split(' ')[0]);
  });

  test('docs phrase carries its scripted reply on the non-stream path', async () => {
    const scripted = DOCS_REPLIES[0];
    const res = await post('/v1/chat/completions', {
      model: 'm',
      messages: [{ role: 'user', content: `Please ${scripted.match}.` }],
    });
    const body = await readJson(res);
    expect(body.choices[0].message.content).toBe(scripted.reply);
  });

  test('a tool-scripted docs phrase emits its tool call, then acks on resume', async () => {
    // The docs-videos canvas scene: a clean on-camera prompt (no e2e keyword)
    // emits a `file_write` tool call with reasoning first, and the follow-up
    // turn streams the plain-text ack — mirroring the e2e fileWrite scenario.
    const scripted = DOCS_REPLIES.find(
      (entry) => entry.tool?.name === 'file_write',
    );
    if (!scripted || scripted.tool?.name !== 'file_write')
      throw new Error('expected a file_write docs script');
    const first = await post('/v1/chat/completions', {
      model: 'm',
      stream: true,
      messages: [{ role: 'user', content: `Please ${scripted.match}.` }],
    });
    const firstText = await first.text();
    expect(firstText).toContain('reasoning_content');
    expect(firstText).toContain('file_write');
    expect(firstText).toContain(
      JSON.stringify(scripted.tool.files[0].path).slice(1, -1),
    );
    expect(firstText).toContain('"finish_reason":"tool_calls"');
    // The ack text must NOT stream on the tool turn.
    const ackWord = scripted.reply.split(/\s+/)[0];
    expect(firstText).not.toContain(`"content":"${ackWord}`);

    const resume = await post('/v1/chat/completions', {
      model: 'm',
      stream: true,
      messages: [
        { role: 'user', content: `Please ${scripted.match}.` },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_docs_fw_0',
              type: 'function',
              function: { name: 'file_write', arguments: '{}' },
            },
          ],
        },
        { role: 'tool', content: '{"ok":true}' },
      ],
    });
    const resumeText = await resume.text();
    expect(resumeText).not.toContain('"finish_reason":"tool_calls"');
    expect(resumeText).toContain(ackWord);
    // The tool turn already "thought" — the ack turn is content-only.
    expect(resumeText).not.toContain('reasoning_content');
  });

  test('a tool-scripted docs phrase stays text-only on the non-stream path', async () => {
    // Thread-title generation is a non-streamed call carrying the user's first
    // message — it must get the plain `reply`, never tool markup.
    const scripted = DOCS_REPLIES.find((entry) => entry.tool);
    if (!scripted) throw new Error('expected a docs reply with a tool script');
    const res = await post('/v1/chat/completions', {
      model: 'm',
      messages: [{ role: 'user', content: `Please ${scripted.match}.` }],
    });
    const body = await readJson(res);
    expect(body.choices[0].message.content).toBe(scripted.reply);
    expect(JSON.stringify(body)).not.toContain('tool_calls');
  });

  test('every tool-scripted docs entry ships all three locales', () => {
    // The docs-videos set is indivisible (en/de/fr) — a tool mechanism used by
    // one locale's scene must have a scripted sibling for the other two, or a
    // locale's take falls back to canned text mid-scene. Tool entries come in
    // locale triplets by construction: file paths differ, tool names group.
    const toolEntries = DOCS_REPLIES.filter((entry) => entry.tool);
    expect(toolEntries.length % 3).toBe(0);
  });

  test('docs phrases never shadow the default canned path', async () => {
    const res = await post('/v1/chat/completions', {
      model: 'e2e-chat-model',
      messages: [{ role: 'user', content: 'hello there' }],
    });
    const body = await readJson(res);
    expect(body.choices[0].message.content).toBe(CANNED_REPLY);
  });

  test('a title-generation call answers a short title, never a docs reply', async () => {
    // `generate_title.ts` sends the chat's FIRST MESSAGE as the user turn —
    // for a seeded docs chat that message carries a docs phrase, and without
    // the title guard the scripted REPLY became the thread's title (and the
    // docs seed could then never re-identify its own threads by prompt).
    const prompt =
      'Summarize the onboarding feedback from our last three customer calls';
    const res = await post('/v1/chat/completions', {
      model: 'e2e-chat-model',
      messages: [
        {
          role: 'system',
          content:
            "You are a title generator for chat conversations.\n\nGiven the user's first message below, produce a concise, descriptive title (3-6 words).",
        },
        { role: 'user', content: prompt },
      ],
    });
    const body = await readJson(res);
    const title = body.choices[0].message.content as string;
    // The title is the prompt's own leading words — the seed matches threads
    // by the prompt's first 40 characters, so that prefix must survive.
    expect(title.startsWith(prompt.slice(0, 40))).toBe(true);
    expect(title.length).toBeLessThanOrEqual(60);
    expect(title).not.toContain('Across the three onboarding calls');
  });

  test('the same docs phrase answers differently per model (Arena Mode)', async () => {
    // Arena Mode streams ONE prompt into two model columns; byte-identical text
    // in both reads as staged. The columns default to the assistant's first two
    // supported models (Claude Haiku 4.5, then Claude Sonnet 4.6).
    const prompt = 'Draft a launch checklist for the website relaunch project';
    const replyFor = async (model: string) => {
      const res = await post('/v1/chat/completions', {
        model,
        messages: [{ role: 'user', content: prompt }],
      });
      const body = await readJson(res);
      return body.choices[0].message.content as string;
    };
    const columnA = await replyFor('anthropic/claude-haiku-4.5');
    const columnB = await replyFor('anthropic/claude-sonnet-4.6');
    expect(columnA).not.toBe(columnB);
    // Both must carry the phrase the docs capture waits for in each column
    // (`chat-arena-split` in tests/docs-screenshots/manifest.ts), exactly once.
    for (const reply of [columnA, columnB]) {
      expect(reply.match(/launch-blocking ones/g)).toHaveLength(1);
    }
    // An unscripted model keeps the entry's default reply — the same prompt is
    // also seeded as a normal chat thread, whose model is picked by auto-routing.
    const fallback = await replyFor('some/other-model');
    expect(fallback).not.toBe(columnA);
    expect(fallback).not.toBe(columnB);
    expect(fallback).toContain('launch-blocking ones');
  });

  test('every model variant opens with its default reply first line', () => {
    // The docs seeder verifies a seeded thread by the first line of the DEFAULT
    // reply (`seed-demo-org.ts` → `expectedReply`) and deletes any thread that
    // does not show it. The seeded chat's model is auto-routed, so a VARIANT can
    // be what renders there — a variant with its own opener would make the
    // seeder re-create that thread on every run.
    for (const entry of DOCS_REPLIES) {
      const opener = entry.reply.split('\n')[0];
      for (const variant of entry.byModel ?? []) {
        expect(
          variant.reply.split('\n')[0],
          `${entry.match} → ${variant.model}`,
        ).toBe(opener);
      }
    }
  });

  test('non-stream call keeps the canned reply when the message carries a streaming-chat trigger', async () => {
    // Thread-title generation is a non-streamed `generateText` call whose
    // prompt is the user's first message. When that message triggers a
    // streaming-chat scenario (e.g. next-steps), the non-stream path must NOT
    // emit that scenario's content — otherwise the `[[NEXT_STEPS]]` marker
    // leaks into the generated title. Only the streamed assistant turn renders
    // the structured block.
    const res = await post('/v1/chat/completions', {
      model: 'e2e-chat-model',
      messages: [
        { role: 'user', content: `${MOCK_TRIGGERS.nextSteps} draft a plan` },
      ],
    });
    const body = await readJson(res);
    expect(body.choices[0].message.content).toBe(CANNED_REPLY);
    expect(body.choices[0].message.content).not.toContain('[[NEXT_STEPS]]');
  });
});

describe('task-triage structured output (the docs Executions log)', () => {
  // The `score` step of the auto-installed `projects__tasks__triage-unassigned`
  // automation is a `generateObject` call whose schema REQUIRES
  // {slug, confidence, reason} — the blanket `{}` the mock returns for `json*`
  // requests fails that validation, which failed EVERY run of it. Its prompt
  // (the automation's `score.config.userPrompt`) renders the candidates under
  // this exact heading, which is what the mock recognises.
  const triagePrompt = (title: string) =>
    [
      `Task title: ${title}`,
      '',
      'Task description:',
      '',
      'Labels: []',
      '',
      'Candidates (slug, description, isManager, preferred):',
      '[{"slug":"assistant","description":"General assistant","isManager":false,"preferred":false}]',
    ].join('\n');

  const scoreFor = async (title: string) => {
    const res = await post('/v1/chat/completions', {
      model: 'anthropic/claude-haiku-4.5',
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'score', schema: {} },
      },
      messages: [{ role: 'user', content: triagePrompt(title) }],
    });
    const body = await readJson(res);
    return JSON.parse(body.choices[0].message.content);
  };

  /**
   * Every task the docs seeder creates. Only its `todo` tasks reach the scoring
   * step (the automation's guard), but ALL of them are pinned here: a seeded
   * task with no script scores `{}` and turns its run red the moment someone
   * flips its status to `todo`.
   */
  const SEEDED_TASKS = DEMO_PROJECTS.flatMap((project) =>
    project.tasks.map((task) => task.title),
  );
  /** The ONE task scripted to fail: the red badge the docs page debugs from. */
  const FAILING_TASK = 'Prepare the rollback plan';
  /** The automation's auto-assign bar (`score.confidence >= 0.7`). */
  const AUTO_ASSIGN_BAR = 0.7;

  test('every other seeded task scores a schema-conforming object', async () => {
    const scored = SEEDED_TASKS.filter((title) => title !== FAILING_TASK);
    expect(scored).toHaveLength(SEEDED_TASKS.length - 1);
    for (const title of scored) {
      const score = await scoreFor(title);
      // `assistant` is auto-installed, so the downstream `assign` action
      // resolves a live candidate and the run reaches `done`.
      expect(score.slug, title).toBe('assistant');
      expect(typeof score.reason, title).toBe('string');
      expect(score.confidence, title).toBeGreaterThan(0);
      expect(score.confidence, title).toBeLessThanOrEqual(1);
    }
  });

  test('auto-assignment happens — but never on the captured board', async () => {
    const assigned: string[] = [];
    for (const title of SEEDED_TASKS) {
      const score = await scoreFor(title);
      if ((score.confidence ?? 0) >= AUTO_ASSIGN_BAR) assigned.push(title);
    }
    // The assign action must stay exercised: its "Auto-assigned" comment and
    // completed assign step are what the automation docs show.
    expect(assigned.length).toBeGreaterThan(0);
    // ...but never for a task on the board the docs shoot (`projects-task-board`
    // captures DEMO_PROJECTS[0]). Assignment acks the task into `in_progress`
    // (`agents/run_agent_on_task.ts`), pulling the card out of the To do column
    // the seeder tuned. Below the bar the run only comments — and still
    // completes.
    const capturedBoardTodo = DEMO_PROJECTS[0].tasks
      .filter((task) => task.status === 'todo')
      .map((task) => task.title);
    for (const title of capturedBoardTodo)
      expect(assigned).not.toContain(title);
  });

  test('exactly one seeded task returns a non-conforming score', async () => {
    const nonConforming: string[] = [];
    for (const title of SEEDED_TASKS) {
      const score = await scoreFor(title);
      if (score.confidence === undefined) nonConforming.push(title);
    }
    expect(nonConforming).toEqual([FAILING_TASK]);
  });

  test('the reasons are task-specific, never copy-pasted', async () => {
    const reasons: string[] = [];
    for (const title of SEEDED_TASKS)
      reasons.push((await scoreFor(title)).reason);
    expect(new Set(reasons).size).toBe(SEEDED_TASKS.length);
  });

  test('an unscripted task keeps the `{}` fallback', async () => {
    // Tasks created by the e2e suite must keep failing their triage run exactly
    // as they do today — this script must never start assigning agents there.
    const score = await scoreFor('Investigate the flaky checkout spec');
    expect(score).toEqual({});
  });
});

describe('Prism-served AI endpoints (deterministic examples)', () => {
  test('POST /v1/embeddings returns deterministic 1536-dim vectors', async () => {
    const res = await post('/v1/embeddings', { model: 'x', input: 'hi' });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.object).toBe('list');
    // The knowledge-db stores vector(1536) — anything else fails at insert.
    expect(body.data[0].embedding).toHaveLength(1536);
    // Deterministic per input, distinct across inputs.
    const again = await readJson(
      await post('/v1/embeddings', { model: 'x', input: 'hi' }),
    );
    expect(again.data[0].embedding).toEqual(body.data[0].embedding);
    const other = await readJson(
      await post('/v1/embeddings', { model: 'x', input: 'bye' }),
    );
    expect(other.data[0].embedding).not.toEqual(body.data[0].embedding);
  });

  test('POST /v1/embeddings honours encoding_format base64', async () => {
    // The OpenAI Node SDK requests base64 by default and decodes packed
    // Float32 bytes — a float-array response quarters the dimensions.
    const res = await post('/v1/embeddings', {
      model: 'x',
      input: 'hi',
      encoding_format: 'base64',
    });
    const body = await readJson(res);
    expect(typeof body.data[0].embedding).toBe('string');
    const floats = new Float32Array(
      Buffer.from(body.data[0].embedding, 'base64').buffer,
    );
    expect(floats).toHaveLength(1536);
  });

  test('POST /v1/moderations returns a benign OpenAI-shaped verdict', async () => {
    const res = await post('/v1/moderations', {
      model: 'omni-moderation-latest',
      input: 'hello there',
    });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(Array.isArray(body.results)).toBe(true);
    expect(body.results[0].flagged).toBe(false);
    expect(typeof body.results[0].categories).toBe('object');
    expect(typeof body.results[0].category_scores).toBe('object');
  });

  test('POST /v1/images/generations returns base64 image data', async () => {
    const res = await post('/v1/images/generations', {
      model: 'img',
      prompt: 'a cat',
    });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(typeof body.data[0].b64_json).toBe('string');
  });

  test('POST /v1/audio/transcriptions returns text + segments', async () => {
    const res = await post('/v1/audio/transcriptions', { model: 'whisper' });
    const body = await readJson(res);
    expect(typeof body.text).toBe('string');
    expect(Array.isArray(body.segments)).toBe(true);
  });

  test('POST /v1/audio/speech returns binary audio bytes', async () => {
    const res = await post('/v1/audio/speech', {
      model: 'tts',
      input: 'hello',
      voice: 'alloy',
    });
    expect(res.status).toBe(200);
    expect((await res.text()).length).toBeGreaterThan(0);
  });

  test('responses are deterministic across calls (byte-identical)', async () => {
    const once = await (
      await post('/v1/embeddings', { model: 'x', input: 'a' })
    ).text();
    const twice = await (
      await post('/v1/embeddings', { model: 'x', input: 'a' })
    ).text();
    expect(once).toBe(twice);
  });
});
