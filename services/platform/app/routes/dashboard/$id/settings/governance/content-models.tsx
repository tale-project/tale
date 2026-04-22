import { createFileRoute } from '@tanstack/react-router';

import { ModelAccessEditor } from '@/app/features/settings/governance/components/model-access-editor';
import { SystemPromptEditor } from '@/app/features/settings/governance/components/system-prompt-editor';
import { lazyComponent } from '@/lib/utils/lazy-component';

const DefaultModelEditor = lazyComponent<{ organizationId: string }>(() =>
  import('@/app/features/settings/governance/components/default-model-editor').then(
    (m) => ({ default: m.DefaultModelEditor }),
  ),
);

export const Route = createFileRoute(
  '/dashboard/$id/settings/governance/content-models',
)({
  component: ContentModelsRoute,
});

function ContentModelsRoute() {
  const { id: organizationId } = Route.useParams();

  return (
    <div className="divide-border flex flex-col divide-y">
      <div className="pb-7">
        <SystemPromptEditor organizationId={organizationId} />
      </div>
      <div className="py-7">
        <DefaultModelEditor organizationId={organizationId} />
      </div>
      <div className="pt-7">
        <ModelAccessEditor organizationId={organizationId} />
      </div>
    </div>
  );
}
