import {
  AdaptiveHeaderRoot,
  AdaptiveHeaderTitle,
} from '@tale/ui/adaptive-header';
import { PageLayout } from '@tale/ui/page-layout';
import { useIsMobile } from '@tale/ui/use-is-mobile';
import { Navigate, createFileRoute } from '@tanstack/react-router';

import { SidebarSearchTrigger } from '@/app/components/layout/app-sidebar/sidebar-search-trigger';
import { HomeNavigator } from '@/app/features/home/components/home-panel';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

/**
 * Home on a phone: the list of everything you work on — chats, your tasks,
 * the inbox — as the screen itself, where a desktop shows it as the panel
 * beside the page. A desktop visit lands on the chat instead, the page the
 * rail's Home opens, so a link to Home works on either. The header holds only
 * search: Home creates nothing, and a new chat starts from the Chats view.
 */
export const Route = createFileRoute('/dashboard/$id/home')({
  head: () => ({
    meta: seo('home'),
  }),
  component: HomeScreen,
});

function HomeScreen() {
  const { id: organizationId } = Route.useParams();
  const { t } = useT('home');
  const isMobile = useIsMobile();

  if (!isMobile) {
    return (
      <Navigate
        to="/dashboard/$id/chat"
        params={{ id: organizationId }}
        replace
      />
    );
  }

  return (
    <PageLayout
      className="overflow-hidden"
      header={
        <AdaptiveHeaderRoot standalone={false} className="gap-2">
          <AdaptiveHeaderTitle>{t('title')}</AdaptiveHeaderTitle>
          {/* The rail's search, for the phone — where the rail is hidden. */}
          <SidebarSearchTrigger className="text-muted-foreground hover:bg-muted/60 hover:text-foreground ml-auto flex size-9 items-center justify-center rounded-md p-0" />
        </AdaptiveHeaderRoot>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <HomeNavigator organizationId={organizationId} variant="screen" />
      </div>
    </PageLayout>
  );
}
