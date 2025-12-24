'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { useRouter } from 'next/navigation';
import { useT } from '@/lib/i18n';

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
  const { t: tCommon } = useT('common');
  const { t: tProducts } = useT('products');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const router = useRouter();
  const updateProduct = useMutation(api.products.updateProduct);

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
        title: 'Product name is required',
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
        title: 'Product updated successfully',
        variant: 'success',
      });

      onClose();
      router.refresh();
    } catch (err) {
      console.error('Update error:', err);
      toast({
        title: 'Failed to update product',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader className="space-y-2">
          <DialogTitle className="font-semibold text-foreground">
            Edit Product
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Update product information. Required fields are marked with *
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          {/* Product Name */}
          <div className="space-y-2">
            <Label htmlFor="name" required>
              Product Name
            </Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) =>
                setFormData({ ...formData, name: e.target.value })
              }
              placeholder={tProducts('edit.namePlaceholder')}
              disabled={isSubmitting}
              required
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) =>
                setFormData({ ...formData, description: e.target.value })
              }
              placeholder={tProducts('edit.descriptionPlaceholder')}
              disabled={isSubmitting}
              rows={3}
            />
          </div>

          {/* Image URL */}
          <div className="space-y-2">
            <Label htmlFor="imageUrl">Image URL</Label>
            <Input
              id="imageUrl"
              type="url"
              value={formData.imageUrl}
              onChange={(e) =>
                setFormData({ ...formData, imageUrl: e.target.value })
              }
              placeholder={tProducts('edit.imageUrlPlaceholder')}
              disabled={isSubmitting}
            />
          </div>

          {/* Price and Currency Row */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="price">Price</Label>
              <Input
                id="price"
                type="number"
                step="0.01"
                min="0"
                value={formData.price}
                onChange={(e) =>
                  setFormData({ ...formData, price: e.target.value })
                }
                placeholder={tProducts('edit.pricePlaceholder')}
                disabled={isSubmitting}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="currency">Currency</Label>
              <Input
                id="currency"
                value={formData.currency}
                onChange={(e) =>
                  setFormData({ ...formData, currency: e.target.value })
                }
                placeholder={tProducts('edit.currencyPlaceholder')}
                disabled={isSubmitting}
                maxLength={3}
              />
            </div>
          </div>

          {/* Stock and Category Row */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="stock">Stock</Label>
              <Input
                id="stock"
                type="number"
                min="0"
                value={formData.stock}
                onChange={(e) =>
                  setFormData({ ...formData, stock: e.target.value })
                }
                placeholder={tProducts('edit.stockPlaceholder')}
                disabled={isSubmitting}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="category">Category</Label>
              <Input
                id="category"
                value={formData.category}
                onChange={(e) =>
                  setFormData({ ...formData, category: e.target.value })
                }
                placeholder={tProducts('edit.categoryPlaceholder')}
                disabled={isSubmitting}
              />
            </div>
          </div>

          <DialogFooter className="flex justify-end mt-6">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? tCommon('actions.saving') : tCommon('actions.saveChanges')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
