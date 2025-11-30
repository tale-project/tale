import ChatInterface from './components/chat-interface';
import { SuspenseLoader } from '@/components/suspense-loader';

interface ChatPageProps {
  params: Promise<{ id: string }>;
}

async function ChatContent({ params }: ChatPageProps) {
  const { id: organizationId } = await params;

  // Render chat interface without threadId - thread will be created on first message
  return <ChatInterface organizationId={organizationId} />;
}

export default function ChatPage(props: ChatPageProps) {
  return (
    <SuspenseLoader>
      <ChatContent {...props} />
    </SuspenseLoader>
  );
}
