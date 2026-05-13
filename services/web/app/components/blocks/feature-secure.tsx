import { Image } from '@tale/ui/image';
import { cva } from 'class-variance-authority';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { type ComponentType, type SVGProps, useState } from 'react';

import {
  ApprovalsIcon,
  ChatIcon,
  ConversationsIcon,
  WorkflowsIcon,
} from '@/app/components/icons/marketing-icons';
import { SiteContainer } from '@/app/components/layout/site-container';
import { useT } from '@/lib/i18n/client';

type FeatureIcon = ComponentType<SVGProps<SVGSVGElement>>;

const easeOut = [0.22, 1, 0.36, 1] as const;

type RailKey = 'chat' | 'conversations' | 'automations' | 'approvals';

interface RailItem {
  key: RailKey;
  icon: FeatureIcon;
  label: string;
  description: string;
  illustration: string;
}

// Per-tab full-bleed gradient. Values mirror frontpages.pen / live tale.dev
// (extracted from the Framer JS bundle, all 0deg bottom→top stops).
const panelGradient = cva('absolute inset-0', {
  variants: {
    tab: {
      chat: 'bg-[linear-gradient(0deg,rgb(155,196,255)_0%,rgb(5,97,230)_18%,rgb(2,49,115)_41%,rgb(2,52,122)_72%,rgb(2,26,63)_100%)]',
      conversations:
        'bg-[linear-gradient(0deg,rgb(253,201,76)_0%,rgb(219,106,4)_41%,rgb(147,56,13)_72%,rgb(70,22,2)_100%)]',
      automations:
        'bg-[linear-gradient(0deg,rgb(163,179,255)_0%,rgb(79,57,246)_41%,rgb(55,42,172)_72%,rgb(30,26,77)_100%)]',
      approvals:
        'bg-[linear-gradient(0deg,rgb(111,230,167)_0%,rgb(7,148,85)_41%,rgb(7,94,58)_72%,rgb(2,44,28)_100%)]',
    },
  },
});

// Frosted glass inner card overlaying the gradient panel. Mirrors the
// Pencil spec: flush-left, ~6% right margin, ~10% top inset, extends past
// the bottom edge so it's clipped by the parent. Rounded only at the
// top-right corner with a subtle gradient stroke (white/20 → white).
const panelGlassCard =
  'pointer-events-none absolute top-[10.4%] right-[6%] bottom-[-3.3%] left-0 overflow-hidden rounded-tr-3xl bg-white/10 backdrop-blur-md';

// Gradient stroke for the glass card — top is fainter, bottom edge near
// fully opaque white. Implemented as a separate absolute ring so it sits
// on top of the backdrop-blurred surface.
const panelGlassStroke =
  'pointer-events-none absolute inset-0 rounded-tr-3xl [mask:linear-gradient(#000_0_0)_content-box,linear-gradient(#000_0_0)] [mask-composite:exclude] p-px [background:linear-gradient(180deg,rgba(255,255,255,0.2)_0%,rgba(255,255,255,1)_100%)]';

// Inner stage that holds the SVG mockup centered inside the glass card.
// `inset-X` keeps a comfortable margin so the illustration never bleeds
// to the card edge regardless of its intrinsic aspect ratio.
const panelStage =
  'absolute inset-4 flex items-center justify-center sm:inset-8';

// SVGs are vector — clamp to 100% on both axes and use `object-contain`
// so they keep their aspect ratio and never blow up beyond the stage.
const panelImage = 'block h-full max-h-full w-full max-w-full object-contain';

