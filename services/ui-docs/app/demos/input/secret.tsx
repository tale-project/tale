import { Input } from '@tale/ui/input';
import { Textarea } from '@tale/ui/textarea';

export default function InputSecret() {
  return (
    <div className="flex w-full max-w-sm flex-col gap-4">
      <Input
        label="Card number"
        description="A real password input: a screen reader does not speak the value."
        type="password"
        autoComplete="off"
        data-1p-ignore
        data-lpignore="true"
        data-form-type="other"
        data-bwignore="true"
        copyable
        defaultValue="0000 1111 2222 3333"
        revealLabels={{ show: 'Show card number', hide: 'Hide card number' }}
        copyLabel="Copy card number"
        copiedLabel="Card number copied"
      />
      <Textarea
        label="Recovery codes"
        description="Masked on screen only: a screen reader still reads every line."
        sensitive
        copyable
        defaultValue={'sample-code-one\nsample-code-two'}
        revealLabels={{
          show: 'Show recovery codes',
          hide: 'Hide recovery codes',
        }}
        copyLabel="Copy recovery codes"
        copiedLabel="Recovery codes copied"
      />
    </div>
  );
}
