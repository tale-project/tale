import { convexQuery } from '@convex-dev/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { DataTableSkeleton } from '@/app/components/ui/data-table/data-table-skeleton';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { Stack, HStack } from '@/app/components/ui/layout/layout';
import { ToneOfVoiceFormClient } from '@/app/features/tone-of-voice/components/tone-of-voice-form-client';
import {
  useToneOfVoiceWithExamples,
  useHasExampleMessages,
} from '@/app/features/tone-of-voice/hooks/queries';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';

const searchSchema = z.object({
  page: z.string().optional(),
});

export const Route = createFileRoute('/dashboard/$id/_knowledge/tone-of-voice')(
  {
    validateSearch: searchSchema,
    loader: ({ context, params }) => {
      void context.queryClient.prefetchQuery(
        convexQuery(api.tone_of_voice.queries.getToneOfVoiceWithExamples, {
          organizationId: params.id,
        }),
      );
      void context.queryClient.prefetchQuery(
        convexQuery(api.tone_of_voice.queries.hasExampleMessages, {
          organizationId: params.id,
        }),
      );
    },
    component: ToneOfVoicePage,
  },
);

function ExampleMessagesSkeleton() {
  const { t } = useT('tables');

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

function ToneOfVoicePage() {
  const { id: organizationId } = Route.useParams();

  const { isLoading: isExamplesLoading } =
    useHasExampleMessages(organizationId);
  const { data: toneOfVoice, isLoading: isToneLoading } =
    useToneOfVoiceWithExamples(organizationId);

  if (isExamplesLoading || isToneLoading) {
    return (
      <Stack gap={8}>
        <ExampleMessagesSkeleton />
        <ToneFormSkeleton />
      </Stack>
    );
  }

  return (
    <ToneOfVoiceFormClient
      organizationId={organizationId}
      toneOfVoice={toneOfVoice ?? null}
    />
  );
}
