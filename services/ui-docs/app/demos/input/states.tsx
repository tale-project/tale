import { Input } from '@tale/ui/input';

export default function InputStates() {
  return (
    <div className="flex w-full max-w-sm flex-col gap-4">
      <Input label="Password" type="password" passwordToggle sensitive />
      <Input
        label="Contact email"
        defaultValue="not-an-email"
        isInvalid
        errorMessage="Enter a valid email address."
      />
      <Input
        label="Organization slug"
        defaultValue="northwind"
        disabled
        disabledReason="The slug is fixed once the first member joins."
      />
      <Input
        label="Deployment region"
        defaultValue="Zurich"
        variant="readOnly"
        readOnly
      />
    </div>
  );
}
