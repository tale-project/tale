import { Input } from '@tale/ui/input';
import { useState } from 'react';

export default function InputBasic() {
  const [value, setValue] = useState('Northwind Trading');

  return (
    <div className="w-full max-w-sm">
      <Input
        label="Workspace name"
        description="Shown in the sidebar and on every invitation."
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
    </div>
  );
}
