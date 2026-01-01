import { Suspense } from 'react';
import { ToneOfVoiceForm } from './tone-of-voice-form';
import { preloadQuery } from '@/lib/convex-next-server';
import { api } from '@/convex/_generated/api';
import { getAuthToken } from '@/lib/auth/auth-server';
import { redirect } from 'next/navigation';
import { getT } from '@/lib/i18n/server';
import { Skeleton } from '@/components/ui/skeleton';
import { Stack, HStack } from '@/components/ui/layout';
import { DataTableSkeleton } from '@/components/ui/data-table';
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

/**
 * Skeleton for the tone of voice page - matches ToneOfVoiceForm layout.
 * Includes example messages table section and tone of voice form section.
 */
async function ToneOfVoiceSkeleton() {
  const { t } = await getT('tables');
  return (
    <Stack gap={8}>
      {/* Example Messages Section */}
      <Stack gap={5}>
        <HStack justify="between">
          <Stack gap={1}>
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-64" />
          </Stack>
          <Skeleton className="h-10 w-32" />
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

      {/* Tone of Voice Form Section */}
      <Stack gap={4}>
        <HStack align="end" justify="between">
          <Stack gap={1}>
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-80" />
          </Stack>
        </HStack>
        <Skeleton className="h-40 w-full rounded-lg" />
        <HStack gap={2} justify="end">
          <Skeleton className="h-10 w-32" />
          <Skeleton className="h-10 w-32" />
        </HStack>
      </Stack>
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
  const skeletonFallback = await Promise.resolve(<ToneOfVoiceSkeleton />);

  return (
    <Suspense fallback={skeletonFallback}>
      <ToneOfVoicePageContent params={params} />
    </Suspense>
  );
}
