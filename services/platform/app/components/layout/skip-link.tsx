import { useT } from '@/lib/i18n/client';

export function SkipLink() {
  const { t } = useT('common');

  return (
    <a
      href="#main-content"
      // Native fragment focus (`<a href="#id">` moving focus to the target) is
      // unreliable — headless Chromium and several screen readers don't move
      // focus on a bare hash navigation, leaving keyboard/AT users on <body>.
      // Focus the target explicitly on activation; `preventDefault` keeps the
      // URL free of a stray hash. The `href` is retained as the no-JS fallback.
      onClick={(e) => {
        e.preventDefault();
        document.getElementById('main-content')?.focus();
      }}
      className="focus:bg-background focus:text-foreground focus:ring-ring sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-[100] focus:rounded-lg focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:ring-2 focus:outline-none"
      onClick={(e) => {
        // Native fragment focus — the browser focusing the `tabIndex={-1}`
        // target after a `#main-content` navigation — is unreliable: some
        // browsers only scroll, and headless Chromium doesn't move focus at
        // all, stranding keyboard and screen-reader users on the link. Focus
        // the target explicitly so activation always lands in `<main>`.
        const target = document.getElementById('main-content');
        if (target) {
          e.preventDefault();
          target.focus();
        }
      }}
    >
      {t('aria.skipToContent')}
    </a>
  );
}
