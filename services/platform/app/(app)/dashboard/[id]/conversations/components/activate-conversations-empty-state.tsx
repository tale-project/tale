import { Button } from '@/components/ui/button';
import { MessageSquare, Plus } from 'lucide-react';
import Link from 'next/link';

interface ActivateConversationsEmptyStateProps {
  organizationId: string;
}

export default function ActivateConversationsEmptyState({
  organizationId,
}: ActivateConversationsEmptyStateProps) {
  return (
    <div className="flex items-center justify-center flex-1 ring-1 ring-border rounded-xl my-6 mx-4 px-4">
      <div className="flex flex-col items-center text-center max-w-md">
        <MessageSquare className="size-6 text-muted-foreground mb-5" />
        <h2 className="text-lg font-semibold text-foreground mb-2">
          Activate conversations
        </h2>
        <p className="text-sm text-muted-foreground mb-5">
          Connect your email to get started with conversations
        </p>
        <Button asChild>
          <Link
            href={`/dashboard/${organizationId}/settings/integrations?tab=email`}
          >
            <Plus className="size-4 mr-2" />
            Connect email
          </Link>
        </Button>
      </div>
    </div>
  );
}
