import { DemoTourSection } from '@tale/marketing-ui/demo-tour-section';
import { Brain, MessagesSquare, Workflow } from 'lucide-react';

import {
  HomeGovernDemo,
  HomeProjectsDemo,
} from '@/app/components/blocks/demos/content';
import { SandboxWorkspace } from '@/app/components/blocks/demos/sandbox-workspace';
import { MarketingCard, PageSection } from '@/app/components/marketing';
import { useT } from '@/lib/i18n/client';

const STAGES = [
  {
    key: 'projects',
    Demo: HomeProjectsDemo,
    moduleTo: '/platform/projects',
    moduleNavKey: 'projects',
  },
  {
    key: 'connect',
    Demo: SandboxWorkspace,
    moduleTo: '/platform/agents',
    moduleNavKey: 'agents',
  },
  {
    key: 'govern',
    Demo: HomeGovernDemo,
    moduleTo: '/platform/governance',
    moduleNavKey: 'governance',
  },
] as const;

const CAPABILITIES = [
  { key: 'pool', to: '/platform/knowledge', Icon: Brain },
  { key: 'delegate', to: '/platform/automations', Icon: Workflow },
  { key: 'arena', to: '/platform/chat', Icon: MessagesSquare },
] as const;

/** Three main chapters, followed by the capabilities that support the work. */
export function OrchestrationTour() {
  const { t } = useT('home');
  const { t: tNav } = useT('nav');

  return (
    <>
      <DemoTourSection
        heading={t('tour.title')}
        description={t('tour.subtitle')}
        stages={STAGES.map((stage, index) => ({
          id: stage.key,
          eyebrow: `${String(index + 1).padStart(2, '0')} ${t(`tour.${stage.key}.eyebrow`)}`,
          title: t(`tour.${stage.key}.title`),
          description: t(`tour.${stage.key}.description`),
          link: {
            label: t('tour.explore', {
              module: tNav(`product.${stage.moduleNavKey}.label`),
            }),
            to: stage.moduleTo,
          },
          demo: <stage.Demo />,
        }))}
      />
      <PageSection surface="wash" pad="compact" border="none">
        <div className="grid gap-x-10 gap-y-2 md:grid-cols-3">
          {CAPABILITIES.map(({ key, to, Icon }) => (
            <MarketingCard
              key={key}
              to={to}
              icon={Icon}
              title={<h3>{t(`tour.${key}.title`)}</h3>}
              description={t(`tour.${key}.description`)}
              surface="quiet"
              showArrow
            />
          ))}
        </div>
      </PageSection>
    </>
  );
}
