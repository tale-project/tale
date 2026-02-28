"""XLSX text extraction using openpyxl.

Converts spreadsheet rows into plain text for indexing.
"""

from io import BytesIO

from loguru import logger
from openpyxl import load_workbook


async def extract_text_from_xlsx_bytes(
    xlsx_bytes: bytes,
    filename: str = "spreadsheet.xlsx",
) -> tuple[str, bool]:
    """Extract text from XLSX bytes.

    Args:
        xlsx_bytes: Raw XLSX bytes.
        filename: Filename for logging.

    Returns:
        Tuple of (extracted_text, vision_was_used). Vision is never used for XLSX.
    """
    logger.info(f"Processing XLSX: {filename}")

    wb = load_workbook(BytesIO(xlsx_bytes), read_only=True, data_only=True)
    sheets_text: list[str] = []

    for sheet_name in wb.sheetnames:
        ws = wb[sheet_name]
        rows_text: list[str] = []

        for row in ws.iter_rows(values_only=True):
            cells = [str(cell) if cell is not None else "" for cell in row]
            line = " | ".join(cells).strip()
            if line and line != "|":
                rows_text.append(line)

        if rows_text:
            sheet_header = f"--- Sheet: {sheet_name} ---"
            sheets_text.append(f"{sheet_header}\n" + "\n".join(rows_text))

    wb.close()

    combined_text = "\n\n".join(sheets_text)
    logger.info(
        f"XLSX processing complete: {len(sheets_text)} sheets, {len(combined_text)} chars"
    )

    return combined_text, False
