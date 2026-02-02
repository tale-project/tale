'use client';

import {
  type ComponentPropsWithoutRef,
  useEffect,
  useState,
  useRef,
  useMemo,
  useSyncExternalStore,
} from 'react';
import { useParams, useNavigate } from '@tanstack/react-router';
import { useQuery } from 'convex/react';

import { api } from '@/convex/_generated/api';
import { cn } from '@/lib/utils/cn';
import { useT } from '@/lib/i18n/client';
import { Input } from '@/app/components/ui/forms/input';
import { Stack } from '@/app/components/ui/layout/layout';
import { useToast } from '@/app/hooks/use-toast';
import { ChatActions } from './chat-actions';
import { useUpdateThread } from '../hooks/use-update-thread';

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
  const currentThreadId = params.threadId as string | undefined;
  const [isMac, setIsMac] = useState(false);
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const clickTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMounted = useIsMounted();
  const { toast } = useToast();

  const threadsData = useQuery(api.threads.queries.listThreads, {});

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
      inputRef.current.focus();
      inputRef.current.select();
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
    navigate({
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
      handleSaveRename(chatId);
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
      <h2 className="text-sm font-medium text-muted-foreground px-2">
        {t('chatHistory')}
      </h2>
      <Stack gap={1}>
        {!isMounted || !chats ? (
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
                  <div
                    className="w-full"
                    style={{
                      transform: 'matrix(0.9, 0, 0, 0.9, 0, 0)',
                      transformOrigin: 'left center',
                    }}
                  >
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
                      className="w-full h-6 px-0 py-0 leading-none focus:border-0 ring-0 outline-none focus-visible:ring-0 focus-visible:ring-offset-0 focus:ring-0 focus:outline-none shadow-none"
                    />
                  </div>
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
                      className="flex-1 truncate text-left cursor-pointer"
                    >
                      {chat.title}
                    </button>
                    <div className="opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
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
