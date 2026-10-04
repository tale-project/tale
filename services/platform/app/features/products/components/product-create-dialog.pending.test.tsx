import { toast } from '@tale/ui/use-toast';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WRITE_ADAPTERS } from '@/app/lib/backend/adapters';
import { AppError } from '@/lib/shared/errors/app-error';
import { act, cleanup, render, screen, waitFor } from '@/tests/utils/render';

import { ProductCreateDialog } from './product-create-dialog';

vi.mock('@tale/ui/use-toast', () => ({ toast: vi.fn() }));
vi.mock('../hooks/use-product-image-upload', () => ({
  PRODUCT_IMAGE_ACCEPT: 'image/*',
  PRODUCT_IMAGE_MAX_BYTES: 5_000_000,
  useProductImageUpload: () => ({ uploadImage: vi.fn(), isUploading: false }),
}));

function deferredWrite() {
  let resolve!: (value: unknown) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<unknown>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function DialogHost({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Reopen product
      </button>
      <ProductCreateDialog
        isOpen={open}
        organizationId="org-1"
        onClose={() => {
          onClose();
          setOpen(false);
        }}
      />
    </>
  );
}

function renderDialog() {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  const onClose = vi.fn();
  const rendered = render(
    <QueryClientProvider client={client}>
      <DialogHost onClose={onClose} />
    </QueryClientProvider>,
  );
  return { ...rendered, client, onClose };
}

async function submitWizard(user: ReturnType<typeof renderDialog>['user']) {
  await user.type(
    screen.getByLabelText('Product name'),
    'Audit product pending',
  );
  await user.type(
    screen.getByLabelText('Description', { exact: false }),
    'Original description',
  );
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await user.click(screen.getByRole('button', { name: 'Create' }));
}

describe('Product Create pending lifecycle', () => {
  const adapter = WRITE_ADAPTERS['products/mutations:createProduct'];
  if (!adapter) throw new Error('Product create adapter is missing');

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(adapter, 'invalidate').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('keeps Create and Back busy for the real write and refuses a repeat', async () => {
    const pending = deferredWrite();
    const run = vi.spyOn(adapter, 'run').mockReturnValue(pending.promise);
    const { user, client, onClose } = renderDialog();
    await submitWizard(user);
    await waitFor(() => expect(client.isMutating()).toBe(1));

    const create = screen.getByRole('button', { name: 'Create' });
    const back = screen.getByRole('button', { name: 'Back' });
    expect(create).toBeDisabled();
    expect(back).toBeDisabled();
    await user.click(create);
    await user.click(back);
    expect(run).toHaveBeenCalledTimes(1);
    expect(client.isMutating()).toBe(1);

    await act(async () => pending.resolve('product-1'));
    await waitFor(() => expect(client.isMutating()).toBe(0));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it('blocks Escape and close requests until the write settles', async () => {
    const pending = deferredWrite();
    vi.spyOn(adapter, 'run').mockReturnValue(pending.promise);
    const { user, client, onClose } = renderDialog();
    await submitWizard(user);
    await waitFor(() => expect(client.isMutating()).toBe(1));

    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(client.isMutating()).toBe(1);

    await act(async () =>
      pending.reject(new AppError({ code: 'DUPLICATE_PRODUCT_NAME' })),
    );
    await waitFor(() => expect(client.isMutating()).toBe(0));
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('retains a refused draft and allows a repaired submission', async () => {
    const first = deferredWrite();
    const repaired = deferredWrite();
    const run = vi
      .spyOn(adapter, 'run')
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(repaired.promise);
    const { user, client, onClose } = renderDialog();
    await submitWizard(user);
    await waitFor(() => expect(client.isMutating()).toBe(1));
    await user.click(screen.getByRole('button', { name: 'Create' }));
    expect(run).toHaveBeenCalledTimes(1);

    await act(async () =>
      first.reject(new AppError({ code: 'DUPLICATE_PRODUCT_NAME' })),
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Back' })).toBeEnabled(),
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'destructive' }),
    );
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(screen.getByRole('button', { name: 'Back' }));
    const name = screen.getByLabelText('Product name');
    expect(name).toHaveValue('Audit product pending');
    expect(screen.getByLabelText('Description', { exact: false })).toHaveValue(
      'Original description',
    );
    await user.clear(name);
    await user.type(name, 'Repaired product draft');
    expect(client.isMutating()).toBe(0);
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(client.isMutating()).toBe(1));
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1]?.[0]).toMatchObject({
      name: 'Repaired product draft',
      description: 'Original description',
    });
    await act(async () => repaired.resolve('product-2'));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(toast).toHaveBeenCalledTimes(2);
  });

  it('closes and resets exactly once after a healthy success', async () => {
    const pending = deferredWrite();
    const run = vi.spyOn(adapter, 'run').mockReturnValue(pending.promise);
    const { user, onClose } = renderDialog();
    await submitWizard(user);
    await act(async () => pending.resolve('product-1'));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(run).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'success' }),
    );
    await user.click(screen.getByRole('button', { name: 'Reopen product' }));
    expect(screen.getByLabelText('Product name')).toHaveValue('');
    expect(screen.getByLabelText('Description', { exact: false })).toHaveValue(
      '',
    );
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });
});
