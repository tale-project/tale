'use client';

import {
  ComponentPropsWithoutRef,
  useEffect,
  useState,
  useRef,
  useMemo,
} from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useUpdateThread } from '../hooks/use-update-thread';
import { cn } from '@/lib/utils/cn';
import { Input } from '@/components/ui/input';
import { Stack } from '@/components/ui/layout';
import { toast } from '@/hooks/use-toast';
import { ChatActions } from './chat-actions';
import { useT } from '@/lib/i18n';

interface ChatHistorySidebarProps extends ComponentPropsWithoutRef<'div'> {
  organizationId: string;
  onSearchOpen?: () => void;
  onNewChat?: () => void;
}

export function ChatHistorySidebar({
  organizationId,
  onSearchOpen,
  onNewChat,
  className,
  ...restProps
}: ChatHistorySidebarProps) {
  const { t } = useT('chat');
  const router = useRouter();
  const params = useParams();
  const currentThreadId = params.threadId as string | undefined;
  const [isMac, setIsMac] = useState(false);
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Load chat threads for current user
  const threadsData = useQuery(api.threads.listThreads, {});

  // Update thread with optimistic update for immediate title change
  const updateThread = useUpdateThread();

  // Memoize chat transformation to prevent unnecessary recalculations
  const chats = useMemo(
    () =>
      threadsData?.map((thread) => ({
        _id: thread._id,
        title: thread.title ?? t('history.untitled'),
        createdAt: thread._creationTime,
      })),
    [threadsData, t],
  );

  // Auto-focus input when editing starts
  useEffect(() => {
    if (editingChatId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingChatId]);

  // Detect platform for keyboard shortcuts
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const platform = (
        navigator.platform ||
        navigator.userAgent ||
        ''
      ).toLowerCase();
      setIsMac(platform.includes('mac'));
    }
  }, []);

  // Global keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isMod = isMac ? e.metaKey : e.ctrlKey;

      // Find: Mod + K
      if (isMod && !e.shiftKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        onSearchOpen?.();
        return;
      }

      // New Chat: Shift + Mod + O
      if (isMod && e.shiftKey && (e.key === 'o' || e.key === 'O')) {
        e.preventDefault();
        onNewChat?.();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isMac, onSearchOpen, onNewChat]);

  const handleChatClick = (threadId: string) => {
    router.push(`/dashboard/${organizationId}/chat/${threadId}`);
  };

  const handleStartRename = (chatId: string, currentTitle: string) => {
    setEditingChatId(chatId);
    setEditValue(currentTitle);
  };

  const handleSaveRename = async (chatId: string) => {
    if (!editValue.trim()) {
      toast({
        title: t('history.toast.titleEmpty'),
        variant: 'destructive',
      });
      return;
    }

    try {
      await updateThread({
        threadId: chatId,
        title: editValue.trim(),
      });

      setEditingChatId(null);
    } catch (error) {
      console.error('Failed to rename chat:', error);
      toast({
        title: t('history.toast.renameFailed'),
        variant: 'destructive',
      });
    }
  };

  const handleCancelRename = () => {
    setEditingChatId(null);
    setEditValue('');
  };

  const handleInputBlur = (chatId: string) => {
    // Only save if still in editing mode (not cancelled via Escape)
    if (editingChatId === chatId) {
      handleSaveRename(chatId);
    }
  };

  return (
    <Stack
      gap={4}
      className={cn('flex-[1_1_0] pb-4 px-2 overflow-y-auto', className)}
      {...restProps}
    >
      <div className="text-xs font-medium text-muted-foreground tracking-[-0.072px] text-nowrap sticky top-0 bg-background z-10 pt-3">
        {t('history.recent')}
      </div>
      <Stack gap={1}>
        {!chats ? (
          <div className="text-sm text-muted-foreground text-nowrap px-2">
            {t('history.loading')}
          </div>
        ) : chats.length === 0 ? (
          <div className="text-sm text-muted-foreground text-nowrap px-2">
            {t('history.empty')}
          </div>
        ) : (
          chats.map((chat) => {
            const isEditing = editingChatId === chat._id;

            return (
              <div
                key={chat._id}
                className={cn(
                  'group relative flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors',
                  !isEditing && 'hover:bg-accent hover:text-accent-foreground',
                  currentThreadId === chat._id &&
                    !isEditing &&
                    'bg-accent text-accent-foreground',
                )}
              >
                {isEditing ? (
                  <Input
                    ref={inputRef}
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleSaveRename(chat._id);
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        handleCancelRename();
                      }
                    }}
                    onBlur={() => handleInputBlur(chat._id)}
                    className="flex-1 h-6 text-sm px-1.5 py-0 leading-none -mx-1.5"
                  />
                ) : (
                  <>
                    <button
                      onClick={() => handleChatClick(chat._id)}
                      className="flex-1 truncate text-left cursor-pointer"
                    >
                      {chat.title}
                    </button>
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                      <ChatActions
                        chat={{ id: chat._id, title: chat.title }}
                        currentChatId={currentThreadId}
                        organizationId={organizationId}
                        onRename={() => handleStartRename(chat._id, chat.title)}
                      />
                    </div>
                  </>
                )}
              </div>
            );
          })
        )}
      </Stack>
    </Stack>
  );
}
