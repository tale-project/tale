/**
 * The two colour vocabularies, side by side. Every swatch is a real utility
 * class — nothing here is a hex value, which is exactly the rule the page
 * describes.
 */

const CANONICAL = [
  { className: 'bg-bg-base', label: 'bg-bg-base' },
  { className: 'bg-bg-elevated', label: 'bg-bg-elevated' },
  { className: 'bg-bg-muted', label: 'bg-bg-muted' },
  { className: 'bg-accent-base', label: 'bg-accent-base' },
  { className: 'bg-success-bg', label: 'bg-success-bg' },
  { className: 'bg-warning-bg', label: 'bg-warning-bg' },
  { className: 'bg-danger-bg', label: 'bg-danger-bg' },
  { className: 'bg-info-bg', label: 'bg-info-bg' },
];

const HSL = [
  { className: 'bg-background', label: 'bg-background' },
  { className: 'bg-card', label: 'bg-card' },
  { className: 'bg-muted', label: 'bg-muted' },
  { className: 'bg-primary', label: 'bg-primary' },
  { className: 'bg-secondary', label: 'bg-secondary' },
  { className: 'bg-destructive', label: 'bg-destructive' },
  { className: 'bg-success', label: 'bg-success' },
  { className: 'bg-warning', label: 'bg-warning' },
];

function Swatches({
  title,
  swatches,
}: {
  title: string;
  swatches: { className: string; label: string }[];
}) {
  return (
    <div className="w-full">
      <p className="text-muted-foreground mb-2 text-[11px] font-semibold tracking-wider uppercase">
        {title}
      </p>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {swatches.map((swatch) => (
          <li key={swatch.label} className="flex flex-col gap-1.5">
            <span
              className={`border-border h-12 w-full rounded-md border ${swatch.className}`}
            />
            <code className="text-muted-foreground text-[11px]">
              {swatch.label}
            </code>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function ColorTokens() {
  return (
    <div className="flex w-full flex-col gap-6">
      <Swatches title="Canonical family" swatches={CANONICAL} />
      <Swatches title="HSL family" swatches={HSL} />
    </div>
  );
}
