import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MemberLookupTarget } from '@/app/features/settings/organization/hooks/member-lookup';
import type { StandInMember } from '@/tests/utils/member-lookup-stand-in';
import { render, screen, waitFor } from '@/tests/utils/render';

import { DocumentRecordSubmitDialog } from './document-record-submit-dialog';

/** Whom the server says may review the record (undefined until it has
 * answered), whom the member lookup found (undefined until it has), whom the
 * dialog asked the lookup for, and every read the dialog made itself. */
const state = vi.hoisted(() => ({
  eligible: undefined as string[] | undefined,
  members: undefined as StandInMember[] | undefined,
  asked: [] as MemberLookupTarget[],
  reads: [] as string[],
  submit: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('../hooks/queries', () => ({
  useEligibleDocumentReviewerIds: () => ({ data: state.eligible }),
  useLastDocumentRecordReview: () => ({ data: undefined }),
}));
vi.mock('../hooks/mutations', () => ({
  useSubmitRecordForReview: () => ({
    mutateAsync: state.submit,
    isPending: false,
  }),
}));
vi.mock('@/app/features/settings/organization/hooks/member-lookup', async () =>
  (await import('@/tests/utils/member-lookup-stand-in')).memberLookupStandIn(
    () => state.members,
    state.asked,
  ),
);
vi.mock('@/app/hooks/use-backend-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/hooks/use-backend-query')>()),
  useBackendQuery: (name: string) => {
    state.reads.push(name);
    return { data: undefined, isLoading: false };
  },
}));
vi.mock('@tale/ui/use-toast', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tale/ui/use-toast')>()),
  toast: state.toast,
}));

const ELIGIBLE = ['user-ada', 'user-bo', 'user-olga', 'user-sam'];

/** The eligible reviewers as the lookup finds them. */
const FOUND: StandInMember[] = [
  { userId: 'user-ada', displayName: 'Ada Admin', email: 'ada@example.com' },
  { userId: 'user-bo', displayName: 'Bo Editor', email: 'bo@example.com' },
  { userId: 'user-olga', displayName: 'Olga Offboarded', role: 'disabled' },
  { userId: 'user-sam', displayName: 'Sam Standing' },
];

beforeEach(() => {
  vi.clearAllMocks();
  state.eligible = ELIGIBLE;
  state.members = FOUND;
  state.asked.length = 0;
  state.reads.length = 0;
  state.submit.mockResolvedValue(undefined);
});

/** The user ids the dialog asked the lookup for. */
function askedFor() {
  return new Set(
    state.asked.map((target) =>
      'userId' in target ? target.userId : target.handle,
    ),
  );
}

function renderDialog(standingReviewer?: { userId: string; name: string }) {
  const onOpenChange = vi.fn();
  const view = render(
    <DocumentRecordSubmitDialog
      open
      onOpenChange={onOpenChange}
      documentId="doc-1"
      documentName="Policy.pdf"
      organizationId="org-a"
      {...(standingReviewer === undefined ? {} : { standingReviewer })}
    />,
  );
  return { ...view, onOpenChange };
}

describe('DocumentRecordSubmitDialog reviewers [MEMBER-R11]', () => {
  it('looks up only the members the server says may review, and reads no member list', async () => {
    const { user } = renderDialog();
    await user.click(screen.getByText('Choose a reviewer'));

    expect(
      screen.getByRole('option', { name: /Ada Admin/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: /Bo Editor/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: /Sam Standing/ }),
    ).toBeInTheDocument();
    // A disabled account cannot answer a review.
    expect(
      screen.queryByRole('option', { name: /Olga Offboarded/ }),
    ).not.toBeInTheDocument();
    expect(askedFor()).toEqual(new Set(ELIGIBLE));
    expect(state.reads).not.toContain('members/queries:listByOrganization');
  });

  it('looks up and offers nobody until the server says who may review', async () => {
    state.eligible = undefined;
    state.members = undefined;
    const { user } = renderDialog();
    await user.click(screen.getByText('Choose a reviewer'));

    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(askedFor()).toEqual(new Set());
  });

  it('does not offer the standing reviewer again when it changes the reviewer', async () => {
    const { user } = renderDialog({ userId: 'user-sam', name: 'Sam Standing' });
    await user.click(screen.getByText('Choose a reviewer'));

    expect(
      screen.queryByRole('option', { name: /Sam Standing/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: /Ada Admin/ }),
    ).toBeInTheDocument();
  });

  it('submits the record to the reviewer chosen', async () => {
    const { user, onOpenChange } = renderDialog();
    await user.click(screen.getByText('Choose a reviewer'));
    await user.click(screen.getByRole('option', { name: /Bo Editor/ }));
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    expect(state.submit).toHaveBeenCalledWith({
      documentId: 'doc-1',
      reviewerUserId: 'user-bo',
    });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});
