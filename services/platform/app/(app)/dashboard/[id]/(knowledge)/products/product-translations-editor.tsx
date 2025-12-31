'use client';

import { useState } from 'react';
import { FormDialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Input } from '@/components/ui/input';
import { Stack, HStack } from '@/components/ui/layout';
import { Edit, Save, X, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from '@/hooks/use-toast';
import { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n';
import { useUpsertProductTranslation } from './hooks';

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
  const { t: tCommon } = useT('common');
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState<TranslatedNames>({
    en: translatedNames?.en || '',
    de: translatedNames?.de || '',
    fr: translatedNames?.fr || '',
  });

  const router = useRouter();
  const upsertTranslation = useUpsertProductTranslation();

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
        title: tProducts('translations.toast.success'),
        variant: 'success',
      });

      setOpen(false);
      router.refresh();
    } catch (error) {
      console.error('Error updating translations:', error);
      toast({
        title: tProducts('translations.toast.error'),
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
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      title={tProducts('translations.title')}
      trigger={
        <IconButton icon={Edit} aria-label={tProducts('translations.title')} />
      }
      customFooter={
        <HStack justify="end" gap={2}>
          <Button
            variant="outline"
            onClick={handleCancel}
            disabled={isLoading}
          >
            <X className="size-4 mr-2" />
            {tCommon('actions.cancel')}
          </Button>
          <Button onClick={handleSave} disabled={isLoading}>
            {isLoading ? (
              <Loader2 className="size-4 mr-2 animate-spin" />
            ) : (
              <Save className="size-4 mr-2" />
            )}
            {tCommon('actions.save')}
          </Button>
        </HStack>
      }
    >
      {/* Original Product Name */}
      <Stack gap={2}>
        <span className="text-sm font-medium text-muted-foreground">
          {tProducts('translations.originalProductName')}
        </span>
        <div className="p-3 bg-muted rounded-md">
          <span className="text-sm">{productName}</span>
        </div>
      </Stack>

      {/* English Translation */}
      <Input
        id="en-translation"
        label={tProducts('translations.englishTranslation')}
        value={formData.en}
        onChange={(e) => handleInputChange('en', e.target.value)}
        placeholder={tProducts('translations.enterTranslation', { language: 'English' })}
        className="w-full"
      />

      {/* German Translation */}
      <Input
        id="de-translation"
        label={tProducts('translations.germanTranslation')}
        value={formData.de}
        onChange={(e) => handleInputChange('de', e.target.value)}
        placeholder={tProducts('translations.enterTranslation', { language: 'German' })}
        className="w-full"
      />

      {/* French Translation */}
      <Input
        id="fr-translation"
        label={tProducts('translations.frenchTranslation')}
        value={formData.fr}
        onChange={(e) => handleInputChange('fr', e.target.value)}
        placeholder={tProducts('translations.enterTranslation', { language: 'French' })}
        className="w-full"
      />
    </FormDialog>
  );
}
