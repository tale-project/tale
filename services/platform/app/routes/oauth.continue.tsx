import { createFileRoute } from '@tanstack/react-router';

import { OAuthAuthorization } from '@/app/features/auth/components/oauth-authorization';

export const Route = createFileRoute('/oauth/continue')({
  component: () => <OAuthAuthorization consent={false} />,
});
