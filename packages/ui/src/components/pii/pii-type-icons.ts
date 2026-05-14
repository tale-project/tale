/**
 * Lucide icon mapping for PII pattern names.
 *
 * Highlighted spans render a small icon alongside the value so the type
 * is identifiable without hovering for the tooltip. The mapping covers
 * every built-in pattern shipped by `@tale/pii` plus a fallback for
 * locale-specific national-id specs and any future detector that lands
 * before its icon does.
 */

import {
  Calendar,
  CreditCard,
  Globe,
  IdCard,
  Landmark,
  Lock,
  type LucideIcon,
  Mail,
  MapPin,
  Phone,
  ShieldCheck,
} from 'lucide-react';

const PATTERN_ICONS: Record<string, LucideIcon> = {
  email: Mail,
  phone: Phone,
  creditCard: CreditCard,
  cvc: ShieldCheck,
  iban: Landmark,
  ipAddress: Globe,
  ssn: IdCard,
  dateOfBirth: Calendar,
  address: MapPin,
  nationalId: IdCard,
};

/**
 * Resolve an icon for a pattern name. National-id specs ship with stable
 * `<country>-<scheme>` ids — we route the whole family to `IdCard` so the
 * highlight looks consistent across locales. Unknown patterns get a
 * generic `Lock`.
 */
export function piiTypeIcon(patternName: string): LucideIcon {
  const direct = PATTERN_ICONS[patternName];
  if (direct) return direct;
  if (patternName.includes('-passport')) return IdCard;
  if (patternName.includes('id') || patternName.includes('-')) return IdCard;
  return Lock;
}
