'use client';

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { X } from 'lucide-react';

import { api } from '@/convex/_generated/api';
import { cn } from '@/lib/utils/cn';
import { useT } from '@/lib/i18n/client';
import { useDebounce } from '@/app/hooks/use-debounce';
import { useDateFormat } from '@/app/hooks/use-date-format';
import { Dialog } from '@/app/components/ui/dialog/dialog';
import { Input } from '@/app/components/ui/forms/input';

interface ChatSearchDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
}

export function ChatSearchDialog({
  isOpen,
  onOpenChange,
  organizationId,
}: ChatSearchDialogProps) {
  const { t } = useT('dialogs');
  const { t: tCommon } = useT('common');
  const { formatDateSmart } = useDateFormat();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  const debouncedQuery = useDebounce(query, 300);

  const threadsData = useQuery(api.threads.queries.listThreads, {
    search: debouncedQuery || undefined,
  });
  const chats =
    threadsData?.map((thread) => ({
      _id: thread._id,
      title: thread.title ?? t('searchChat.untitledChat'),
      createdAt: thread._creationTime,
    })) || [];

  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toLowerCase().includes('mac');
      const isMod = isMac ? e.metaKey : e.ctrlKey;

      if (isMod && !e.shiftKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        e.stopPropagation();
        onOpenChange(false);
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [isOpen, onOpenChange]);

  useEffect(() => {
    if (isOpen) setSelectedIndex(-1);
  }, [isOpen, query]);

  const close = () => onOpenChange(false);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, chats.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && chats[selectedIndex]) {
      navigate({
        to: '/dashboard/$id/chat/$threadId',
        params: { id: organizationId, threadId: chats[selectedIndex]._id },
      });
      onOpenChange(false);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onOpenChange(false);
    }
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={onOpenChange}
      title={t('searchChat.title')}
      hideClose
      className="p-0 overflow-hidden gap-0"
      customHeader={
        <div className="px-3 py-4 border-b border-border relative flex items-center">
          <Input
            ref={inputRef}
            placeholder={t('searchChat.placeholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            variant="unstyled"
            className="pr-9 p-0 h-6"
          />
          <button
            type="button"
            onClick={close}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            aria-label={tCommon('actions.close')}
          >
            <X className="size-4" />
          </button>
        </div>
      }
    >
      <div className="h-[13.75rem] overflow-y-auto p-3">
        {chats.length === 0 ? (
          <div className="text-sm text-muted-foreground px-4 py-6 size-full flex items-center justify-center">
            {t('searchChat.noResults')}
          </div>
        ) : (
          <ul className="py-1">
            {chats.map((chat, idx) => (
              <li key={chat._id}>
                <button
                  type="button"
                  className={cn(
                    'w-full text-left flex items-start gap-3 p-3 hover:bg-muted transition-colors rounded-lg',
                    idx === selectedIndex && 'bg-muted',
                  )}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  onClick={() => {
                    navigate({
                      to: '/dashboard/$id/chat/$threadId',
                      params: { id: organizationId, threadId: chat._id },
                    });
                    close();
                  }}
                >
                  <div className="text-sm text-foreground truncate flex items-center gap-2 w-full">
                    {chat.title}
                    <div className="text-[0.625rem] text-muted-foreground truncate ml-auto">
                      {chat.createdAt &&
                        formatDateSmart(new Date(chat.createdAt) || '')}
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
