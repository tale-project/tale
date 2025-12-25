'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import ReactMarkdown from 'react-markdown';
import { useT } from '@/lib/i18n';

interface MessageImprovementModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAccept: () => void;
  originalMessage: string;
  improvedMessage: string;
}

export function MessageImprovementModal({
  isOpen,
  onClose,
  onAccept,
  originalMessage,
  improvedMessage,
}: MessageImprovementModalProps) {
  const { t } = useT('conversations');
  const { t: tCommon } = useT('common');
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>{t('improvement.title')}</DialogTitle>
          <DialogDescription>
            {t('improvement.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col grow gap-4">
          <div>
            <h3 className="text-sm font-medium mb-2">{t('improvement.original')}</h3>
            <div className="rounded-md border border-border p-4 overflow-y-auto">
              <div className="prose prose-sm max-h-[12rem] text-xs">
                <ReactMarkdown>{originalMessage}</ReactMarkdown>
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-medium mb-2">{t('improvement.improved')}</h3>
            <div className="rounded-md border border-border p-4 bg-secondary/20 overflow-y-auto">
              <div className="prose prose-sm max-h-[12rem] text-xs">
                <ReactMarkdown>{improvedMessage}</ReactMarkdown>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('improvement.reject')}
          </Button>
          <Button onClick={onAccept}>{t('improvement.accept')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