export function FeatureSecure() {
  const { t } = useT('home');
  const reduceMotion = useReducedMotion();
  const fadeInitial = reduceMotion ? false : { opacity: 0, y: 24 };
  const [active, setActive] = useState<RailKey>('chat');

  const items: RailItem[] = [
    {
      key: 'chat',
      icon: ChatIcon,
      label: t('featureSecure.chat.label'),
      description: t('featureSecure.chat.description'),
      illustration: '/marketing/svg/mock-doc-summarizing.svg',
    },
    {
      key: 'conversations',
      icon: ConversationsIcon,
      label: t('featureSecure.conversations.label'),
      description: t('featureSecure.conversations.description'),
      illustration: '/marketing/svg/mock-conversations.svg',
    },
    {
      key: 'automations',
      icon: WorkflowsIcon,
      label: t('featureSecure.automations.label'),
      description: t('featureSecure.automations.description'),
      illustration: '/marketing/svg/mock-workflow-grid.svg',
    },
    {
      key: 'approvals',
      icon: ApprovalsIcon,
      label: t('featureSecure.approvals.label'),
      description: t('featureSecure.approvals.description'),
      illustration: '/marketing/svg/mock-approvals-table.svg',
    },
  ];

  const activeItem = items.find((item) => item.key === active) ?? items[0];

  const tabId = (key: RailKey) => `feature-secure-tab-${key}`;

  const renderPanel = (item: RailItem) => (
    <div
      role="tabpanel"
      aria-labelledby={tabId(item.key)}
      className="relative aspect-square w-full overflow-hidden lg:aspect-671/559"
    >
      <div aria-hidden className={panelGradient({ tab: item.key })} />
      <div aria-hidden className={panelGlassCard}>
        <div className={panelStage}>
          <Image
            src={item.illustration}
            alt=""
            draggable={false}
            className={panelImage}
          />
        </div>
        <div aria-hidden className={panelGlassStroke} />
      </div>
    </div>
  );

  return (
    <section
      id="features"
      className="border-border-base scroll-mt-16 border-b py-12 md:py-20"
    >
      <SiteContainer>
        <motion.div
          initial={fadeInitial}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-15%' }}
          transition={
            reduceMotion ? { duration: 0 } : { duration: 0.6, ease: easeOut }
          }
          className="mx-auto flex max-w-[678px] flex-col items-center gap-3 text-center"
        >
          <h2 className="text-fg-base text-[32px] leading-[1.08] font-medium tracking-[-1.4px] md:text-[52px] md:leading-[1.077] md:tracking-[-2.14px]">
            {t('featureSecure.title')}
          </h2>
          <p className="text-fg-muted max-w-[528px] text-[15px] leading-[1.55] tracking-[-0.22px] md:text-lg md:leading-[1.556] md:tracking-[-0.27px]">
            {t('featureSecure.description')}
          </p>
        </motion.div>
      </SiteContainer>

      <SiteContainer>
        <motion.div
          initial={fadeInitial}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-15%' }}
          transition={
            reduceMotion
              ? { duration: 0 }
              : { delay: 0.1, duration: 0.7, ease: easeOut }
          }
          className="border-border-base mx-auto mt-8 grid max-w-[1120px] overflow-hidden border md:mt-16 lg:grid-cols-[400px_1fr]"
        >
          <ul
            role="tablist"
            aria-label={t('featureSecure.title')}
            className="border-border-base divide-border-base flex flex-col divide-y border-r-0 lg:border-r"
          >
            {items.map((item) => {
              const { key, icon: Icon, label, description } = item;
              const isActive = key === active;
              return (
                <li
                  key={key}
                  className={`relative ${isActive ? 'flex-1' : ''}`}
                >
                  <button
                    type="button"
                    role="tab"
                    id={tabId(key)}
                    aria-selected={isActive}
                    aria-controls="feature-secure-panel"
                    onClick={() => setActive(key)}
                    className={`focus-visible:ring-fg-base/60 focus-visible:ring-offset-bg-base flex w-full items-start gap-3 px-6 py-6 text-left transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none lg:py-9 ${
                      isActive
                        ? 'bg-bg-base'
                        : 'bg-bg-base hover:bg-bg-elevated cursor-pointer'
                    }`}
                  >
                    <Icon
                      className="text-fg-base h-6 w-6 shrink-0"
                      aria-hidden
                      strokeWidth={2}
                      stroke="currentColor"
                      fill="none"
                    />
                    <div className="flex-1 overflow-hidden">
                      <div
                        className="text-fg-base text-2xl font-medium"
                        style={{ letterSpacing: '-0.24px', lineHeight: 1.167 }}
                      >
                        {label}
                      </div>
                      <AnimatePresence initial={false}>
                        {isActive ? (
                          <motion.p
                            key={key}
                            initial={
                              reduceMotion
                                ? false
                                : { height: 0, opacity: 0, marginTop: 0 }
                            }
                            animate={{
                              height: 'auto',
                              opacity: 1,
                              marginTop: 12,
                            }}
                            exit={
                              reduceMotion
                                ? { height: 0, opacity: 0, marginTop: 0 }
                                : { height: 0, opacity: 0, marginTop: 0 }
                            }
                            transition={
                              reduceMotion
                                ? { duration: 0 }
                                : { duration: 0.35, ease: easeOut }
                            }
                            className="text-fg-muted overflow-hidden text-base font-medium whitespace-pre-line"
                            style={{
                              letterSpacing: '-0.24px',
                              lineHeight: 1.5,
                            }}
                          >
                            {description}
                          </motion.p>
                        ) : null}
                      </AnimatePresence>
                    </div>
                  </button>
                  {isActive ? (
                    <div className="lg:hidden">{renderPanel(item)}</div>
                  ) : null}
                </li>
              );
            })}
          </ul>

          <div id="feature-secure-panel" className="relative hidden lg:block">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={activeItem.key}
                initial={reduceMotion ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={
                  reduceMotion
                    ? { duration: 0 }
                    : { duration: 0.4, ease: easeOut }
                }
              >
                {renderPanel(activeItem)}
              </motion.div>
            </AnimatePresence>
          </div>
        </motion.div>
      </SiteContainer>
    </section>
  );
}
