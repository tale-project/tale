import {
  createFileRoute,
  Outlet,
  useMatch,
  useNavigate,
} from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';

import {
  AdaptiveHeaderRoot,
  AdaptiveHeaderTitle,
} from '@/app/components/layout/adaptive-header';
import { PageLayout } from '@/app/components/layout/page-layout';
import { AutomationsListNavigation } from '@/app/features/automations/components/automations-list-navigation';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/automations')({
  head: () => ({
    meta: seo('automations'),
  }),
  component: AutomationsLayout,
});

function AutomationsLayout() {
  const { id: organizationId } = Route.useParams();
  const { t } = useT('automations');
  const navigate = useNavigate();

  const isSpecificAutomation = useMatch({
    from: '/dashboard/$id/automations/$amId',
    shouldThrow: false,
  });

  const indexMatch = useMatch({
    from: '/dashboard/$id/automations/',
    shouldThrow: false,
  });
  const currentFolder = indexMatch?.search?.folder;

  return (
    <PageLayout
      organizationId={organizationId}
      header={
        !isSpecificAutomation ? (
          <>
            <AdaptiveHeaderRoot standalone={false}>
              <AdaptiveHeaderTitle>
                {currentFolder ? (
                  <span className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() =>
                        void navigate({
                          to: '/dashboard/$id/automations',
                          params: { id: organizationId },
                        })
                      }
                      className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {t('title')}
                    </button>
                    <ChevronRight className="text-muted-foreground size-4 shrink-0" />
                    <span>{currentFolder}</span>
                  </span>
                ) : (
                  t('title')
                )}
              </AdaptiveHeaderTitle>
            </AdaptiveHeaderRoot>
            <AutomationsListNavigation organizationId={organizationId} />
          </>
        ) : undefined
      }
    >
      <Outlet />
    </PageLayout>
  );
}
