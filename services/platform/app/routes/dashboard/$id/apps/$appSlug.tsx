import { createFileRoute, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/dashboard/$id/apps/$appSlug')({
  component: AppLayout,
});

/**
 * Layout for an app + its nested run-detail page
 * (`/apps/$appSlug/runs/$executionId`). The app itself renders at the index
 * child; nested routes render through the Outlet — which keeps run-watching
 * INSIDE the app shell instead of bouncing out to the global automations
 * operator route. (Index-child pattern, like `agents/$agentId` — no pathname
 * compare, so it's robust to any URL-encoded slug.)
 */
function AppLayout() {
  return (
    <div className="p-4">
      <Outlet />
    </div>
  );
}
