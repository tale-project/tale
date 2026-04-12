#!/usr/bin/env bun
/**
 * Integration test for OpenAI-compatible API using AI SDK v6.
 * Simulates real user scenarios with @ai-sdk/openai-compatible.
 *
 * Usage: bun scripts/test-openai-compat.ts
 */

import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText, streamText, tool, stepCountIs } from 'ai';
import { z } from 'zod';

const BASE_URL = 'http://localhost:3000/api/v1';
const API_KEY =
  'taleDsYqAacBOcFDlGBISiORAmxkQHhNEChqBgagAngCaaReIsBGfAREKtZTckLmyeqn';

const provider = createOpenAICompatible({
  name: 'tale',
  baseURL: BASE_URL,
  headers: { Authorization: `Bearer ${API_KEY}` },
});

function uid() {
  return Date.now().toString(36);
}

// ── Test 1: List models ──────────────────────────────────────────────────────

async function testListModels(): Promise<string> {
  console.log('\n═══ Test 1: List models ═══');

  const res = await fetch(`${BASE_URL}/models`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  const body = await res.json();

  console.log(`  Found ${body.data?.length ?? 0} models:`);
  for (const m of body.data ?? []) {
    console.log(`    ${m.id} (${m.owned_by})`);
  }

  const modelId = body.data?.[0]?.id;
  if (!modelId) throw new Error('No models available');
  return modelId;
}

// ── Test 2: generateText ─────────────────────────────────────────────────────

async function testGenerateText(modelId: string) {
  console.log(`\n═══ Test 2: generateText (model: ${modelId}) ═══`);

  const result = await generateText({
    model: provider.chatModel(modelId),
    prompt: `What is 2+2? Answer in one word. (${uid()})`,
  });

  console.log(`  text: ${result.text}`);
  console.log(`  finishReason: ${result.finishReason}`);
  console.log(`  usage: ${JSON.stringify(result.usage)}`);
}

// ── Test 3: streamText ───────────────────────────────────────────────────────

async function testStreamText(modelId: string) {
  console.log(`\n═══ Test 3: streamText (model: ${modelId}) ═══`);

  const result = streamText({
    model: provider.chatModel(modelId),
    prompt: `Name one color. (${uid()})`,
  });

  process.stdout.write('  streaming: ');
  for await (const chunk of result.textStream) {
    process.stdout.write(chunk);
  }
  console.log();

  const usage = await result.usage;
  console.log(`  usage: ${JSON.stringify(usage)}`);
}

// ── Test 4: Tool calling (single step) ───────────────────────────────────────

async function testToolCalling(modelId: string) {
  console.log(`\n═══ Test 4: Tool calling (model: ${modelId}) ═══`);

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
  console.log(`  usage: ${JSON.stringify(result.usage)}`);

  if (result.toolCalls.length > 0) {
    const tc = result.toolCalls[0];
    console.log(`  ✓ Tool called: ${tc.toolName}(${JSON.stringify(tc.input)})`);
  } else {
    console.log('  ✗ No tool calls returned');
  }
}

// ── Test 5: Multi-turn tool calling with execute ─────────────────────────────

async function testMultiTurnToolCalling(modelId: string) {
  console.log(`\n═══ Test 5: Multi-turn tool calling (model: ${modelId}) ═══`);

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
  console.log(`  usage: ${JSON.stringify(result.usage)}`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Testing OpenAI-compatible API with AI SDK v6');
  console.log(`Base URL: ${BASE_URL}`);

  const modelId = await testListModels();
  await testGenerateText(modelId);
  await testStreamText(modelId);
  await testToolCalling(modelId);
  await testMultiTurnToolCalling(modelId);

  console.log('\n═══ All tests done ═══\n');
}

main().catch(console.error);
