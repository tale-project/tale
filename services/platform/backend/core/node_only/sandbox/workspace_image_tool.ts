'use node';

/**
 * `generate_image` — the workspace tool that lets a managed agent turn (a
 * project agent working a task, an automation's agent step) create images.
 *
 * Executed on the platform, never in the sandbox: the agent asks through
 * the in-container MCP shim (`workspace_tool` → `POST /api/tools/execute`),
 * and this dispatch resolves the organization's image model, calls the
 * provider with the organization's credential, and writes the images into
 * the agent's workspace — so no provider key ever enters the container.
 *
 * Every call, in order:
 *  1. The arguments are read and bounded (prompt, count, size, paths), and
 *     the reference images read from the workspace under their size caps.
 *  2. The turn the token serves must still be live; its run names the
 *     person the spend is booked under and the delivery box the files go to.
 *  3. The policy is re-read: an admin who turned image generation off
 *     mid-turn stops the next call, not the next turn.
 *  4. The admission (`domains/sandbox/image-generation.ts`) runs BEFORE the
 *     provider is called: one generation in flight per turn, a ceiling on
 *     the images one turn may create, the turn's spend allowance (shared
 *     with its model spend), and the budget caps — refusing with the reason
 *     in words. An admitted call holds its estimate until it is settled.
 *  5. The images are generated — one request per image, concurrently, all
 *     sent from one request built once.
 *  6. Every request the provider billed is booked in the usage ledger and
 *     the hold released, even when a reply had no usable image or saving
 *     fails: the spend happened.
 *  7. The images are staged into the session at the resolved paths.
 *
 * An identical call from the same turn within {@link REPEAT_WINDOW_MS}
 * attaches to the first one's result instead of paying again, so an agent
 * whose MCP client gave up waiting can retry and collect the images the
 * platform finished anyway.
 */

import { createHash, randomBytes } from 'node:crypto';

import type { ActionCtx } from '../../lib/ctx';
import { internal } from '../../lib/handler_names';
import { orgSlugFromId } from '../../lib/helpers/org_slug';
import {
  generateOneImage,
  ImageProviderError,
  prepareImageRequest,
  type ImageCallResult,
} from '../../lib/providers/image_generation';
import {
  IMAGE_SIZES,
  isReferenceMediaType,
  RASTER_EXTENSIONS,
  sniffRasterMediaType,
  type GeneratedImage,
  type ImageSize,
  type ReferenceImage,
} from '../../lib/providers/image_wire';
import {
  ImageGenerationError,
  resolveImageGenerationModel,
  type ResolvedImageModel,
} from '../../lib/providers/resolve_image_model';
import { deleteBlob, putBlob } from '../../lib/storage/blob_access';
import { SANDBOX_TURN_MAX_GENERATED_IMAGES } from '../../sandbox/session_constants';
import {
  IMAGE_GENERATION_TOOL,
  type TurnOpRef,
} from '../../sandbox/tool_names';
import {
  SessionFileTooLargeError,
  sessionReadFile,
  sessionStageFiles,
  type SessionStageFile,
} from './helpers/session_client';
import { stageUrlForBlobRef } from './helpers/stage_url';
import type { ToolResult } from './workspace_tool_shared';

/** Images one call may create. */
const IMAGE_COUNT_MAX = 4;
/** Reference images one call may start from. */
const REFERENCE_IMAGES_MAX = 4;
/** Long enough for any image brief; image models read the start of a very
 * long prompt and ignore the rest, so a cap here costs nothing. */
const IMAGE_PROMPT_MAX_CHARS = 4_000;
/** A reference image's size cap: a photo at a size an image model reads,
 * small enough to ride a provider request base64-encoded. */
const REFERENCE_IMAGE_MAX_BYTES = 4 * 1024 * 1024;
/** All of one call's reference images together. */
const REFERENCE_IMAGES_TOTAL_MAX_BYTES = 20 * 1024 * 1024;
/** A generated image above this is refused rather than staged. */
const GENERATED_IMAGE_MAX_BYTES = 20 * 1024 * 1024;
/** Up to this size an image rides the stage request inline: the sandbox
 * daemon takes inline files up to 1 MiB, and the base64 of this many bytes
 * stays inside one stage request's budget. Anything larger is fetched from
 * the blob store by URL. */
