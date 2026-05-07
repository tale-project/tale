import { Button } from '@tale/ui/button';
import { ThumbsDown, ThumbsUp } from 'lucide-react';
import { useState } from 'react';

import { useT } from '@/lib/i18n/client';

interface DocsFeedbackProps {
  /** Stable identifier for the page — usually `<locale>:<slug>`. */
  pageId: string;
}

/**
 * Lightweight thumbs-up / thumbs-down feedback widget. Posts to
 * `/api/docs-feedback` if available; otherwise just records in localStorage
 * and shows a thank-you state. The endpoint is intentionally optional so
 * the docs site stays static-deploy friendly.
 */
export function DocsFeedback({ pageId }: DocsFeedbackProps) {
  const { t } = useT('docs');
  const [submitted, setSubmitted] = useState<'up' | 'down' | null>(null);

  const submit = async (vote: 'up' | 'down') => {
    setSubmitted(vote);
    try {
      window.localStorage.setItem(`docs:feedback:${pageId}`, vote);
    } catch (error) {
      console.warn('[docs-feedback] localStorage unavailable', error);
    }
    try {
      await fetch('/api/docs-feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pageId, vote }),
      });
    } catch (error) {
      console.warn('[docs-feedback] endpoint missing or failed', error);
    }
  };

  if (submitted) {
    return <p className="text-fg-muted mt-12 text-sm">{t('feedbackThanks')}</p>;
  }

  return (
    <div className="border-border-base mt-12 flex items-center gap-3 border-t pt-6 text-sm">
      <span className="text-fg-muted">{t('wasThisHelpful')}</span>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={() => submit('up')}
        aria-label={t('feedbackYes')}
        className="gap-1.5"
      >
        <ThumbsUp className="size-3.5" aria-hidden />
        <span>{t('feedbackYes')}</span>
      </Button>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={() => submit('down')}
        aria-label={t('feedbackNo')}
        className="gap-1.5"
      >
        <ThumbsDown className="size-3.5" aria-hidden />
        <span>{t('feedbackNo')}</span>
      </Button>
    </div>
  );
}
