'use client';

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n';

interface CopyableCodeProps {
  value: string;
}

export function CopyableCode({ value }: CopyableCodeProps) {
  const { t } = useT('settings');
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
      toast({
        title: t('integrations.failedToCopy'),
        variant: 'destructive',
      });
    }
  };

  return (
    <Button
      onClick={handleCopy}
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
