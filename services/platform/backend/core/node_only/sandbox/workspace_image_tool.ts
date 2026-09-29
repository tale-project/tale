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
 *  1. The arguments are read and bounded (prompt, count, size, paths).
 *  2. The turn the token serves must still be live; its run names the
 *     person the spend is booked under and the delivery box the files go to.
 *  3. The policy is re-read: an admin who turned image generation off
 *     mid-turn stops the next call, not the next turn.
 *  4. The budget gate measures the person (or, for a run a trigger started,
 *     the organization) BEFORE the provider is called, and refuses with the
 *     cap's own words once a cap that applies is reached.
 *  5. The images are generated — one request per image, concurrently.
 *  6. Every image the provider produced is booked in the usage ledger, even
 *     when saving it fails: the spend happened.
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
  type ImageCallResult,
} from '../../lib/providers/image_generation';
import {
  IMAGE_SIZES,
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
import {
  IMAGE_GENERATION_TOOL,
  type TurnOpRef,
} from '../../sandbox/tool_names';
import {
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
/** A reference image's size cap: large enough for a photo, small enough to
 * ride a provider request. */
const REFERENCE_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
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

/** The tool's description, as the status listing relays it to the model. */
export const IMAGE_GENERATION_TOOL_DESCRIPTION =
  "Create images with the organization's image model and save them into " +
  'your workspace. Args: {prompt: string (what to draw — subject, style, ' +
  `composition, any text to render; at most ${IMAGE_PROMPT_MAX_CHARS} ` +
  'characters), path?: string (the file to save, e.g. "cover.png" — a ' +
  "relative path lands in this turn's delivery box, an absolute one must " +
  'be inside the delivery box or /agent/workspace/; the extension follows ' +
  'the format the model returns; default: a timestamped name in the ' +
  'delivery box), size?: "square"|"landscape"|"portrait" (default square; ' +
  'a pixel size such as "1536x1024" is read by its orientation), ' +
  `count?: 1-${IMAGE_COUNT_MAX} (default 1; several are saved as ` +
  '<name>-1, <name>-2, …), inputImages?: string[] (up to ' +
  `${REFERENCE_IMAGES_MAX} workspace image paths to edit or take as ` +
  'reference, when the model accepts images)}. Answers with the saved ' +
  'paths and the model used. Generation can take a minute or two; if the ' +
  'call times out, call it again with exactly the same arguments — it ' +
  'collects the images the platform finished instead of paying for new ' +
  'ones. Change the prompt or the path to get a new image.';

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
 * (`1536x1024`, the spelling image APIs teach models) read by its
 * orientation. */
function imageSizeOf(raw: unknown): ImageSize | undefined {
  if (typeof raw !== 'string') return undefined;
  const value = raw.trim().toLowerCase();
  const named = IMAGE_SIZES.find((candidate) => candidate === value);
  if (named !== undefined) return named;
  const pixels = /^(\d{2,5})\s*[x×]\s*(\d{2,5})$/.exec(value);
  if (pixels === null) return undefined;
  const width = Number(pixels[1]);
  const height = Number(pixels[2]);
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
        error: `"size" must be one of ${IMAGE_SIZES.map((s) => `"${s}"`).join(', ')}, or a pixel size such as "1536x1024".`,
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
 * decides the extension). `null` when `path` leaves both allowed roots.
 * Without a path the name is the moment plus `unique`, so two calls in one
 * second never write over each other's image. */
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
  if (
    resolved === null ||
    !(isInside(resolved, outputDir) || isInside(resolved, WORKSPACE_DIR))
  ) {
    return null;
  }
  const slash = resolved.lastIndexOf('/');
  const base = resolved.slice(slash + 1).replace(IMAGE_EXTENSION, '');
  if (base === '' || base.length > 120) return null;
  return { dir: resolved.slice(0, slash), base };
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
 * says why one cannot be used. */
async function readReferenceImages(
  sessionId: string,
  paths: readonly string[],
): Promise<ReferenceImage[] | ToolResult> {
  const references: ReferenceImage[] = [];
  for (const raw of paths) {
    const path = agentPath(raw, WORKSPACE_DIR);
    if (path === null) {
      return {
        status: 'invalid_args',
        message: `"${raw}" is not a path inside /agent/ — pass the workspace path of an image file.`,
      };
    }
    const file = await sessionReadFile(sessionId, path);
    if (file === null) {
      return {
        status: 'not_found',
        message: `No readable file at ${path} (it is missing, or larger than the sandbox serves).`,
      };
    }
    const bytes = new Uint8Array(file.bytes);
    if (bytes.byteLength > REFERENCE_IMAGE_MAX_BYTES) {
      return {
        status: 'invalid_args',
        message: `${path} is ${Math.round(bytes.byteLength / (1024 * 1024))} MB; a reference image may be at most ${REFERENCE_IMAGE_MAX_BYTES / (1024 * 1024)} MB.`,
      };
    }
    const mediaType = sniffRasterMediaType(bytes);
    if (mediaType === null) {
      return {
        status: 'invalid_args',
        message: `${path} is not a PNG, JPEG, WebP or GIF image.`,
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
  const key = [
    args.sessionId,
    turn.execId,
    createHash('sha256').update(JSON.stringify(parsed)).digest('hex'),
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

async function generateForTurn(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    sessionId: string;
    turn: TurnOpRef;
    request: ImageToolArgs;
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
  if (context.status !== 'live') {
    return unavailable(
      'run_ended',
      'The run this turn belongs to is no longer running, so it cannot generate images. Do not retry.',
    );
  }

  const target = resolveImageTarget(
    request.path,
    context.outputDir,
    new Date(),
    randomBytes(3).toString('hex'),
  );
  if (target === null) {
    return {
      status: 'invalid_args',
      message: `"path" must name a file inside ${context.outputDir}/ or ${WORKSPACE_DIR}/ (a relative path lands in ${context.outputDir}/), without "." or ".." segments.`,
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

  let references: ReferenceImage[] = [];
  if (request.inputImages.length > 0) {
    if (!model.acceptsImageInput) {
      return {
        status: 'invalid_args',
        message: `The organization's image model (${model.modelId}) does not take reference images. Describe the image in the prompt instead, without "inputImages".`,
      };
    }
    const read = await readReferenceImages(args.sessionId, request.inputImages);
    if (!Array.isArray(read)) return read;
    references = read;
  }

  const budget: { allowed: true } | { allowed: false; message: string } =
    await ctx.runQuery(
      internal.sandbox.image_generation.checkImageGenerationBudget,
      {
        organizationId: args.organizationId,
        sessionId: args.sessionId,
        execId: turn.execId,
        subject: context.subject,
        images: request.count,
      },
    );
  if (!budget.allowed) {
    return unavailable(
      'budget_exceeded',
      `${budget.message} No image was generated. Tell the user; do not retry.`,
    );
  }

  const startedAt = Date.now();
  const calls = await Promise.allSettled(
    Array.from({ length: request.count }, () =>
      generateOneImage(model, {
        prompt: request.prompt,
        size: request.size,
        references,
      }),
    ),
  );
  const produced: ImageCallResult[] = [];
  const failures: string[] = [];
  for (const call of calls) {
    if (call.status === 'fulfilled') {
      produced.push(call.value);
    } else {
      failures.push(
        call.reason instanceof ImageProviderError
          ? call.reason.message
          : 'the image request failed',
      );
      if (!(call.reason instanceof ImageProviderError)) {
        console.warn('[image-generation] image request failed:', call.reason);
      }
    }
  }

  // Book what was produced before anything else can fail: the provider
  // has charged for it whether or not it reaches the workspace.
  let costCents = 0;
  for (const call of produced) {
    costCents += call.costCents;
    await ctx
      .runMutation(
        internal.sandbox.image_generation.recordImageGenerationUsage,
        {
          organizationId: args.organizationId,
          subject: context.subject,
          provider: model.providerSlug,
          model: model.modelId,
          inputTokens: call.inputTokens,
          outputTokens: call.outputTokens,
          costCents: call.costCents,
          timestamp: Date.now(),
        },
      )
      .catch((error: unknown) =>
        console.error('[image-generation] usage booking failed:', error),
      );
  }

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
    bytes,
    costCents,
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
      files: saved.map((file) => ({
        path: file.path,
        mediaType: file.image.mediaType,
        bytes: file.image.bytes.byteLength,
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
