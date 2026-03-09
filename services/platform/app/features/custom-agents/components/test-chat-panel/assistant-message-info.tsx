'use client';

import { CheckIcon, CopyIcon, Info } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { IconButton } from '@/app/components/ui/primitives/icon-button';
import { MessageInfoDialog } from '@/app/features/chat/components/message-info-dialog';
import { useMessageMetadata } from '@/app/features/chat/hooks/queries';
import { useT } from '@/lib/i18n/client';

interface AssistantMessageInfoProps {
  messageId: string;
  timestamp: Date;
  content: string;
}

export function AssistantMessageInfo({
  messageId,
  timestamp,
  content,
}: AssistantMessageInfoProps) {
  const { t } = useT('common');
  const [isOpen, setIsOpen] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const copyTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const { metadata } = useMessageMetadata(messageId);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    };
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setIsCopied(true);
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = setTimeout(() => setIsCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <div className="flex items-center">
      <IconButton
        icon={isCopied ? CheckIcon : CopyIcon}
        aria-label={isCopied ? t('actions.copied') : t('actions.copy')}
        onClick={handleCopy}
        iconSize={3}
        className="text-muted-foreground hover:text-foreground p-1"
      />
      <IconButton
        icon={Info}
        aria-label={t('actions.showInfo')}
        onClick={() => setIsOpen(true)}
        iconSize={3}
        className="text-muted-foreground hover:text-foreground p-1"
      />
      <MessageInfoDialog
        isOpen={isOpen}
        onOpenChange={setIsOpen}
        messageId={messageId}
        timestamp={timestamp}
        metadata={metadata}
      />
    </div>
  );
}
