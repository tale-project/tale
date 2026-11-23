import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4Prompt,
  LanguageModelV4Usage,
  SharedV4ProviderOptions,
} from '@ai-sdk/provider';

import type { UpstreamEndpoint } from '../endpoint.ts';
import type { RelayUsage } from '../usage.ts';

/** The fetch an SDK provider calls the upstream with. */
export type ProviderFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

/** The SDK types a provider's fetch as the global one, `preconnect` and
 * all; the relay's never preconnects. */
function asGlobalFetch(fetcher: ProviderFetch): typeof globalThis.fetch {
  return Object.assign(fetcher, { preconnect: () => undefined });
}

type Reasoning = LanguageModelV4CallOptions['reasoning'];

/**
 * How hard an upstream is asked to think, as its wire can take it. The SDK
 * sends a Chat Completions upstream the level it is given, verbatim, as
 * `reasoning_effort`: OpenAI's own API takes every level it names (`none`
 * through `xhigh`), but other OpenAI-compatible servers know low, medium
 * and high at most, and some refuse anything else — so for them the level
 * is rounded to those, and `none` sends nothing. Anthropic's newest models
 * cannot stop thinking and refuse to be told to, so `none` asks nothing of
 * Anthropic either: the model thinks as it does by default.
 *
 * A call that carries tools to a model whose endpoint takes them only at
 * its catalog's `off` effort is sent exactly that, whatever was asked —
 * even nothing, which would leave the vendor's default above it in force
 * ({@link UpstreamEndpoint.toolsEffort}).
 */
export function reasoningForUpstream(
  endpoint: UpstreamEndpoint,
  reasoning: Reasoning,
  call: { tools: boolean },
): Reasoning {
  if (call.tools && endpoint.toolsEffort !== undefined) {
    return endpoint.toolsEffort;
  }
  if (reasoning === undefined || reasoning === 'provider-default') {
    return reasoning;
  }
  if (endpoint.wire === 'anthropic') {
    return reasoning === 'none' ? undefined : reasoning;
  }
  if (endpoint.connector === 'openai') {
    return reasoning === 'max' ? 'xhigh' : reasoning;
  }
  switch (reasoning) {
    case 'none':
      return undefined;
    case 'minimal':
    case 'low':
      return 'low';
    case 'medium':
      return 'medium';
    case 'high':
    case 'xhigh':
    case 'max':
      return 'high';
    default: {
      const _exhaustive: never = reasoning;
      return _exhaustive;
    }
  }
}

/**
 * The SDK model that calls an endpoint, on the endpoint's wire: Anthropic
 * Messages or Chat Completions (a translated call never goes to the
 * Responses API, which is reached only on its own wire). Built per call —
 * nothing is sent until it is called — and its provider package loaded only
 * when a call needs it, so a relay that only passes calls through never
 * loads one.
 */
export async function languageModelFor(
  endpoint: UpstreamEndpoint,
  fetch: ProviderFetch,
  extraHeaders: Record<string, string> = {},
): Promise<LanguageModelV4> {
  const headers = { ...endpoint.headers, ...extraHeaders };
  switch (endpoint.wire) {
    case 'anthropic': {
      const { createAnthropic } = await import('@ai-sdk/anthropic');
      return createAnthropic({
        // The SDK appends `/messages` to a base that ends in the version.
        baseURL: `${endpoint.baseUrl}/v1`,
        apiKey: endpoint.apiKey,
        headers,
        fetch: asGlobalFetch(fetch),
      }).languageModel(endpoint.modelId);
    }
    case 'openai-chat': {
      const { createOpenAICompatible } =
        await import('@ai-sdk/openai-compatible');
      return createOpenAICompatible({
        name: 'upstream',
        baseURL: endpoint.baseUrl,
        apiKey: endpoint.apiKey,
        headers,
        fetch: asGlobalFetch(fetch),
        includeUsage: true,
      }).chatModel(endpoint.modelId);
    }
    case 'openai-responses':
      throw new Error(
        'a translated call never goes to the Responses API: it is reached only on its own wire',
      );
    default: {
      const _exhaustive: never = endpoint.wire;
      return _exhaustive;
    }
  }
}

