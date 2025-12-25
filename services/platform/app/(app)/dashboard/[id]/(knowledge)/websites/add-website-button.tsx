'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import AddWebsiteDialog from './add-website-dialog';
import { useT } from '@/lib/i18n';

interface AddWebsiteButtonProps {
  organizationId: string;
}

export default function AddWebsiteButton({ organizationId }: AddWebsiteButtonProps) {
  const { t: tWebsites } = useT('websites');
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setIsAddDialogOpen(true)}>
        <Plus className="size-4 mr-1" />
        {tWebsites('addButton')}
      </Button>
      <AddWebsiteDialog
        isOpen={isAddDialogOpen}
        onClose={() => setIsAddDialogOpen(false)}
        organizationId={organizationId}
      />
    </>
  );
}
