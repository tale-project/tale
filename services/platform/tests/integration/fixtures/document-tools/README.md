# Synthetic spreadsheet fixtures

Both workbooks contain one `Documents` sheet with two rows:
`["Item", "Amount"]` and `["Example", 123.45]`. They contain no client data.
The independent writer is the platform's existing SheetJS 0.20.3 dependency;
the image conformance test reads the binary XLS with xlrd and the XLSX with
openpyxl. Committed bytes keep the release image gate independent of workspace
package installation.

SHA-256:

- `workbook.xls`: `2e1f30dbc5be58d62d2032aea99eff0e1402bd9ff9deaf8f41d5d564a2398214`
- `workbook.xlsx`: `e9b7510e6e4c87296f846b648ff773ee741e05bcd3128e5f96b2a0e8df0961af`

To regenerate, run from `services/platform` after `bun install --frozen-lockfile`:

```js
import * as XLSX from 'xlsx';
import { writeFileSync } from 'node:fs';

if (XLSX.version !== '0.20.3') throw new Error('Fixture generator version changed');
for (const [extension, bookType] of [['xls', 'biff8'], ['xlsx', 'xlsx']]) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ['Item', 'Amount'], ['Example', 123.45],
  ]), 'Documents');
  book.Props = { CreatedDate: new Date('2000-01-01T00:00:00Z') };
  writeFileSync(
    `tests/integration/fixtures/document-tools/workbook.${extension}`,
    XLSX.write(book, { bookType, type: 'buffer' }),
  );
}
```
