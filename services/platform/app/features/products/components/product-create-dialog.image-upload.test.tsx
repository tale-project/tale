import { toast } from '@tale/ui/use-toast';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WRITE_ADAPTERS } from '@/app/lib/backend/adapters';
import { act, cleanup, render, screen, waitFor } from '@/tests/utils/render';

import { ProductCreateDialog } from './product-create-dialog';

// #3626: Add product stays mounted across close and reopen, and an image
// upload that finished after its draft was closed landed in the next one.
// The real dialog, image field and upload hook run here; the image door's
// answer (held until the test sends it) and the create write are the seams.

vi.mock('@tale/ui/use-toast', () => ({ toast: vi.fn() }));

const FIRST_IMAGE =
  '/api/app/products/images/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa?orgId=org-1';

const fetchMock = vi.fn();

/** The image door's answer to one upload POST, sent when the test says. */
function heldUpload() {
  let send!: (answer: unknown) => void;
  const answer = new Promise<unknown>((resolve) => {
    send = resolve;
  });
  fetchMock.mockReturnValueOnce(answer);
  return {
    accept: (imageUrl: string) =>
      send({ ok: true, status: 200, json: async () => ({ imageUrl }) }),
    refuse: (code: string) =>
      send({ ok: false, status: 400, json: async () => ({ error: code }) }),
  };
}

// Like ProductsActionMenu: the dialog stays mounted and only `isOpen` flips.
function DraftHost() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Reopen product
      </button>
      <ProductCreateDialog
        isOpen={open}
        organizationId="org-1"
        onClose={() => setOpen(false)}
      />
    </>
  );
}

function renderDraft() {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <DraftHost />
    </QueryClientProvider>,
  );
}

type User = ReturnType<typeof renderDraft>['user'];

async function chooseImage(user: User) {
  const input = document.getElementById('product-image-upload');
  if (!(input instanceof HTMLInputElement)) {
    throw new Error('drop-zone input missing');
  }
  await user.upload(
    input,
    new File([new Uint8Array([137, 80, 78, 71])], 'shoe.png', {
      type: 'image/png',
    }),
  );
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
}

async function closeDraft(user: User) {
  await user.click(screen.getByRole('button', { name: 'Close' }));
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  );
}

async function reopen(user: User) {
  await user.click(screen.getByRole('button', { name: 'Reopen product' }));
  await screen.findByRole('dialog');
}

// Every hop from the door's answer to the field acting on it is a
// microtask; one timer turn drains them all.
const settle = () =>
  act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

function expectNoImage() {
  expect(
    screen.queryByRole('button', { name: 'Remove image' }),
  ).not.toBeInTheDocument();
  expect(screen.getByText('Upload image')).toBeInTheDocument();
}

describe('Product Create image upload and its draft', () => {
  const createProduct = WRITE_ADAPTERS['products/mutations:createProduct'];
  if (!createProduct) throw new Error('Product create adapter is missing');

  async function create(user: User, name: string) {
    const run = vi.spyOn(createProduct, 'run').mockResolvedValue('product-2');
    await user.type(screen.getByLabelText('Product name'), name);
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    return run.mock.calls[0]?.[0];
  }

  beforeEach(() => {
    vi.clearAllMocks();
    // The upload URL is scoped to the organization in the address.
    window.history.pushState({}, '', '/dashboard/org-1/products');
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(createProduct, 'invalidate').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.history.pushState({}, '', '/');
  });

  it('drops an upload that finishes after its draft was closed', async () => {
    const upload = heldUpload();
    const { user } = renderDraft();
    await chooseImage(user);

    await closeDraft(user);
    upload.accept(FIRST_IMAGE);
    await settle();

    await reopen(user);
    expectNoImage();
    const sent = await create(user, 'Hat');
    expect(sent).toMatchObject({ name: 'Hat' });
    expect(sent?.imageUrl).toBeUndefined();
  });

  it('drops an upload that finishes while the next draft is open', async () => {
    const upload = heldUpload();
    const { user } = renderDraft();
    await chooseImage(user);

    await closeDraft(user);
    await reopen(user);
    upload.accept(FIRST_IMAGE);
    await settle();

    expectNoImage();
    const sent = await create(user, 'Hat');
    expect(sent?.imageUrl).toBeUndefined();
  });

  it('starts the next draft clean after an upload that finished before close', async () => {
    const upload = heldUpload();
    const { user } = renderDraft();
    await chooseImage(user);
    upload.accept(FIRST_IMAGE);
    await settle();
    expect(
      screen.getByRole('button', { name: 'Remove image' }),
    ).toBeInTheDocument();

    await closeDraft(user);
    await reopen(user);

    expectNoImage();
  });

  // The field unmounts when its step is left; the draft it fills goes on.
  it('keeps an upload that finishes while its draft is on a later step', async () => {
    const upload = heldUpload();
    const run = vi.spyOn(createProduct, 'run').mockResolvedValue('product-1');
    const { user } = renderDraft();
    await user.type(screen.getByLabelText('Product name'), 'Shoe');
    await chooseImage(user);
    await user.click(screen.getByRole('button', { name: 'Next' }));

    upload.accept(FIRST_IMAGE);
    await settle();
    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(document.querySelector(`img[src="${FIRST_IMAGE}"]`)).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(run.mock.calls[0]?.[0]).toMatchObject({ imageUrl: FIRST_IMAGE });
  });

  it('says nothing about an upload refused after its draft was closed', async () => {
    const upload = heldUpload();
    const { user } = renderDraft();
    await chooseImage(user);

    await closeDraft(user);
    upload.refuse('PRODUCT_IMAGE_INVALID');
    await settle();

    expect(toast).not.toHaveBeenCalled();
    await reopen(user);
    expectNoImage();
    expect(screen.queryByText(/supported image/)).not.toBeInTheDocument();
  });

  it('stops sending the upload when its draft is closed', async () => {
    fetchMock.mockImplementationOnce(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal;
          if (signal) {
            signal.addEventListener('abort', () => reject(signal.reason));
          }
        }),
    );
    const { user } = renderDraft();
    await chooseImage(user);
    const signal = fetchMock.mock.calls[0]?.[1]?.signal;
    expect(signal?.aborted).toBe(false);

    await closeDraft(user);
    await settle();

    expect(signal?.aborted).toBe(true);
    expect(toast).not.toHaveBeenCalled();
    await reopen(user);
    expectNoImage();
  });
});
