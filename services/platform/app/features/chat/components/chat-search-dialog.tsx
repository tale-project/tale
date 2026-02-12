'use client';

import { useNavigate } from '@tanstack/react-router';
import { X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Dialog } from '@/app/components/ui/dialog/dialog';
import { Input } from '@/app/components/ui/forms/input';
import { useDebounce } from '@/app/hooks/use-debounce';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
import { filterByTextSearch } from '@/lib/utils/filtering';

import { useThreadCollection } from '../hooks/collections';
import { useThreads } from '../hooks/queries';

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
  const { formatDateHeader } = useFormatDate();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const selectedIndexRef = useRef(selectedIndex);
  selectedIndexRef.current = selectedIndex;
  const inputRef = useRef<HTMLInputElement>(null);

  const debouncedQuery = useDebounce(query, 300);

  const threadCollection = useThreadCollection();
  const { threads: allThreads } = useThreads(threadCollection);

  const threadsData = useMemo(() => {
    if (!allThreads) return null;
    if (!debouncedQuery) return allThreads;
    return filterByTextSearch(allThreads, debouncedQuery, ['title']);
  }, [allThreads, debouncedQuery]);

  const chats = useMemo(
    () =>
      threadsData?.map((thread) => ({
        _id: thread._id,
        title: thread.title ?? t('searchChat.untitledChat'),
        createdAt: thread._creationTime,
      })) ?? [],
    [threadsData, t],
  );

  const groupedChats = useMemo(() => {
    const groups: { label: string; chats: typeof chats }[] = [];
    let currentLabel = '';

    for (const chat of chats) {
      const label = chat.createdAt
        ? formatDateHeader(new Date(chat.createdAt))
        : '';
      if (label !== currentLabel) {
        currentLabel = label;
        groups.push({ label, chats: [chat] });
      } else {
        groups[groups.length - 1].chats.push(chat);
      }
    }

    return groups;
  }, [chats, formatDateHeader]);

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

  // Reset selection when results change (debounced query), not on every keystroke
  useEffect(() => {
    if (isOpen) setSelectedIndex(-1);
  }, [isOpen, debouncedQuery]);

  const close = useCallback(() => onOpenChange(false), [onOpenChange]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, chats.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' && chats[selectedIndexRef.current]) {
        void navigate({
          to: '/dashboard/$id/chat/$threadId',
          params: {
            id: organizationId,
            threadId: chats[selectedIndexRef.current]._id,
          },
        });
        onOpenChange(false);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onOpenChange(false);
      }
    },
    [chats, navigate, organizationId, onOpenChange],
  );

  return (
    <Dialog
      open={isOpen}
      onOpenChange={onOpenChange}
      title={t('searchChat.title')}
      hideClose
      className="gap-0 overflow-hidden p-0 sm:p-0"
      customHeader={
        <div className="border-border relative flex items-center border-b px-3 py-4">
          <Input
            ref={inputRef}
            placeholder={t('searchChat.placeholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            variant="unstyled"
            className="h-6 p-0 pr-9"
          />
          <button
            type="button"
            onClick={close}
            className="text-muted-foreground hover:text-foreground absolute top-1/2 right-4 -translate-y-1/2 transition-colors"
            aria-label={tCommon('actions.close')}
          >
            <X className="size-4" />
          </button>
        </div>
      }
    >
      <div className="h-[13.75rem] overflow-y-auto p-3">
        {threadsData !== null && chats.length === 0 ? (
          <div className="text-muted-foreground flex size-full items-center justify-center px-4 py-6 text-sm">
            {t('searchChat.noResults')}
          </div>
        ) : (
          <ul className="py-1">
            {(() => {
              let flatIdx = 0;
              return groupedChats.map((group) => (
                <li key={group.label}>
                  {group.label && (
                    <div className="text-muted-foreground px-2 pt-2 pb-1 text-xs font-medium">
                      {group.label}
                    </div>
                  )}
                  <ul>
                    {group.chats.map((chat) => {
                      const idx = flatIdx++;
                      return (
                        <li key={chat._id}>
                          <button
                            type="button"
                            className={cn(
                              'w-full text-left flex items-start gap-3 py-3 px-2 hover:bg-muted transition-colors rounded-lg cursor-pointer',
                              idx === selectedIndex && 'bg-muted',
                            )}
                            onMouseEnter={() => setSelectedIndex(idx)}
                            onMouseLeave={() => setSelectedIndex(-1)}
                            onClick={() => {
                              void navigate({
                                to: '/dashboard/$id/chat/$threadId',
                                params: {
                                  id: organizationId,
                                  threadId: chat._id,
                                },
                              });
                              close();
                            }}
                          >
                            <span className="text-foreground truncate text-sm">
                              {chat.title}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ));
            })()}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
