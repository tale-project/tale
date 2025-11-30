import { SuspenseLoader } from '@/components/suspense-loader';
import ToneOfVoiceForm from './tone-of-voice-form';

interface ToneOfVoicePageProps {
  params: Promise<{ id: string }>;
}

async function ToneOfVoicePageContent({ params }: ToneOfVoicePageProps) {
  const { id } = await params;

  return <ToneOfVoiceForm organizationId={id} />;
}

export default function ToneOfVoicePage(props: ToneOfVoicePageProps) {
  return (
    <SuspenseLoader>
      <ToneOfVoicePageContent {...props} />
    </SuspenseLoader>
  );
}
