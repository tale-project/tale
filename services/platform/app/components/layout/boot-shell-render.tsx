import { uiMessages } from '@tale/ui/i18n/messages';
import { createInstance, type ResourceLanguage } from 'i18next';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider, initReactI18next } from 'react-i18next';

// Relative import on purpose: this module also runs under plain `bun`
// (the prerender script), where the `@/` tsconfig alias isn't guaranteed.
import { DashboardShellFrame } from './dashboard-shell-frame';

/**
 * NODE-ONLY module (it imports `react-dom/server`) — consumed by the
 * build-time prerender script and the dev-server middleware, never by the
 * client bundle. Renders the dashboard boot shell to static HTML so the HTML
 * server can serve the sidebar-rail skeleton before any JS runs.
 */

// A private instance so rendering never mutates the app's i18n singleton.
// The shell is skeleton-only chrome; its sole translated string is the
// Skeletonize status label — overridden to '' here: the shell wrapper is
// `aria-hidden` (see below), so the label is unreachable anyway, and it is
// the shell's only TEXT. The dev server delivers CSS through the JS module
// graph, so the injected shell paints unstyled at first — every element is
// an empty div (invisible), but a real label in the `sr-only` spans would
// flash as raw "Loading content" text until the stylesheet arrives. The
// shell must render no text at all (unit-tested in boot-shell-render.test).
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the ui bundle is plain nested JSON; i18next's ResourceLanguage is the same shape typed loosely
const uiBundle = uiMessages.bundles.en as ResourceLanguage;
const i18n = createInstance();
// Inline resources land in the store synchronously (no async backend), so
// the render helper below can stay synchronous — same reliance as the app's
// own module-scope init in @tale/ui initI18n.
void i18n.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  resources: { en: { ...uiBundle, skeleton: { loading: '' } } },
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

/**
 * Static markup for the boot shell. The `data-boot-shell` wrapper is
 * `display: contents` (no box, no layout impact) and exists so tests and
 * devtools can tell the served shell apart from the React-rendered frame.
 * `aria-hidden`: the shell is a purely visual pre-paint artifact — its
 * Skeletonize regions (label-less here, see the i18n override above) must
 * not surface as live regions on top of the real placeholder React mounts
 * a moment later (which keeps the proper `role="status"` semantics).
 */
export function renderBootShell(): string {
  const markup = renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <DashboardShellFrame />
    </I18nextProvider>,
  );
  return `<div data-boot-shell="" aria-hidden="true" style="display:contents">${markup}</div>`;
}