const INLINE_STAGE_MAX_BYTES = 768 * 1024;
/** How long an identical call from the same turn collects the first call's
 * result instead of generating (and billing) again. */
const REPEAT_WINDOW_MS = 10 * 60 * 1000;
/** Calls remembered at once; the oldest settled entry goes first. */
const REPEAT_ENTRIES_MAX = 500;

const WORKSPACE_DIR = '/agent/workspace';
const AGENT_ROOT = '/agent';
const IMAGE_EXTENSION = /\.(png|jpe?g|webp|gif)$/i;
const MIB = 1024 * 1024;

/** The tool's description, as the status listing relays it to the model. */
export const IMAGE_GENERATION_TOOL_DESCRIPTION =
  "Create images with the organization's image model and save them into " +
  'your workspace. Args: {prompt: string (what to draw — subject, style, ' +
  `composition, any text to render; at most ${IMAGE_PROMPT_MAX_CHARS} ` +
  'characters), path?: string (the file to save — a bare name such as ' +
  '"cover.png" lands in the delivery box of this turn, which delivers only ' +
  'its top level, so no subfolders there; an absolute path may also name a ' +
  'file anywhere under /agent/workspace/; the extension follows the ' +
  'format the model returns; default: a timestamped name in the delivery ' +
  'box), size?: "square"|"landscape"|"portrait" (default square; ' +
  'landscape is 3:2 and portrait 2:3, in pixels the model picks; another ' +
  'shape such as "16:9" or "1920x1080" is read by its orientation), ' +
  `count?: 1-${IMAGE_COUNT_MAX} (default 1; several are saved as ` +
  '<name>-1, <name>-2, …), inputImages?: string[] (up to ' +
  `${REFERENCE_IMAGES_MAX} workspace PNG, JPEG or WebP images of at most ` +
  `${REFERENCE_IMAGE_MAX_BYTES / MIB} MB each, to edit or take as ` +
  'reference, when the model accepts images)}. Answers with the saved ' +
  "paths, each image's width and height in pixels, and the model used — " +
  'report those, not the size you asked for. One call at a time, and at most ' +
  `${SANDBOX_TURN_MAX_GENERATED_IMAGES} images a turn, within the turn's ` +
  'spend allowance. Generation can take a minute or two; if the call times ' +
  'out, call it again with exactly the same arguments — it collects the ' +
  'images the platform finished instead of paying for new ones. Change the ' +
  'prompt or the path to get a new image.';

interface ImageTurnSubject {
  userId: string;
  agentSlug?: string;
  apiKeyId?: string;
}

type ImageTurnContext =
  | { status: 'live'; outputDir: string; subject: ImageTurnSubject }
  | { status: 'ended' };

interface ImageToolArgs {
  prompt: string;
  count: number;
  size: ImageSize;
  path?: string;
  inputImages: string[];
}

/** The shape an agent asked for: one of {@link IMAGE_SIZES}, or a pixel size
 * (`1536x1024`, the spelling image APIs teach models) or an aspect ratio
 * (`16:9`, the spelling people use) read by its orientation. */
function imageSizeOf(raw: unknown): ImageSize | undefined {
  if (typeof raw !== 'string') return undefined;
  const value = raw.trim().toLowerCase();
  const named = IMAGE_SIZES.find((candidate) => candidate === value);
  if (named !== undefined) return named;
  const shape =
    /^(\d{2,5})\s*[x×]\s*(\d{2,5})$/.exec(value) ??
    /^([1-9]\d{0,3})\s*:\s*([1-9]\d{0,3})$/.exec(value);
  if (shape === null) return undefined;
  const width = Number(shape[1]);
  const height = Number(shape[2]);
  return width === height
    ? 'square'
    : width > height
      ? 'landscape'
      : 'portrait';
}

