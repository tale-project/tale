'use client';

/** The Apps hub landing: a config-driven grid of installed packs. Each pack is
 * a skill with a `pack` manifest — a new pack appears here with no code change.
 */
import { Card } from '@tale/ui/card';
import { EmptyState } from '@tale/ui/empty-state';
import { Grid } from '@tale/ui/layout';
import { SkeletonText } from '@tale/ui/skeleton';
import { Link } from '@tanstack/react-router';
import { LayoutGrid } from 'lucide-react';

import { useT } from '@/lib/i18n/client';

import { usePacks } from '../hooks/use-packs';

export function PacksGrid({ organizationId }: { organizationId: string }) {
  const { t } = useT('apps');
  const { packs, isLoading } = usePacks(organizationId);

  if (isLoading && packs.length === 0) return <SkeletonText lines={4} />;
  if (packs.length === 0) {
    return (
      <EmptyState
        icon={LayoutGrid}
        title={t('empty.title')}
        description={t('empty.description')}
      />
    );
  }

  return (
    <Grid className="grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {packs.map((pack) => (
        <Link
          key={pack.slug}
          to="/dashboard/$id/apps/$packSlug"
          params={{ id: organizationId, packSlug: pack.slug }}
          className="block"
        >
          <Card
            title={pack.name}
            description={pack.description}
            className="hover:border-primary/50 h-full transition-colors"
          />
        </Link>
      ))}
    </Grid>
  );
}
