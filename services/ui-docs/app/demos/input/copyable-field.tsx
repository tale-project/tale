import { CopyableField } from '@tale/ui/copyable-field';

export default function InputCopyableField() {
  return (
    <div className="flex w-full max-w-sm flex-col gap-4">
      <CopyableField label="Project ID" value="proj_northwind_4821" />
      <CopyableField
        label="Access token"
        value="sample-token-not-a-real-secret"
        masked
        copyAriaLabel="Copy access token"
        revealLabels={{ show: 'Show access token', hide: 'Hide access token' }}
      />
      <CopyableField
        label="Guest Wi-Fi note"
        value={'Network: Northwind-Guest\nThe password is on the fridge.'}
        mono={false}
        wrap
        copyAriaLabel="Copy guest Wi-Fi note"
      />
    </div>
  );
}