/** Read and bound the call's arguments, or say what is wrong with them. */
function readImageToolArgs(
  callArgs: Record<string, unknown>,
): ImageToolArgs | { error: string } {
  const prompt =
    typeof callArgs.prompt === 'string' ? callArgs.prompt.trim() : '';
  if (prompt === '') {
    return {
      error: `${IMAGE_GENERATION_TOOL} needs a non-empty "prompt": describe the image to create.`,
    };
  }
  if (prompt.length > IMAGE_PROMPT_MAX_CHARS) {
    return {
      error: `The "prompt" is ${prompt.length} characters; keep it at most ${IMAGE_PROMPT_MAX_CHARS}.`,
    };
  }
  let count = 1;
  if (callArgs.count !== undefined) {
    // A model relays a number as text often enough; its decimal spelling
    // counts the same.
    const requested =
      typeof callArgs.count === 'string' && /^\d+$/.test(callArgs.count.trim())
        ? Number(callArgs.count.trim())
        : callArgs.count;
    if (
      typeof requested !== 'number' ||
      !Number.isInteger(requested) ||
      requested < 1 ||
      requested > IMAGE_COUNT_MAX
    ) {
      return {
        error: `"count" must be a whole number from 1 to ${IMAGE_COUNT_MAX}.`,
      };
    }
    count = requested;
  }
  let size: ImageSize = 'square';
  if (callArgs.size !== undefined) {
    const known = imageSizeOf(callArgs.size);
    if (known === undefined) {
      return {
        error: `"size" must be one of ${IMAGE_SIZES.map((s) => `"${s}"`).join(', ')}, or a shape such as "16:9" or "1536x1024".`,
      };
    }
    size = known;
  }
  let path: string | undefined;
  if (callArgs.path !== undefined) {
    if (typeof callArgs.path !== 'string' || callArgs.path.trim() === '') {
      return { error: '"path" must be a non-empty file path.' };
    }
    path = callArgs.path.trim();
  }
  let inputImages: string[] = [];
  if (callArgs.inputImages !== undefined) {
    if (
      !Array.isArray(callArgs.inputImages) ||
      !callArgs.inputImages.every(
        (entry): entry is string =>
          typeof entry === 'string' && entry.trim() !== '',
      )
    ) {
      return { error: '"inputImages" must be a list of workspace file paths.' };
    }
    if (callArgs.inputImages.length > REFERENCE_IMAGES_MAX) {
      return {
        error: `Pass at most ${REFERENCE_IMAGES_MAX} "inputImages".`,
      };
    }
    inputImages = callArgs.inputImages.map((entry) => entry.trim());
  }
  return {
    prompt,
    count,
    size,
    ...(path !== undefined ? { path } : {}),
    inputImages,
  };
}

/**
 * `raw` as a normalized absolute path under `/agent`, or `null` when it is
 * not one: a relative path resolves against `base`; separators never
 * repeat; `.` and `..` segments, backslashes and control characters are
 * refused outright (never resolved), so a path cannot climb out of the root
 * it names.
 */
function agentPath(raw: string, base: string): string | null {
  // oxlint-disable-next-line no-control-regex -- the point is to refuse control characters
  if (raw.includes('\\') || /[\u0000-\u001f]/.test(raw)) return null;
  const absolute = raw.startsWith('/') ? raw : `${base}/${raw}`;
  const segments = absolute.split('/').slice(1);
  if (
    segments.length === 0 ||
    segments.some(
      (segment) => segment === '' || segment === '.' || segment === '..',
    )
  ) {
    return null;
  }
  const path = `/${segments.join('/')}`;
  return path.startsWith(`${AGENT_ROOT}/`) ? path : null;
}

function isInside(path: string, dir: string): boolean {
  return path.startsWith(`${dir}/`);
}

/** Where the images go: a directory and a base name (the returned format
 * decides the extension). `null` when `path` leaves both allowed places: a
 * file directly in the delivery box — which delivers only its top level, so
 * an image in a subfolder of it would be paid for and never delivered — or
 * a file anywhere under the workspace. Without a path the name is the
 * moment plus `unique`, so two calls in one second never write over each
 * other's image. */
export function resolveImageTarget(
  path: string | undefined,
  outputDir: string,
  now: Date,
  unique: string,
): { dir: string; base: string } | null {
  if (path === undefined) {
    const stamp = now.toISOString().replace(/[-:]/g, '').slice(0, 15);
    return { dir: outputDir, base: `image-${stamp}-${unique}` };
  }
  const resolved = agentPath(path, outputDir);
  if (resolved === null) return null;
  const slash = resolved.lastIndexOf('/');
  const dir = resolved.slice(0, slash);
  if (!(dir === outputDir || isInside(resolved, WORKSPACE_DIR))) return null;
  const base = resolved.slice(slash + 1).replace(IMAGE_EXTENSION, '');
  if (base === '' || base.length > 120) return null;
  return { dir, base };
}

