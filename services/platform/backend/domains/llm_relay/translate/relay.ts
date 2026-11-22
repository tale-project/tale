import { randomUUID } from 'node:crypto';

import {
  APICallError,
  InvalidPromptError,
  type LanguageModelV4,
  type LanguageModelV4StreamPart,
  UnsupportedFunctionalityError,
} from '@ai-sdk/provider';

import { estimateTokens } from '../../../../lib/chat/types.ts';
import { sanitizeError } from '../../../core/lib/utils/sanitize_secrets.ts';
import type { UpstreamEndpoint } from '../endpoint.ts';
import { estimatedPromptTokens } from '../estimate.ts';
import {
  neverConnected,
  type RelayCallOutcome,
  type RelayLifetime,
  relayFetch,
  relayLifetime,
  type UpstreamFetch,
} from '../passthrough.ts';
import { NO_USAGE, type RelayUsage } from '../usage.ts';
import {
  errorResponse,
  type RelayErrorKind,
  type RelayWire,
  statusOf,
} from '../wires.ts';
import {
  type EncodeContext,
  type InboundAdapter,
  TranslationError,
} from './contract.ts';
import {
  languageModelFor,
  promptForUpstream,
  reasoningForUpstream,
  relayUsageOf,
  upstreamProviderOptions,
} from './upstream.ts';

/**
 * One call whose client and upstream speak different wires
 * (tale-project/tale#4942): the client's request is read into the AI SDK's
 * call by its wire's adapter, the SDK's provider calls the upstream on its
 * own wire, and the answer is written back in the client's wire. The call
 * lives and ends as a passed-through one does (`passthrough.ts`): it reports
 * how it ended exactly once, a client that hangs up aborts it upstream, and
 * it never outlives its lifetime.
 */

/** Each client wire's adapter, loaded when a call first needs it. */
const ADAPTERS: Readonly<Record<RelayWire, () => Promise<InboundAdapter>>> = {
  anthropic: async () => (await import('./anthropic.ts')).anthropicAdapter,
  'openai-chat': async () =>
    (await import('./openai-chat.ts')).openAiChatAdapter,
  'openai-responses': async () =>
    (await import('./responses.ts')).responsesAdapter,
  genai: async () => (await import('./genai.ts')).genAiAdapter,
};

export interface TranslatedArgs {
  /** The wire the client spoke. */
  inbound: RelayWire;
  endpoint: UpstreamEndpoint;
  body: Record<string, unknown>;
  stream: boolean;
  /** The model name the client asked for, echoed in the answer. */
  requestedModel: string;
  /** Headers the client asked the relay to pass on (`x-bf-eh-*`). */
  extraHeaders?: Record<string, string>;
  signal: AbortSignal;
  onDone: (outcome: RelayCallOutcome) => void;
  lifetime?: Partial<RelayLifetime>;
  fetcher?: UpstreamFetch;
  /** Seams for the unit layer. */
  adapter?: InboundAdapter;
  model?: LanguageModelV4;
}

/** The kind and status of a refusal the upstream answered. */
function refusalOf(error: unknown): {
  kind: RelayErrorKind;
  status: number;
  message: string;
} {
  if (APICallError.isInstance(error) && error.statusCode !== undefined) {
    const status = error.statusCode;
    const detail = sanitizeError(error.responseBody ?? error.message, 500);
    if (status === 401 || status === 403) {
      return {
        kind: 'upstream',
        status: statusOf('upstream'),
        message: `The model provider refused the organization's credential (HTTP ${status}): ${detail}`,
      };
    }
    const kind: RelayErrorKind =
      status === 429
        ? 'rate_limit'
        : status === 413
          ? 'too_large'
          : status >= 500
            ? 'upstream'
            : 'invalid_request';
    return {
      kind,
      status,
      message: `The model provider answered HTTP ${status}: ${detail}`,
    };
  }
  // The provider's package refused the request before sending it: what the
  // client asked for has no form on the upstream's wire.
  if (
    UnsupportedFunctionalityError.isInstance(error) ||
    InvalidPromptError.isInstance(error)
  ) {
    return {
      kind: 'invalid_request',
      status: statusOf('invalid_request'),
      message: `The request cannot be sent to this model's provider: ${sanitizeError(error.message, 300)}`,
    };
  }
  // A transport failure's wording names addresses: it stays in the log.
  console.warn(
    `[llm-relay] a translated call failed: ${sanitizeError(error, 300)}`,
  );
  return {
    kind: 'upstream',
    status: statusOf('upstream'),
    message: 'The model provider could not be reached.',
  };
}

