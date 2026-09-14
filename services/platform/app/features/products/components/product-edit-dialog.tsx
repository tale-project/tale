'use client';

import { FormDialog } from '@tale/ui/dialog/form-dialog';
import { useEffect, useRef } from 'react';

import {
  ProductEditFields,
  type ProductEditTarget,
  useProductEditForm,
} from './product-edit-form';

interface EditProductDialogProps {
  isOpen: boolean;
  onClose: () => void;
  product: ProductEditTarget;
}

export function ProductEditDialog({
  isOpen,
  onClose,
  product,
}: EditProductDialogProps) {
  const {
    tProducts,
    register,
    errors,
    isDirty,
    isPending,
    seed,
    setValue,
    watch,
    statusOptions,
    submit,
  } = useProductEditForm(product, onClose);

  const wasOpen = useRef(false);
  useEffect(() => {
    if (isOpen && !wasOpen.current) seed();
    wasOpen.current = isOpen;
  }, [isOpen, seed]);

  return (
    <FormDialog
      open={isOpen}
      onOpenChange={onClose}
      title={tProducts('edit.title')}
      isSubmitting={isPending}
      isDirty={isDirty}
      onSubmit={submit}
      size="default"
      large
    >
      <ProductEditFields
        register={register}
        errors={errors}
        isPending={isPending}
        setValue={setValue}
        watch={watch}
        statusOptions={statusOptions}
      />
    </FormDialog>
  );
}
