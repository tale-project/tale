import { createFileRoute, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/dashboard/$id/automations')({
  component: AutomationsLayout,
});

function AutomationsLayout() {
  return <Outlet />;
}