/**
 * The provider options every translated call carries on its upstream's
 * wire: on Anthropic, the model's thinking sent back with the turns that
 * carried it, as a thinking model needs it — and, on Anthropic's own API,
 * its automatic prompt caching, which the clients that reach Claude through
 * translation never ask for themselves (each turn of an agent's loop would
 * otherwise pay its whole prompt again). A third-party Anthropic endpoint
 * is not sent the field: it may refuse what it does not know.
 */
export function upstreamProviderOptions(
  endpoint: UpstreamEndpoint,
): SharedV4ProviderOptions | undefined {
  if (endpoint.wire !== 'anthropic') return undefined;
  return {
    anthropic: {
      sendReasoning: true,
      ...(endpoint.connector === 'anthropic'
        ? { cacheControl: { type: 'ephemeral' } }
        : {}),
    },
  };
}

/**
 * The prompt as the upstream's wire can take it. Chat Completions takes
 * only text in a tool's answer — the SDK would write an image a tool
 * returned there as JSON, base64 and all — so on that wire the files of a
 * tool's answer move to the user message right after the tool answers,
 * labelled with the call, and the answer says they follow. Where the client
 * wrote a user message next, the files lead it rather than come as a user
 * message of their own: some servers' chat templates refuse two user turns
 * in a row.
 */
export function promptForUpstream(
  endpoint: UpstreamEndpoint,
  prompt: LanguageModelV4Prompt,
): LanguageModelV4Prompt {
  if (endpoint.wire !== 'openai-chat') return prompt;
  type UserContent = Extract<
    LanguageModelV4Prompt[number],
    { role: 'user' }
  >['content'];
  const shaped: LanguageModelV4Prompt = [];
  let moved: UserContent = [];
  for (const message of prompt) {
    if (moved.length > 0) {
      if (message.role === 'user') {
        shaped.push({ ...message, content: [...moved, ...message.content] });
        moved = [];
        continue;
      }
      if (message.role !== 'tool') {
        shaped.push({ role: 'user', content: moved });
        moved = [];
      }
    }
    if (message.role !== 'tool') {
      shaped.push(message);
      continue;
    }
    const content = message.content.map((part) => {
      if (part.type !== 'tool-result' || part.output.type !== 'content') {
        return part;
      }
      const files = part.output.value.filter((item) => item.type === 'file');
      if (files.length === 0) return part;
      const text = part.output.value
        .flatMap((item) => (item.type === 'text' ? [item.text] : []))
        .join('\n');
      moved.push({
        type: 'text',
        text: `The ${files.length === 1 ? 'file' : `${files.length} files`} the call ${part.toolCallId} (${part.toolName}) returned:`,
      });
      for (const file of files) {
        moved.push({
          type: 'file',
          data: file.data,
          mediaType: file.mediaType,
          ...(file.filename !== undefined ? { filename: file.filename } : {}),
        });
      }
      const note = `(${files.length === 1 ? 'a file follows' : `${files.length} files follow`} in the next message)`;
      return {
        ...part,
        output: {
          type: 'text' as const,
          value: text === '' ? note : `${text}\n${note}`,
        },
      };
    });
    shaped.push({ ...message, content });
  }
  if (moved.length > 0) shaped.push({ role: 'user', content: moved });
  return shaped;
}

/** The SDK's usage in the relay's shape: uncached input, cache reads and
 * writes, and every output token (reasoning included). */
export function relayUsageOf(usage: LanguageModelV4Usage): RelayUsage {
  const total = usage.inputTokens.total ?? 0;
  const cacheRead = usage.inputTokens.cacheRead ?? 0;
  const cacheWrite = usage.inputTokens.cacheWrite ?? 0;
  const noCache =
    usage.inputTokens.noCache ?? Math.max(0, total - cacheRead - cacheWrite);
  return {
    inputTokens: noCache,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    outputTokens:
      usage.outputTokens.total ??
      (usage.outputTokens.text ?? 0) + (usage.outputTokens.reasoning ?? 0),
  };
}
