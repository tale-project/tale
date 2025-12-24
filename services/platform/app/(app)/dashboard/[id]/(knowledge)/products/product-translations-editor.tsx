'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Edit, Save, X, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from '@/hooks/use-toast';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n';

type TranslatedNames = {
  [language: string]: string;
};

interface ProductTranslationsEditorProps {
  productId: string;
  productName: string;
  translatedNames: TranslatedNames | null;
}

export default function ProductTranslationsEditor({
  productId,
  productName,
  translatedNames,
}: ProductTranslationsEditorProps) {
  const { t: tProducts } = useT('products');
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState<TranslatedNames>({
    en: translatedNames?.en || '',
    de: translatedNames?.de || '',
    fr: translatedNames?.fr || '',
  });

  const router = useRouter();
  const upsertTranslation = useMutation(api.products.upsertProductTranslation);

  const handleInputChange = (
    language: keyof TranslatedNames,
    value: string,
  ) => {
    setFormData((prev) => ({
      ...prev,
      [language]: value,
    }));
  };

  const handleSave = async () => {
    setIsLoading(true);
    try {
      // Update all translations in parallel using Promise.all
      const translationPromises = Object.entries(formData)
        .filter(([, name]) => name.trim())
        .map(([language, name]) =>
          upsertTranslation({
            productId: productId as Id<'products'>,
            language,
            name: name.trim(),
          }),
        );

      await Promise.all(translationPromises);

      toast({
        title: 'Product translations updated',
        variant: 'success',
      });

      setOpen(false);
      router.refresh();
    } catch (error) {
      console.error('Error updating translations:', error);
      toast({
        title: 'Failed to update translations',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancel = () => {
    setFormData({
      en: translatedNames?.en || '',
      de: translatedNames?.de || '',
      fr: translatedNames?.fr || '',
    });
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon">
          <Edit className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tProducts('translations.title')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* Original Product Name */}
          <div className="space-y-2">
            <Label className="text-sm font-medium text-muted-foreground">
              Original Product Name
            </Label>
            <div className="p-3 bg-muted rounded-md">
              <span className="text-sm">{productName}</span>
            </div>
          </div>

          {/* English Translation */}
          <div className="space-y-2">
            <Label htmlFor="en-translation" className="text-sm font-medium">
              English Translation
            </Label>
            <Input
              id="en-translation"
              value={formData.en}
              onChange={(e) => handleInputChange('en', e.target.value)}
              placeholder={tProducts('translations.enterTranslation', { language: 'English' })}
              className="w-full"
            />
          </div>

          {/* German Translation */}
          <div className="space-y-2">
            <Label htmlFor="de-translation" className="text-sm font-medium">
              German Translation
            </Label>
            <Input
              id="de-translation"
              value={formData.de}
              onChange={(e) => handleInputChange('de', e.target.value)}
              placeholder={tProducts('translations.enterTranslation', { language: 'German' })}
              className="w-full"
            />
          </div>

          {/* French Translation */}
          <div className="space-y-2">
            <Label htmlFor="fr-translation" className="text-sm font-medium">
              French Translation
            </Label>
            <Input
              id="fr-translation"
              value={formData.fr}
              onChange={(e) => handleInputChange('fr', e.target.value)}
              placeholder={tProducts('translations.enterTranslation', { language: 'French' })}
              className="w-full"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end space-x-2 pt-2">
            <Button
              variant="outline"
              onClick={handleCancel}
              disabled={isLoading}
            >
              <X className="size-4 mr-2" />
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isLoading}>
              {isLoading ? (
                <Loader2 className="size-4 mr-2 animate-spin" />
              ) : (
                <Save className="size-4 mr-2" />
              )}
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
