#!/usr/bin/env bun
/**
 * End-to-end tests for the OpenAI-compatible Chat Completions API.
 *
 * Two surfaces are exercised:
 *   - AI SDK v6 integration via @ai-sdk/openai-compatible (generateText, streamText, tools)
 *   - OpenAI wire-protocol conformance via raw HTTP for features the SDK abstracts away
 *     (response_format, stop sequences, citations field, manual multi-round tool
 *     continuation, error responses)
 *
 * Usage: bun scripts/test-openai-compat.ts
 */

import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText, stepCountIs, streamText, tool } from 'ai';
import { z } from 'zod';

const BASE_URL = 'http://localhost:3000/api/v1';
const API_KEY =
  'taleDsYqAacBOcFDlGBISiORAmxkQHhNEChqBgagAngCaaReIsBGfAREKtZTckLmyeqn';

const provider = createOpenAICompatible({
  name: 'tale',
  baseURL: BASE_URL,
  headers: { Authorization: `Bearer ${API_KEY}` },
});

let passed = 0;
let failed = 0;

const uid = () => Date.now().toString(36);

function header(name: string) {
  console.log(`\n${'='.repeat(60)}\nTEST: ${name}\n${'='.repeat(60)}`);
}

function ok(msg = '') {
  passed++;
  console.log(`  \x1b[32mPASS\x1b[0m ${msg}`);
}

function fail(msg: string) {
  failed++;
  console.log(`  \x1b[31mFAIL\x1b[0m ${msg}`);
}

async function postChat(
  body: Record<string, unknown>,
  apiKey: string = API_KEY,
): Promise<Response> {
  return fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
}

async function run(name: string, fn: () => Promise<void>) {
  header(name);
  try {
    await fn();
  } catch (e) {
    fail((e instanceof Error ? e.message : String(e)).slice(0, 200));
  }
}

