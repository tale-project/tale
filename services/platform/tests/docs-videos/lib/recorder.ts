/**
 * The record stage: drive one episode's scenes in a real Chromium page while
 * a CDP screencast captures every compositor frame with its timestamp.
 *
 * Sync model (see timeline.ts): the timeline is PLANNED from the narration
 * durations before recording. This runner paces scene starts to that plan on
 * the Node monotonic clock, anchored at the arrival of the first screencast
 * frame — so "scene k starts at plan[k].startMs" holds on the same clock the
 * frames are timestamped with (modulo one frame-delivery latency, ~10 ms).
 * A scene that cannot hold its budget throws — the compose stage would
 * otherwise ship a video whose audio drifts from the pictures.
 *
 * Recording context deliberately INVERTS two docs-screenshots choices: real
 * animations (`reducedMotion: no-preference`) and motion-friendly capture —
 * a video wants the product alive, a screenshot wants it frozen.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { chromium, type Browser, type CDPSession } from '@playwright/test';

import { BASE_URL } from '../../e2e/helpers/env';
import { readAudioPlan } from './audio-plan';
import { installVideoCards } from './cards';
import { Cursor } from './cursor';
import type { EpisodeSpec, Locale } from './episode';
import { contextLocale, localeT } from './i18n';
import {
  choreographyFor,
  type SceneChoreography,
  type SceneContext,
} from './scene';
import { planTimeline, type PlannedTimeline } from './timeline';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const SCREENSHOTS_STATE = path.join(
  HERE,
  '..',
  '..',
  'docs-screenshots',
  '.state',
);

const VIEWPORT = { width: 1920, height: 1080 } as const;
const DPR = 2;
/** Device pixels the screencast may deliver (viewport × DPR). */
const CAPTURE = { width: VIEWPORT.width * DPR, height: VIEWPORT.height * DPR };
const JPEG_QUALITY = 85;

export interface RecordedTimeline {
  readonly planned: PlannedTimeline;
  readonly actualStartsMs: Record<string, number>;
}

export function framesDir(
  stateDir: string,
  episodeId: string,
  locale: Locale,
): string {
  return path.join(stateDir, 'frames', `${episodeId}.${locale}`);
}

export function timelinePath(
  stateDir: string,
  episodeId: string,
  locale: Locale,
): string {
  return path.join(stateDir, 'frames', `${episodeId}.${locale}.timeline.json`);
}

interface OrgState {
  readonly orgId: string;
  readonly projects: Record<string, string>;
}

function readOrgState(episode: EpisodeSpec, locale: Locale): OrgState {
  if (episode.diagnostic) return { orgId: '', projects: {} };
  // en records against the shared docs-screenshots org; de/fr against their
  // own natively-seeded orgs (native task titles, documents, entries).
  if (locale === 'en') {
    const orgStatePath = path.join(SCREENSHOTS_STATE, 'org.json');
    if (!existsSync(orgStatePath)) {
      throw new Error(
        `No demo workspace at ${orgStatePath} — run \`bun run docs:screenshots\` once ` +
          `first (it bootstraps and seeds the shared Northlight Labs org).`,
      );
    }
    const state = JSON.parse(readFileSync(orgStatePath, 'utf8')) as OrgState;
    return { orgId: state.orgId, projects: state.projects ?? {} };
  }
  const localeOrgsPath = path.join(HERE, '..', '.state', 'locale-orgs.json');
  if (!existsSync(localeOrgsPath)) {
    throw new Error(
      `No locale orgs at ${localeOrgsPath} — run ` +
        `\`bun services/platform/tests/docs-videos/seed-locale-orgs.ts\` first.`,
    );
  }
  const orgs = JSON.parse(readFileSync(localeOrgsPath, 'utf8')) as Partial<
    Record<Locale, OrgState>
  >;
  const state = orgs[locale];
  if (!state) {
    throw new Error(
      `No ${locale} org in ${localeOrgsPath} — run the locale seeder with --locale ${locale}.`,
    );
  }
  return state;
}

interface ChoreographyModule {
  readonly SCENES: readonly SceneChoreography[];
  /** Optional pre-screencast lap over every surface the take visits. */
  readonly warmup?: (
    page: import('@playwright/test').Page,
    ctx: SceneContext,
  ) => Promise<void>;
}

