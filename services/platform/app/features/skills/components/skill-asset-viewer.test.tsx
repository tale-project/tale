/**
 * The asset viewer keeps three answers apart (#3752): a read that failed
 * (say so, offer Try again), a file the bundle no longer has (the door's
 * 404), and a file that is genuinely empty. A failed read never renders as
 * an empty preview.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BackendApiError } from '@/app/lib/backend/api-client';
import { render, screen } from '@/tests/utils/render';

import { SkillAssetViewer } from './skill-asset-viewer';

const asset = vi.hoisted(() => ({
  read: {} as Record<string, unknown>,
  refetch: vi.fn(),
}));

vi.mock('../hooks/queries', () => ({
  useSkillAsset: () => ({ ...asset.read, refetch: asset.refetch }),
}));

function toBase64(text: string) {
  let binary = '';
  for (const byte of new TextEncoder().encode(text)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function answered(text: string | null) {
  return {
    data: text === null ? null : { contentBase64: toBase64(text) },
    error: null,
    isError: false,
    isFetching: false,
    isPending: false,
    isSuccess: true,
  };
}

function failed(data?: unknown) {
  return {
    data,
    error: new BackendApiError(503, 'Service Unavailable'),
    isError: true,
    isFetching: false,
    isPending: false,
    isSuccess: false,
  };
}

/** Try again on a read with no data: react-query is `pending` again. */
const retrying = {
  data: undefined,
  error: null,
  isError: false,
  isFetching: true,
  isPending: true,
  isSuccess: false,
};

function renderViewer(assetPath = 'references/notes.txt') {
  return render(
    <SkillAssetViewer
      organizationId="org_1"
      skillSlug="demo"
      assetPath={assetPath}
    />,
  );
}

const copyButton = () => screen.getByRole('button', { name: 'Copy' });

beforeEach(() => {
  asset.refetch.mockReset();
  asset.refetch.mockResolvedValue(undefined);
});

describe('SkillAssetViewer read states', () => {
  it('says a failed read failed, with Try again, instead of an empty preview', async () => {
    asset.read = failed();
    const { user, container } = renderViewer();

    expect(screen.getByRole('alert')).toHaveTextContent(
      "Couldn't load this file.",
    );
    expect(screen.getByText('references/notes.txt')).toBeInTheDocument();
    expect(container.querySelector('pre')).toBeNull();
    expect(screen.queryByText(/ B · /)).not.toBeInTheDocument();
    expect(copyButton()).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(asset.refetch).toHaveBeenCalledTimes(1);
  });

  it('masks the pane while Try again runs, then shows the file', () => {
    asset.read = retrying;
    const { rerender } = renderViewer();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();

    asset.read = answered('Reference notes line 1\n');
    rerender(
      <SkillAssetViewer
        organizationId="org_1"
        skillSlug="demo"
        assetPath="references/notes.txt"
      />,
    );

    expect(screen.getByText('Reference notes line 1')).toBeInTheDocument();
    expect(copyButton()).toBeEnabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says a file the bundle no longer has is gone, with no Try again', () => {
    asset.read = answered(null);
    renderViewer();

    expect(
      screen.getByText(
        'This file is no longer in the bundle. Pick another file from the tree.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Try again' }),
    ).not.toBeInTheDocument();
  });

  it('shows a genuinely empty file as empty, not as a failure', () => {
    asset.read = answered('');
    renderViewer('references/empty.txt');

    expect(screen.getByText('This file is empty.')).toBeInTheDocument();
    expect(screen.getByText(/^0 B · /)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(copyButton()).toBeDisabled();
  });

  it('keeps a shown file when its refresh fails, and says so', async () => {
    asset.read = failed({
      contentBase64: toBase64('Reference notes line 1\n'),
    });
    const { user } = renderViewer();

    expect(screen.getByText('Reference notes line 1')).toBeInTheDocument();
    expect(copyButton()).toBeEnabled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      "Couldn't refresh this file. You're seeing the version loaded earlier.",
    );
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(asset.refetch).toHaveBeenCalledTimes(1);
  });
});
