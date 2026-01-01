'use client';

import { Button } from '@/components/ui/button';
import { DeleteDialog } from '@/components/ui/dialog';
import { HStack } from '@/components/ui/layout';
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
import { useT } from '@/lib/i18n';
import { useDeleteThread } from '../hooks/use-delete-thread';

interface ChatActionsProps {
  chat: {
    id: string;
    title: string;
  };
  currentChatId?: string;
  organizationId: string;
  onRename?: () => void;
}

export function ChatActions({
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
  const deleteThread = useDeleteThread();

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
        <HStack gap={1}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                className="p-1"
                size="icon"
                onClick={onRename}
                aria-label={tCommon('actions.rename')}
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
                aria-label={tCommon('actions.delete')}
              >
                <Trash2 className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{tCommon('actions.delete')}</TooltipContent>
          </Tooltip>
        </HStack>
      </TooltipProvider>

      {/* Delete Confirmation Dialog */}
      <DeleteDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        title={tChat('deleteChat')}
        description={
          <>
            {tChat('deleteConfirmation', { title: chat.title })}
            <br /><br />
            <span className="text-muted-foreground">
              {tChat('deleteArchiveMessage')}
            </span>
          </>
        }
        deleteText={tChat('deleteChat')}
        isDeleting={isLoading}
        onDelete={handleDelete}
      />
    </>
  );
}
