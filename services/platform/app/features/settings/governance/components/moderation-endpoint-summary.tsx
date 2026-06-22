'use client';

import { Button } from '@tale/ui/button';
import { Row } from '@tale/ui/layout';
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
    <Row
      align="start"
      justify="between"
      className="border-border rounded-lg border p-4"
    >
      <dl className="min-w-0 flex-1 space-y-1 text-sm">
        <Row gap={2} align="stretch">
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
        </Row>
        <Row gap={2} align="stretch">
          <dt className="text-muted-foreground w-36 shrink-0">
            {t('moderationProvider.endpointHeadersLabel')}
          </dt>
          <dd>{headersCount}</dd>
        </Row>
        <Row gap={2} align="stretch">
          <dt className="text-muted-foreground w-36 shrink-0">
            {t('moderationProvider.endpointTimeoutLabel')}
          </dt>
          <dd>
            {t('moderationProvider.endpointTimeoutValue', { ms: timeoutMs })}
          </dd>
        </Row>
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
    </Row>
  );
}