/** The request without its conversation: what the answer's writer reads is
 * the request's options (whether it asked for usage, which tools were
 * custom), never its messages. */
function lightRequest(body: Record<string, unknown>): Record<string, unknown> {
  const {
    messages: _messages,
    input: _input,
    contents: _contents,
    ...options
  } = body;
  return options;
}

/** The text a part carries, for the estimate of output the vendor never
 * reported. */
function partText(part: LanguageModelV4StreamPart): string {
  switch (part.type) {
    case 'text-delta':
    case 'reasoning-delta':
    case 'tool-input-delta':
      return part.delta;
    default:
      return '';
  }
}

export async function relayTranslated(args: TranslatedArgs): Promise<Response> {
  const { inbound, endpoint, stream } = args;
  const lifetime = { ...relayLifetime(), ...args.lifetime };
  let done = false;
  const report = (outcome: RelayCallOutcome) => {
    if (done) return;
    done = true;
    args.onDone(outcome);
  };
  const refuse = (kind: RelayErrorKind, message: string, status?: number) => {
    report({ status: 'failed', usage: NO_USAGE, estimated: false });
    return errorResponse(inbound, kind, message, status);
  };

  const adapter = args.adapter ?? (await ADAPTERS[inbound]());
  let parsed;
  try {
    parsed = adapter.parse(args.body);
  } catch (error) {
    if (error instanceof TranslationError)
      return refuse(error.kind, error.message);
    throw error;
  }

  if (args.signal.aborted) {
    report({ status: 'cancelled', usage: NO_USAGE, estimated: false });
    return new Response(null, { status: 499 });
  }

  const upstream = new AbortController();
  const onClientAbort = () => upstream.abort(new Error('the client hung up'));
  args.signal.addEventListener('abort', onClientAbort, { once: true });
  const timers: ReturnType<typeof setTimeout>[] = [];
  const clear = () => {
    for (const timer of timers) clearTimeout(timer);
    args.signal.removeEventListener('abort', onClientAbort);
  };
  timers.push(
    setTimeout(
      () => upstream.abort(new Error('the call outlived its lifetime')),
      stream ? lifetime.streamMs : lifetime.wholeMs,
    ),
  );
  const fetcher: UpstreamFetch = args.fetcher ?? relayFetch;
  // Whether the request left for the vendor: one that ends before its
  // answer then books the prompt the vendor read, unless no connection was
  // ever made.
  let sent = false;
  const model =
    args.model ??
    (await languageModelFor(
      endpoint,
      (input, init) => {
        sent = true;
        return fetcher(
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url,
          { ...init, signal: upstream.signal },
        );
      },
      args.extraHeaders,
    ));
  const inputEstimate = estimatedPromptTokens(parsed.options.prompt);
  /** A call that ended before its answer: the prompt, where the vendor read
   * it; nothing, where it never got there. */
  const endedEarly = (
    status: RelayCallOutcome['status'],
    error: unknown,
  ): RelayCallOutcome =>
    (sent || args.model !== undefined) &&
    !neverConnected(error) &&
    !(APICallError.isInstance(error) && error.statusCode !== undefined)
      ? {
          status,
          usage: { ...NO_USAGE, inputTokens: inputEstimate },
          estimated: true,
        }
      : { status, usage: NO_USAGE, estimated: false };
  const providerOptions = upstreamProviderOptions(endpoint);
  const reasoning = reasoningForUpstream(endpoint, parsed.options.reasoning);
  const { reasoning: _asked, ...asked } = parsed.options;
  const call = {
    ...asked,
    ...(reasoning !== undefined ? { reasoning } : {}),
    prompt: promptForUpstream(endpoint, parsed.options.prompt),
    abortSignal: upstream.signal,
    ...(providerOptions !== undefined ? { providerOptions } : {}),
  };
  const context: EncodeContext = {
    model: args.requestedModel,
    id: randomUUID().replaceAll('-', ''),
    created: Math.floor(Date.now() / 1000),
    // What the answer's writer may read of the request: all but the
    // conversation, which can be tens of megabytes and would otherwise live
    // as long as the stream.
    request: lightRequest(args.body),
  };

  if (!stream) {
    try {
      const result = await model.doGenerate(call);
      clear();
      const answer = adapter.encodeAnswer(result, context);
      report({
        status: 'completed',
        usage: relayUsageOf(result.usage),
        estimated: result.usage.inputTokens.total === undefined,
      });
      return Response.json(answer);
    } catch (error) {
      clear();
      if (args.signal.aborted) {
        report(endedEarly('cancelled', error));
        return new Response(null, { status: 499 });
      }
      if (upstream.signal.aborted) {
        report(endedEarly('failed', error));
        return errorResponse(
          inbound,
          'timeout',
          'The model provider did not answer in time.',
        );
      }
      report(endedEarly('failed', error));
      const refusal = refusalOf(error);
      return errorResponse(
        inbound,
        refusal.kind,
        refusal.message,
        refusal.status,
      );
    }
  }

  let parts: ReadableStream<LanguageModelV4StreamPart>;
  try {
    parts = (await model.doStream(call)).stream;
  } catch (error) {
    clear();
    if (args.signal.aborted) {
      report(endedEarly('cancelled', error));
      return new Response(null, { status: 499 });
    }
    report(endedEarly('failed', error));
    if (upstream.signal.aborted) {
      return errorResponse(
        inbound,
        'timeout',
        'The model provider did not answer in time.',
      );
    }
    const refusal = refusalOf(error);
    return errorResponse(
      inbound,
      refusal.kind,
      refusal.message,
      refusal.status,
    );
  }

  // The parts, watched on their way to the adapter: the usage the finish
  // part reports, the text for an estimate, the idle clock — and an error
  // part turned into the throw the adapter's contract expects.
  let usage: RelayUsage | undefined;
  let counted = 0;
  let idle: ReturnType<typeof setTimeout> | undefined;
  const touch = () => {
    if (idle !== undefined) clearTimeout(idle);
    idle = setTimeout(
      () => upstream.abort(new Error('the stream went silent')),
      lifetime.streamIdleMs,
    );
    timers.push(idle);
  };
  touch();
  const reader = parts.getReader();
  async function* watched(): AsyncIterable<LanguageModelV4StreamPart> {
    for (;;) {
      const { done: ended, value } = await reader.read();
      if (ended) return;
      touch();
      if (value.type === 'error') {
        throw value.error instanceof Error
          ? value.error
          : new Error(sanitizeError(value.error, 300));
      }
      if (value.type === 'finish') usage = relayUsageOf(value.usage);
      const text = partText(value);
      if (text !== '') counted += estimateTokens(text);
      yield value;
    }
  }
  const outcome = (status: RelayCallOutcome['status']): RelayCallOutcome =>
    usage !== undefined && status === 'completed'
      ? { status, usage, estimated: false }
      : {
          status,
          usage: {
            ...(usage ?? NO_USAGE),
            inputTokens: usage?.inputTokens ?? inputEstimate,
            outputTokens: Math.max(usage?.outputTokens ?? 0, counted),
          },
          estimated: true,
        };

  const encoder = new TextEncoder();
  const encoded = adapter.encodeStream(watched(), context);
  const events = encoded[Symbol.asyncIterator]();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await events.next();
        if (next.done === true) {
          clear();
          controller.close();
          report(outcome('completed'));
          return;
        }
        controller.enqueue(encoder.encode(next.value));
      } catch (error) {
        clear();
        if (args.signal.aborted) {
          report(outcome('cancelled'));
          controller.error(error);
          return;
        }
        const refusal = upstream.signal.aborted
          ? {
              kind: 'timeout' as const,
              message: 'The model stopped answering.',
            }
          : refusalOf(error);
        const event = adapter.encodeStreamError(
          refusal.kind,
          refusal.message,
          context,
        );
        if (event !== null) controller.enqueue(encoder.encode(event));
        controller.close();
        report(outcome('failed'));
      }
    },
    async cancel(reason) {
      clear();
      upstream.abort(
        reason instanceof Error ? reason : new Error('the client hung up'),
      );
      report(outcome('cancelled'));
      await reader.cancel(reason).catch((error: unknown) => {
        console.warn(
          '[llm-relay] could not cancel a translated stream:',
          error,
        );
      });
    },
  });
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
    },
  });
}
