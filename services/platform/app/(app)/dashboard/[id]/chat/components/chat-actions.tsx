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

  // Convex hooks
  const deleteThread = useMutation(api.threads.deleteChatThread);

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
      } else {
        router.refresh();
      }
    } catch (error) {
      console.error('Failed to delete chat:', error);
      toast({
        title: 'Failed to delete chat',
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
            <TooltipContent side="bottom">Rename</TooltipContent>
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
            <TooltipContent side="bottom">Delete</TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>

      {/* Delete Confirmation Dialog */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader className="pt-2">
            <DialogTitle>Delete chat</DialogTitle>
          </DialogHeader>
          <div className="text-left space-y-2 py-2">
            <DialogDescription className="mb-2">
              Are you sure you want to delete{' '}
              <span className="font-medium text-foreground">{chat.title}</span>?
            </DialogDescription>
            <p className="text-sm text-muted-foreground">
              This chat will be archived and won&apos;t appear in your chat
              history.
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
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleDelete}
              disabled={isLoading}
              className="flex-1"
            >
              {isLoading ? 'Deleting...' : 'Delete chat'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
