import { NumberStepper } from '@tale/ui/number-stepper';
import { useState } from 'react';

export default function InputNumberStepper() {
  const [copies, setCopies] = useState(2);

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span id="stepper-before">Keep</span>
      <NumberStepper
        id="stepper-field"
        aria-labelledby="stepper-before stepper-field stepper-after"
        value={copies}
        min={1}
        max={10}
        onValueChange={setCopies}
      />
      <span id="stepper-after">
        {copies === 1 ? 'backup copy' : 'backup copies'}
      </span>
    </div>
  );
}
