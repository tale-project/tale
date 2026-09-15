import { Button } from '@tale/ui/button';
import { ContentArea } from '@tale/ui/content-area';
import { Input } from '@tale/ui/input';
import { Select } from '@tale/ui/select';
import { Switch } from '@tale/ui/switch';
import { useState } from 'react';

/**
 * A settings surface: `ContentArea variant="narrow"` declares the row field
 * layout (label left, control right from `sm` up) through `FieldShell`, so
 * every control lines up without a single layout class at the call site. The
 * save bar stays visible; its status and action availability follow the
 * difference between the local draft and saved baseline.
 */
export default function PatternSettingsPage() {
  const [name, setName] = useState('Northwind Trading');
  const [region, setRegion] = useState('ch');
  const [digest, setDigest] = useState(true);
  // This demo saves in memory only; reloading restores the initial example.
  const [saved, setSaved] = useState({ name, region, digest });
  const dirty =
    name !== saved.name || region !== saved.region || digest !== saved.digest;

  return (
    <div className="border-border bg-background w-full overflow-hidden rounded-lg border">
      <ContentArea variant="narrow" className="pb-6">
        <Input
          label="Workspace name"
          description="Shown in the sidebar and on every invitation."
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <Select
          label="Data region"
          description="Where documents and embeddings are stored."
          value={region}
          onValueChange={setRegion}
          options={[
            { value: 'ch', label: 'Switzerland' },
            { value: 'de', label: 'Germany' },
            { value: 'ie', label: 'Ireland' },
          ]}
        />
        <Switch
          label="Weekly digest"
          description="Send a Monday summary to every member."
          checked={digest}
          onCheckedChange={setDigest}
        />
      </ContentArea>
      <div className="border-border bg-muted/40 flex h-13 items-center justify-end gap-2 border-t px-4">
        <span className="text-muted-foreground mr-auto text-xs">
          {dirty ? 'Unsaved changes' : 'Everything saved'}
        </span>
        <Button
          size="sm"
          variant="secondary"
          disabled={!dirty}
          onClick={() => {
            setName(saved.name);
            setRegion(saved.region);
            setDigest(saved.digest);
          }}
        >
          Discard
        </Button>
        <Button
          size="sm"
          disabled={!dirty}
          onClick={() => setSaved({ name, region, digest })}
        >
          Save
        </Button>
      </div>
    </div>
  );
}
