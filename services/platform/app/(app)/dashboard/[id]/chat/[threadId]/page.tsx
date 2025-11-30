import ChatInterface from '../components/chat-interface';
import { SuspenseLoader } from '@/components/suspense-loader';

interface AIConversationPageProps {
  params: Promise<{ id: string; threadId: string }>;
}

async function ChatContent({ params }: AIConversationPageProps) {
  const { id: organizationId, threadId } = await params;

  return <ChatInterface organizationId={organizationId} threadId={threadId} />;
}

export default function AIConversationPage(props: AIConversationPageProps) {
  return (
    <SuspenseLoader>
      <ChatContent {...props} />
    </SuspenseLoader>
  );
}