/** The saved file name of image `index` (0-based) of `count`. */
function imageFileName(
  base: string,
  index: number,
  count: number,
  image: GeneratedImage,
): string {
  const extension = RASTER_EXTENSIONS[image.mediaType];
  return count === 1
    ? `${base}.${extension}`
    : `${base}-${index + 1}.${extension}`;
}

/** Read the reference images from the session, or the tool result that
 * says why one cannot be used. Each read is capped where it happens — the
 * platform never holds more of a file than the cap allows, one image's cap
 * or what is left of the call's total. */
async function readReferenceImages(
  sessionId: string,
  paths: readonly string[],
): Promise<ReferenceImage[] | ToolResult> {
  const references: ReferenceImage[] = [];
  let total = 0;
  for (const raw of paths) {
    const path = agentPath(raw, WORKSPACE_DIR);
    if (path === null) {
      return {
        status: 'invalid_args',
        message: `"${raw}" is not a path inside /agent/ — pass the workspace path of an image file.`,
      };
    }
    const maxBytes = Math.min(
      REFERENCE_IMAGE_MAX_BYTES,
      REFERENCE_IMAGES_TOTAL_MAX_BYTES - total,
    );
    let file: Awaited<ReturnType<typeof sessionReadFile>>;
    try {
      file = await sessionReadFile(sessionId, path, { maxBytes });
    } catch (error) {
      if (!(error instanceof SessionFileTooLargeError)) throw error;
      return {
        status: 'invalid_args',
        message:
          maxBytes < REFERENCE_IMAGE_MAX_BYTES
            ? `${path} does not fit: the reference images of one call may be at most ${REFERENCE_IMAGES_TOTAL_MAX_BYTES / MIB} MB together.`
            : `${path} is larger than ${REFERENCE_IMAGE_MAX_BYTES / MIB} MB, the most a reference image may be. Pass a smaller copy.`,
      };
    }
    if (file === null) {
      return {
        status: 'not_found',
        message: `No readable file at ${path} (it is missing, or larger than the sandbox serves).`,
      };
    }
    const bytes = new Uint8Array(file.bytes);
    total += bytes.byteLength;
    const mediaType = sniffRasterMediaType(bytes);
    if (mediaType === null || !isReferenceMediaType(mediaType)) {
      return {
        status: 'invalid_args',
        message: `${path} is not a PNG, JPEG or WebP image — the formats a reference image may have.`,
      };
    }
    references.push({
      bytes,
      mediaType,
      fileName: path.slice(path.lastIndexOf('/') + 1),
    });
  }
  return references;
}

/** The digests of a call's reference images, so an identical retry is told
 * apart from a call that names the same paths after the files changed. */
function referencesDigest(references: readonly ReferenceImage[]): string[] {
  return references.map((image) =>
    createHash('sha256').update(image.bytes).digest('hex'),
  );
}

/**
 * Stage the images into the session: inline when a file is small enough to
 * ride the stage request itself, else through the organization's blob store
 * and a signed stage URL — the door every workspace file takes — with each
 * transit blob deleted once the sandbox has fetched it (or failed to).
 * Answers the paths the sandbox wrote.
 */
