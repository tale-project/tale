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
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Message Improvement Preview</DialogTitle>
          <DialogDescription>
            Review the AI-improved version and accept or reject the changes
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col grow gap-4">
          <div>
            <h3 className="text-sm font-medium mb-2">Original</h3>
            <div className="rounded-md border border-border p-4 overflow-y-auto">
              <div className="prose prose-sm max-h-[12rem] text-xs">
                <ReactMarkdown>{originalMessage}</ReactMarkdown>
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-medium mb-2">Improved</h3>
            <div className="rounded-md border border-border p-4 bg-secondary/20 overflow-y-auto">
              <div className="prose prose-sm max-h-[12rem] text-xs">
                <ReactMarkdown>{improvedMessage}</ReactMarkdown>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Reject
          </Button>
          <Button onClick={onAccept}>Accept Changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
