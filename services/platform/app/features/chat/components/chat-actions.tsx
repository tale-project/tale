'use client';

import { useNavigate } from '@tanstack/react-router';
import { Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { DeleteDialog } from '@/app/components/ui/dialog/delete-dialog';
import { HStack } from '@/app/components/ui/layout/layout';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/app/components/ui/overlays/tooltip';
import { Button } from '@/app/components/ui/primitives/button';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

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
  const navigate = useNavigate();
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const { t: tCommon } = useT('common');
  const { t: tChat } = useT('chat');

  const deleteThread = useDeleteThread();

  const handleDelete = async () => {
    try {
      setIsLoading(true);
      await deleteThread({
        threadId: chat.id,
      });

      setIsDeleteDialogOpen(false);

      if (currentChatId === chat.id) {
        void navigate({
          to: '/dashboard/$id/chat',
          params: { id: organizationId },
        });
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
                className="hidden p-1 md:inline-flex"
                size="icon"
                onClick={onRename}
                aria-label={tCommon('actions.rename')}
              >
                <Pencil className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {tCommon('actions.rename')}
            </TooltipContent>
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
            <TooltipContent side="bottom">
              {tCommon('actions.delete')}
            </TooltipContent>
          </Tooltip>
        </HStack>
      </TooltipProvider>

      <DeleteDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        title={tChat('deleteChat')}
        description={
          <>
            {(() => {
              const parts = tChat('deleteConfirmation', {
                title: '\x00',
              }).split('\x00');
              if (parts.length < 2) {
                return tChat('deleteConfirmation', { title: chat.title });
              }
              return (
                <>
                  {parts[0]}
                  <span className="text-foreground font-semibold">
                    {chat.title}
                  </span>
                  {parts[1]}
                </>
              );
            })()}
            <br />
            <br />
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
