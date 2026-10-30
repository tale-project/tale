/**
 * The upload preview asks whom the skill is for, starting on what the bundle
 * declares — an unmarked one reads as the organization — and the upload
 * carries the pick, which the server writes into the stored SKILL.md. When
 * the organization reserves sharing with everyone and the viewer may not
 * publish, Organization is withheld with the reason and the viewer's own
 * teams are preselected instead, so a member uploads a bundle for their team
 * without editing team IDs into it. A member in no team is told where to
 * turn, and nothing is sent.
 */

import type { SkillFrontmatter } from '@tale/shared/schemas/skills';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { backendErrorFromResponse } from '@/app/lib/backend/adapters';
import { AppError } from '@/lib/shared/errors/app-error';
import { render, screen } from '@/tests/utils/render';

import type { ParsedSkillBundle } from './utils/parse-skill-bundle';

const { useSkillPublishing, useOrgTeams, upload, bundle, toast } = vi.hoisted(
  () => ({
    useSkillPublishing: vi.fn(),
    useOrgTeams: vi.fn(),
    upload: vi.fn(),
    bundle: { current: null as ParsedSkillBundle | null },
    toast: vi.fn(),
  }),
);

vi.mock('@tale/ui/use-toast', () => ({ toast }));

vi.mock('../../hooks/queries', () => ({ useSkillPublishing }));
vi.mock('@/app/features/settings/teams/hooks/queries', () => ({ useOrgTeams }));
vi.mock('./hooks/use-skill-bundle-upload', () => ({
  useSkillBundleUpload: () => ({ upload, isMountedRef: { current: true } }),
}));
vi.mock('./hooks/use-upload-skill', () => ({
  useUploadSkill: () => ({
    step: 'preview',
    parsedBundle: bundle.current,
    isSubmitting: false,
    setParsedBundle: vi.fn(),
    setIsSubmitting: vi.fn(),
    goBack: vi.fn(),
    reset: vi.fn(),
  }),
}));

import { SkillUploadPane } from './skill-upload-pane';

function parsed(
  sharing: Pick<SkillFrontmatter, 'visibility' | 'teams'>,
): ParsedSkillBundle {
  return {
    zipFile: new File(['zip'], 'house-voice.zip'),
    slug: 'house-voice',
    meta: {
      name: 'house-voice',
      description: 'How we write.',
      extra: {},
      ...sharing,
    },
    assets: [
      { relPath: 'references/tone.md', size: 120 },
      { relPath: 'examples/newsletter.md', size: 340 },
    ],
    totalBytes: 463,
  };
}

