import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { capture, projectRoot } from './exec';

// SheetJS supplies independent XLS/XLSX bytes; the image reads them with
// xlrd/openpyxl. Only synthetic fixture bytes enter the offline container.
function spreadsheetFixture(extension: 'xls' | 'xlsx') {
  const bytes = readFileSync(
    new URL(
      `../fixtures/document-tools/workbook.${extension}`,
      import.meta.url,
    ),
  );
  return {
    base64: bytes.toString('base64'),
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

const PYTHON_CHECK = String.raw`
import base64
import hashlib
import importlib
import importlib.metadata
import io
import json
import os
import platform
import signal
import sys
from pathlib import Path

signal.alarm(60)
data = json.load(sys.stdin)
assert os.getuid() == data["uid"]
assert sys.version_info[:2] == (3, 12)
if data["architecture"] is not None:
    assert platform.machine() == data["architecture"]
modules = {
    "defusedxml": "defusedxml",
    "elementpath": "elementpath",
    "et-xmlfile": "et_xmlfile",
    "openpyxl": "openpyxl",
    "pypdf": "pypdf",
    "PyYAML": "yaml",
    "xlrd": "xlrd",
    "xmlschema": "xmlschema",
}
assert set(data["versions"]) == set(modules)
problems = []
for name, expected in data["versions"].items():
    try:
        actual = importlib.metadata.version(name)
        if actual != expected:
            problems.append(f"{name}: expected {expected}, found {actual}")
    except importlib.metadata.PackageNotFoundError:
        problems.append(f"{name}: missing")
assert not problems, "; ".join(problems)
assert hashlib.sha256(
    Path("/opt/tale/document-python-requirements.txt").read_bytes()
).hexdigest() == data["requirementsSha256"]

verified = 0
for name, module in modules.items():
    importlib.import_module(module)
    distribution = importlib.metadata.distribution(name)
    hashed = 0
    for file in distribution.files or ():
        if file.hash is None:
            continue
        content = distribution.locate_file(file).read_bytes()
        digest = hashlib.new(file.hash.mode, content).digest()
        actual = base64.urlsafe_b64encode(digest).rstrip(b"=").decode()
        assert actual == file.hash.value, f"{name}: changed installed file {file}"
        hashed += 1
    assert hashed > 0, f"{name}: missing installed RECORD hashes"
    verified += hashed

import openpyxl
import pypdf
import xlrd
import xmlschema
import yaml
from defusedxml import ElementTree
from defusedxml.common import EntitiesForbidden
from openpyxl.xml import DEFUSEDXML

assert DEFUSEDXML, "openpyxl must enable its XML entity protection"
sources = {}
for kind in ("xls", "xlsx"):
    source = base64.b64decode(data[kind]["base64"], validate=True)
    assert hashlib.sha256(source).hexdigest() == data[kind]["sha256"]
    sources[kind] = source
assert sources["xls"].startswith(bytes.fromhex("d0cf11e0a1b11ae1"))
assert sources["xlsx"].startswith(b"PK")

legacy = xlrd.open_workbook(file_contents=sources["xls"])
sheet = legacy.sheet_by_name("Documents")
assert sheet.row_values(0) == ["Item", "Amount"]
assert sheet.row_values(1) == ["Example", 123.45]
legacy.release_resources()
modern = openpyxl.load_workbook(io.BytesIO(sources["xlsx"]), read_only=True)
assert list(modern["Documents"].values) == [
    ("Item", "Amount"), ("Example", 123.45)
]
modern.close()
for kind, source in sources.items():
    assert hashlib.sha256(source).hexdigest() == data[kind]["sha256"]

writer = pypdf.PdfWriter()
writer.add_blank_page(width=72, height=144)
writer.add_blank_page(width=144, height=72)
writer.add_metadata({"/Title": "Synthetic document"})
pdf = io.BytesIO()
writer.write(pdf)
pdf_bytes = pdf.getvalue()
pdf_hash = hashlib.sha256(pdf_bytes).hexdigest()
reader = pypdf.PdfReader(io.BytesIO(pdf_bytes), strict=True)
assert len(reader.pages) == 2
assert reader.metadata.title == "Synthetic document"
assert tuple(float(v) for v in reader.pages[0].mediabox) == (0, 0, 72, 144)
assert tuple(float(v) for v in reader.pages[1].mediabox) == (0, 0, 144, 72)
assert hashlib.sha256(pdf_bytes).hexdigest() == pdf_hash

assert yaml.safe_load("title: Example\nenabled: true\n") == {
    "title": "Example", "enabled": True
}
try:
    yaml.safe_load("!!python/object/apply:builtins.str [unsafe]")
except yaml.constructor.ConstructorError:
    pass
else:
    raise AssertionError("safe YAML parsing accepted a Python object tag")

schema = xmlschema.XMLSchema('''
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="amount" type="xs:decimal"/>
</xs:schema>
''')
assert schema.is_valid("<amount>123.45</amount>")
assert not schema.is_valid("<amount>not-a-number</amount>")
try:
    ElementTree.fromstring('<!DOCTYPE x [<!ENTITY e "forbidden">]><x>&e;</x>')
except EntitiesForbidden:
    pass
else:
    raise AssertionError("XML entity declaration was accepted")

print(json.dumps({
    "uid": os.getuid(),
    "architecture": platform.machine(),
    "versions": data["versions"],
    "requirementsSha256": data["requirementsSha256"],
    "recordFilesVerified": verified,
    "formats": ["PDF", "XLSX", "XLS", "YAML", "XML"],
    "refusals": ["unsafe YAML tag", "invalid XSD value", "XML entity"],
    "inputDigests": {kind: data[kind]["sha256"] for kind in sources},
}))
`;

/** Exercise the baked document toolchain without a network or writable root. */
export async function checkDocumentTools(
  image: string,
  uid: 65534 | 10001,
  platform?: 'linux/amd64' | 'linux/arm64',
) {
  const requirements = readFileSync(
    join(
      projectRoot(),
      'services/sandbox-runtime/document-python-requirements.txt',
    ),
    'utf8',
  );
  const versions: Record<string, string> = {};
  for (const line of requirements.split('\n')) {
    if (line.trim() === '' || line.startsWith('#')) continue;
    const match = /^(\S+)==(\S+) --hash=sha256:/.exec(line);
    if (!match) throw new Error(`Unpinned document requirement: ${line}`);
    versions[match[1]!] = match[2]!;
  }
  return await capture(
    [
      'docker',
      'run',
      '--rm',
      '-i',
      ...(platform ? ['--platform', platform] : []),
      '--network',
      'none',
      '--read-only',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      '--memory',
      '256m',
      '--pids-limit',
      '128',
      '--user',
      `${uid}:${uid}`,
      '--tmpfs',
      `/tmp:uid=${uid},gid=${uid},mode=700`,
      '--env',
      'PYTHONDONTWRITEBYTECODE=1',
      '--env',
      'PIP_NO_INDEX=1',
      '--entrypoint',
      'python3',
      image,
      '-c',
      PYTHON_CHECK,
    ],
    {
      stdin: JSON.stringify({
        uid,
        architecture: platform
          ? platform === 'linux/amd64'
            ? 'x86_64'
            : 'aarch64'
          : null,
        versions,
        requirementsSha256: createHash('sha256')
          .update(requirements)
          .digest('hex'),
        xls: spreadsheetFixture('xls'),
        xlsx: spreadsheetFixture('xlsx'),
      }),
    },
  );
}
