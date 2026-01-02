import { cn } from '@/lib/utils/cn';
import Image from 'next/image';
import type { Message as MessageType } from '../types';
import { formatMessageTime } from '@/lib/utils/conversation/date-utils';
import { EmailPreview } from '@/components/ui/email-preview';
import { Clock, CheckCheck, Check, AlertCircle } from 'lucide-react';

interface MessageProps {
  message: MessageType;
}

function getDeliveryIcon(status: string) {
  switch (status) {
    case 'queued':
      return <Clock className="size-3" />;
    case 'sent':
      return <Check className="size-3" />;
    case 'delivered':
      return <CheckCheck className="size-3" />;
    case 'failed':
      return <AlertCircle className="size-3" />;
    default:
      return null;
  }
}

export function Message({ message }: MessageProps) {
  return (
    <div className="flex flex-col">
      <div
        className={cn(
          'flex',
          message.isCustomer ? 'justify-start' : 'justify-end',
        )}
      >
        <div className="relative">
          <div
            className={cn(
              'max-w-[40rem] relative overflow-x-auto bg-white',
              message.isCustomer
                ? 'text-foreground'
                : 'p-4 rounded-2xl shadow-sm bg-muted text-foreground mb-6',
            )}
          >
            {(() => {
              if (
                message.attachment &&
                typeof message.attachment === 'object' &&
                message.attachment !== null &&
                'url' in message.attachment
              ) {
                const attachment = message.attachment as {
                  url: string;
                  type?: string;
                  alt?: string;
                };
                return (
                  <div className="mb-3">
                    <Image
                      src={attachment.url}
                      alt={
                        attachment.type === 'image'
                          ? attachment.alt || 'Image attachment'
                          : 'Attachment'
                      }
                      width={460}
                      height={300}
                      className="rounded-lg w-full h-auto"
                      unoptimized={/^https?:\/\//.test(attachment.url)}
                      onError={(e) => {
                        const target = e.target as HTMLImageElement;
                        if (target.src !== '/assets/placeholder-image.png') {
                          target.src = '/assets/placeholder-image.png';
                        }
                      }}
                    />
                  </div>
                );
              }
              return null;
            })()}
            <div className="text-xs leading-5">
              <EmailPreview html={message.content} />
            </div>
          </div>
          <div
            className={cn(
              'text-xs flex items-center gap-1.5 justify-end text-nowrap',
              message.isCustomer
                ? 'text-muted-foreground text-left'
                : 'text-muted-foreground/70 text-right absolute -bottom-4 right-0',
            )}
          >
            {formatMessageTime(message.timestamp)}
            {!message.isCustomer && message.status && (
              <span className="inline-flex items-center">
                {getDeliveryIcon(message.status)}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
