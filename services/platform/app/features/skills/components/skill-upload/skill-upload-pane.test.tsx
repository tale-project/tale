/**
 * The upload preview says what the server will conclude before anything is
 * sent. When the organization reserves organization-wide skills and the
 * viewer may not publish, a bundle shared with the whole organization — an
 * unmarked one included, which reads as `org` — is flagged with the reason
 * and how to fix it, and cannot be sent.
 */

import type { SkillFrontmatter } from '@tale/shared/schemas/skills';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import type { ParsedSkillBundle } from './utils/parse-skill-bundle';

const { useSkillPublishing, upload, bundle, toast } = vi.hoisted(() => ({
  useSkillPublishing: vi.fn(),
  upload: vi.fn(),
  bundle: { current: null as ParsedSkillBundle | null },
  toast: vi.fn(),
}));

vi.mock('@tale/ui/use-toast', () => ({ toast }));

vi.mock('../../hooks/queries', () => ({ useSkillPublishing }));
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
    assets: [],
    totalBytes: 3,
  };
}

function mountPane() {
  return render(
    <SkillUploadPane
      organizationId="org_1"
      mode="zip"
      onUploaded={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
}

const REFUSAL_HINT =
  'Set visibility to team with your team IDs in SKILL.md, or ask an admin to upload this bundle.';

beforeEach(() => {
  toast.mockClear();
  upload.mockReset();
  upload.mockResolvedValue({ status: 'landed', slug: 'house-voice' });
});

describe('SkillUploadPane', () => {
  it('flags an organization-wide bundle the viewer may not publish, and sends nothing', async () => {
    useSkillPublishing.mockReturnValue({ mode: 'editors', allowed: false });
    bundle.current = parsed({ visibility: 'org' });
    const { user } = mountPane();

    expect(
      screen.getByText(
        'Your organization reserves sharing with everyone for Editors and above, and members an admin allowed.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(REFUSAL_HINT)).toBeInTheDocument();
    const submit = screen.getByRole('button', { name: 'Upload bundle' });
    expect(submit).toBeDisabled();
    await user.click(submit);
    expect(upload).not.toHaveBeenCalled();
  });

  it('sends a team bundle as usual', async () => {
    useSkillPublishing.mockReturnValue({ mode: 'admins', allowed: false });
    bundle.current = parsed({ visibility: 'team', teams: ['team-red'] });
    const { user } = mountPane();

    expect(screen.queryByText(REFUSAL_HINT)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Upload bundle' }));
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it('sends an organization-wide bundle when the viewer may publish', async () => {
    useSkillPublishing.mockReturnValue({ mode: 'admins', allowed: true });
    bundle.current = parsed({ visibility: 'org' });
    const { user } = mountPane();

    expect(screen.queryByText(REFUSAL_HINT)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Upload bundle' }));
    expect(upload).toHaveBeenCalledTimes(1);
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

    await user.click(screen.getByRole('button', { name: 'Upload bundle' }));
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        description:
          "Your organization reserves sharing with everyone, and you aren't allowed to publish. Share the skill with your teams instead.",
        variant: 'destructive',
      }),
    );
  });
});
