import { uiMessages } from '@tale/ui/i18n/messages';
import { createInstance, type ResourceLanguage } from 'i18next';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider, initReactI18next } from 'react-i18next';

// Relative on purpose: the build runs this module under plain `bun`
// (`scripts/prerender-boot-shell.ts`), where the `@/` alias is not guaranteed.
import { AppFramePlaceholder } from './app-frame-placeholder';

/*
 * NOT PART OF THE PAGE: it imports `react-dom/server`. The build bakes the boot
 * shell into `dist/index.html` with it (`scripts/prerender-boot-shell.ts`), and
 * the dev server into the page it serves (`vite.config.ts`), so the first paint
 * of every address is the frame of the app before any script has run.
 */

/** The empty mount point, as `index.html` has it. */
const ROOT_MARKER = '<div id="root"></div>';

// An instance of its own, so the render never touches the app's. The shell's
// one word is the label `Skeletonize` gives assistive technology, and it is
// emptied here: the shell is `aria-hidden` (see below), so nobody hears it, and
// it would be its only text. The dev server brings the styles with the scripts,
// so there the shell is drawn before any style: empty boxes are invisible, a
// word would show as raw text until the styles came. As the platform's boot
// shell (`services/platform/app/components/layout/boot-shell-render.tsx`).
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the messages of the library are plain nested JSON; i18next types the same shape loosely
const uiBundle = uiMessages.bundles.en as ResourceLanguage;
const i18n = createInstance();
// Messages given inline are in the store at once (no backend to wait for), so
// the render below stays synchronous.
void i18n.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  resources: { en: { ...uiBundle, skeleton: { loading: '' } } },
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

/**
 * The markup of the boot shell. The `data-boot-shell` wrapper is
 * `display: contents` (no box of its own) and lets a test or the devtools tell
 * the shell from the frame React draws. `aria-hidden`: the shell is a picture
 * of the frame for the moment before the scripts run, with nothing to read or
 * operate; the page React draws in its place has the landmarks.
 */
export function renderBootShell(): string {
  const markup = renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <AppFramePlaceholder />
    </I18nextProvider>,
  );
  return `<div data-boot-shell="" aria-hidden="true" style="display:contents">${markup}</div>`;
}

/**
 * `html` with the boot shell in its empty `#root`. A page without an empty
 * `#root` (one that has its shell already, or a template that changed) is
 * returned as it is: a blank first paint, never a broken page.
 */
export function withBootShell(html: string): string {
  if (!html.includes(ROOT_MARKER)) return html;
  // A function, so a `$&` in the markup stays text.
  return html.replace(
    ROOT_MARKER,
    () => `<div id="root">${renderBootShell()}</div>`,
  );
}
