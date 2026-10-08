/**
 * The media and safety endpoints, as stubs that answer with valid payloads:
 * image generation (a 1x1 PNG), speech (silent MP3 frames), transcription
 * (a sentence) and moderation (nothing flagged). They exist so a journey
 * that touches them completes against the mock; their latency is the
 * chat's time to first token, and they carry no fault injection.
 */

import type { ServerResponse } from 'node:http';

import { generateSentence } from './content.ts';
import type { MockContext } from './context.ts';
import { ResponseStream, sendBytes, sendJson } from './http.ts';
import { lognormalFromMedianP95, randomId } from './random.ts';

/** A valid 1x1 transparent PNG. */
export const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/**
 * One MPEG-1 Layer III frame: 128 kbit/s, 44.1 kHz, mono, no padding
 * (417 bytes). The side information and main data are zero, which decodes
 * as silence; each frame plays 1152 samples (about 26 ms).
 */
const MP3_FRAME = ((): Buffer => {
  const frame = Buffer.alloc(417);
  frame[0] = 0xff;
  frame[1] = 0xfb;
  frame[2] = 0x90;
  frame[3] = 0xc4;
  return frame;
})();

/** Frames per second of audio. */
const MP3_FRAMES_PER_SECOND = 38;
/** Characters a voice speaks per second. */
const SPEECH_CHARS_PER_SECOND = 15;
const MAX_SPEECH_SECONDS = 120;

/** Silent MP3 audio of about `seconds` seconds. */
export function silentMp3(seconds: number): Buffer {
  const frames = Math.max(
    1,
    Math.round(Math.min(seconds, MAX_SPEECH_SECONDS) * MP3_FRAMES_PER_SECOND),
  );
  return Buffer.concat(new Array<Buffer>(frames).fill(MP3_FRAME));
}

async function wait(
  ctx: MockContext,
  res: ServerResponse,
  arrivedAt: number,
): Promise<boolean> {
  const random = ctx.requestRandom();
  const stream = new ResponseStream(res);
  const latency = lognormalFromMedianP95(
    random,
    ctx.options.ttftMedianMs,
    ctx.options.ttftP95Ms,
  );
  await stream.sleep(latency - (performance.now() - arrivedAt));
  return !stream.closed;
}

/** `POST /v1/images/generations`. */
export async function handleImageGeneration(
  ctx: MockContext,
  res: ServerResponse,
  body: Record<string, unknown>,
  arrivedAt: number,
): Promise<void> {
  if (!(await wait(ctx, res, arrivedAt))) return;
  const n =
    typeof body.n === 'number' && Number.isInteger(body.n) && body.n > 0
      ? Math.min(body.n, 10)
      : 1;
  const asUrl = body.response_format === 'url';
  const image = asUrl
    ? { url: `data:image/png;base64,${TINY_PNG_BASE64}` }
    : { b64_json: TINY_PNG_BASE64 };
  sendJson(res, 200, {
    created: Math.floor(Date.now() / 1000),
    data: new Array(n).fill(image),
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
    },
  });
}

/** `POST /v1/audio/speech`. */
export async function handleSpeech(
  ctx: MockContext,
  res: ServerResponse,
  body: Record<string, unknown>,
  arrivedAt: number,
): Promise<void> {
  if (!(await wait(ctx, res, arrivedAt))) return;
  const input = typeof body.input === 'string' ? body.input : '';
  sendBytes(
    res,
    200,
    'audio/mpeg',
    silentMp3(input.length / SPEECH_CHARS_PER_SECOND),
  );
}

/**
 * `POST /v1/audio/transcriptions`. The multipart body is not parsed: the
 * mock only looks for a `response_format` of `text` to answer plain text.
 */
export async function handleTranscription(
  ctx: MockContext,
  res: ServerResponse,
  raw: Buffer,
  arrivedAt: number,
): Promise<void> {
  if (!(await wait(ctx, res, arrivedAt))) return;
  const text = generateSentence(ctx.requestRandom(), 'en');
  const plain = /name="response_format"\r?\n\r?\ntext\b/.test(
    raw.subarray(0, Math.min(raw.length, 1 << 20)).toString('latin1'),
  );
  if (plain) {
    sendBytes(res, 200, 'text/plain; charset=utf-8', text);
    return;
  }
  sendJson(res, 200, {
    text,
    usage: {
      type: 'duration',
      seconds: Math.max(1, Math.round(raw.length / 16_000)),
    },
  });
}

const MODERATION_CATEGORIES = [
  'harassment',
  'harassment/threatening',
  'hate',
  'hate/threatening',
  'illicit',
  'illicit/violent',
  'self-harm',
  'self-harm/instructions',
  'self-harm/intent',
  'sexual',
  'sexual/minors',
  'violence',
  'violence/graphic',
] as const;

/** `POST /v1/moderations`: every input passes. */
export function handleModeration(
  ctx: MockContext,
  res: ServerResponse,
  body: Record<string, unknown>,
): void {
  const inputs = Array.isArray(body.input) ? body.input.length : 1;
  const categories = Object.fromEntries(
    MODERATION_CATEGORIES.map((category) => [category, false]),
  );
  const scores = Object.fromEntries(
    MODERATION_CATEGORIES.map((category) => [category, 0.000_01]),
  );
  sendJson(res, 200, {
    id: `modr-${randomId(ctx.requestRandom(), 24)}`,
    model:
      typeof body.model === 'string' ? body.model : 'omni-moderation-latest',
    results: Array.from({ length: Math.max(1, inputs) }, () => ({
      flagged: false,
      categories,
      category_scores: scores,
    })),
  });
}
