import { useIsMobile } from '@tale/ui/use-is-mobile';
import { Outlet } from '@tanstack/react-router';

import { SessionsPanel } from './sessions-panel';

/**
 * The Sessions section: the list of sessions beside the page that is open. A
 * phone has no room for both, so it shows the page alone and reaches the list
 * as a screen of its own (`/sessions`).
 */
export function SessionsLayout() {
  const isMobile = useIsMobile();
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-row">
      {!isMobile && <SessionsPanel />}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Outlet />
      </div>
    </div>
  );
}
