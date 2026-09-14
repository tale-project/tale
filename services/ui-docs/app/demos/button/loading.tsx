import { Button } from '@tale/ui/button';
import { useState } from 'react';

export default function ButtonLoading() {
  const [saving, setSaving] = useState(false);

  return (
    <div className="flex flex-wrap items-center justify-center gap-3">
      <Button
        isLoading={saving}
        onClick={() => {
          setSaving(true);
          setTimeout(() => setSaving(false), 1500);
        }}
      >
        Save changes
      </Button>
      <Button variant="secondary" isLoading>
        Always loading
      </Button>
    </div>
  );
}
