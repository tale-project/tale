/**
 * Recovery for a tab that outlived a deploy.
 *
 * Every lazily loaded chunk in the build goes through Vite's preload helper,
 * which reports a failed load as a cancelable `vite:preloadError` on
 * `window`, with the import's error in `event.payload`. A tab opened before a
 * deploy still names the previous build's content-hashed chunks, and the
 * deploy removed them: the server answers the SPA shell instead
 * (`server.ts`), and the browser refuses that as a module. Nothing else
 * rescues such a tab — the service worker precaches no JS
 * (`packages/ui/src/pwa/vite-plugin.ts`), and the previews, tabs and editors
 * load through `lazyComponent` / plain `import()`, not through the router's
 * `lazyRouteComponent` with its own reload.
 *
 * So the first failure of a chunk reloads the page onto the new build — once
 * the deployment answers: a chunk that failed because the server is down or
 * the network dropped is an outage, not a stale build, and a reload then
 * would land on the browser's error page. The attempt is remembered for the
 * tab's session, keyed by the page's `TALE_VERSION` and the chunk's URL:
 * when the same chunk fails again at the same version — the reload landed on
 * the old build again mid-rollout, or the chunk really is gone — a
 * destructive toast asks for the reload instead of looping.
 *
 * Installed once from app/main.tsx, before the first render; the error
 * reporter consults `isStaleBundleFallout` (app/router.tsx).
 */

import * as ToastPrimitives from '@radix-ui/react-toast';
import { Button } from '@tale/ui/button';
import { toast } from '@tale/ui/use-toast';

import { probeBackend } from '@/app/lib/backend/connection-state';
import { getEnv } from '@/lib/env';
import { i18n } from '@/lib/i18n/i18n';

const STORAGE_PREFIX = 'tale:stale-bundle-reload:';

/**
 * How long a page that asked for a reload counts as leaving. A reload can be
 * refused — an unsaved editor's leave prompt answered with Stay — and the
 * page lives on: past this window it shows the toast, and from then on only
 * the toast, so the user is not asked to leave again on every failure.
 */
const RELOAD_PENDING_MS = 5_000;

/**
 * How long after this page swallows a chunk failure its errors count as the
 * recovery's own. The prevented import resolved `undefined`, so its caller
 * fails on that (`reading 'default'` of undefined) while the page reloads,
 * or while an outage is left to OnlineGate — long enough for a slow reload
 * to arrive.
 */
const RECOVERY_FALLOUT_MS = 15_000;
let falloutUntil = 0;

/**
 * Whether an error reported now is fallout of a chunk failure this page
 * swallowed. The error reporter drops those (app/router.tsx), so a tab that
 * recovers reports nothing; a chunk that fails again after its reload is
 * never swallowed, and still reports its real error.
 */
export function isStaleBundleFallout(): boolean {
  return Date.now() < falloutUntil;
}

/**
 * How each engine words a dynamic import whose module (or one of its static
 * imports) could not be fetched — a missing chunk answered with the SPA
 * shell fails the module MIME check the same way — and Vite's own wording
 * for a stylesheet the chunk needs. A module that loaded and then threw
 * rejects with its own error instead: a bug, not a stale build, so it is
 * left to its caller.
 */
const CHUNK_LOAD_FAILURES = [
  'Failed to fetch dynamically imported module', // Chromium
  'error loading dynamically imported module', // Firefox
  'Importing a module script failed', // WebKit — names no URL
  'Unable to preload CSS for', // Vite's CSS preload
];

function isChunkLoadFailure(error: unknown): error is Error {
  return (
    error instanceof Error &&
    CHUNK_LOAD_FAILURES.some((message) => error.message.includes(message))
  );
}

/** The chunk the message names; one shared slot for engines that name none. */
function failedChunkUrl(error: Error): string {
  return /https?:\/\/\S+/.exec(error.message)?.[0] ?? 'unknown';
}

/**
 * Claims this chunk's one reload at this version. `false` once it was
 * claimed — and when sessionStorage is unusable, since without the record
 * nothing would stop the reloaded page from reloading again.
 */
function claimReload(key: string): boolean {
  try {
    if (window.sessionStorage.getItem(key) !== null) return false;
    window.sessionStorage.setItem(key, '1');
    return true;
  } catch (error) {
    console.warn(
      '[stale-bundle-recovery] sessionStorage is unavailable; asking for the reload instead',
      error,
    );
    return false;
  }
}

