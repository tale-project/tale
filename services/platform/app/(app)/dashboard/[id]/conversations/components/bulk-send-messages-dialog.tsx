import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface BulkSendMessagesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedCount: number;
  onSend: () => Promise<void>;
  isLoading: boolean;
}

export function BulkSendMessagesDialog({
  open,
  onOpenChange,
  selectedCount,
  onSend,
  isLoading,
}: BulkSendMessagesDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader className="pt-2">
          <DialogTitle>Send {selectedCount} Messages</DialogTitle>
        </DialogHeader>
        <p className="text-muted-foreground text-sm">
          You&apos;re about to send replies for {selectedCount}{' '}
          {selectedCount === 1 ? 'conversation' : 'conversations'}. This action
          can&apos;t be undone.
          <br />
          <br />
          Are you sure you want to continue?
        </p>
        <DialogFooter className="flex">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button className="flex-1" onClick={onSend} disabled={isLoading}>
            {isLoading ? 'Sending...' : 'Send'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
