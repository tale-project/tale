'use client';

import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { X } from 'lucide-react';

import { HStack } from '@/app/components/ui/layout/layout';
import { useT } from '@/lib/i18n/client';

interface FilterChipsProps {
  agentSlug?: string;
  model?: string;
  provider?: string;
  onClearAgent: () => void;
  onClearModel: () => void;
  onClearAll: () => void;
}

export function FilterChips({
  agentSlug,
  model,
  provider,
  onClearAgent,
  onClearModel,
  onClearAll,
}: FilterChipsProps) {
  const { t } = useT('analytics');

  if (!agentSlug && !model && !provider) {
    return null;
  }

  return (
    <HStack gap={2} className="flex-wrap items-center">
      {agentSlug ? (
        <Badge
          variant="outline"
          className="cursor-pointer"
          onClick={onClearAgent}
        >
          {t('feedback.filterChips.agent', { value: agentSlug })}
          <X className="ml-1 size-3" />
        </Badge>
      ) : null}
      {model ? (
        <Badge
          variant="outline"
          className="cursor-pointer"
          onClick={onClearModel}
        >
          {t('feedback.filterChips.model', { value: model })}
          <X className="ml-1 size-3" />
        </Badge>
      ) : null}
      {provider && !model ? (
        <Badge
          variant="outline"
          className="cursor-pointer"
          onClick={onClearModel}
        >
          {t('feedback.filterChips.provider', { value: provider })}
          <X className="ml-1 size-3" />
        </Badge>
      ) : null}
      <Button variant="ghost" size="sm" onClick={onClearAll}>
        {t('feedback.filterChips.clear')}
      </Button>
    </HStack>
  );
}
