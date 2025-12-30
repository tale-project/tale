'use client';

import { Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n';
import { useCopyButton } from '@/hooks/use-copy';

interface CopyableCodeProps {
  value: string;
}

export function CopyableCode({ value }: CopyableCodeProps) {
  const { t } = useT('settings');
  const { copied, onClick } = useCopyButton(value);

  return (
    <Button
      onClick={onClick}
      variant="ghost"
      size="icon"
      className="p-1"
      title={t('integrations.clickToCopy')}
    >
      <code className="font-mono">{value}</code>
      {copied ? (
        <Check className="size-4 text-success p-0.5" />
      ) : (
        <Copy className="size-4 p-0.5" />
      )}
    </Button>
  );
}
