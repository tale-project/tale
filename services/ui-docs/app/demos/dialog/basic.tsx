import { Button } from '@tale/ui/button';
import { Dialog } from '@tale/ui/dialog/dialog';
import { Input } from '@tale/ui/input';
import { useState } from 'react';

export default function DialogBasic() {
  const [open, setOpen] = useState(false);

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title="Invite a member"
      description="They receive an email with a join link that expires in seven days."
      trigger={<Button variant="secondary">Invite a member</Button>}
      footer={
        <>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={() => setOpen(false)}>Send invitation</Button>
        </>
      }
    >
      <Input
        label="Email address"
        type="email"
        placeholder="name@example.com"
      />
    </Dialog>
  );
}
