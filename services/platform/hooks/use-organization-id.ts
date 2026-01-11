import { useParams } from 'next/navigation';

/**
 * Hook to get the current organization ID from the route params.
 *
 * Used throughout the dashboard to access the organization context
 * from the [id] dynamic route segment.
 *
 * @returns The organization ID from the URL, or undefined if not in an organization route
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const organizationId = useOrganizationId();
 *   // organizationId will be the value from /dashboard/[id]/...
 * }
 * ```
 */
export function useOrganizationId(): string | undefined {
  const params = useParams();
  const id = params?.id;
  return typeof id === 'string' ? id : undefined;
}
