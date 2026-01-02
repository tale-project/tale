import { Navigation } from './navigation';

interface NavigationServerProps {
  organizationId: string;
  role: string | null;
}

/**
 * Server Component wrapper for Navigation.
 *
 * This component receives the role from the parent layout (which already
 * fetched it during auth validation) and passes it to the client Navigation.
 *
 * Benefits:
 * - No additional data fetching (role is passed from layout)
 * - Enables streaming via Suspense in the parent
 * - Navigation renders immediately with correct role
 */
export function NavigationServer({
  organizationId: _organizationId,
  role,
}: NavigationServerProps) {
  // The Navigation component is a client component that handles
  // the interactive navigation UI. We pass the role directly
  // instead of fetching it again.
  return <Navigation role={role} />;
}
