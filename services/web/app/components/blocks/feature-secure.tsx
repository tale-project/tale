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

type RailKey = 'chat' | 'conversations' | 'workflows' | 'approvals';

interface RailItem {
  key: RailKey;
  icon: LucideIcon;
  label: string;
  description: string;
  illustration: string;
}

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
      key: 'workflows',
      icon: Network,
      label: t('featureSecure.workflows.label'),
      description: t('featureSecure.workflows.description'),
      illustration: '/marketing/feature-secure-workflows.png',
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
          className="border-border-base mx-auto mt-16 grid max-w-[1120px] overflow-hidden border md:grid-cols-[400px_1fr]"
        >
          <ul
            role="tablist"
            aria-label={t('featureSecure.title')}
            className="border-border-base divide-border-base flex flex-col divide-y border-r-0 md:border-r"
          >
            {items.map(({ key, icon: Icon, label, description }) => {
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
                </li>
              );
            })}
          </ul>

          <div
            id="feature-secure-panel"
            role="tabpanel"
            className="bg-bg-elevated relative aspect-[671/559] w-full overflow-hidden"
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.img
                key={activeItem.key}
                src={activeItem.illustration}
                alt=""
                aria-hidden
                draggable={false}
                initial={reduceMotion ? false : { opacity: 0, scale: 1.02 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={
                  reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.98 }
                }
                transition={
                  reduceMotion
                    ? { duration: 0 }
                    : { duration: 0.4, ease: easeOut }
                }
                className="absolute inset-0 h-full w-full object-cover"
              />
            </AnimatePresence>
          </div>
        </motion.div>
      </SiteContainer>
    </section>
  );
}
