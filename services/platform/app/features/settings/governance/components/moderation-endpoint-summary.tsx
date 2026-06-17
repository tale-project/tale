'use client';

import { Button } from '@tale/ui/button';
import { Pencil } from 'lucide-react';

import { useT } from '@/lib/i18n/client';

interface EndpointSummaryProps {
  url: string;
  headersCount: number;
  timeoutMs: string;
  onEdit: () => void;
  disabled: boolean;
}

export function EndpointSummary({
  url,
  headersCount,
  timeoutMs,
  onEdit,
  disabled,
}: EndpointSummaryProps) {
  const { t } = useT('governance');
  const { t: tCommon } = useT('common');
  return (
    <div className="border-border flex items-start justify-between gap-4 rounded-lg border p-4">
      <dl className="min-w-0 flex-1 space-y-1 text-sm">
        <div className="flex gap-2">
          <dt className="text-muted-foreground w-36 shrink-0">
            {t('moderationProvider.endpointUrlLabel')}
          </dt>
          <dd className="font-mono text-xs break-all">
            {url || (
              <span className="text-muted-foreground">
                {t('moderationProvider.endpointUrlNotSet')}
              </span>
            )}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted-foreground w-36 shrink-0">
            {t('moderationProvider.endpointHeadersLabel')}
          </dt>
          <dd>{headersCount}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted-foreground w-36 shrink-0">
            {t('moderationProvider.endpointTimeoutLabel')}
          </dt>
          <dd>
            {t('moderationProvider.endpointTimeoutValue', { ms: timeoutMs })}
          </dd>
        </div>
      </dl>
      <Button
        variant="secondary"
        size="sm"
        icon={Pencil}
        disabled={disabled}
        onClick={onEdit}
      >
        {tCommon('actions.edit')}
      </Button>
    </div>
  );
}
