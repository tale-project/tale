import { SuspenseLoader } from '@/components/suspense-loader';
import ToneOfVoiceForm from './tone-of-voice-form';
import { FormSkeleton } from '@/components/skeletons';
import { preloadQuery } from '@/lib/convex-next-server';
import { api } from '@/convex/_generated/api';
import { getAuthToken } from '@/lib/auth/auth-server';
import { redirect } from 'next/navigation';

interface ToneOfVoicePageProps {
  params: Promise<{ id: string }>;
}

/**
 * Skeleton for the tone of voice form.
 */
function ToneOfVoiceSkeleton() {
  return (
    <div className="max-w-2xl">
      <FormSkeleton fields={3} />
    </div>
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

export default function ToneOfVoicePage({ params }: ToneOfVoicePageProps) {
  return (
    <SuspenseLoader fallback={<ToneOfVoiceSkeleton />}>
      <ToneOfVoicePageContent params={params} />
    </SuspenseLoader>
  );
}
