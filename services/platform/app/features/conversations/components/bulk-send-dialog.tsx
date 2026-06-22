import { Button } from '@tale/ui/button';
import { Heading } from '@tale/ui/heading';
import { Row } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { Loader2Icon } from 'lucide-react';

import { useT } from '@/lib/i18n/client';

interface BulkSendDialogProps {
  selectedCount: number;
  isSending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function BulkSendDialog({
  selectedCount,
  isSending,
  onConfirm,
  onCancel,
}: BulkSendDialogProps) {
  const { t: tConversations } = useT('conversations');
  const { t: tCommon } = useT('common');

  return (
    <Row
      gap={0}
      justify="center"
      className="bg-background/80 fixed inset-0 z-50 backdrop-blur-sm"
    >
      <div className="bg-background mx-4 w-full max-w-md rounded-lg border p-6">
        <Heading level={3} size="lg" className="mb-4">
          {tConversations('bulkSend.title', { count: selectedCount })}
        </Heading>
        <Text variant="muted" className="mb-6">
          {tConversations('bulkSend.description', { count: selectedCount })}
        </Text>
        <Row gap={3} align="stretch" justify="end">
          <Button variant="secondary" onClick={onCancel} disabled={isSending}>
            {tCommon('actions.cancel')}
          </Button>
          <Button onClick={onConfirm} disabled={isSending}>
            {isSending && <Loader2Icon className="mr-2 size-4 animate-spin" />}
            {tConversations('bulkSend.send')}
          </Button>
        </Row>
      </div>
    </Row>
  );
}