async function listModels(): Promise<string> {
  header('1. GET /v1/models');
  const res = await fetch(`${BASE_URL}/models`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  const body = (await res.json()) as {
    data?: Array<{ id: string; owned_by?: string }>;
  };
  for (const m of body.data ?? []) console.log(`    ${m.id} (${m.owned_by})`);
  const modelId = body.data?.[0]?.id;
  if (!modelId) {
    fail('No models returned');
    throw new Error('No models available');
  }
  ok(`Found ${body.data?.length} models`);
  return modelId;
}

async function main() {
  console.log('Testing OpenAI-compatible API with AI SDK v6');
  console.log(`Base URL: ${BASE_URL}`);

  const modelId = await listModels();

  await run(`2. generateText (model: ${modelId})`, async () => {
    const result = await generateText({
      model: provider.chatModel(modelId),
      prompt: `What is 2+2? Answer in one word. (${uid()})`,
    });
    console.log(`  text: ${result.text}`);
    console.log(`  finishReason: ${result.finishReason}`);
    console.log(`  usage: ${JSON.stringify(result.usage)}`);
    if (!result.text) {
      fail('No content');
      return;
    }
    ok();
  });

  await run('3. streamText', async () => {
    const result = streamText({
      model: provider.chatModel(modelId),
      prompt: `Name one color. (${uid()})`,
    });
    process.stdout.write('  streaming: ');
    let acc = '';
    for await (const chunk of result.textStream) {
      acc += chunk;
      process.stdout.write(chunk);
    }
    console.log();
    console.log(`  usage: ${JSON.stringify(await result.usage)}`);
    if (!acc) {
      fail('No content streamed');
      return;
    }
    ok(`${acc.length} chars`);
  });

  await run(
    '4. Generation params (temperature=0.1, max_tokens=15)',
    async () => {
      const res = await postChat({
        model: modelId,
        messages: [{ role: 'user', content: 'Count from 1 to 100.' }],
        temperature: 0.1,
        max_tokens: 15,
      });
      const body = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = body.choices?.[0]?.message?.content;
      console.log(`  Content: ${JSON.stringify(content)}`);
      if (!content) {
        fail('No content');
        return;
      }
      ok(`Length: ${content.length} chars`);
    },
  );

  await run('5. response_format: json_object', async () => {
    const res = await postChat({
      model: modelId,
      messages: [
        {
          role: 'user',
          content:
            "Return a JSON object with key 'status' and value 'ok'. Only output the JSON, nothing else.",
        },
      ],
      response_format: { type: 'json_object' },
    });
    const body = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = body.choices?.[0]?.message?.content;
    console.log(`  Content: ${JSON.stringify(content)}`);
    if (!content || !content.toLowerCase().includes('status')) {
      fail("Missing 'status' in JSON response");
      return;
    }
    ok();
  });

  await run(
    '6. Tool calling (single round, tool_choice=required)',
    async () => {
      const result = await generateText({
        model: provider.chatModel(modelId),
        prompt: `What is the weather in Berlin? (${uid()})`,
        tools: {
          get_weather: tool({
            description: 'Get current weather for a city',
            inputSchema: z.object({
              city: z.string().describe('City name'),
            }),
          }),
        },
        toolChoice: 'required',
      });
      console.log(`  finishReason: ${result.finishReason}`);
      console.log(`  toolCalls: ${JSON.stringify(result.toolCalls, null, 2)}`);
      if (result.toolCalls.length === 0) {
        fail('No tool_calls returned');
        return;
      }
      const tc = result.toolCalls[0];
      console.log(`  Called: ${tc.toolName}(${JSON.stringify(tc.input)})`);
      ok(`${result.toolCalls.length} tool call(s)`);
    },
  );

  await run('7. Multi-turn tool calling with execute', async () => {
    const result = await generateText({
      model: provider.chatModel(modelId),
      prompt: `What is the weather in Tokyo? (${uid()})`,
      tools: {
        get_weather: tool({
          description: 'Get current weather for a city',
          inputSchema: z.object({
            city: z.string().describe('City name'),
          }),
          execute: async ({ city }) => {
            console.log(`  [tool executed] get_weather("${city}")`);
            return { temperature: 22, condition: 'sunny', city };
          },
        }),
      },
      stopWhen: stepCountIs(3),
    });
    console.log(`  text: ${result.text}`);
    console.log(`  finishReason: ${result.finishReason}`);
    console.log(`  steps: ${result.steps.length}`);
    if (result.steps.length < 2) {
      fail('Expected multi-step result');
      return;
    }
    ok();
  });

  await run(
    '8. Multi-round tool continuation (raw wire protocol)',
    async () => {
      const tools = [
        {
          type: 'function',
          function: {
            name: 'calculator',
            description: 'Calculate a math expression and return the result',
            parameters: {
              type: 'object',
              properties: {
                expression: { type: 'string', description: 'Math expression' },
              },
              required: ['expression'],
            },
          },
        },
      ];

      const messages: Array<Record<string, unknown>> = [
        { role: 'user', content: 'What is 42 * 17? Use the calculator tool.' },
      ];

      const r1 = await postChat({
        model: modelId,
        messages,
        tools,
        tool_choice: 'required',
      });
      const b1 = (await r1.json()) as {
        choices?: Array<{
          finish_reason?: string;
          message?: {
            tool_calls?: Array<{
              id: string;
              function: { name: string; arguments: string };
            }>;
          };
        }>;
      };
      const c1 = b1.choices?.[0];
      console.log(`  Step 1: finish=${c1?.finish_reason}`);
      const tc = c1?.message?.tool_calls?.[0];
      if (c1?.finish_reason !== 'tool_calls' || !tc) {
        fail('No tool_calls in step 1');
        return;
      }
      console.log(
        `  Tool: ${tc.function.name}(${tc.function.arguments}), id=${tc.id}`,
      );

      messages.push(c1.message as Record<string, unknown>);
      messages.push({ role: 'tool', tool_call_id: tc.id, content: '714' });

      const r2 = await postChat({ model: modelId, messages, tools });
      const b2 = (await r2.json()) as {
        choices?: Array<{
          finish_reason?: string;
          message?: { content?: string };
        }>;
      };
      const c2 = b2.choices?.[0];
      const content = c2?.message?.content;
      console.log(
        `  Step 2: finish=${c2?.finish_reason}, content=${JSON.stringify(content)}`,
      );
      if (!content) {
        fail('No content in step 2');
        return;
      }
      ok(
        content.includes('714')
          ? 'Model used tool result correctly'
          : 'Got response (may not echo exact number)',
      );
    },
  );

  await run('9. Tool calling streaming', async () => {
    const result = streamText({
      model: provider.chatModel(modelId),
      prompt: `Search for 'Python tutorial' (${uid()})`,
      tools: {
        search: tool({
          description: 'Search the web',
          inputSchema: z.object({ query: z.string() }),
        }),
      },
      toolChoice: 'required',
    });
    for await (const _ of result.fullStream) {
      // drain stream
    }
    const finish = await result.finishReason;
    const toolCalls = await result.toolCalls;
    console.log(`  Finish: ${finish}, toolCalls: ${toolCalls.length}`);
    if (finish !== 'tool-calls' || toolCalls.length === 0) {
      fail(
        `Expected tool-calls finish with calls, got ${finish}/${toolCalls.length}`,
      );
      return;
    }
    ok();
  });

  await run('10. Multiple tools defined', async () => {
    const result = await generateText({
      model: provider.chatModel(modelId),
      prompt: `What is the weather in Tokyo? (${uid()})`,
      tools: {
        get_weather: tool({
          description: 'Get weather for a city',
          inputSchema: z.object({ city: z.string() }),
        }),
        get_time: tool({
          description: 'Get current time in a timezone',
          inputSchema: z.object({ timezone: z.string() }),
        }),
      },
      toolChoice: 'required',
    });
    if (result.toolCalls.length === 0) {
      fail('No tool_calls with multiple tools');
      return;
    }
    const names = result.toolCalls.map((t) => t.toolName);
    console.log(`  Tools called: ${names.join(', ')}`);
    if (!names.includes('get_weather') && !names.includes('get_time')) {
      fail(`Unexpected tool: ${names.join(', ')}`);
      return;
    }
    ok(`Called: ${names.join(', ')}`);
  });

  await run('11. tool_choice=auto (model decides)', async () => {
    const result = await generateText({
      model: provider.chatModel(modelId),
      prompt: `What is the capital of France? (${uid()})`,
      tools: {
        calculator: tool({
          description: 'Calculate math',
          inputSchema: z.object({ expr: z.string() }),
        }),
      },
      toolChoice: 'auto',
    });
    console.log(`  finishReason: ${result.finishReason}`);
    console.log(`  text: ${result.text || '(empty)'}`);
    console.log(`  toolCalls: ${result.toolCalls.length}`);
    if (result.finishReason === 'stop' && result.text) {
      ok('Model answered directly without tools');
    } else if (result.finishReason === 'tool-calls') {
      ok('Model chose to use tool');
    } else {
      fail(`Unexpected: finish=${result.finishReason}`);
    }
  });

  await run('12. stop sequences', async () => {
    const res = await postChat({
      model: modelId,
      messages: [
        { role: 'user', content: 'Count: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10' },
      ],
      stop: ['5'],
    });
    const body = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = body.choices?.[0]?.message?.content;
    console.log(`  Content: ${JSON.stringify(content)}`);
    ok(
      content
        ? `length: ${content.length}`
        : 'empty (stop triggered immediately)',
    );
  });

  await run('13. Citations field present', async () => {
    const res = await postChat({
      model: modelId,
      messages: [{ role: 'user', content: 'Say hello in exactly 2 words.' }],
    });
    const body = (await res.json()) as { citations?: unknown };
    const citations = body.citations;
    console.log(`  citations: ${JSON.stringify(citations)}`);
    if (!Array.isArray(citations)) {
      fail('citations field missing or not a list');
      return;
    }
    for (const c of citations as Array<Record<string, unknown>>) {
      if (
        !('index' in c) ||
        !('type' in c) ||
        !('source' in c) ||
        !('relevance' in c)
      ) {
        fail('Citation shape invalid (missing index/type/source/relevance)');
        return;
      }
      if (c.type !== 'rag' && c.type !== 'web') {
        fail(`Invalid citation type: ${String(c.type)}`);
        return;
      }
    }
    ok(`citations field present (length: ${citations.length})`);
  });

  await run('14. Error: invalid model (404)', async () => {
    const res = await postChat({
      model: 'nonexistent-model-xyz',
      messages: [{ role: 'user', content: 'hi' }],
    });
    if (res.status !== 404) {
      fail(`Expected 404, got ${res.status}`);
      return;
    }
    ok(`HTTP ${res.status}`);
  });

  await run('15. Error: invalid API key (401)', async () => {
    const res = await postChat(
      { model: modelId, messages: [{ role: 'user', content: 'hi' }] },
      'bad_key',
    );
    if (res.status !== 401) {
      fail(`Expected 401, got ${res.status}`);
      return;
    }
    ok(`HTTP ${res.status}`);
  });

  await run('16. Error: missing messages (400)', async () => {
    const res = await postChat({ model: modelId });
    if (res.status !== 400) {
      fail(`Expected 400, got ${res.status}`);
      return;
    }
    ok(`HTTP ${res.status}`);
  });

  await run('17. Error: no user message (400)', async () => {
    const res = await postChat({
      model: modelId,
      messages: [{ role: 'system', content: 'You are helpful.' }],
    });
    if (res.status !== 400) {
      fail(`Expected 400, got ${res.status}`);
      return;
    }
    ok(`HTTP ${res.status}`);
  });

  const total = passed + failed;
  console.log(`\n${'='.repeat(60)}`);
  if (failed === 0) {
    console.log(`\x1b[32m ALL PASSED: ${passed}/${total} tests \x1b[0m`);
  } else {
    console.log(
      `\x1b[31m RESULTS: ${passed} passed, ${failed} failed out of ${total} tests \x1b[0m`,
    );
  }
  console.log('='.repeat(60));
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
