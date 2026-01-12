import { Suspense } from 'react';
import { ToneOfVoiceForm } from './components/tone-of-voice-form';
import { fetchQuery, preloadQuery } from '@/lib/convex-next-server';
import { api } from '@/convex/_generated/api';
import { getAuthToken } from '@/lib/auth/auth-server';
import { redirect } from 'next/navigation';
import { getT } from '@/lib/i18n/server';
import { Skeleton } from '@/components/ui/feedback/skeleton';
import { Stack, HStack } from '@/components/ui/layout/layout';
import { DataTableSkeleton } from '@/components/ui/data-table/data-table-skeleton';
import type { Metadata } from 'next';

// This page requires authentication (cookies/connection), so it must be dynamic
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('metadata');
  return {
    title: t('toneOfVoice.title'),
    description: t('toneOfVoice.description'),
  };
}

interface ToneOfVoicePageProps {
  params: Promise<{ id: string }>;
}

/** Skeleton for the example messages table section */
async function ExampleMessagesSkeleton() {
  const { t } = await getT('tables');
  return (
    <Stack gap={5}>
      <HStack justify="between">
        <Stack gap={1}>
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-64" />
        </Stack>
        <Skeleton className="h-9 w-32" />
      </HStack>
      <DataTableSkeleton
        rows={5}
        columns={[
          { header: t('headers.message') },
          { header: t('headers.updated'), size: 140 },
          { isAction: true, size: 60 },
        ]}
        showHeader
      />
    </Stack>
  );
}

/** Skeleton for the tone of voice form section */
function ToneFormSkeleton() {
  return (
    <Stack gap={4}>
      <HStack align="end" justify="between">
        <Stack gap={1}>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-80" />
        </Stack>
      </HStack>
      <Skeleton className="h-40 w-full rounded-lg" />
      <HStack gap={2} justify="end">
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-9 w-32" />
      </HStack>
    </Stack>
  );
}

interface ToneOfVoiceContentProps {
  params: Promise<{ id: string }>;
}

async function ToneOfVoicePageContent({ params }: ToneOfVoiceContentProps) {
  // All dynamic data access inside Suspense boundary for proper streaming
  const token = await getAuthToken();
  if (!token) {
    redirect('/log-in');
  }

  const { id: organizationId } = await params;

  // Preload tone of voice data for SSR + real-time reactivity
  const preloadedToneOfVoice = await preloadQuery(
    api.tone_of_voice.getToneOfVoiceWithExamples,
    { organizationId },
    { token },
  );

  return (
    <ToneOfVoiceForm
      organizationId={organizationId}
      preloadedToneOfVoice={preloadedToneOfVoice}
    />
  );
}

export default async function ToneOfVoicePage({ params }: ToneOfVoicePageProps) {
  const token = await getAuthToken();
  if (!token) {
    redirect('/log-in');
  }

  const { id: organizationId } = await params;

  // Two-phase loading: check if examples exist before showing table skeleton
  // This prevents flickering of the table skeleton when there are no examples
  const hasExamples = await fetchQuery(
    api.tone_of_voice.hasExampleMessages,
    { organizationId },
    { token },
  );

  // Show appropriate skeleton based on whether examples exist
  // When no examples exist, skip the table skeleton (empty state will be shown by component)
  const skeletonFallback = await Promise.resolve(
    <Stack gap={8}>
      {hasExamples && <ExampleMessagesSkeleton />}
      <ToneFormSkeleton />
    </Stack>
  );

  return (
    <Suspense fallback={skeletonFallback}>
      <ToneOfVoicePageContent params={params} />
    </Suspense>
  );
}
