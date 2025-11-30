'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils/cn';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useDateFormat } from '@/hooks/use-date-format';
interface ChatSearchDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
}

export default function ChatSearchDialog({
  isOpen,
  onOpenChange,
  organizationId,
}: ChatSearchDialogProps) {
  const { formatDateSmart } = useDateFormat();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  const threadsData = useQuery(api.threads.listThreads);
  const chats =
    threadsData?.map((thread) => ({
      _id: thread._id,
      title: thread.title ?? 'Untitled Chat',
      createdAt: thread._creationTime,
    })) || [];

  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen]);

  // Handle Cmd+K toggle when dialog is open
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return chats;
    return chats.filter((c) => {
      if (c.title.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [query, chats]);

  useEffect(() => {
    if (isOpen) setSelectedIndex(-1);
  }, [isOpen, query]);

  const close = () => onOpenChange(false);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && filtered[selectedIndex]) {
      router.push(
        `/dashboard/${organizationId}/chat/${filtered[selectedIndex]._id}`,
      );
      onOpenChange(false);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="p-0 overflow-hidden gap-0">
        <div className="py-3 px-4 border-b border-border">
          <VisuallyHidden>
            <DialogTitle>Search chat</DialogTitle>
          </VisuallyHidden>
          <Input
            ref={inputRef}
            placeholder="Search chat"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className="!outline-none !ring-0 !ring-offset-0 border-0 pr-9 p-0 h-6"
          />
        </div>
        <div className="h-[13.75rem] overflow-y-auto p-3">
          {filtered.length === 0 ? (
            <div className="text-sm text-muted-foreground px-4 py-6 size-full flex items-center justify-center">
              No results
            </div>
          ) : (
            <ul className="py-1">
              {filtered.map((chat, idx) => (
                <li key={chat._id}>
                  <button
                    type="button"
                    className={cn(
                      'w-full text-left flex items-start gap-3 p-3 hover:bg-muted transition-colors rounded-lg',
                      idx === selectedIndex && 'bg-muted',
                    )}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    onClick={() => {
                      router.push(
                        `/dashboard/${organizationId}/chat/${chat._id}`,
                      );
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
      </DialogContent>
    </Dialog>
  );
}
