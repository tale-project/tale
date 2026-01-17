import { useParams } from '@tanstack/react-router';

/**
 * Hook to get the current organization ID from the route params.
 *
 * Used throughout the dashboard to access the organization context
 * from the $id dynamic route segment.
 *
 * @returns The organization ID from the URL, or undefined if not in an organization route
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const organizationId = useOrganizationId();
 *   // organizationId will be the value from /dashboard/$id/...
 * }
 * ```
 */
export function useOrganizationId(): string | undefined {
  const params = useParams({ strict: false }) as { id?: string };
  return params?.id;
}
