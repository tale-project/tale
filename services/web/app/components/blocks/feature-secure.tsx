import { cva } from 'class-variance-authority';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  CircleCheck,
  Inbox,
  MessageSquareMore,
  Network,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';

import { SiteContainer } from '@/app/components/layout/site-container';
import { useT } from '@/lib/i18n/client';

const easeOut = [0.22, 1, 0.36, 1] as const;

type RailKey = 'chat' | 'conversations' | 'automations' | 'approvals';

interface RailItem {
  key: RailKey;
  icon: LucideIcon;
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

// Per-tab card position. The product mockup peeks out of the panel: top edge
// inset, the right/left/bottom that sits "off-canvas" uses negative offsets so
// the rounded corners on those sides simply get clipped by the panel.
const panelCard = cva(
  'absolute overflow-hidden bg-white shadow-[0_24px_64px_-16px_rgba(0,0,0,0.55)]',
  {
    variants: {
      tab: {
        // chat: peeks out to the right + bottom, top-left rounded.
        chat: 'top-[8%] left-[7%] -right-[18%] -bottom-[20%] rounded-tl-2xl border-t border-l border-white/30',
        // conversations: same anchor as chat (top-left in the panel).
        conversations:
          'top-[8%] left-[7%] -right-[18%] -bottom-[20%] rounded-tl-2xl border-t border-l border-white/30',
        // automations: centered horizontally, both top corners rounded.
        automations:
          'top-[8%] right-[7%] left-[7%] -bottom-[20%] rounded-t-2xl border-t border-x border-white/30',
        // approvals: peeks out to the left + bottom, top-right rounded.
        approvals:
          'top-[8%] -left-[18%] right-[7%] -bottom-[20%] rounded-tr-2xl border-t border-r border-white/30',
      },
    },
  },
);

// Image anchor matches the card's "anchored" (non-clipped) corner so the
// important content stays in view while the opposite side gets clipped by
// the panel's overflow.
const panelImage = cva('block h-full w-full object-cover', {
  variants: {
    tab: {
      chat: 'object-left-top',
      conversations: 'object-left-top',
      automations: 'object-top',
      approvals: 'object-right-top',
    },
  },
});

export function FeatureSecure() {
  const { t } = useT('home');
  const reduceMotion = useReducedMotion();
  const fadeInitial = reduceMotion ? false : { opacity: 0, y: 24 };
  const [active, setActive] = useState<RailKey>('chat');

  const items: RailItem[] = [
    {
      key: 'chat',
      icon: MessageSquareMore,
      label: t('featureSecure.chat.label'),
      description: t('featureSecure.chat.description'),
      illustration: '/marketing/feature-secure-chat.png',
    },
    {
      key: 'conversations',
      icon: Inbox,
      label: t('featureSecure.conversations.label'),
      description: t('featureSecure.conversations.description'),
      illustration: '/marketing/feature-secure-conversations.png',
    },
    {
      key: 'automations',
      icon: Network,
      label: t('featureSecure.automations.label'),
      description: t('featureSecure.automations.description'),
      illustration: '/marketing/feature-secure-automations.png',
    },
    {
      key: 'approvals',
      icon: CircleCheck,
      label: t('featureSecure.approvals.label'),
      description: t('featureSecure.approvals.description'),
      illustration: '/marketing/feature-secure-approvals.png',
    },
  ];

  const activeItem = items.find((item) => item.key === active) ?? items[0];

  const renderPanel = (item: RailItem) => (
    <div
      role="tabpanel"
      className="relative aspect-[671/559] w-full overflow-hidden"
    >
      <div aria-hidden className={panelGradient({ tab: item.key })} />
      <div className={panelCard({ tab: item.key })}>
        <img
          src={item.illustration}
          alt=""
          aria-hidden
          draggable={false}
          loading="lazy"
          className={panelImage({ tab: item.key })}
        />
      </div>
    </div>
  );

  return (
    <section
      id="features"
      className="border-border-base scroll-mt-16 border-b py-20"
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
          <h2
            className="text-fg-base text-3xl font-medium md:text-[52px]"
            style={{ letterSpacing: '-2.14px', lineHeight: 1.077 }}
          >
            {t('featureSecure.title')}
          </h2>
          <p
            className="text-fg-muted max-w-[528px] text-base md:text-lg"
            style={{ letterSpacing: '-0.27px', lineHeight: 1.556 }}
          >
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
          className="border-border-base mx-auto mt-16 grid max-w-[1120px] overflow-hidden border lg:grid-cols-[400px_1fr]"
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
                  <motion.span
                    aria-hidden
                    className="bg-fg-base absolute top-0 bottom-0 left-0 w-px origin-top"
                    initial={false}
                    animate={{ scaleY: isActive ? 1 : 0 }}
                    transition={
                      reduceMotion
                        ? { duration: 0 }
                        : { duration: 0.4, ease: easeOut }
                    }
                  />
                  <button
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    aria-controls="feature-secure-panel"
                    onClick={() => setActive(key)}
                    className={`flex w-full items-start gap-3 px-6 py-9 text-left transition-colors ${
                      isActive
                        ? 'bg-bg-base'
                        : 'bg-bg-base hover:bg-bg-elevated cursor-pointer'
                    }`}
                  >
                    <Icon
                      className="text-fg-base mt-1 h-6 w-6 shrink-0"
                      aria-hidden
                      strokeWidth={1.75}
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
                            className="text-fg-muted overflow-hidden text-base whitespace-pre-line"
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
