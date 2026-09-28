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

// Runs under the image's own NODE_PATH from a directory with no node_modules
// above it, so every require() below resolves through the baked prefix.
const NODE_CHECK = String.raw`
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync, realpathSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const root = realpathSync('/opt/tale/document-node');
const out = process.argv[1];
const expected = JSON.parse(readFileSync(0, 'utf8'));
const lockBytes = readFileSync(join(root, 'package-lock.json'));
assert.equal(
  createHash('sha256').update(lockBytes).digest('hex'),
  expected.lockSha256,
);
const lock = JSON.parse(lockBytes);
const installed = JSON.parse(
  readFileSync(join(root, 'node_modules/.package-lock.json'), 'utf8'),
);
let integrityChecked = 0;
for (const [key, entry] of Object.entries(installed.packages)) {
  assert.ok(entry.integrity, key + ': installed without an integrity hash');
  assert.equal(entry.integrity, lock.packages[key]?.integrity, key);
  integrityChecked++;
}
const versions = {};
for (const name of Object.keys(expected.versions)) {
  versions[name] = JSON.parse(
    readFileSync(join(root, 'node_modules', name, 'package.json'), 'utf8'),
  ).version;
}
for (const name of ['docx', 'pptxgenjs', 'sharp']) {
  assert.ok(
    require.resolve(name).startsWith(join(root, 'node_modules', name) + '/'),
    require.resolve(name),
  );
}

(async () => {
  const docx = require('docx');
  const PptxGenJS = require('pptxgenjs');
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const sharp = require('sharp');
  const { FaCheckCircle } = require('react-icons/fa');

  const document = new docx.Document({
    sections: [
      {
        children: [
          new docx.Paragraph({
            children: [new docx.TextRun('Synthetic document')],
          }),
        ],
      },
    ],
  });
  writeFileSync(join(out, 'document.docx'), await docx.Packer.toBuffer(document));

  const svg = renderToStaticMarkup(
    React.createElement(FaCheckCircle, { color: '#4472C4', size: '256' }),
  );
  const icon = await sharp(Buffer.from(svg)).png().toBuffer();
  const meta = await sharp(icon).metadata();
  assert.equal(meta.format, 'png');
  assert.equal(meta.width, 256);

  const deck = new PptxGenJS();
  const slide = deck.addSlide();
  slide.addText('Synthetic slide', { x: 1, y: 1, w: 6, h: 1 });
  slide.addImage({
    data: 'image/png;base64,' + icon.toString('base64'),
    x: 1,
    y: 2,
    w: 0.5,
    h: 0.5,
  });
  writeFileSync(
    join(out, 'deck.pptx'),
    await deck.write({ outputType: 'nodebuffer' }),
  );
  console.log(JSON.stringify({ versions, integrityChecked }));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
`;

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
import subprocess
import sys
import tempfile
from pathlib import Path

signal.alarm(120)
data = json.load(sys.stdin)
assert os.getuid() == data["uid"]
assert sys.version_info[:2] == (3, 12)
if data["architecture"] is not None:
    assert platform.machine() == data["architecture"]
