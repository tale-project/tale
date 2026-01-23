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
    const subPage = location.pathname.startsWith(basePath)
      ? location.pathname.slice(basePath.length)
      : '';

    if (subPage === '/executions') {
      navigate({
        to: '/dashboard/$id/automations/$amId/executions',
        params: { id: organizationId, amId: versionId },
      });
    } else if (subPage === '/configuration') {
      navigate({
        to: '/dashboard/$id/automations/$amId/configuration',
        params: { id: organizationId, amId: versionId },
      });
    } else {
      navigate({
        to: '/dashboard/$id/automations/$amId',
        params: { id: organizationId, amId: versionId },
        search: { panel: 'ai-chat' },
      });
    }
  };

  return { navigateToVersion };
}