/** Hands the reload back when the deployment did not answer. */
function releaseReload(key: string): void {
  try {
    window.sessionStorage.removeItem(key);
  } catch (error) {
    console.warn(
      '[stale-bundle-recovery] could not hand the reload back',
      error,
    );
  }
}

function showNewVersionToast(reload: () => void): void {
  const reloadLabel = i18n.t('newVersion.reload', { ns: 'connectivity' });
  toast({
    variant: 'destructive',
    // An error toast stays until it is dismissed (design/docs/app.md); the
    // toaster has no close control, so it carries its own Later.
    duration: Infinity,
    title: i18n.t('newVersion.title', { ns: 'connectivity' }),
    description: i18n.t('newVersion.description', { ns: 'connectivity' }),
    action: (
      // `w-full` forces this group onto its own wrapped line below the
      // title/description (see toaster.tsx's `flex-wrap`) instead of
      // squeezing beside a two-line description on a phone-width toast.
      // The top border reads as a footer (matches filter-panel.tsx /
      // searchable-select.tsx) instead of floating whitespace.
      <div className="border-border flex w-full items-center justify-end gap-2 border-t pt-2">
        <ToastPrimitives.Close asChild>
          <Button type="button" variant="ghost" size="sm">
            {i18n.t('newVersion.later', { ns: 'connectivity' })}
          </Button>
        </ToastPrimitives.Close>
        <ToastPrimitives.Action altText={reloadLabel} asChild onClick={reload}>
          <Button type="button" variant="primary" size="sm">
            {reloadLabel}
          </Button>
        </ToastPrimitives.Action>
      </div>
    ),
  });
}

interface StaleBundleRecoveryOptions {
  /** Reloads the page — injectable because jsdom cannot. */
  reload?: () => void;
}

/**
 * Listens for failed chunk loads for the page's lifetime. Returns the
 * uninstall, for tests; the app installs it once.
 */
export function installStaleBundleRecovery({
  reload = () => {
    window.location.reload();
  },
}: StaleBundleRecoveryOptions = {}): () => void {
  let phase: 'idle' | 'reloading' | 'stayed' = 'idle';
  let pendingTimer: ReturnType<typeof setTimeout> | undefined;
  let installed = true;

  /** Keeps Vite from rethrowing; what the caller does next is fallout. */
  const swallow = (event: VitePreloadErrorEvent) => {
    event.preventDefault();
    falloutUntil = Date.now() + RECOVERY_FALLOUT_MS;
  };

  const onPreloadError = (event: VitePreloadErrorEvent) => {
    const error: unknown = event.payload;
    if (!isChunkLoadFailure(error)) return;
    // Offline, every fetch fails: that says nothing about a new build, and a
    // reload would only land on the offline shell. OnlineGate owns this.
    if (!navigator.onLine) return;
    // The page is already on its way to the new build; its other chunks
    // failing on the way out need no answer.
    if (phase === 'reloading') {
      swallow(event);
      return;
    }
    const version = getEnv('TALE_VERSION') ?? 'unknown';
    const key = `${STORAGE_PREFIX}${version}:${failedChunkUrl(error)}`;
    if (phase === 'stayed' || !claimReload(key)) {
      // Failed again after its reload, or the page stayed: ask, and leave
      // the error to its caller. Prevented, the import would resolve
      // `undefined`, and the caller would fail on that instead of on this.
      void probeBackend().then((answered) => {
        if (installed && answered) showNewVersionToast(reload);
      });
      return;
    }
    swallow(event);
    phase = 'reloading';
    // Only a deployment that answers can serve the reload. No answer is an
    // outage: the probe has told OnlineGate, the reload is handed back, and
    // the next failure is judged afresh. Asked every time rather than read
    // from the page's last verdict, which still says "unreachable" for a
    // few seconds after a restarted deployment is back — the moment a tab
    // that outlived the deploy first misses a chunk.
    void probeBackend().then((answered) => {
      if (!installed) return;
      if (!answered) {
        releaseReload(key);
        phase = 'idle';
        return;
      }
      pendingTimer = setTimeout(() => {
        phase = 'stayed';
        showNewVersionToast(reload);
      }, RELOAD_PENDING_MS);
      reload();
    });
  };

  window.addEventListener('vite:preloadError', onPreloadError);
  return () => {
    installed = false;
    falloutUntil = 0;
    window.removeEventListener('vite:preloadError', onPreloadError);
    clearTimeout(pendingTimer);
  };
}
