import { LocaleTabs } from '@tale/ui/locale-tabs';
import { Textarea } from '@tale/ui/textarea';
import { useState } from 'react';

const MAX_LENGTH = 280;

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  de: 'German',
  fr: 'French',
};

export default function TabsLocaleTabs() {
  const [editingLocale, setEditingLocale] = useState('en');
  const [texts, setTexts] = useState<Record<string, string>>({
    en: 'Do not paste client names or contract values into chat.',
    de: 'Füge keine Kundennamen oder Vertragswerte in den Chat ein.',
    fr: '',
  });

  return (
    <div className="w-full max-w-lg">
      <LocaleTabs
        defaultLocale="en"
        editingLocale={editingLocale}
        onEditingLocaleChange={setEditingLocale}
        hasTranslation={(locale) => (texts[locale] ?? '').trim() !== ''}
        hasError={(locale) => (texts[locale] ?? '').length > MAX_LENGTH}
        listAriaLabel="Notice languages"
        renderPanel={(locale) => (
          <Textarea
            aria-label={`Notice text (${LANGUAGE_NAMES[locale] ?? locale})`}
            placeholder={locale === 'en' ? undefined : texts.en}
            counterMax={MAX_LENGTH}
            value={texts[locale] ?? ''}
            onChange={(event) =>
              setTexts((current) => ({
                ...current,
                [locale]: event.target.value,
              }))
            }
          />
        )}
      />
    </div>
  );
}
