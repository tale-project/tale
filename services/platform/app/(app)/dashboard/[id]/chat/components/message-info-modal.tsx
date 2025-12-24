'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatDate } from '@/lib/utils/date/format';
import { formatNumber } from '@/lib/utils/format';
import { useLocale } from '@/lib/i18n';

interface MessageMetadata {
  model: string;
  provider: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
  reasoning?: string;
}

interface MessageInfoModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  messageId: string;
  timestamp: Date;
  metadata?: MessageMetadata;
}

export default function MessageInfoModal({
  isOpen,
  onOpenChange,
  messageId,
  timestamp,
  metadata,
}: MessageInfoModalProps) {
  const locale = useLocale();

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Message Information</DialogTitle>
          <DialogDescription>Details about this AI response</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Timestamp */}
          <div className="space-y-1">
            <div className="text-sm font-medium text-muted-foreground">
              Timestamp
            </div>
            <div className="text-sm">{formatDate(timestamp, { preset: 'long' })}</div>
          </div>

          {/* Message ID */}
          <div className="space-y-1">
            <div className="text-sm font-medium text-muted-foreground">
              Message ID
            </div>
            <div className="text-xs font-mono bg-muted px-2 py-1 rounded">
              {messageId}
            </div>
          </div>

          {metadata ? (
            <>
              {/* Model */}
              <div className="space-y-1">
                <div className="text-sm font-medium text-muted-foreground">
                  Model
                </div>
                <div className="text-sm">
                  {metadata.model} ({metadata.provider})
                </div>
              </div>

              {/* Token Usage */}
              {metadata.totalTokens !== undefined && (
                <div className="space-y-2">
                  <div className="text-sm font-medium text-muted-foreground">
                    Token Usage
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    {metadata.inputTokens !== undefined && (
                      <div className="space-y-0.5">
                        <div className="text-xs text-muted-foreground">
                          Input
                        </div>
                        <div className="font-medium">
                          {formatNumber(metadata.inputTokens, locale)}
                        </div>
                      </div>
                    )}
                    {metadata.outputTokens !== undefined && (
                      <div className="space-y-0.5">
                        <div className="text-xs text-muted-foreground">
                          Output
                        </div>
                        <div className="font-medium">
                          {formatNumber(metadata.outputTokens, locale)}
                        </div>
                      </div>
                    )}
                    {metadata.totalTokens !== undefined && (
                      <div className="space-y-0.5">
                        <div className="text-xs text-muted-foreground">
                          Total
                        </div>
                        <div className="font-medium">
                          {formatNumber(metadata.totalTokens, locale)}
                        </div>
                      </div>
                    )}
                    {metadata.reasoningTokens !== undefined &&
                      metadata.reasoningTokens > 0 && (
                        <div className="space-y-0.5">
                          <div className="text-xs text-muted-foreground">
                            Reasoning
                          </div>
                          <div className="font-medium">
                            {formatNumber(metadata.reasoningTokens, locale)}
                          </div>
                        </div>
                      )}
                    {metadata.cachedInputTokens !== undefined &&
                      metadata.cachedInputTokens > 0 && (
                        <div className="space-y-0.5">
                          <div className="text-xs text-muted-foreground">
                            Cached
                          </div>
                          <div className="font-medium">
                            {formatNumber(metadata.cachedInputTokens, locale)}
                          </div>
                        </div>
                      )}
                  </div>
                </div>
              )}

              {/* Reasoning */}
              {metadata.reasoning && (
                <div className="space-y-1">
                  <div className="text-sm font-medium text-muted-foreground">
                    Reasoning
                  </div>
                  <div className="text-sm bg-muted px-3 py-2 rounded max-h-40 overflow-y-auto">
                    {metadata.reasoning}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="space-y-1">
              <div className="text-sm text-muted-foreground">
                Token usage and model information are not available for this
                message.
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