async function stageImages(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    sessionId: string;
    files: Array<{ path: string; image: GeneratedImage }>;
  },
): Promise<{
  staged: Set<string>;
  skipped: Array<{ path: string; reason: string }>;
}> {
  const toStage: SessionStageFile[] = [];
  const transit: Array<{ orgSlug: string; ref: string }> = [];
  try {
    for (const { path, image } of args.files) {
      if (image.bytes.byteLength <= INLINE_STAGE_MAX_BYTES) {
        toStage.push({
          path,
          contentBase64: Buffer.from(image.bytes).toString('base64'),
        });
        continue;
      }
      const orgSlug = await orgSlugFromId(ctx, args.organizationId);
      const ref = await putBlob(orgSlug, image.bytes, image.mediaType);
      transit.push({ orgSlug, ref });
      const url = await stageUrlForBlobRef(ref, args.organizationId);
      if (url === null) {
        throw new Error(
          'this deployment cannot sign a sandbox stage URL (no HMAC root)',
        );
      }
      toStage.push({ path, url });
    }
    const result = await sessionStageFiles(args.sessionId, toStage);
    return {
      staged: new Set(result.staged.map((entry) => entry.path)),
      skipped: result.skipped,
    };
  } finally {
    for (const { orgSlug, ref } of transit) {
      await deleteBlob(orgSlug, ref).catch((error: unknown) =>
        console.warn('[image-generation] transit blob cleanup failed:', error),
      );
    }
  }
}

function unavailable(code: string, guidance: string): ToolResult {
  return { status: 'unavailable', blockers: [{ code, guidance }] };
}

/** Why the admission refused — the answer `admitImageGeneration`
 * (`domains/sandbox/image-generation.ts`) sends across the shim. */
type ImageRefusal = {
  admitted: false;
  code:
    | 'run_ended'
    | 'generation_in_progress'
    | 'turn_image_limit'
    | 'turn_allowance'
    | 'spend_unknown'
    | 'budget_exceeded';
  message: string;
};

type ImageAdmission =
  | { admitted: true; callStartedAt: number; holdCents: number }
  | ImageRefusal;

function runEnded(): ToolResult {
  return unavailable(
    'run_ended',
    'The run this turn belongs to is no longer running, so it cannot generate images. Do not retry.',
  );
}

/** What an agent should do after each refusal but a run that ended. */
const REFUSAL_ADVICE: Record<
  Exclude<ImageRefusal['code'], 'run_ended'>,
  string
> = {
  generation_in_progress:
    'Wait for its answer, then call again if you still need more images.',
  turn_image_limit:
    'No image was generated. Ask for fewer images, or tell the user the limit is reached; do not retry the same call.',
  spend_unknown:
    'No image was generated. Try once more in a minute; if it fails again, tell the user.',
  turn_allowance: 'No image was generated. Tell the user; do not retry.',
  budget_exceeded: 'No image was generated. Tell the user; do not retry.',
};

/** A refusal as the agent reads it: the reason, then what to do. */
function refusalResult(refusal: ImageRefusal): ToolResult {
  if (refusal.code === 'run_ended') return runEnded();
  return unavailable(
    refusal.code,
    `${refusal.message} ${REFUSAL_ADVICE[refusal.code]}`,
  );
}

/** Remembered calls: the in-flight promise, and when it settled. */
const recentCalls = new Map<
  string,
  { result: Promise<ToolResult>; settledAt?: number }
>();

function forgetStaleCalls(now: number): void {
  for (const [key, entry] of recentCalls) {
    if (
      entry.settledAt !== undefined &&
      now - entry.settledAt > REPEAT_WINDOW_MS
    ) {
      recentCalls.delete(key);
    }
  }
  while (recentCalls.size >= REPEAT_ENTRIES_MAX) {
    const oldest = [...recentCalls].find(
      ([, entry]) => entry.settledAt !== undefined,
    );
    if (oldest === undefined) break;
    recentCalls.delete(oldest[0]);
  }
}

/** Test seam: forget every remembered call. */
export function resetImageToolMemory(): void {
  recentCalls.clear();
}

/**
 * Run one `generate_image` call for a sandbox session. The HTTP door has
 * already authenticated the session token and checked the grant; `turn` is
 * the token's own `turnOp` — never the request's.
 */
