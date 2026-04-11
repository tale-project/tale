import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { ModelAccessEditor } from './model-access-editor';

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

vi.mock('@/app/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('../hooks/mutations', () => ({
  useUpsertGovernancePolicy: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

// Stable references prevent infinite re-render loops caused by
// useEffect depending on useMemo([policy]) — a new object each render
// would trigger setState → re-render → new object → infinite loop.
const STABLE_POLICY = {
  data: {
    config: {
      enabled: false,
      mode: 'blocklist' as const,
      rules: [],
    },
  },
  isLoading: false,
};

vi.mock('../hooks/queries', () => ({
  useGovernancePolicy: () => STABLE_POLICY,
}));

const STABLE_MEMBERS = { members: [] };
vi.mock('@/app/features/settings/organization/hooks/queries', () => ({
  useMembers: () => STABLE_MEMBERS,
}));

const STABLE_TEAMS = { teams: [] };
vi.mock('@/app/features/settings/teams/hooks/queries', () => ({
  useOrgTeams: () => STABLE_TEAMS,
}));

const STABLE_PROVIDERS = { providers: [] };
vi.mock('@/app/features/settings/providers/hooks/queries', () => ({
  useListProviders: () => STABLE_PROVIDERS,
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true, cannot: () => false }),
}));

vi.mock('@/app/components/ui/forms/switch', () => ({
  Switch: ({
    checked,
    onCheckedChange,
    label,
  }: {
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
    label?: string;
    disabled?: boolean;
  }) => (
    <label>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onCheckedChange(e.target.checked)}
        aria-label={label ?? 'Switch'}
      />
      {label && <span>{label}</span>}
    </label>
  ),
}));

vi.mock('@/app/components/ui/forms/select', () => ({
  Select: ({
    value,
    onValueChange,
    options,
    label,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    options: Array<{ value: string; label: string }>;
    label?: string;
  }) => (
    <select
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
      aria-label={label ?? 'Select'}
    >
      {options.map((opt: { value: string; label: string }) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  ),
}));

vi.mock('@/app/components/ui/dialog/form-dialog', () => ({
  FormDialog: ({ children }: { children: React.ReactNode }) => (
    <div role="dialog">{children}</div>
  ),
}));

vi.mock('@/app/components/ui/forms/searchable-select', () => ({
  SearchableSelect: ({
    value,
    onValueChange,
    options,
  }: {
    value: string | null;
    onValueChange: (value: string) => void;
    options: Array<{ value: string; label: string }>;
    [key: string]: unknown;
  }) => (
    <select
      value={value ?? ''}
      onChange={(e) => onValueChange(e.target.value)}
      aria-label="searchable-select"
    >
      {options.map((opt: { value: string; label: string }) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  ),
}));

vi.mock('@/app/components/ui/forms/checkbox-group', () => ({
  CheckboxGroup: ({
    label,
    options,
    value,
    onValueChange,
  }: {
    label: string;
    options: Array<{ value: string; label: string }>;
    value: string[];
    onValueChange: (values: string[]) => void;
    [key: string]: unknown;
  }) => (
    <fieldset>
      <legend>{label}</legend>
      {options.map((opt: { value: string; label: string }) => (
        <label key={opt.value}>
          <input
            type="checkbox"
            checked={value.includes(opt.value)}
            onChange={(e) => {
              if (e.target.checked) {
                onValueChange([...value, opt.value]);
              } else {
                onValueChange(value.filter((v) => v !== opt.value));
              }
            }}
          />
          {opt.label}
        </label>
      ))}
    </fieldset>
  ),
}));

vi.mock('@/app/components/ui/layout/page-section', () => ({
  PageSection: ({
    children,
    title,
    description,
  }: {
    children: React.ReactNode;
    title: string;
    description?: string;
  }) => (
    <section>
      <h2>{title}</h2>
      {description && <p>{description}</p>}
      {children}
    </section>
  ),
}));

vi.mock('@/app/components/ui/primitives/button', () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock('@/app/components/ui/typography/text', () => ({
  Text: ({ children, ...props }: React.HTMLAttributes<HTMLSpanElement>) => (
    <span {...props}>{children}</span>
  ),
}));

describe('ModelAccessEditor', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <ModelAccessEditor organizationId="org-1" />,
      );
      await checkAccessibility(container);
    });
  });
});
