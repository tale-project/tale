import { convexQuery } from '@convex-dev/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { ToneOfVoiceForm } from '@/app/features/tone-of-voice/components/tone-of-voice-form';
import {
  useApproxExampleMessageCount,
  useToneOfVoiceWithExamples,
} from '@/app/features/tone-of-voice/hooks/queries';
import { api } from '@/convex/_generated/api';
import { seo } from '@/lib/utils/seo';

const searchSchema = z.object({
  page: z.string().optional(),
});

export const Route = createFileRoute('/dashboard/$id/_knowledge/tone-of-voice')(
  {
    head: () => ({
      meta: seo('toneOfVoice'),
    }),
    validateSearch: searchSchema,
    loader: ({ context, params }) => {
      void context.queryClient.prefetchQuery(
        convexQuery(api.tone_of_voice.queries.approxCountExampleMessages, {
          organizationId: params.id,
        }),
      );
      void context.queryClient.prefetchQuery(
        convexQuery(api.tone_of_voice.queries.getToneOfVoiceWithExamples, {
          organizationId: params.id,
        }),
      );
    },
    component: ToneOfVoicePage,
  },
);

function ToneOfVoicePage() {
  const { id: organizationId } = Route.useParams();

  const { data: exampleCount } = useApproxExampleMessageCount(organizationId);
  const { data: toneOfVoice, isLoading } =
    useToneOfVoiceWithExamples(organizationId);

  return (
    <ToneOfVoiceForm
      organizationId={organizationId}
      toneOfVoice={toneOfVoice ?? null}
      isLoading={isLoading}
      exampleCount={exampleCount}
    />
  );
}
