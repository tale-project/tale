import { AppShell } from '@tale/ui/app-shell';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { i18n } from '@/lib/i18n/i18n';

import { queryClient } from './lib/query-client';
import { readsSettled } from './lib/route-read';
import { installStaleBundleReload } from './lib/stale-bundle-reload';
import { router } from './router';

import './globals.css';
import './locals.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Missing #root element');
// The check above does not reach into the function below.
const root: HTMLElement = rootElement;

// A tab that outlived an update of the manager reloads onto the new build when
// a navigation misses a chunk the update replaced.
installStaleBundleReload({ navigating: () => router.state.isLoading });

// The first frame is the page as it opens, not a change: nothing in it fades
// or glides into place (the highlight of the rail, of a panel's row). The root
// route lets transitions run again once that frame is painted
// (`useOpeningDone`, `locals.css`).
document.documentElement.dataset.opening = '';

// `<AppShell>` enforces the standard `<ThemeProvider> → <LocaleProvider>
// → <I18nextProvider> → <LocaleSync>` stack every Tale frontend uses. The
// language is a preference of this browser, so the locale is detected on the
// client rather than taken from the URL.
const locale = { mode: 'client' } as const;
function renderApp() {
  createRoot(root).render(
    <StrictMode>
      <AppShell i18n={i18n} locale={locale} theme>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </AppShell>
    </StrictMode>,
  );
}

// React's first commit replaces what `#root` holds, the boot shell the build
// put there (`scripts/prerender-boot-shell.ts`). Mounted while the router is
// still resolving the address (its route chunks, the reads its loaders wait
// for), the first commit would be a router without a page: an empty frame
// between the shell and the page. So the address is resolved first, while the
// shell stays on screen, and the first commit paints the page, as the
// platform's does (`services/platform/app/main.tsx`). A redirect is followed
// inside `load()`; a failure mounts the app anyway, where the router's own
// error page tells it. The lists the page asked for and does not wait for are
// waited for too (at most a second, `readsSettled`), so the first frame has
// their rows. The mount's own load then runs over the page that is already
// there, without taking it away.
router
  .load()
  .then(() => readsSettled(queryClient))
  .catch((error: unknown) => {
    console.warn('Failed to load the first page; mounting anyway', error);
  })
  .finally(renderApp);
