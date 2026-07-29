// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen, waitFor } from '@/tests/utils/render';

vi.mock('@/lib/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string) => `${ns}.${key}`,
  }),
}));

vi.mock('@/app/features/projects/hooks/queries', () => ({
  useProjects: () => ({ projects: [] }),
}));

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org_1',
}));

const toast = vi.fn();
vi.mock('@/app/hooks/use-toast', () => ({
  toast: (args: unknown) => toast(args),
}));

const invalidateQueries = vi.fn();
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries }),
}));

const uploadAction = vi.fn();
const generateUploadUrl = vi.fn().mockResolvedValue('https://upload.test/put');
const recordIntent = vi.fn().mockResolvedValue(null);
vi.mock('convex/react', () => ({
  useAction: () => uploadAction,
  useMutation: (ref: unknown) =>
    ref === 'automations/upload_mutations:generateAutomationUploadUrl'
      ? generateUploadUrl
      : recordIntent,
}));

// The generated api proxies are plain objects here; the useMutation mock keys
// off the reference identity strings below.
vi.mock('@/convex/_generated/api', () => ({
  api: {
    automations: {
      upload_action: { uploadAutomation: 'automations/upload_action' },
      upload_mutations: {
        generateAutomationUploadUrl:
          'automations/upload_mutations:generateAutomationUploadUrl',
        recordAutomationUploadIntent:
          'automations/upload_mutations:recordAutomationUploadIntent',
      },
    },
  },
}));

import { UploadAutomationDialog } from './upload-automation-dialog';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ storageId: 'storage_1' }),
  });
  uploadAction.mockReset();
  toast.mockReset();
  invalidateQueries.mockReset();
  generateUploadUrl.mockClear();
  recordIntent.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The dialog is controlled — its trigger lives in the list's create menu. */
async function openDialogWith(files: File[]) {
  const utils = render(
    <UploadAutomationDialog
      organizationId="org_1"
      open
      onOpenChange={() => {}}
    />,
  );
  const input = screen.getByLabelText('automations.upload.filesLabel', {
    selector: 'input',
  });
  await utils.user.upload(input, files);
  return utils;
}

describe('UploadAutomationDialog', () => {
  it('sends text files through the text lane', async () => {
    uploadAction.mockResolvedValue({
      ok: true,
      name: 'demo',
      version: 1,
      warnings: [],
      skills: [],
    });
    const { user } = await openDialogWith([
      new File(['name: demo\nnodes: []\n'], 'workflow.yml', {
        type: 'text/yaml',
      }),
    ]);
    await user.click(
      screen.getByRole('button', { name: 'automations.upload.submit' }),
    );
    await waitFor(() => {
      expect(uploadAction).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: 'org_1',
          files: [{ name: 'workflow.yml', content: 'name: demo\nnodes: []\n' }],
        }),
      );
    });
    expect(
      fetchMock.mock.calls.filter(([url]) => url === 'https://upload.test/put'),
    ).toHaveLength(0);
  });

  it('refuses a zip mixed with other files', async () => {
    const { user } = await openDialogWith([
      new File(['zip'], 'pack.zip', { type: 'application/zip' }),
      new File(['doc'], 'workflow.yml', { type: 'text/yaml' }),
    ]);
    expect(
      screen.getAllByText('automations.upload.zipOnly').length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByRole('button', { name: 'automations.upload.submit' }),
    ).toBeDisabled();
    expect(uploadAction).not.toHaveBeenCalled();
    expect(user).toBeDefined();
  });

  it('drives the zip lane: presign, POST, intent, action', async () => {
    uploadAction.mockResolvedValue({
      ok: true,
      name: 'demo',
      version: 2,
      warnings: [],
      skills: [{ slug: 'triage', action: 'created' }],
    });
    const { user } = await openDialogWith([
      new File(['zipbytes'], 'pack.zip', { type: 'application/zip' }),
    ]);
    await user.click(
      screen.getByRole('button', { name: 'automations.upload.submit' }),
    );
    await waitFor(() => {
      expect(uploadAction).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: 'org_1',
          storageId: 'storage_1',
        }),
      );
    });
    expect(generateUploadUrl).toHaveBeenCalledWith({
      organizationId: 'org_1',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://upload.test/put',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(recordIntent).toHaveBeenCalledWith({
      organizationId: 'org_1',
      storageId: 'storage_1',
    });
    // The carried skill invalidates the skills queries.
    expect(invalidateQueries).toHaveBeenCalled();
  });

  it('shows the conflict panel and re-runs the flow with the allowlist', async () => {
    uploadAction
      .mockResolvedValueOnce({
        ok: false,
        status: 'needs_confirm',
        skillConflicts: ['triage'],
      })
      .mockResolvedValueOnce({
        ok: true,
        name: 'demo',
        version: 3,
        warnings: [],
        skills: [{ slug: 'triage', action: 'replaced' }],
      });
    const { user } = await openDialogWith([
      new File(['zipbytes'], 'pack.zip', { type: 'application/zip' }),
    ]);
    await user.click(
      screen.getByRole('button', { name: 'automations.upload.submit' }),
    );
    const confirm = await screen.findByTestId('confirm-skill-overwrite');
    expect(screen.getByText('triage')).toBeVisible();

    await user.click(confirm);
    await waitFor(() => {
      expect(uploadAction).toHaveBeenLastCalledWith(
        expect.objectContaining({ overwriteSkills: ['triage'] }),
      );
    });
    // The confirm round-trip re-uploads the zip (the blob is single-use).
    // Count only the presigned-URL POSTs — the app shell's i18n loader may
    // fetch catalogs through the same stubbed global.
    const uploadPosts = fetchMock.mock.calls.filter(
      ([url]) => url === 'https://upload.test/put',
    );
    expect(uploadPosts).toHaveLength(2);
  });
});
