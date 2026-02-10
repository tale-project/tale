import { useNavigate, useLocation } from '@tanstack/react-router';

/**
 * Hook for navigating between automation versions while preserving the current sub-page.
 * Handles navigation to editor, executions, and configuration pages.
 */
export function useAutomationVersionNavigation(
  organizationId: string,
  currentAutomationId: string,
) {
  const location = useLocation();
  const navigate = useNavigate();

  const navigateToVersion = (versionId: string) => {
    const basePath = `/dashboard/${organizationId}/automations/${currentAutomationId}`;
    const pathname = location.pathname;

    const isBasePathMatch =
      pathname === basePath ||
      (pathname.startsWith(basePath) && pathname[basePath.length] === '/');

    const subPage = isBasePathMatch ? pathname.slice(basePath.length) : '';

    const isExecutionsPage = subPage.startsWith('/executions');
    const isConfigurationPage = subPage.startsWith('/configuration');

    if (isExecutionsPage) {
      void navigate({
        to: '/dashboard/$id/automations/$amId/executions',
        params: { id: organizationId, amId: versionId },
      });
    } else if (isConfigurationPage) {
      void navigate({
        to: '/dashboard/$id/automations/$amId/configuration',
        params: { id: organizationId, amId: versionId },
      });
    } else {
      void navigate({
        to: '/dashboard/$id/automations/$amId',
        params: { id: organizationId, amId: versionId },
        search: { panel: 'ai-chat' },
      });
    }
  };

  return { navigateToVersion };
}
