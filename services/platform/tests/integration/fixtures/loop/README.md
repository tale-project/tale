# Synthetic Loop page fixture

`standup.loop.pdf` stands in for what Microsoft Graph answers when a sync asks
for a Loop page as a PDF (`GET …/content?format=pdf`): a one-page PDF, which
the sync stores under the page's name with `.pdf` added. It is not Graph's
output, so it proves that the platform reads such a page, not what Graph puts
in one. It holds a made-up stand-up and no client data:

```text
Daily stand-up
Yesterday
Mia finished the import of the Meetings folder.
Today
Jonas checks that search finds the stand-up notes.
Blockers
None.
```

SHA-256:

- `standup.loop.pdf`: `8ce6f2c00c18fce72ce9e9d504c778897517d77cd47116c0a289227ccb70f658`

To regenerate, run from `services/platform`:

```js
import { writeFileSync } from 'node:fs';

const lines = [
  [20, 'Daily stand-up'],
  [14, 'Yesterday'],
  [11, 'Mia finished the import of the Meetings folder.'],
  [14, 'Today'],
  [11, 'Jonas checks that search finds the stand-up notes.'],
  [14, 'Blockers'],
  [11, 'None.'],
];
const stream = [
  'BT',
  '72 740 Td',
  ...lines.flatMap(([size, text], index) => [
    `/F1 ${size} Tf`,
    ...(index === 0 ? [] : ['0 -28 Td']),
    `(${text}) Tj`,
  ]),
  'ET',
].join('\n');
const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
  `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
];
let pdf = '%PDF-1.7\n';
const offsets = [];
objects.forEach((body, i) => {
  offsets.push(pdf.length);
  pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
});
const xref = pdf.length;
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
for (const offset of offsets) {
  pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
}
pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
writeFileSync('tests/integration/fixtures/loop/standup.loop.pdf', pdf);
```
