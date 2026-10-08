/**
 * Options of the mock AI provider: what a run may tune and what it gets
 * when it tunes nothing.
 *
 * The defaults describe a mid-sized hosted chat model on a normal day: a
 * first token after roughly half a second (with a long tail), around sixty
 * tokens a second, replies of a couple of hundred tokens, and the rare
 * rate limit or server error every provider answers now and then. Every
 * option is settable from a flag object (the CLI's parsed flags, where
 * numbers may still be strings) and from the environment as
 * `TALE_LOAD_MOCK_<SNAKE_CASE>`; a flag wins over the environment, which
 * wins over the default.
 */

import { z } from 'zod';

/** Prefix of every environment variable the mock reads. */
const MOCK_ENV_PREFIX = 'TALE_LOAD_MOCK_';

const rate = z.coerce.number().min(0).max(1);
const milliseconds = z.coerce.number().min(0);
const positive = z.coerce.number().positive();
const count = z.coerce.number().int().min(0);

export const mockOptionsSchema = z
  .object({
    host: z.string().min(1).default('127.0.0.1'),
    port: z.coerce.number().int().min(0).max(65_535).default(4199),
    processes: z.coerce.number().int().min(1).max(256).default(1),
    /** Absent: every start draws a fresh seed. */
    seed: z.coerce.number().int().optional(),
    ttftMedianMs: milliseconds.default(450),
    ttftP95Ms: milliseconds.default(1500),
    tokensPerSecondMean: positive.default(60),
    tokensPerSecondSd: z.coerce.number().min(0).default(15),
    replyTokensMedian: positive.default(220),
    replyTokensP95: positive.default(900),
    chunkTokens: z.coerce.number().int().min(1).max(64).default(3),
    toolCallRate: rate.default(0.15),
    reasoningTokensRatio: z.coerce.number().min(0).max(20).default(0.4),
    rate429: rate.default(0.002),
    rate5xx: rate.default(0.001),
    midStreamErrorRate: rate.default(0.001),
    stallRate: rate.default(0),
    stallMs: milliseconds.default(30_000),
    maxConcurrentStreams: count.default(0),
    embeddingLatencyMedianMs: milliseconds.default(40),
    embeddingLatencyP95Ms: milliseconds.default(150),
    retryAfterSeconds: z.coerce.number().int().min(0).default(2),
    promptCacheEntries: count.default(100_000),
    /** Absent: `port + 1` (or an ephemeral port when `port` is 0). */
    metricsPort: z.coerce.number().int().min(0).max(65_535).optional(),
  })
  .superRefine((options, ctx) => {
    if (options.ttftP95Ms < options.ttftMedianMs) {
      ctx.addIssue({
        code: 'custom',
        path: ['ttftP95Ms'],
        message: 'ttftP95Ms must be at least ttftMedianMs',
      });
    }
    if (options.replyTokensP95 < options.replyTokensMedian) {
      ctx.addIssue({
        code: 'custom',
        path: ['replyTokensP95'],
        message: 'replyTokensP95 must be at least replyTokensMedian',
      });
    }
    if (options.embeddingLatencyP95Ms < options.embeddingLatencyMedianMs) {
      ctx.addIssue({
        code: 'custom',
        path: ['embeddingLatencyP95Ms'],
        message:
          'embeddingLatencyP95Ms must be at least embeddingLatencyMedianMs',
      });
    }
    if (options.rate429 + options.rate5xx + options.midStreamErrorRate > 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['rate429'],
        message: 'rate429 + rate5xx + midStreamErrorRate must not exceed 1',
      });
    }
  });

export type MockOptions = z.infer<typeof mockOptionsSchema>;

export type MockOptionKey = keyof MockOptions;

/**
 * What a caller may hand in: any subset of the options, numbers possibly
 * still as the strings a command line produced.
 */
export type MockOptionsInput = {
  [K in MockOptionKey]?: MockOptions[K] | string;
};

/** One line per option, for the CLI's help text and the README. */
export const MOCK_OPTION_DESCRIPTIONS: Readonly<Record<MockOptionKey, string>> =
  {
    host: 'interface to bind (0.0.0.0 to accept remote generators)',
    port: 'port to listen on (0 picks an ephemeral port)',
    processes: 'worker processes sharing the port (node:cluster)',
    seed: 'seed of the random streams (absent: a fresh seed per start)',
    ttftMedianMs: 'median time to first token, ms',
    ttftP95Ms: '95th percentile time to first token, ms',
    tokensPerSecondMean: 'mean output rate of a reply, tokens/s',
    tokensPerSecondSd: 'standard deviation of the output rate, tokens/s',
    replyTokensMedian: 'median reply length, tokens',
    replyTokensP95: '95th percentile reply length, tokens',
    chunkTokens: 'tokens per streamed chunk',
    toolCallRate: 'share of tool-offering requests answered with a tool call',
    reasoningTokensRatio:
      'reasoning tokens per reply token when reasoning is requested',
    rate429: 'share of requests refused with 429',
    rate5xx: 'share of requests refused with a 5xx',
    midStreamErrorRate: 'share of streams that fail after some content',
    stallRate: 'share of streams that go silent for stallMs',
    stallMs: 'length of a stall, ms',
    maxConcurrentStreams: 'streams served at once before 429 (0: unlimited)',
    embeddingLatencyMedianMs: 'median embeddings latency, ms',
    embeddingLatencyP95Ms: '95th percentile embeddings latency, ms',
    retryAfterSeconds: 'retry-after a 429 asks for, seconds',
    promptCacheEntries: 'conversation prefixes the prompt cache remembers',
    metricsPort: 'aggregated metrics port with processes > 1 (default port+1)',
  };

/** The option keys, in declaration order. */
export const MOCK_OPTION_KEYS = Object.keys(
  MOCK_OPTION_DESCRIPTIONS,
) as readonly MockOptionKey[];

/**
 * The environment variable of an option: `ttftP95Ms` reads
 * `TALE_LOAD_MOCK_TTFT_P95_MS`, `rate429` reads `TALE_LOAD_MOCK_RATE_429`.
 */
export function mockEnvName(key: MockOptionKey): string {
  const snake = key
    .replace(/([a-z])([A-Z0-9])/g, '$1_$2')
    .replace(/([0-9])([A-Z])/g, '$1_$2')
    .toUpperCase();
  return `${MOCK_ENV_PREFIX}${snake}`;
}

/**
 * Resolve the options: flag object over environment over defaults, then
 * validated as a whole. Throws an `Error` listing every invalid option.
 * An empty string (a flag or variable set to nothing) counts as unset.
 */
export function parseMockOptions(
  input: MockOptionsInput = {},
  env: Readonly<Record<string, string | undefined>> = process.env,
): MockOptions {
  const merged: Record<string, unknown> = {};
  for (const key of MOCK_OPTION_KEYS) {
    const flag = input[key];
    if (flag !== undefined && flag !== '') {
      merged[key] = flag;
      continue;
    }
    const fromEnv = env[mockEnvName(key)];
    if (fromEnv !== undefined && fromEnv.trim() !== '') {
      merged[key] = fromEnv.trim();
    }
  }
  const parsed = mockOptionsSchema.safeParse(merged);
  if (!parsed.success) {
    throw new Error(`invalid mock options:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
