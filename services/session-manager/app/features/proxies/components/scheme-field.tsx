import { Description } from '@tale/ui/description';
import { SegmentedControl } from '@tale/ui/segmented-control';

import { schemeSchema, SCHEMES, type Scheme } from '@/lib/api/schemas';
import { useT } from '@/lib/i18n/client';

// Protocol names read the same in every language.
const OPTIONS = SCHEMES.map((scheme) => ({
  value: scheme,
  label: scheme.toUpperCase(),
}));

export interface SchemeFieldProps {
  value: Scheme;
  onChange: (scheme: Scheme) => void;
  disabled?: boolean;
}

/** The type a proxy gets when what was typed or pasted does not say its own. */
export function SchemeField({ value, onChange, disabled }: SchemeFieldProps) {
  const { t } = useT('proxies');
  return (
    <div className="flex flex-col gap-1.5">
      <SegmentedControl
        label={t('scheme.label')}
        value={value}
        onValueChange={(next) => {
          const scheme = schemeSchema.safeParse(next);
          if (scheme.success) onChange(scheme.data);
        }}
        options={OPTIONS}
        disabled={disabled}
      />
      <Description>{t('scheme.hint')}</Description>
    </div>
  );
}