async function loadChoreography(
  episodeId: string,
): Promise<ChoreographyModule> {
  return (await import(
    `../episodes/${episodeId}/scenes`
  )) as ChoreographyModule;
}

interface FrameLogEntry {
  readonly file: string;
  /** Milliseconds since the first captured frame. */
  readonly tMs: number;
}

/** Collects screencast frames to disk and acks each one (flow control). */
function attachScreencastSink(
  cdp: CDPSession,
  dir: string,
): {
  frames: FrameLogEntry[];
  firstFrameAt: () => Promise<number>;
} {
  const frames: FrameLogEntry[] = [];
  let t0: number | null = null;
  let resolveFirst: ((ts: number) => void) | null = null;
  const firstFrame = new Promise<number>((resolve) => {
    resolveFirst = resolve;
  });

  cdp.on(
    'Page.screencastFrame',
    (event: {
      data: string;
      sessionId: number;
      metadata: { timestamp?: number };
    }) => {
      const timestamp = event.metadata.timestamp ?? 0;
      if (t0 === null) {
        t0 = timestamp;
        resolveFirst?.(timestamp);
      }
      const file = `f${String(frames.length + 1).padStart(6, '0')}.jpg`;
      writeFileSync(path.join(dir, file), Buffer.from(event.data, 'base64'));
      frames.push({ file, tMs: Math.round((timestamp - t0) * 1000) });
      cdp
        .send('Page.screencastFrameAck', { sessionId: event.sessionId })
        .catch((error) => {
          console.warn('screencastFrameAck failed:', error);
        });
    },
  );

  return { frames, firstFrameAt: () => firstFrame };
}

function sleepUntil(deadlineMs: number, nowMs: () => number): Promise<void> {
  const wait = deadlineMs - nowMs();
  if (wait <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, wait));
}

/**
 * Delete every thread the take created — the take must leave the demo org
 * exactly as seeded. Scenes register ids under the `wowThreadId` note (the
 * Episode 1 contract, one thread) and/or a comma-separated `cleanupThreadIds`
 * note (any number). Runs in its own en-locale context because the e2e chat
 * helpers resolve labels from the en catalog. Best-effort per thread: a
 * failure here must never mask the take's own error.
 */
