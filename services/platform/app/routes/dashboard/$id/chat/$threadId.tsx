import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/dashboard/$id/chat/$threadId')({
  component: () => null,
});