export async function runGenerateImage(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    sessionId: string;
    turn: TurnOpRef | undefined;
    callArgs: Record<string, unknown>;
  },
): Promise<ToolResult> {
  const parsed = readImageToolArgs(args.callArgs);
  if ('error' in parsed) {
    return { status: 'invalid_args', message: parsed.error };
  }
  if (args.turn === undefined) {
    return unavailable(
      'no_turn',
      'This session token does not belong to an agent turn that may generate images. Tell the user; do not retry.',
    );
  }
  const turn = args.turn;
  let references: ReferenceImage[] = [];
  if (parsed.inputImages.length > 0) {
    const read = await readReferenceImages(args.sessionId, parsed.inputImages);
    if (!Array.isArray(read)) return read;
    references = read;
  }
  // The same call, byte for byte — its arguments and the content of the
  // images it starts from. Remembered in this process only: a retry that
  // reaches another replica runs as a new call, which the turn's in-flight
  // mark refuses while the first still runs, and which the per-turn ceiling
  // and allowance bound after that.
  const key = [
    args.sessionId,
    turn.execId,
    createHash('sha256')
      .update(
        JSON.stringify({ ...parsed, references: referencesDigest(references) }),
      )
      .digest('hex'),
  ].join('\0');
  const now = Date.now();
  forgetStaleCalls(now);
  const remembered = recentCalls.get(key);
  if (remembered !== undefined) return remembered.result;

  const entry: { result: Promise<ToolResult>; settledAt?: number } = {
    result: generateForTurn(ctx, {
      organizationId: args.organizationId,
      sessionId: args.sessionId,
      turn,
      request: parsed,
      references,
    }),
  };
  recentCalls.set(key, entry);
  try {
    const result = await entry.result;
    // Only a success is worth collecting again; a refusal or a failure is
    // re-decided on the next call.
    if (result.status === 'ok') entry.settledAt = Date.now();
    else recentCalls.delete(key);
    return result;
  } catch (error) {
    recentCalls.delete(key);
    throw error;
  }
}

/** What the provider returned and billed for one admitted call. */
interface GenerationOutcome {
  produced: ImageCallResult[];
  /** One entry per request the provider billed: its cost in cents. */
  charges: number[];
  failures: string[];
}

async function generateImages(
  model: ResolvedImageModel,
  request: ImageToolArgs,
  references: readonly ReferenceImage[],
): Promise<GenerationOutcome> {
  // One request, built once: the reference images are encoded once
  // whatever the count.
  const wireRequest = prepareImageRequest(model, {
    prompt: request.prompt,
    size: request.size,
    references,
  });
  const calls = await Promise.allSettled(
    Array.from({ length: request.count }, () =>
      generateOneImage(model, wireRequest),
    ),
  );
  const outcome: GenerationOutcome = {
    produced: [],
    charges: [],
    failures: [],
  };
  for (const call of calls) {
    if (call.status === 'fulfilled') {
      outcome.produced.push(call.value);
      outcome.charges.push(call.value.costCents);
      continue;
    }
    if (call.reason instanceof ImageProviderError) {
      outcome.failures.push(call.reason.message);
      // Answered but unusable: billed all the same.
      if (call.reason.charge !== undefined) {
        outcome.charges.push(call.reason.charge.costCents);
      }
    } else {
      outcome.failures.push('the image request failed');
      console.warn('[image-generation] image request failed:', call.reason);
    }
  }
  return outcome;
}

