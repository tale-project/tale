'use client';

import { Card } from '@tale/ui/card';
import { Row } from '@tale/ui/layout';
/**
 * The card frame every connected block renders inside — a titled section (icon +
 * title + optional description + a right-aligned action slot) over the `@tale/ui`
 * Card surface (the one bordered primitive; padding stays local so the header/
 * body rhythm is unchanged). This is the structure the flat-tables page was
 * missing; applying it uniformly turns the view from a data dump into a product
 * surface.
 */
import { Text } from '@tale/ui/text';
import type { LucideIcon } from 'lucide-react';

export function Section({
  title,
  description,
  icon: Icon,
  action,
  children,
  className,
}: {
  title?: string;
  description?: string;
  icon?: LucideIcon;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card asChild padding="none" shadow="sm" className={className}>
      <section>
        <Row gap={3} align="start" justify="between" className="p-5 pb-3">
          <div className="flex min-w-0 items-center gap-2.5">
            {Icon && (
              <Row
                gap={0}
                justify="center"
                className="bg-muted text-muted-foreground size-8 shrink-0 rounded-md"
              >
                <Icon className="size-4" />
              </Row>
            )}
            <div className="min-w-0">
              {title && (
                <Text as="span" className="font-semibold">
                  {title}
                </Text>
              )}
              {description && (
                <Text variant="muted" className="block text-sm">
                  {description}
                </Text>
              )}
            </div>
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </Row>
        <div className="px-5 pb-5">{children}</div>
      </section>
    </Card>
  );
}
