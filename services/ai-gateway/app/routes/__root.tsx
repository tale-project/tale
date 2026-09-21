import { Outlet, createRootRoute } from '@tanstack/react-router';

export const Route = createRootRoute({
  component: RootComponent,
});

/**
 * The full-viewport column every screen is measured against.
 *
 * `PageLayout` and `ContentArea variant="list"` bound themselves to their
 * parent so the table scrolls its own rows rather than the page — which only
 * works if something above them actually has a height. That is this.
 */
function RootComponent() {
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <Outlet />
    </div>
  );
}
