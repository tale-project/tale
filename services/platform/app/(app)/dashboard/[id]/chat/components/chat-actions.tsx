'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Pencil, Trash2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n';

interface ChatActionsProps {
  chat: {
    id: string;
    title: string;
  };
  currentChatId?: string;
  organizationId: string;
  onRename?: () => void;
}

export default function ChatActions({
  chat,
  currentChatId,
  organizationId,
  onRename,
}: ChatActionsProps) {
  const router = useRouter();
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Translations
  const { t: tCommon } = useT('common');
  const { t: tChat } = useT('chat');

  // Convex hooks - Delete thread with optimistic update for immediate UI feedback
  const deleteThread = useMutation(
    api.threads.deleteChatThread,
  ).withOptimisticUpdate((localStore, args) => {
    const currentThreads = localStore.getQuery(api.threads.listThreads, {});

    if (currentThreads !== undefined) {
      const updatedThreads = currentThreads.filter(
        (thread) => thread._id !== args.threadId,
      );
      localStore.setQuery(api.threads.listThreads, {}, updatedThreads);
    }
  });

  const handleDelete = async () => {
    try {
      setIsLoading(true);
      await deleteThread({
        threadId: chat.id,
      });

      setIsDeleteDialogOpen(false);

      // If deleting current chat, redirect to chat home
      if (currentChatId === chat.id) {
        router.push(`/dashboard/${organizationId}/chat`);
      }
    } catch (error) {
      console.error('Failed to delete chat:', error);
      toast({
        title: tChat('deleteFailed'),
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <TooltipProvider>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                className="p-1"
                size="icon"
                onClick={onRename}
              >
                <Pencil className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{tCommon('actions.rename')}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                className="p-1"
                size="icon"
                onClick={() => setIsDeleteDialogOpen(true)}
              >
                <Trash2 className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{tCommon('actions.delete')}</TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>

      {/* Delete Confirmation Dialog */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader className="pt-2">
            <DialogTitle>{tChat('deleteChat')}</DialogTitle>
          </DialogHeader>
          <div className="text-left space-y-2 py-2">
            <DialogDescription className="mb-2">
              {tChat('deleteConfirmation', { title: chat.title })}
            </DialogDescription>
            <p className="text-sm text-muted-foreground">
              {tChat('deleteArchiveMessage')}
            </p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsDeleteDialogOpen(false)}
              disabled={isLoading}
              className="flex-1"
            >
              {tCommon('actions.cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleDelete}
              disabled={isLoading}
              className="flex-1"
            >
              {isLoading ? tCommon('actions.deleting') : tChat('deleteChat')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
