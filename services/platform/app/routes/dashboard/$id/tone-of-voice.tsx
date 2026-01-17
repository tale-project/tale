import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { ToneOfVoiceFormClient } from '@/app/features/knowledge/tone-of-voice/components/tone-of-voice-form-client';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { Stack, HStack } from '@/app/components/ui/layout/layout';
import { DataTableSkeleton } from '@/app/components/ui/data-table/data-table-skeleton';
import { useT } from '@/lib/i18n/client';

export const Route = createFileRoute('/dashboard/$id/tone-of-voice')({
  component: ToneOfVoicePage,
});

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

  const hasExamples = useQuery(api.tone_of_voice.queries.has_example_messages.hasExampleMessages, {
    organizationId,
  });
  const toneOfVoice = useQuery(api.tone_of_voice.queries.get_tone_of_voice.getToneOfVoiceWithExamples, {
    organizationId,
  });

  if (hasExamples === undefined || toneOfVoice === undefined) {
    return (
      <Stack gap={8}>
        {hasExamples && <ExampleMessagesSkeleton />}
        <ToneFormSkeleton />
      </Stack>
    );
  }

  return (
    <ToneOfVoiceFormClient
      organizationId={organizationId}
      toneOfVoice={toneOfVoice}
    />
  );
}
