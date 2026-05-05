import { ArrowUp, Paperclip } from 'lucide-react';

import { useT } from '@/lib/i18n/client';

export function ProductMockChat() {
  const { t } = useT('productMockChat');

  return (
    <div className="flex h-full w-full flex-col gap-4 p-6">
      <div className="flex items-start gap-3">
        <div className="h-7 w-7 shrink-0 rounded-full bg-[color:var(--color-bg-muted)]" />
        <div className="rounded-2xl rounded-tl-sm bg-[color:var(--color-bg-muted)] px-4 py-3 text-sm text-[color:var(--color-fg-base)]">
          {t('userMessage')}
        </div>
      </div>

      <div className="flex items-start gap-3 self-end">
        <div className="rounded-2xl rounded-tr-sm bg-[color:var(--color-accent-base)] px-4 py-3 text-sm text-[color:var(--color-accent-fg)]">
          {t('assistantMessage')}
        </div>
      </div>

      <div className="mt-auto flex items-center gap-2 rounded-xl border border-[color:var(--color-border-strong)] bg-[color:var(--color-bg-base)] px-3 py-2 shadow-sm">
        <button
          type="button"
          aria-label={t('attachAriaLabel')}
          className="text-[color:var(--color-fg-muted)] hover:text-[color:var(--color-fg-base)]"
        >
          <Paperclip className="h-4 w-4" aria-hidden />
        </button>
        <span className="flex-1 text-sm text-[color:var(--color-fg-subtle)]">
          {t('inputPlaceholder')}
        </span>
        <button
          type="button"
          aria-label={t('sendAriaLabel')}
          className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[color:var(--color-accent-base)] text-[color:var(--color-accent-fg)]"
        >
          <ArrowUp className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
