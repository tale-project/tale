import { Button } from '@tale/ui/button';
import { FormDialog } from '@tale/ui/dialog/form-dialog';
import { Input } from '@tale/ui/input';
import { useState } from 'react';

export default function DialogStickyFooter() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Edit forty values
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title="Edit forty values"
        description="Scroll the fields: Cancel and Save stay where they are."
        submitText="Save"
        stickyFooter
        onSubmit={() => setOpen(false)}
      >
        {Array.from({ length: 40 }, (_, index) => (
          <Input
            key={index}
            label={`Value ${index + 1}`}
            defaultValue={`Sample value ${index + 1}`}
          />
        ))}
      </FormDialog>
    </>
  );
}
