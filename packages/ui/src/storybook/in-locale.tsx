import { type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Renders its children once the shared i18n instance speaks `locale`, and
 * hands the previous language back on unmount — for a story that shows a
 * control in German or French.
 */
export function InLocale({
  locale,
  children,
}: {
  locale: string;
  children: ReactNode;
}) {
  const { i18n } = useTranslation();
  const [ready, setReady] = useState(i18n.language === locale);
  useEffect(() => {
    const previous = i18n.language;
    i18n
      .changeLanguage(locale)
      .then(() => setReady(true))
      .catch((error: unknown) => {
        console.error('[stories] could not switch the language', error);
      });
    return () => {
      i18n.changeLanguage(previous).catch((error: unknown) => {
        console.error('[stories] could not restore the language', error);
      });
    };
  }, [i18n, locale]);
  return ready ? children : null;
}
