'use client';

import { Info } from 'lucide-react';
import { useState } from 'react';

import { IconButton } from '@/app/components/ui/primitives/icon-button';
import { MessageInfoDialog } from '@/app/features/chat/components/message-info-dialog';
import { useMessageMetadata } from '@/app/features/chat/hooks/queries';

interface AssistantMessageInfoProps {
  messageId: string;
  timestamp: Date;
}

export function AssistantMessageInfo({
  messageId,
  timestamp,
}: AssistantMessageInfoProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { metadata } = useMessageMetadata(messageId);

  return (
    <div className="flex items-center">
      <IconButton
        icon={Info}
        aria-label="Message info"
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
