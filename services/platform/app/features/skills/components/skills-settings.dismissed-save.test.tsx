/**
 * A skill saved from a dialog the member dismissed while it was saving still
 * lands — the library refreshes and the success toast says so — but it no
 * longer opens: by then the member may be writing the next draft or reading
 * another skill, and a late landing must not replace that dialog (#3659).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { act, render, screen, within } from '@/tests/utils/render';

import { SkillsSettings } from './skills-settings';

const { saveSkill, toast, upload } = vi.hoisted(() => ({
  saveSkill: vi.fn(),
  toast: vi.fn(() => ({ id: 'toast', dismiss: () => {}, update: () => {} })),
  upload: { onUploaded: undefined as ((slug: string) => void) | undefined },
}));

vi.mock('../hooks/queries', () => ({
  useSkills: () => ({
    data: {
      skills: [
        {
          slug: 'house-voice',
          description: 'How we write',
          visibility: 'org',
          origin: 'member',
          owner: 'user-ada',
          ownerName: 'Ada Lovelace',
          canEdit: true,
        },
      ],
      failures: [],
    },
    isPending: false,
  }),
  useSkillPublishing: () => ({ mode: 'everyone', allowed: true }),
}));
vi.mock('../hooks/mutations', () => ({
  useSaveSkill: () => ({ mutateAsync: saveSkill, isPending: false }),
}));
vi.mock('@/app/features/settings/teams/hooks/queries', () => ({
  useOrgTeams: () => ({ teams: [], isLoading: false }),
  useTeamDirectory: () => ({ teams: [], isLoading: false }),
}));
vi.mock('@tale/ui/error-boundaries/error-scope', () => ({
  useErrorScope: () => ({ organizationId: 'org1' }),
}));
vi.mock('@tale/ui/use-toast', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tale/ui/use-toast')>()),
  toast,
}));
// The editor and the upload flow have suites of their own: here they only say
// which skill is open, and the upload hands back the callback its landing
// calls, as the real pane's submit holds it from the render that started it.
vi.mock('./skill-pane-dialog', () => ({
  SkillDetailDialog: ({ slug }: { slug: string }) => (
    <div role="dialog" aria-label={`Skill ${slug}`} />
  ),
}));
vi.mock('./skill-upload-dialog', () => ({
  SkillUploadDialog: ({
    onUploaded,
    onClose,
  }: {
    onUploaded: (slug: string) => void;
    onClose: () => void;
  }) => {
    upload.onUploaded = onUploaded;
    return (
      <div role="dialog" aria-label="Upload skill">
        <button type="button" onClick={onClose}>
          Close upload
        </button>
      </div>
    );
  },
}));

type User = ReturnType<typeof render>['user'];

function deferred() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function openFromAddMenu(user: User, item: string) {
  await user.click(screen.getByRole('button', { name: 'Add skill' }));
  await user.click(await screen.findByRole('menuitem', { name: item }));
}

async function openBlankSkill(user: User) {
  await openFromAddMenu(user, 'Blank skill');
  return screen.findByRole('dialog', { name: 'Create skill' });
}

async function writeDraft(
  user: User,
  dialog: HTMLElement,
  name: string,
  description: string,
) {
  await user.type(within(dialog).getByLabelText('Name'), name);
  await user.type(within(dialog).getByLabelText('Description'), description);
}

async function submitAndCancel(user: User, dialog: HTMLElement) {
  await user.click(within(dialog).getByRole('button', { name: 'Create' }));
  expect(saveSkill).toHaveBeenCalledWith(
    expect.objectContaining({ slug: 'audit-new' }),
  );
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(
    screen.queryByRole('dialog', { name: 'Create skill' }),
  ).not.toBeInTheDocument();
}

beforeEach(() => {
  saveSkill.mockReset();
  toast.mockClear();
  upload.onUploaded = undefined;
});

describe('SkillsSettings — a save that lands after its dialog closed', () => {
  it('keeps the next draft open when a dismissed create lands', async () => {
    const save = deferred();
    saveSkill.mockReturnValueOnce(save.promise);
    const { user } = render(<SkillsSettings organizationId="org1" />);

    const first = await openBlankSkill(user);
    await writeDraft(user, first, 'audit-new', 'First draft.');
    await submitAndCancel(user, first);

    const next = await openBlankSkill(user);
    await writeDraft(
      user,
      next,
      'second-unsaved-draft',
      'Keep this later draft.',
    );
    await act(async () => save.resolve());

    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Skill created', variant: 'success' }),
    );
    expect(
      screen.queryByRole('dialog', { name: 'Skill audit-new' }),
    ).not.toBeInTheDocument();
    const draft = screen.getByRole('dialog', { name: 'Create skill' });
    expect(within(draft).getByLabelText('Name')).toHaveValue(
      'second-unsaved-draft',
    );
    expect(within(draft).getByLabelText('Description')).toHaveValue(
      'Keep this later draft.',
    );
    expect(saveSkill).toHaveBeenCalledTimes(1);
  });

  it('opens nothing when a dismissed create lands with no dialog open', async () => {
    const save = deferred();
    saveSkill.mockReturnValueOnce(save.promise);
    const { user } = render(<SkillsSettings organizationId="org1" />);

    const first = await openBlankSkill(user);
    await writeDraft(user, first, 'audit-new', 'First draft.');
    await submitAndCancel(user, first);
    await act(async () => save.resolve());

    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Skill created', variant: 'success' }),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes an unsent draft without saving, and reopens it empty', async () => {
    const { user } = render(<SkillsSettings organizationId="org1" />);

    const first = await openBlankSkill(user);
    await writeDraft(user, first, 'audit-new', 'Never sent.');
    await user.click(within(first).getByRole('button', { name: 'Cancel' }));

    expect(
      screen.queryByRole('dialog', { name: 'Create skill' }),
    ).not.toBeInTheDocument();
    expect(saveSkill).not.toHaveBeenCalled();
    const again = await openBlankSkill(user);
    expect(within(again).getByLabelText('Name')).toHaveValue('');
    expect(within(again).getByLabelText('Description')).toHaveValue('');
  });

  it('opens the created skill when its create lands with the dialog still open', async () => {
    const save = deferred();
    saveSkill.mockReturnValueOnce(save.promise);
    const { user } = render(<SkillsSettings organizationId="org1" />);

    const dialog = await openBlankSkill(user);
    await writeDraft(user, dialog, 'audit-new', 'First draft.');
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));
    await act(async () => save.resolve());

    expect(
      await screen.findByRole('dialog', { name: 'Skill audit-new' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('dialog', { name: 'Create skill' }),
    ).not.toBeInTheDocument();
  });

  it('keeps another skill open when a dismissed upload lands', async () => {
    const { user } = render(<SkillsSettings organizationId="org1" />);

    await openFromAddMenu(user, 'Upload zip');
    const landDismissed = upload.onUploaded;
    await user.click(screen.getByRole('button', { name: 'Close upload' }));
    await user.click(screen.getByRole('button', { name: 'house-voice' }));
    expect(
      screen.getByRole('dialog', { name: 'Skill house-voice' }),
    ).toBeInTheDocument();

    act(() => landDismissed?.('bundle-skill'));

    expect(landDismissed).toBeDefined();
    expect(
      screen.getByRole('dialog', { name: 'Skill house-voice' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('dialog', { name: 'Skill bundle-skill' }),
    ).not.toBeInTheDocument();
  });

  it('opens the uploaded skill when its upload lands with the dialog still open', async () => {
    const { user } = render(<SkillsSettings organizationId="org1" />);

    await openFromAddMenu(user, 'Upload zip');
    act(() => upload.onUploaded?.('bundle-skill'));

    expect(
      screen.getByRole('dialog', { name: 'Skill bundle-skill' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('dialog', { name: 'Upload skill' }),
    ).not.toBeInTheDocument();
  });
});
