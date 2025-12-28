import { Suspense } from 'react';
import { getAuthToken } from '@/lib/auth/auth-server';
import Integrations from './integrations';
import { redirect } from 'next/navigation';
import { fetchQuery, preloadQuery } from '@/lib/convex-next-server';
import { api } from '@/convex/_generated/api';
import { Skeleton } from '@/components/ui/skeleton';
import { Stack, Grid, HStack } from '@/components/ui/layout';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { AccessDenied } from '@/components/layout';
import { getT } from '@/lib/i18n/server';
import type { Metadata } from 'next';

// This page requires authentication (cookies/connection), so it must be dynamic
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('metadata');
  return {
    title: `${t('integrations.title')} | ${t('suffix')}`,
    description: t('integrations.description'),
  };
}

interface IntegrationsPageProps {
  params: Promise<{ id: string }>;
}

/**
 * Skeleton for integration card matching the actual layout.
 */
function IntegrationCardSkeleton() {
  return (
    <Card>
      <CardContent className="p-5">
        <Stack gap={3}>
          <Skeleton className="w-11 h-11 rounded-md" />
          <Stack gap={1}>
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </Stack>
        </Stack>
      </CardContent>
      <CardFooter className="border-t border-border px-5 py-4">
        <HStack justify="between" className="w-full">
          <Skeleton className="h-6 w-20" />
          <Skeleton className="h-5 w-9 rounded-full" />
        </HStack>
      </CardFooter>
    </Card>
  );
}

/**
 * Skeleton for the integrations page that matches the actual layout.
 */
function IntegrationsSkeleton() {
  return (
    <Stack>
      <Grid cols={1} md={2} lg={3}>
        {Array.from({ length: 3 }).map((_, i) => (
          <IntegrationCardSkeleton key={i} />
        ))}
      </Grid>
    </Stack>
  );
}

interface IntegrationsContentProps {
  params: Promise<{ id: string }>;
}

async function IntegrationsPageContent({ params }: IntegrationsContentProps) {
  // All dynamic data access inside Suspense boundary for proper streaming
  const token = await getAuthToken();
  const { id: organizationId } = await params;
  if (!token) {
    redirect('/log-in');
  }

  const { t } = await getT('accessDenied');

  // Check user's role in the organization
  const memberContext = await fetchQuery(
    api.member.getCurrentMemberContext,
    {
      organizationId,
    },
    { token },
  );

  // Only Admin or Developer can access integrations settings (case-insensitive)
  const userRole = (memberContext.role ?? '').toLowerCase();
  const hasAccess = userRole === 'admin' || userRole === 'developer';

  if (!hasAccess) {
    return (
      <AccessDenied message={t('integrations')} />
    );
  }

  // Preload integrations data for SSR + real-time reactivity on client
  const [
    preloadedShopify,
    preloadedCirculy,
    preloadedProtel,
    preloadedEmailProviders,
  ] = await Promise.all([
    preloadQuery(
      api.integrations.getByName,
      { organizationId, name: 'shopify' },
      { token },
    ),
    preloadQuery(
      api.integrations.getByName,
      { organizationId, name: 'circuly' },
      { token },
    ),
    preloadQuery(
      api.integrations.getByName,
      { organizationId, name: 'protel' },
      { token },
    ),
    preloadQuery(api.email_providers.list, { organizationId }, { token }),
  ]);

  return (
    <Integrations
      organizationId={organizationId}
      preloadedShopify={preloadedShopify}
      preloadedCirculy={preloadedCirculy}
      preloadedProtel={preloadedProtel}
      preloadedEmailProviders={preloadedEmailProviders}
    />
  );
}

export default function IntegrationsPage({ params }: IntegrationsPageProps) {
  return (
    <Suspense fallback={<IntegrationsSkeleton />}>
      <IntegrationsPageContent params={params} />
    </Suspense>
  );
}
