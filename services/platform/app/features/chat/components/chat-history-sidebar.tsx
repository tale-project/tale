'use client';

import { useParams, useNavigate } from '@tanstack/react-router';
import {
  type ComponentPropsWithoutRef,
  useEffect,
  useState,
  useRef,
  useMemo,
  useSyncExternalStore,
} from 'react';

import { Stack } from '@/app/components/ui/layout/layout';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useThreadCollection } from '../hooks/collections';
import { useUpdateThread } from '../hooks/mutations';
import { useThreads } from '../hooks/queries';
import { ChatActions } from './chat-actions';

const emptySubscribe = () => () => {};

function useIsMounted() {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

interface ChatHistorySidebarProps extends ComponentPropsWithoutRef<'div'> {
  organizationId: string;
  onSearchOpen?: () => void;
  onNewChat?: () => void;
  onChatSelect?: () => void;
}

export function ChatHistorySidebar({
  organizationId,
  onSearchOpen,
  onNewChat,
  onChatSelect,
  className,
  ...restProps
}: ChatHistorySidebarProps) {
  const { t } = useT('chat');
  const navigate = useNavigate();
  const params = useParams({ strict: false });
  // TanStack Router useParams with strict: false returns unknown params — cast required
  const currentThreadId = params.threadId;
  const [isMac, setIsMac] = useState(false);
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const clickTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMounted = useIsMounted();
  const { toast } = useToast();

  const threadCollection = useThreadCollection();
  const { threads: threadsData } = useThreads(threadCollection);

  const updateThread = useUpdateThread();

  const chats = useMemo(
    () =>
      threadsData?.map((thread) => ({
        _id: thread._id,
        title: thread.title ?? t('history.untitled'),
        createdAt: thread._creationTime,
      })),
    [threadsData, t],
  );

  useEffect(() => {
    if (editingChatId && inputRef.current) {
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [editingChatId]);

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

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isMod = isMac ? e.metaKey : e.ctrlKey;

      if (isMod && !e.shiftKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        onSearchOpen?.();
        return;
      }

      if (isMod && e.shiftKey && (e.key === 'o' || e.key === 'O')) {
        e.preventDefault();
        onNewChat?.();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isMac, onSearchOpen, onNewChat]);

  const handleChatClick = (threadId: string) => {
    void navigate({
      to: '/dashboard/$id/chat/$threadId',
      params: { id: organizationId, threadId },
    });
    onChatSelect?.();
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
    if (editingChatId === chatId) {
      void handleSaveRename(chatId);
    }
  };

  return (
    <Stack
      gap={4}
      className={cn(
        'flex-[1_1_0] pb-4 px-2.5 py-3.5 overflow-y-auto',
        className,
      )}
      {...restProps}
    >
      <h2 className="text-muted-foreground px-2 text-sm font-medium">
        {t('chatHistory')}
      </h2>
      <Stack gap={1}>
        {!isMounted || !chats ? (
          <div className="text-muted-foreground px-2 text-sm text-nowrap">
            {t('history.loading')}
          </div>
        ) : chats.length === 0 ? (
          <div className="text-muted-foreground px-2 text-sm text-nowrap">
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
                  !isEditing &&
                    'cursor-pointer hover:bg-accent hover:text-accent-foreground',
                  currentThreadId === chat._id &&
                    !isEditing &&
                    'bg-accent text-accent-foreground',
                )}
              >
                {isEditing ? (
                  <input
                    ref={inputRef}
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void handleSaveRename(chat._id);
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        handleCancelRename();
                      }
                    }}
                    onBlur={() => handleInputBlur(chat._id)}
                    aria-label={t('history.renameChat')}
                    className="ring-primary focus-visible:ring-primary min-h-[20px] min-w-0 flex-1 rounded-sm bg-transparent px-1 text-sm leading-snug ring-1 outline-none focus-visible:ring-2"
                  />
                ) : (
                  <>
                    <button
                      onClick={() => {
                        if (clickTimeoutRef.current) {
                          clearTimeout(clickTimeoutRef.current);
                          clickTimeoutRef.current = null;
                          handleStartRename(chat._id, chat.title);
                        } else {
                          clickTimeoutRef.current = setTimeout(() => {
                            clickTimeoutRef.current = null;
                            handleChatClick(chat._id);
                          }, 250);
                        }
                      }}
                      className="min-h-[20px] flex-1 truncate text-left text-sm leading-snug"
                    >
                      {chat.title}
                    </button>
                    <div className="opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100">
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
