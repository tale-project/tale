import {
  AdaptiveHeaderProvider,
  AdaptiveHeaderRoot,
  AdaptiveHeaderTitle,
} from '@tale/ui/adaptive-header';
import { Button } from '@tale/ui/button';
import { ContentArea } from '@tale/ui/content-area';
import { PageLayout } from '@tale/ui/page-layout';
import { Plus } from 'lucide-react';

/**
 * Page chrome renders its own `h1`, and a documentation page already has one.
 * The frame is therefore presented the way `DemoShell` presents the product
 * window: one labelled illustration, its payload `inert` so nothing inside it
 * enters the heading outline or the tab order.
 */
export default function AppShellPageLayout() {
  return (
    <div
      role="img"
      aria-label="A page shell: the h-13 header row with a title and a primary action, above a scrolling body."
      className="border-border bg-background h-72 w-full overflow-hidden rounded-lg border"
    >
      <div aria-hidden="true" inert className="flex h-full flex-col">
        <AdaptiveHeaderProvider>
          <PageLayout
            header={
              <AdaptiveHeaderRoot showBorder standalone={false}>
                <AdaptiveHeaderTitle>Agents</AdaptiveHeaderTitle>
                <Button size="sm" icon={Plus} className="ml-auto">
                  New agent
                </Button>
              </AdaptiveHeaderRoot>
            }
          >
            <ContentArea>
              <p className="text-muted-foreground text-sm">
                The body scrolls under the sticky header. Every list page in the
                product is this shell with a table inside it.
              </p>
            </ContentArea>
          </PageLayout>
        </AdaptiveHeaderProvider>
      </div>
    </div>
  );
}
