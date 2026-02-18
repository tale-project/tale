'use client';

import ReactMarkdown from 'react-markdown';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { PageSection } from '@/app/components/ui/layout/page-section';
import { useT } from '@/lib/i18n/client';

interface MessageImprovementDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onAccept: () => void;
  originalMessage: string;
  improvedMessage: string;
}

export function MessageImprovementDialog({
  isOpen,
  onClose,
  onAccept,
  originalMessage,
  improvedMessage,
}: MessageImprovementDialogProps) {
  const { t } = useT('conversations');

  return (
    <ConfirmDialog
      open={isOpen}
      onOpenChange={onClose}
      title={t('improvement.title')}
      description={t('improvement.description')}
      cancelText={t('improvement.reject')}
      confirmText={t('improvement.accept')}
      onConfirm={onAccept}
      className="max-h-[80vh] max-w-4xl"
    >
      <div className="flex grow flex-col gap-4">
        <PageSection
          as="h3"
          titleSize="sm"
          titleWeight="medium"
          title={t('improvement.original')}
          gap={3}
        >
          <div className="border-border overflow-y-auto rounded-md border p-4">
            <div className="prose prose-sm max-h-[12rem] text-xs">
              <ReactMarkdown>{originalMessage}</ReactMarkdown>
            </div>
          </div>
        </PageSection>

        <PageSection
          as="h3"
          titleSize="sm"
          titleWeight="medium"
          title={t('improvement.improved')}
          gap={3}
        >
          <div className="border-border bg-secondary/20 overflow-y-auto rounded-md border p-4">
            <div className="prose prose-sm max-h-[12rem] text-xs">
              <ReactMarkdown>{improvedMessage}</ReactMarkdown>
            </div>
          </div>
        </PageSection>
      </div>
    </ConfirmDialog>
  );
}