async function cleanupWowThread(
  browser: Browser,
  ctx: SceneContext,
): Promise<void> {
  const ids = [
    ...new Set(
      [
        ctx.notes.get('wowThreadId'),
        ...(ctx.notes.get('cleanupThreadIds')?.split(',') ?? []),
      ]
        .map((id) => id?.trim())
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  // Knowledge entries a take creates ON CAMERA (Episode 3's `entries`
  // scene), registered by topic — topics are per-locale DATA literals, so
  // the en-locale cleanup context finds them regardless of the take locale.
  const entryTopics = [
    ...new Set(
      (ctx.notes.get('cleanupEntryTopics')?.split(',') ?? [])
        .map((topic) => topic.trim())
        .filter(Boolean),
    ),
  ];
  // Agents a take creates ON CAMERA (Episode 4's create scene), registered
  // by display name — the agents list row carries it in every locale.
  const agentNames = [
    ...new Set(
      (ctx.notes.get('cleanupAgentNames')?.split(',') ?? [])
        .map((name) => name.trim())
        .filter(Boolean),
    ),
  ];
  // Tasks a take creates ON CAMERA (Episode 6), archived by title on the
  // board the scene registered under `cleanupTaskBoardUrl`.
  const taskTitles = [
    ...new Set(
      (ctx.notes.get('cleanupTaskTitles')?.split(',') ?? [])
        .map((title) => title.trim())
        .filter(Boolean),
    ),
  ];
  const taskBoardUrl = ctx.notes.get('cleanupTaskBoardUrl') ?? '';
  if (
    ids.length === 0 &&
    entryTopics.length === 0 &&
    agentNames.length === 0 &&
    taskTitles.length === 0
  )
    return;
  const cleanupContext = await browser.newContext({
    baseURL: BASE_URL,
    storageState: path.join(SCREENSHOTS_STATE, 'auth.json'),
    viewport: VIEWPORT,
    locale: 'en-US',
    timezoneId: 'UTC',
    serviceWorkers: 'block',
  });
  try {
    await cleanupContext.addInitScript(() => {
      window.localStorage.setItem('user-locale', 'en');
    });
    const cleanupPage = await cleanupContext.newPage();
    await cleanupPage.goto(`/dashboard/${ctx.orgId}/chat`, {
      waitUntil: 'domcontentloaded',
    });
    const { deleteThreadById, ensureHistorySidebarOpen } =
      await import('../../e2e/helpers/chat');
    // Thread rows render only inside the history drawer — open it before
    // any existence check, or every row reads as "gone".
    await ensureHistorySidebarOpen(cleanupPage);
    for (const id of ids) {
      // The app deletes some registered threads itself (an Arena branch on
      // exit) — skip rows that are already gone instead of timing out.
      // `isVisible()` never waits — use a bounded waitFor so a still-loading
      // list cannot read as "already gone".
      const row = cleanupPage.locator(`[data-thread-id="${id}"]`).first();
      const present = await row
        .waitFor({ state: 'visible', timeout: 5_000 })
        .then(() => true)
        .catch(() => false);
      if (!present) {
        console.log(`  · thread ${id} already gone`);
        continue;
      }
      try {
        await deleteThreadById(cleanupPage, id);
        console.log(`  ✓ cleaned up thread ${id}`);
      } catch (error) {
        console.warn(
          `  ! could not delete thread ${id} — remove it by hand:`,
          error,
        );
      }
    }
    for (const topic of entryTopics) {
      try {
        await cleanupPage.goto(`/dashboard/${ctx.orgId}/knowledge-entries`, {
          waitUntil: 'domcontentloaded',
        });
        // Wait for the list to resolve before judging the row's absence.
        await cleanupPage
          .getByRole('button', { name: 'Add entry' })
          .waitFor({ state: 'visible', timeout: 15_000 });
        const row = cleanupPage
          .getByRole('row')
          .filter({ hasText: topic })
          .first();
        const present = await row
          .waitFor({ state: 'visible', timeout: 8_000 })
          .then(() => true)
          .catch(() => false);
        if (!present) {
          console.log(`  · entry "${topic}" already gone`);
          continue;
        }
        // Row menu → Delete → confirm (the dialog's button shares the label).
        await row.getByRole('button', { name: 'Open menu' }).click();
        await cleanupPage.getByRole('menuitem', { name: 'Delete' }).click();
        const dialog = cleanupPage.getByRole('dialog', {
          name: 'Delete knowledge entry',
        });
        await dialog.waitFor({ state: 'visible', timeout: 15_000 });
        await dialog.getByRole('button', { name: 'Delete' }).click();
        await dialog.waitFor({ state: 'hidden', timeout: 15_000 });
        console.log(`  ✓ cleaned up knowledge entry "${topic}"`);
      } catch (error) {
        console.warn(
          `  ! could not delete entry "${topic}" — remove it by hand:`,
          error,
        );
      }
    }
    for (const name of agentNames) {
      try {
        await cleanupPage.goto(`/dashboard/${ctx.orgId}/agents`, {
          waitUntil: 'domcontentloaded',
        });
        await cleanupPage
          .getByRole('button', { name: 'Create agent' })
          .waitFor({ state: 'visible', timeout: 15_000 });
        const row = cleanupPage
          .getByRole('row')
          .filter({ hasText: name })
          .first();
        const present = await row
          .waitFor({ state: 'visible', timeout: 8_000 })
          .then(() => true)
          .catch(() => false);
        if (!present) {
          console.log(`  · agent "${name}" already gone`);
          continue;
        }
        await row.getByRole('button', { name: 'Open menu' }).click();
        await cleanupPage
          .getByRole('menuitem', { name: 'Delete', exact: true })
          .click();
        await cleanupPage
          .getByRole('button', { name: 'Delete agent', exact: true })
          .click();
        await row.waitFor({ state: 'hidden', timeout: 15_000 });
        console.log(`  ✓ cleaned up agent "${name}"`);
      } catch (error) {
        console.warn(
          `  ! could not delete agent "${name}" — remove it by hand:`,
          error,
        );
      }
    }
    for (const title of taskTitles) {
      if (!taskBoardUrl) break;
      try {
        await cleanupPage.goto(taskBoardUrl, {
          waitUntil: 'domcontentloaded',
        });
        const card = cleanupPage.getByText(title).first();
        const present = await card
          .waitFor({ state: 'visible', timeout: 15_000 })
          .then(() => true)
          .catch(() => false);
        if (!present) {
          console.log(`  · task "${title}" already gone`);
          continue;
        }
        await card.click();
        const dialog = cleanupPage.getByRole('dialog').last();
        await dialog.waitFor({ state: 'visible', timeout: 15_000 });
        // Archive lives directly in the dialog, or under its ⋯ menu.
        const direct = dialog.getByRole('button', { name: 'Archive' }).first();
        if (await direct.isVisible().catch(() => false)) {
          await direct.click();
        } else {
          await dialog
            .getByRole('button', { name: 'More actions' })
            .first()
            .click();
          await cleanupPage
            .getByRole('menuitem', { name: 'Archive' })
            .first()
            .click();
        }
        const confirm = cleanupPage.getByRole('dialog', {
          name: 'Archive task?',
        });
        await confirm.waitFor({ state: 'visible', timeout: 10_000 });
        await confirm.getByRole('button', { name: 'Archive' }).click();
        await confirm.waitFor({ state: 'hidden', timeout: 10_000 });
        console.log(`  ✓ archived task "${title}"`);
      } catch (error) {
        console.warn(
          `  ! could not archive task "${title}" — archive it by hand:`,
          error,
        );
      }
    }
  } catch (error) {
    console.warn(
      '  ! thread cleanup context failed — check the org by hand:',
      error,
    );
  } finally {
    await cleanupContext.close();
  }
}

export async function runRecordStage(
  episode: EpisodeSpec,
  locale: Locale,
  stateDir: string,
): Promise<void> {
  const audioPlan = readAudioPlan(stateDir, episode.id, locale);
  const timeline = planTimeline(
    episode.scenes.map((scene) => {
      const audio = audioPlan.scenes.find((s) => s.id === scene.id);
      if (!audio) {
        throw new Error(
          `Audio plan is missing scene "${scene.id}" — re-run --stage tts.`,
        );
      }
      return {
        id: scene.id,
        audioDurationMs: audio.durationMs,
        leadInMs: scene.leadInMs,
        tailMs: scene.tailMs,
        minMs: scene.minMs,
      };
    }),
  );
  const choreographyModule = await loadChoreography(episode.id);
  const choreography = choreographyModule.SCENES;
  for (const scene of episode.scenes) choreographyFor(choreography, scene.id);
  const orgState = readOrgState(episode, locale);
  const t = localeT(locale);

  const dir = framesDir(stateDir, episode.id, locale);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  console.log(
    `Recording ${episode.id}/${locale}: ${timeline.scenes.length} scenes, ` +
      `${(timeline.totalMs / 1000).toFixed(1)}s planned.`,
  );

  const browser = await chromium.launch({
    args: ['--force-color-profile=srgb', '--hide-scrollbars'],
  });
  try {
    const context = await browser.newContext({
      baseURL: BASE_URL,
      ...(existsSync(path.join(SCREENSHOTS_STATE, 'auth.json'))
        ? { storageState: path.join(SCREENSHOTS_STATE, 'auth.json') }
        : {}),
      viewport: VIEWPORT,
      deviceScaleFactor: DPR,
      colorScheme: 'light',
      locale: contextLocale(locale),
      timezoneId: 'UTC',
      serviceWorkers: 'block',
    });
    await context.addInitScript(
      ([userLocale]) => {
        window.localStorage.setItem('tale-theme', 'light');
        window.localStorage.setItem('user-locale', userLocale);
      },
      [locale] as const,
    );
    await context.addInitScript({ path: path.join(HERE, 'overlay.js') });

    const page = await context.newPage();
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const cursor = new Cursor(page);
    const ctx: SceneContext = {
      orgId: orgState.orgId,
      locale,
      heroPrompt: episode.heroPromptByLocale[locale],
      projects: new Map(Object.entries(orgState.projects)),
      notes: new Map(),
    };

    // The take is ONE SPA session — no full page load ever happens on
    // camera (a reload re-boots the app and shows skeletons no warm-up can
    // hide). Boot the app, warm every surface, land on the opening route
    // (the warmup's contract), then cover the settled app with the in-app
    // title card and only THEN start the screencast.
    if (episode.diagnostic) {
      await page.goto('about:blank');
    } else {
      await page.goto(`/dashboard/${ctx.orgId}/chat`, { waitUntil: 'load' });
      if (choreographyModule.warmup) {
        console.log('  warming routes…');
        await choreographyModule.warmup(page, ctx);
      }
    }
    await installVideoCards(page, {
      title: episode.titleByLocale[locale],
      episodeLabel: episode.episodeLabelByLocale[locale],
    });
    // Let fonts/paint settle under the card before frame one.
    await page.waitForTimeout(600);

    const cdp = await context.newCDPSession(page);
    const sink = attachScreencastSink(cdp, dir);
    await cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: JPEG_QUALITY,
      maxWidth: CAPTURE.width,
      maxHeight: CAPTURE.height,
      everyNthFrame: 1,
    });
    await sink.firstFrameAt();
    const nodeT0 = performance.now();
    const now = () => performance.now() - nodeT0;

    const actualStartsMs: Record<string, number> = {};
    try {
      for (const planned of timeline.scenes) {
        await sleepUntil(planned.startMs, now);
        actualStartsMs[planned.id] = Math.round(now());
        const scene = choreographyFor(choreography, planned.id);
        const cue = (seconds: number) =>
          sleepUntil(planned.narrationStartMs + seconds * 1000, now);
        const narrationSeconds =
          (audioPlan.scenes.find((s) => s.id === planned.id)?.durationMs ?? 0) /
          1000;
        const sceneSpec = episode.scenes.find((s) => s.id === planned.id);
        const chapter = sceneSpec?.chapterByLocale?.[locale];
        if (chapter) {
          // 'cut' chapters swap URL under a blur veil (cursor hidden, and
          // the choreography held until the frame is fully veiled);
          // 'navigate' chapters show the on-camera navigation with only the
          // card playing. Both animate on their own timers.
          const cut = sceneSpec?.chapterTransition === 'cut';
          await page.evaluate(
            ([label, veil]) => window.__taleVideoCard?.showChapter(label, veil),
            [chapter, cut] as const,
          );
          if (cut) await page.waitForTimeout(450);
        }
        await scene.run({ page, cursor, t, cue, narrationSeconds, ctx });
        const elapsed = now();
        const budgetEnd = planned.startMs + planned.budgetMs;
        if (elapsed > budgetEnd) {
          throw new Error(
            `Scene "${planned.id}" overran its budget by ${Math.round(elapsed - budgetEnd)}ms ` +
              `(ended at ${Math.round(elapsed)}ms, budget end ${budgetEnd}ms). ` +
              `Raise its leadInMs/minMs in episode.ts or trim the choreography — never let it stretch silently.`,
          );
        }
        console.log(
          `  ▸ ${planned.id} @ ${Math.round(actualStartsMs[planned.id] ?? 0)}ms ` +
            `(plan ${planned.startMs}ms, drift ${Math.round((actualStartsMs[planned.id] ?? 0) - planned.startMs)}ms)`,
        );
        await sleepUntil(budgetEnd, now);
      }
    } finally {
      // Cleanup runs EVEN WHEN A TAKE ABORTS — a leftover wow thread changes
      // the org (and once ambushed the next take's picker locator).
      await cdp.send('Page.stopScreencast').catch((error) => {
        console.warn('stopScreencast failed:', error);
      });
      await context.close();
      await cleanupWowThread(browser, ctx);
    }

    const recorded: RecordedTimeline = {
      planned: timeline,
      actualStartsMs,
    };
    writeFileSync(
      timelinePath(stateDir, episode.id, locale),
      `${JSON.stringify(recorded, null, 2)}\n`,
    );
    writeFileSync(
      path.join(dir, 'frames.json'),
      `${JSON.stringify({ frames: sink.frames }, null, 2)}\n`,
    );
    console.log(
      `Recorded ${sink.frames.length} frames over ${(timeline.totalMs / 1000).toFixed(1)}s → ${dir}`,
    );
  } finally {
    await browser.close();
  }
}
