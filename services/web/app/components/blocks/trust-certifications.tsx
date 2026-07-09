import { ShieldCheck } from 'lucide-react';

import {
  CERTIFICATION_KEYS,
  type CertificationKey,
} from '@/app/content/certifications';
import { useT } from '@/lib/i18n/client';

type TrustCertificationsVariant = 'line' | 'badges';

interface TrustCertificationsProps {
  variant: TrustCertificationsVariant;
  className?: string;
}

/**
 * Homepage trust chips — hero inline line and compliance badge row share
 * `CERTIFICATION_KEYS` so the claim set cannot drift.
 */
export function TrustCertifications({
  variant,
  className,
}: TrustCertificationsProps) {
  const { t } = useT('complianceTrust');
  const labels = CERTIFICATION_KEYS.map((key: CertificationKey) =>
    t(`certifications.${key}`),
  );

  if (variant === 'line') {
    return (
      <p className={className ?? 'text-fg-subtle text-xs tracking-[0.02em]'}>
        {labels.join(' · ')}
      </p>
    );
  }

  return (
    <div className={className ?? 'mt-2 flex flex-wrap items-center gap-2'}>
      {labels.map((label) => (
        <span
          key={label}
          className="border-border-base bg-surface-site-inset text-fg-muted inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium"
        >
          <ShieldCheck
            aria-hidden
            className="text-fg-subtle size-3.5"
            strokeWidth={1.75}
          />
          {label}
        </span>
      ))}
    </div>
  );
}
