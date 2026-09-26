import {
  AdaptiveHeaderRoot,
  AdaptiveHeaderTitle,
} from '@tale/ui/adaptive-header';
import { Button } from '@tale/ui/button';
import { PageLayout } from '@tale/ui/page-layout';
import { useIsMobile } from '@tale/ui/use-is-mobile';
import { Link, Navigate, createFileRoute } from '@tanstack/react-router';
import { SquarePen } from 'lucide-react';

import { HomeNavigator } from '@/app/features/home/components/home-panel';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

/**
 * Home on a phone: the list of everything you work on — chats, your tasks,
 * the inbox — as the screen itself, where a desktop shows it as the panel
 * beside the page. A desktop visit lands on the chat instead, the page the
 * rail's Home opens, so a link to Home works on either.
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
          <Button
            asChild
            size="icon"
            variant="ghost"
            aria-label={t('newChat')}
            className="text-muted-foreground ml-auto size-9"
          >
            <Link
              to="/dashboard/$id/chat"
              params={{ id: organizationId }}
              search={{ new: true }}
            >
              <SquarePen className="size-5" />
            </Link>
          </Button>
        </AdaptiveHeaderRoot>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <HomeNavigator organizationId={organizationId} />
      </div>
    </PageLayout>
  );
}