modules = {
    "beautifulsoup4": "bs4",
    "certifi": "certifi",
    "cffi": "cffi",
    "charset-normalizer": "charset_normalizer",
    "click": "click",
    "cryptography": "cryptography",
    "defusedxml": "defusedxml",
    "elementpath": "elementpath",
    "et-xmlfile": "et_xmlfile",
    "flatbuffers": "flatbuffers",
    "idna": "idna",
    "lxml": "lxml.etree",
    "magika": "magika",
    "markdownify": "markdownify",
    "markitdown": "markitdown",
    "numpy": "numpy",
    "onnxruntime": "onnxruntime",
    "openpyxl": "openpyxl",
    "packaging": "packaging",
    "pandas": "pandas",
    "pdf2image": "pdf2image",
    "pdfminer-six": "pdfminer",
    "pdfplumber": "pdfplumber",
    "pillow": "PIL.Image",
    "protobuf": "google.protobuf",
    "pycparser": "pycparser",
    "pypdf": "pypdf",
    "pypdfium2": "pypdfium2",
    "python-dateutil": "dateutil",
    "python-dotenv": "dotenv",
    "python-pptx": "pptx",
    "PyYAML": "yaml",
    "reportlab": "reportlab",
    "requests": "requests",
    "six": "six",
    "soupsieve": "soupsieve",
    "typing-extensions": "typing_extensions",
    "urllib3": "urllib3",
    "xlrd": "xlrd",
    "xlsxwriter": "xlsxwriter",
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

# The builtin document skills' own libraries, each on the path the skill takes.
import lxml.etree
import pandas
import pdfplumber
import pypdfium2
from pdf2image import convert_from_bytes
from reportlab.pdfgen import canvas

office_schema = lxml.etree.XMLSchema(lxml.etree.fromstring(b"""
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="slide" type="xs:string"/>
</xs:schema>
"""))
assert office_schema.validate(lxml.etree.fromstring(b"<slide>Synthetic</slide>"))
assert not office_schema.validate(lxml.etree.fromstring(b"<deck/>"))

frame = pandas.read_excel(io.BytesIO(sources["xlsx"]), sheet_name="Documents")
assert frame.to_dict("records") == [{"Item": "Example", "Amount": 123.45}]

report = io.BytesIO()
page = canvas.Canvas(report, pagesize=(200, 100))
page.drawString(20, 50, "Synthetic report")
page.save()
report_bytes = report.getvalue()
with pdfplumber.open(io.BytesIO(report_bytes)) as opened:
    assert "Synthetic report" in opened.pages[0].extract_text()
pdfium = pypdfium2.PdfDocument(report_bytes)
assert pdfium[0].render(scale=1).to_pil().size == (200, 100)
pdfium.close()
rasterized = convert_from_bytes(report_bytes, dpi=72)
assert [image.size for image in rasterized] == [(200, 100)]

# Node writes a Word file and a deck carrying a rasterized icon from the baked
# prefix; pandoc and markitdown (the skills' readers) must read them back.
work = Path(tempfile.mkdtemp())
node = subprocess.run(
    ["node", "-e", data["nodeCheck"], str(work)],
    input=json.dumps({
        "versions": data["nodeVersions"],
        "lockSha256": data["nodeLockSha256"],
    }),
    capture_output=True,
    cwd=work,
    text=True,
    timeout=60,
)
assert node.returncode == 0, node.stderr[-1200:]
node_result = json.loads(node.stdout)
assert node_result["versions"] == data["nodeVersions"]
word = subprocess.run(
    ["pandoc", "--from", "docx", "--to", "plain", str(work / "document.docx")],
    capture_output=True, check=True, text=True, timeout=60,
).stdout
assert "Synthetic document" in word, word
deck = subprocess.run(
    [sys.executable, "-m", "markitdown", str(work / "deck.pptx")],
    capture_output=True, check=True, text=True, timeout=60,
).stdout
assert "Synthetic slide" in deck, deck

print(json.dumps({
    "uid": os.getuid(),
    "architecture": platform.machine(),
    "versions": data["versions"],
    "requirementsSha256": data["requirementsSha256"],
    "recordFilesVerified": verified,
    "formats": ["PDF", "XLSX", "XLS", "YAML", "XML", "DOCX", "PPTX", "PNG"],
    "nodeVersions": node_result["versions"],
    "nodeIntegrityChecked": node_result["integrityChecked"],
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
  const nodeLock = readFileSync(
    join(
      projectRoot(),
      'services/sandbox-runtime/document-node/package-lock.json',
    ),
  );
  const nodeManifest = JSON.parse(
    readFileSync(
      join(
        projectRoot(),
        'services/sandbox-runtime/document-node/package.json',
      ),
      'utf8',
    ),
  ) as { dependencies: Record<string, string> };
  const nodeVersions: Record<string, string> = {};
  for (const [name, version] of Object.entries(nodeManifest.dependencies)) {
    if (!/^\d+\.\d+\.\d+$/.test(version)) {
      throw new Error(`Unpinned document Node package: ${name}@${version}`);
    }
    nodeVersions[name] = version;
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
      // One interpreter imports every baked library (onnxruntime and pandas
      // among them) while Node renders beside it: ~300 MB resident.
      '--memory',
      '1g',
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
        nodeCheck: NODE_CHECK,
        nodeVersions,
        nodeLockSha256: createHash('sha256').update(nodeLock).digest('hex'),
        xls: spreadsheetFixture('xls'),
        xlsx: spreadsheetFixture('xlsx'),
      }),
    },
  );
}