function mountPane() {
  return render(
    <SkillUploadPane
      organizationId="org_1"
      mode="folder"
      onUploaded={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
}

const RESERVED_FOR_EDITORS =
  'Only Editors and above, and members an admin allowed, can share a skill with everyone.';
const NO_TEAMS =
  "You aren't in a team, and your organization reserves sharing with everyone. Ask an admin to add you to a team or to let you publish skills.";
const RED = { id: 'team-red', name: 'Red' };
const BLUE = { id: 'team-blue', name: 'Blue' };

const submitButton = () =>
  screen.getByRole('button', { name: 'Upload bundle' });

beforeEach(() => {
  toast.mockClear();
  upload.mockReset();
  upload.mockResolvedValue({ status: 'landed', slug: 'house-voice' });
  useOrgTeams.mockReturnValue({ teams: [RED], isLoading: false });
});

describe('SkillUploadPane', () => {
  it('preselects the member’s own teams for an organization-wide bundle they may not publish, and uploads it for them', async () => {
    useSkillPublishing.mockReturnValue({ mode: 'editors', allowed: false });
    useOrgTeams.mockReturnValue({ teams: [RED, BLUE], isLoading: false });
    bundle.current = parsed({ visibility: 'org' });
    const { user } = mountPane();

    expect(
      screen.getByRole('group', { name: 'Visibility' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Teams/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Organization/ })).toBeDisabled();
    expect(screen.getByText(RESERVED_FOR_EDITORS)).toBeInTheDocument();
    await user.click(submitButton());

    expect(upload).toHaveBeenCalledExactlyOnceWith(
      bundle.current.zipFile,
      false,
      { visibility: 'team', teams: ['team-red', 'team-blue'] },
    );
  });

  it('disables Upload once the member clears every team, and sends nothing', async () => {
    useSkillPublishing.mockReturnValue({ mode: 'admins', allowed: false });
    bundle.current = parsed({ visibility: 'org' });
    const { user } = mountPane();

    expect(submitButton()).toBeEnabled();
    await user.click(
      screen.getByRole('combobox', { name: /Shared with teams/ }),
    );
    await user.click(await screen.findByRole('option', { name: /Red/ }));
    await user.keyboard('{Escape}');

    expect(
      screen.getByText('Pick at least one team, or choose another visibility.'),
    ).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
    await user.click(submitButton());
    expect(upload).not.toHaveBeenCalled();
  });

  it('keeps Upload disabled while the member’s teams load, without calling them missing', () => {
    useSkillPublishing.mockReturnValue({ mode: 'admins', allowed: false });
    useOrgTeams.mockReturnValue({ teams: undefined, isLoading: true });
    bundle.current = parsed({ visibility: 'org' });
    mountPane();

    expect(screen.queryByText(NO_TEAMS)).not.toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
  });

  it('tells a member in no team where to turn, and sends nothing', async () => {
    useSkillPublishing.mockReturnValue({ mode: 'admins', allowed: false });
    useOrgTeams.mockReturnValue({ teams: [], isLoading: false });
    bundle.current = parsed({ visibility: 'org' });
    const { user } = mountPane();

    expect(screen.getByText(NO_TEAMS)).toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
    await user.click(submitButton());
    expect(upload).not.toHaveBeenCalled();
  });

  it('keeps the teams a team bundle declares, and sends them', async () => {
    useSkillPublishing.mockReturnValue({ mode: 'admins', allowed: false });
    useOrgTeams.mockReturnValue({ teams: [RED, BLUE], isLoading: false });
    bundle.current = parsed({ visibility: 'team', teams: ['team-red'] });
    const { user } = mountPane();

    expect(screen.getByRole('radio', { name: /Teams/ })).toBeChecked();
    await user.click(submitButton());
    expect(upload).toHaveBeenCalledExactlyOnceWith(
      bundle.current.zipFile,
      false,
      { visibility: 'team', teams: ['team-red'] },
    );
  });

  it('preselects Organization for an organization-wide bundle when the viewer may publish, and sends it', async () => {
    useSkillPublishing.mockReturnValue({ mode: 'admins', allowed: true });
    bundle.current = parsed({ visibility: 'org' });
    const { user } = mountPane();

    expect(screen.getByRole('radio', { name: /Organization/ })).toBeChecked();
    expect(screen.queryByText(RESERVED_FOR_EDITORS)).not.toBeInTheDocument();
    await user.click(submitButton());
    expect(upload).toHaveBeenCalledExactlyOnceWith(
      bundle.current.zipFile,
      false,
      { visibility: 'org', teams: [] },
    );
  });

  it('names the reason in the viewer’s language when the server refuses a publish the listing still offered', async () => {
    useSkillPublishing.mockReturnValue({ mode: 'everyone', allowed: true });
    bundle.current = parsed({ visibility: 'org' });
    upload.mockRejectedValue(
      Object.assign(new Error('SKILL_PUBLISH_FORBIDDEN'), {
        data: {
          code: 'SKILL_PUBLISH_FORBIDDEN',
          message: 'Your organization reserves sharing a skill …',
        },
      }),
    );
    const { user } = mountPane();

    await user.click(submitButton());
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        description:
          "Your organization reserves sharing with everyone, and you aren't allowed to publish. Share the skill with your teams instead.",
        variant: 'destructive',
      }),
    );
  });
});

/**
 * A failed upload reads what it threw through `failureDetail`, never through
 * the error's message: a refusal keeps the door's words, a lost connection is
 * the localized sentence, and a fault puts nothing under the title — not
 * "Request failed with status 502" or "Failed to fetch" (#4888).
 */
describe('SkillUploadPane — a failed upload', () => {
  const UPLOAD_FAILED = "Couldn't upload skill bundle";

  beforeEach(() => {
    useSkillPublishing.mockReturnValue({ mode: 'everyone', allowed: true });
    bundle.current = parsed({ visibility: 'org' });
  });

  it('puts no status line under the title when the door answers with a fault', async () => {
    upload.mockRejectedValue(
      await backendErrorFromResponse(
        new Response('<html>Bad Gateway</html>', { status: 502 }),
      ),
    );
    const { user } = mountPane();

    await user.click(submitButton());
    expect(toast).toHaveBeenCalledExactlyOnceWith({
      title: UPLOAD_FAILED,
      description: undefined,
      variant: 'destructive',
    });
  });

  it('says the connection was lost when the upload got no answer', async () => {
    upload.mockRejectedValue(new TypeError('Failed to fetch'));
    const { user } = mountPane();

    await user.click(submitButton());
    expect(toast).toHaveBeenCalledExactlyOnceWith({
      title: UPLOAD_FAILED,
      description: "Couldn't reach Tale. Check your connection and try again.",
      variant: 'destructive',
    });
  });

  it('keeps a refusal’s own words under the title', async () => {
    upload.mockRejectedValue(
      new AppError({
        code: 'INVALID_BUNDLE',
        message: 'SKILL.md frontmatter needs a description.',
      }),
    );
    const { user } = mountPane();

    await user.click(submitButton());
    expect(toast).toHaveBeenCalledExactlyOnceWith({
      title: UPLOAD_FAILED,
      description: 'SKILL.md frontmatter needs a description.',
      variant: 'destructive',
    });
  });
});