async function generateForTurn(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    sessionId: string;
    turn: TurnOpRef;
    request: ImageToolArgs;
    references: readonly ReferenceImage[];
  },
): Promise<ToolResult> {
  const { request, turn } = args;
  const context: ImageTurnContext = await ctx.runQuery(
    internal.sandbox.image_generation.getImageTurnContext,
    {
      organizationId: args.organizationId,
      sessionId: args.sessionId,
      kind: turn.kind,
      execId: turn.execId,
    },
  );
  if (context.status !== 'live') return runEnded();

  const target = resolveImageTarget(
    request.path,
    context.outputDir,
    new Date(),
    randomBytes(3).toString('hex'),
  );
  if (target === null) {
    return {
      status: 'invalid_args',
      message: `"path" must be a file name in ${context.outputDir}/ (no subfolders: only its top level is delivered) or a file under ${WORKSPACE_DIR}/, without "." or ".." segments.`,
    };
  }

  let model: ResolvedImageModel | null;
  try {
    model = await resolveImageGenerationModel(ctx, args.organizationId);
  } catch (error) {
    if (error instanceof ImageGenerationError) {
      return unavailable(
        'image_generation_unavailable',
        `${error.data.message} Tell the user; do not retry.`,
      );
    }
    throw error;
  }
  if (model === null) {
    return unavailable(
      'image_generation_off',
      'An administrator has turned image generation off for this organization. Tell the user; do not retry.',
    );
  }
  if (args.references.length > 0 && !model.acceptsImageInput) {
    return {
      status: 'invalid_args',
      message: `The organization's image model (${model.modelId}) does not take reference images. Describe the image in the prompt instead, without "inputImages".`,
    };
  }

  const admission: ImageAdmission = await ctx.runMutation(
    internal.sandbox.image_generation.admitImageGeneration,
    {
      organizationId: args.organizationId,
      sessionId: args.sessionId,
      execId: turn.execId,
      subject: context.subject,
      images: request.count,
    },
  );
  if (!admission.admitted) return refusalResult(admission);

  const startedAt = Date.now();
  let outcome: GenerationOutcome = { produced: [], charges: [], failures: [] };
  try {
    outcome = await generateImages(model, request, args.references);
  } finally {
    // Book what the provider billed and release the hold, whatever
    // happened after the admission — before anything else can fail.
    await ctx
      .runMutation(internal.sandbox.image_generation.settleImageGeneration, {
        organizationId: args.organizationId,
        sessionId: args.sessionId,
        execId: turn.execId,
        callStartedAt: admission.callStartedAt,
        subject: context.subject,
        provider: model.providerSlug,
        model: model.modelId,
        charges: outcome.charges,
        timestamp: Date.now(),
      })
      .catch((error: unknown) =>
        console.error('[image-generation] usage booking failed:', error),
      );
  }
  const { produced, charges, failures } = outcome;

  const images = produced
    .flatMap((call) => call.images)
    .filter((image) => {
      if (image.bytes.byteLength <= GENERATED_IMAGE_MAX_BYTES) return true;
      failures.push('the model returned an image larger than 20 MB');
      return false;
    })
    .slice(0, request.count);
  const bytes = images.reduce((sum, image) => sum + image.bytes.byteLength, 0);
  // The structured record of the generation — which model, how much, what
  // it cost. Never the prompt: it is the organization's content.
  console.info('[image-generation] generated', {
    organizationId: args.organizationId,
    sessionId: args.sessionId,
    execId: turn.execId,
    turn: turn.kind,
    provider: model.providerSlug,
    model: model.modelId,
    source: model.source,
    requested: request.count,
    images: images.length,
    failed: request.count - produced.length,
    charged: charges.length,
    bytes,
    costCents: charges.reduce((sum, charge) => sum + charge, 0),
    durationMs: Date.now() - startedAt,
  });

  if (images.length === 0) {
    return {
      status: 'error',
      message: `No image was generated with ${model.modelId}: ${failures[0] ?? 'the provider returned none'}. You may retry once with a different prompt; if it fails again, tell the user.`,
    };
  }

  const files = images.map((image, index) => ({
    path: `${target.dir}/${imageFileName(target.base, index, images.length, image)}`,
    image,
  }));
  let staged: Awaited<ReturnType<typeof stageImages>>;
  try {
    staged = await stageImages(ctx, {
      organizationId: args.organizationId,
      sessionId: args.sessionId,
      files,
    });
  } catch (error) {
    console.error('[image-generation] staging failed:', error);
    return {
      status: 'error',
      message: `The ${images.length === 1 ? 'image was' : 'images were'} generated but could not be saved into the workspace. Tell the user; do not retry.`,
    };
  }
  if (staged.staged.size === 0) {
    console.error('[image-generation] every file was skipped:', staged.skipped);
    return {
      status: 'error',
      message: `The ${images.length === 1 ? 'image was' : 'images were'} generated but could not be saved into the workspace. Tell the user; do not retry.`,
    };
  }
  const saved = files.filter((file) => staged.staged.has(file.path));
  return {
    status: 'ok',
    output: {
      files: saved.map(({ path, image }) => ({
        path,
        mediaType: image.mediaType,
        bytes: image.bytes.byteLength,
        ...(image.width !== undefined && image.height !== undefined
          ? { width: image.width, height: image.height }
          : {}),
      })),
      model: `${model.providerSlug}/${model.modelId}`,
      ...(saved.length < request.count
        ? {
            note: `${saved.length} of ${request.count} requested images were saved${failures.length > 0 ? ` (${failures[0]})` : ''}.`,
          }
        : {}),
    },
  };
}
