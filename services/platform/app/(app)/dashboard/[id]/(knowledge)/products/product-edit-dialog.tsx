'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { FormDialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Grid } from '@/components/ui/layout';
import { toast } from '@/hooks/use-toast';
import { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n';
import { useUpdateProduct } from './hooks';

interface EditProductDialogProps {
  isOpen: boolean;
  onClose: () => void;
  product: {
    id: string;
    name: string;
    description?: string;
    imageUrl?: string;
    stock?: number;
    price?: number;
    currency?: string;
    category?: string;
    status?: string;
  };
}

export default function EditProductDialog({
  isOpen,
  onClose,
  product,
}: EditProductDialogProps) {
  const { t: tProducts } = useT('products');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const router = useRouter();
  const updateProduct = useUpdateProduct();

  // Form state
  const [formData, setFormData] = useState({
    name: product.name,
    description: product.description || '',
    imageUrl: product.imageUrl || '',
    stock: product.stock?.toString() || '',
    price: product.price?.toString() || '',
    currency: product.currency || 'USD',
    category: product.category || '',
  });

  // Reset form when product changes
  useEffect(() => {
    setFormData({
      name: product.name,
      description: product.description || '',
      imageUrl: product.imageUrl || '',
      stock: product.stock?.toString() || '',
      price: product.price?.toString() || '',
      currency: product.currency || 'USD',
      category: product.category || '',
    });
  }, [product]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim()) {
      toast({
        title: tProducts('edit.validation.nameRequired'),
        variant: 'destructive',
      });
      return;
    }

    try {
      setIsSubmitting(true);

      await updateProduct({
        productId: product.id as Id<'products'>,
        name: formData.name.trim(),
        description: formData.description.trim() || undefined,
        imageUrl: formData.imageUrl.trim() || undefined,
        stock: formData.stock ? parseInt(formData.stock) : undefined,
        price: formData.price ? parseFloat(formData.price) : undefined,
        currency: formData.currency || undefined,
        category: formData.category.trim() || undefined,
      });

      toast({
        title: tProducts('edit.toast.success'),
        variant: 'success',
      });

      onClose();
      router.refresh();
    } catch (err) {
      console.error('Update error:', err);
      toast({
        title: tProducts('edit.toast.error'),
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <FormDialog
      open={isOpen}
      onOpenChange={onClose}
      title={tProducts('edit.title')}
      description={tProducts('edit.description')}
      isSubmitting={isSubmitting}
      onSubmit={handleSubmit}
      large
    >
      {/* Product Name */}
      <Input
        id="name"
        label={tProducts('edit.labels.name')}
        required
        value={formData.name}
        onChange={(e) =>
          setFormData({ ...formData, name: e.target.value })
        }
        placeholder={tProducts('edit.namePlaceholder')}
        disabled={isSubmitting}
      />

      {/* Description */}
      <Textarea
        id="description"
        label={tProducts('edit.labels.description')}
        value={formData.description}
        onChange={(e) =>
          setFormData({ ...formData, description: e.target.value })
        }
        placeholder={tProducts('edit.descriptionPlaceholder')}
        disabled={isSubmitting}
        rows={3}
      />

      {/* Image URL */}
      <Input
        id="imageUrl"
        type="url"
        label={tProducts('edit.labels.imageUrl')}
        value={formData.imageUrl}
        onChange={(e) =>
          setFormData({ ...formData, imageUrl: e.target.value })
        }
        placeholder={tProducts('edit.imageUrlPlaceholder')}
        disabled={isSubmitting}
      />

      {/* Price and Currency Row */}
      <Grid cols={2} gap={4}>
        <Input
          id="price"
          type="number"
          step="0.01"
          min="0"
          label={tProducts('edit.labels.price')}
          value={formData.price}
          onChange={(e) =>
            setFormData({ ...formData, price: e.target.value })
          }
          placeholder={tProducts('edit.pricePlaceholder')}
          disabled={isSubmitting}
        />
        <Input
          id="currency"
          label={tProducts('edit.labels.currency')}
          value={formData.currency}
          onChange={(e) =>
            setFormData({ ...formData, currency: e.target.value })
          }
          placeholder={tProducts('edit.currencyPlaceholder')}
          disabled={isSubmitting}
          maxLength={3}
        />
      </Grid>

      {/* Stock and Category Row */}
      <Grid cols={2} gap={4}>
        <Input
          id="stock"
          type="number"
          min="0"
          label={tProducts('edit.labels.stock')}
          value={formData.stock}
          onChange={(e) =>
            setFormData({ ...formData, stock: e.target.value })
          }
          placeholder={tProducts('edit.stockPlaceholder')}
          disabled={isSubmitting}
        />
        <Input
          id="category"
          label={tProducts('edit.labels.category')}
          value={formData.category}
          onChange={(e) =>
            setFormData({ ...formData, category: e.target.value })
          }
          placeholder={tProducts('edit.categoryPlaceholder')}
          disabled={isSubmitting}
        />
      </Grid>
    </FormDialog>
  );
}
