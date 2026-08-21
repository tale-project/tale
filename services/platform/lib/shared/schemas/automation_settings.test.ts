import { describe, expect, test } from 'vitest';

import {
  automationSettingsSchema,
  isFieldsForm,
  isUploadsForm,
  parseAutomationSettings,
  resolveSettingsFolder,
  settingsFormSatisfied,
} from './automation_settings';

const fxForm = {
  file: 'validation-policy.yaml',
  title: 'Validation policy',
  fields: [
    {
      key: 'method',
      label: 'Validation profile',
      type: 'select',
      required: true,
      default: 'strict_rules',
      options: [
        { value: 'strict_rules', label: 'Strict checklist (standard)' },
        { value: 'custom_rules', label: 'Custom checklist' },
      ],
    },
  ],
} as const;

const identityForm = {
  file: 'identity.yaml',
  title: 'Client identity',
  required: true,
  fields: [
    {
      key: 'organisation_name',
      label: 'Legal name',
      type: 'text',
      required: true,
    },
    {
      key: 'case_id',
      label: 'Case ID',
      type: 'text',
      required: true,
      pattern: String.raw`^CASE-\d{6}$`,
    },
  ],
} as const;

describe('automationSettingsSchema', () => {
  test('accepts a full declaration with i18n channels', () => {
    const parsed = automationSettingsSchema.safeParse({
      folder: 'Setup',
      forms: [
        {
          ...identityForm,
          i18n: { de: { title: 'Fallprofil' } },
          fields: [
            {
              ...identityForm.fields[0],
              i18n: { de: { label: 'Rechtlicher Name' } },
            },
            identityForm.fields[1],
          ],
        },
        {
          ...fxForm,
          fields: [
            {
              ...fxForm.fields[0],
              options: [
                {
                  value: 'strict_rules',
                  label: 'Strict checklist (standard)',
                  i18n: {
                    fr: { label: 'Liste de contrôle stricte (standard)' },
                  },
                },
              ],
              default: 'strict_rules',
            },
          ],
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  test.each([
    ['select without options', { ...fxForm.fields[0], options: undefined }],
    [
      'options on a non-select',
      {
        key: 'x',
        label: 'X',
        type: 'text',
        options: [{ value: 'a', label: 'A' }],
      },
    ],
    [
      'select default outside options',
      { ...fxForm.fields[0], default: 'nope' },
    ],
    [
      'pattern on a non-text field',
      { key: 'x', label: 'X', type: 'number', pattern: '^1$' },
    ],
    [
      'invalid regex pattern',
      { key: 'x', label: 'X', type: 'text', pattern: '([' },
    ],
    [
      'boolean default that is not true/false',
      { key: 'x', label: 'X', type: 'boolean', default: 'yes' },
    ],
    [
      'non-numeric number default',
      { key: 'x', label: 'X', type: 'number', default: 'many' },
    ],
    [
      'key that would not survive the YAML serializer',
      { key: 'not-a-key', label: 'X', type: 'text' },
    ],
  ])('refuses %s', (_name, field) => {
    const parsed = automationSettingsSchema.safeParse({
      forms: [{ file: 'a.yaml', title: 'A', fields: [field] }],
    });
    expect(parsed.success).toBe(false);
  });

  test('refuses duplicate field keys and duplicate files', () => {
    expect(
      automationSettingsSchema.safeParse({
        forms: [
          {
            file: 'a.yaml',
            title: 'A',
            fields: [
              { key: 'x', label: 'X', type: 'text' },
              { key: 'x', label: 'X again', type: 'text' },
            ],
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      automationSettingsSchema.safeParse({
        forms: [
          {
            file: 'a.yaml',
            title: 'A',
            fields: [{ key: 'x', label: 'X', type: 'text' }],
          },
          {
            file: 'a.yaml',
            title: 'B',
            fields: [{ key: 'y', label: 'Y', type: 'text' }],
          },
        ],
      }).success,
    ).toBe(false);
  });

  test('refuses a file name with path separators', () => {
    expect(
      automationSettingsSchema.safeParse({
        forms: [
          {
            file: '../escape.yaml',
            title: 'A',
            fields: [{ key: 'x', label: 'X', type: 'text' }],
          },
        ],
      }).success,
    ).toBe(false);
  });
});

describe('parseAutomationSettings', () => {
  test('reads a valid declaration and nulls a malformed one', () => {
    expect(parseAutomationSettings({ forms: [fxForm] })).not.toBeNull();
    expect(parseAutomationSettings({ forms: [] })).toBeNull();
    expect(parseAutomationSettings('nonsense')).toBeNull();
    expect(parseAutomationSettings(undefined)).toBeNull();
  });
});

describe('resolveSettingsFolder', () => {
  const parsed = parseAutomationSettings({ forms: [fxForm] });
  if (parsed === null) throw new Error('fixture did not parse');
  const settings = parsed;

  test('declaration wins, then the contract setup folder, then the default', () => {
    expect(
      resolveSettingsFolder(
        { ...settings, folder: 'Config' },
        {
          input: { kind: 'folder', setupFolderName: 'Setup' },
        },
      ),
    ).toBe('Config');
    expect(
      resolveSettingsFolder(settings, {
        input: { kind: 'folder', setupFolderName: 'Klienten-Setup' },
      }),
    ).toBe('Klienten-Setup');
    expect(resolveSettingsFolder(settings, null)).toBe('Setup');
  });
});

describe('settingsFormSatisfied', () => {
  test('every required key must be present and non-blank', () => {
    const form = parseAutomationSettings({ forms: [identityForm] })?.forms[0];
    if (form === undefined || !isFieldsForm(form)) {
      throw new Error('fixture did not parse');
    }
    expect(settingsFormSatisfied(form, {})).toBe(false);
    expect(
      settingsFormSatisfied(form, {
        organisation_name: 'Acme Corp',
      }),
    ).toBe(false);
    expect(
      settingsFormSatisfied(form, {
        organisation_name: 'Acme Corp',
        case_id: '   ',
      }),
    ).toBe(false);
    expect(
      settingsFormSatisfied(form, {
        organisation_name: 'Acme Corp',
        case_id: 'CASE-123456',
      }),
    ).toBe(true);
  });

  test('a form with no required fields is always satisfied', () => {
    const form = parseAutomationSettings({
      forms: [
        {
          file: 'client-policy.yaml',
          title: 'Import documents',
          fields: [{ key: 'zaz_client', label: 'ZAZ client', type: 'boolean' }],
        },
      ],
    })?.forms[0];
    if (form === undefined || !isFieldsForm(form)) {
      throw new Error('fixture did not parse');
    }
    expect(settingsFormSatisfied(form, {})).toBe(true);
  });
});

describe('uploads forms', () => {
  const uploadsForm = {
    kind: 'uploads',
    title: 'Filed returns',
    description: 'Drop the submitted return PDFs here.',
    accept: ['.pdf', '.json'],
    match: '^history-.*\\.json$|\\.pdf$',
  } as const;

  test('an uploads panel parses beside field forms and skips the file-dedupe', () => {
    const settings = parseAutomationSettings({
      forms: [fxForm, uploadsForm, { ...uploadsForm, title: 'More uploads' }],
    });
    if (settings === null) throw new Error('fixture did not parse');
    const [fields, uploads] = settings.forms;
    if (fields === undefined || uploads === undefined) {
      throw new Error('forms missing');
    }
    expect(isFieldsForm(fields)).toBe(true);
    expect(isUploadsForm(uploads)).toBe(true);
    expect(isUploadsForm(uploads) && uploads.accept).toEqual(['.pdf', '.json']);
  });

  test('a broken match regex is refused at the declaration door', () => {
    expect(
      automationSettingsSchema.safeParse({
        forms: [{ ...uploadsForm, match: '([' }],
      }).success,
    ).toBe(false);
  });

  test('accept entries must be dotted extensions', () => {
    expect(
      automationSettingsSchema.safeParse({
        forms: [{ ...uploadsForm, accept: ['pdf'] }],
      }).success,
    ).toBe(false);
  });

  test('field forms still dedupe on their file', () => {
    expect(
      automationSettingsSchema.safeParse({
        forms: [fxForm, fxForm, uploadsForm],
      }).success,
    ).toBe(false);
  });
});
