import { AlertTriangle } from 'lucide-react';

import { useT } from '@/lib/i18n/client';
import { parseModelFallbackBody } from '@/lib/shared/constants/system-message-tags';

interface ModelFallbackNoticeProps {
  /** The `[MODEL_FALLBACK]` body (structured `from=.. to=.. reason=..`). */
  body: string;
}

/** Friendly, qualifier-free model label: `openrouter:anthropic/claude-opus-4.8` → `claude-opus-4.8`. */
function friendlyModelLabel(ref: string | undefined): string | undefined {
  if (!ref || ref === 'default') return undefined;
  const afterProvider = ref.includes(':')
    ? ref.slice(ref.indexOf(':') + 1)
    : ref;
  return afterProvider.includes('/')
    ? afterProvider.slice(afterProvider.lastIndexOf('/') + 1)
    : afterProvider;
}

/**
 * Renders a `[MODEL_FALLBACK]` system message as a localized one-line warning
 * ("X was unavailable — switched to Y"). Legacy English-sentence bodies (no
 * structured fields) render verbatim.
 */
export function ModelFallbackNotice({ body }: ModelFallbackNoticeProps) {
  const { t } = useT('chat');
  const parsed = parseModelFallbackBody(body);

  const line =
    !parsed.from && !parsed.to
      ? body
      : t('modelFallbackNotice', {
          from: friendlyModelLabel(parsed.from) ?? t('modelFallbackUnknown'),
          to: friendlyModelLabel(parsed.to) ?? t('modelFallbackDefaultModel'),
        });

  return (
    <div className="text-warning flex items-center gap-1.5 px-4 py-1 text-xs">
      <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
      <span>{line}</span>
    </div>
  );
}
