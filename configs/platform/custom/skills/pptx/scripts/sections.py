"""Keep the sections of a PPTX in step with its slides.

Usage: python sections.py <file.pptx | unpacked_dir>

Examples:
    python sections.py output.pptx
    python sections.py unpacked/

A template's sections (p14:sectionLst in ppt/presentation.xml) keep listing
slides after they leave <p:sldIdLst> and know nothing of slides added since,
so PowerPoint shows the template's sections empty and the new slides outside
them. This script:
- Changes nothing while every slide is listed once, in deck order, and no
  section lists a slide that is gone
- Drops section entries for slides no longer in <p:sldIdLst>
- Puts a slide that is in no section into the section of the slide before it
  (slides ahead of every sectioned slide into the first section that still
  holds one)
- Keeps each section one run of slides: a section stays where most of its
  slides sit together, and its slides elsewhere join the section of the
  slide before them (of the slide after them, at the start of the deck)
- Orders the sections, and the slides in each, as <p:sldIdLst> orders them
- Removes the sections it leaves empty, and the whole section list when no
  slide is left in one. A section that listed no slide before is kept, after
  the section it followed

clean.py runs this on an unpacked directory. Run it yourself on a finished
.pptx built another way (python-pptx on a template, for instance). A deck
without sections is left as it is.

python-pptx has no way to delete a slide; delete one with delete_slide(prs,
slide) from this module, which takes it out of its section as well.
"""

import os
import stat
import sys
import tempfile
import zipfile
from pathlib import Path

import defusedxml.minidom

P_NS = "http://schemas.openxmlformats.org/presentationml/2006/main"
P14_NS = "http://schemas.microsoft.com/office/powerpoint/2010/main"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PRESENTATION = "ppt/presentation.xml"

SMART_QUOTE_REPLACEMENTS = {
    "\u201c": "&#x201C;",
    "\u201d": "&#x201D;",
    "\u2018": "&#x2018;",
    "\u2019": "&#x2019;",
}


def reconcile_sections(dom) -> bool:
    order = _deck_order(dom)
    changed = False
    for section_lst in dom.getElementsByTagNameNS(P14_NS, "sectionLst"):
        if _reconcile(section_lst, order):
            changed = True
    return changed


def list_sections(dom) -> list[tuple[str, int]]:
    return [
        (section.getAttribute("name"), len(_entries(section)))
        for section in dom.getElementsByTagNameNS(P14_NS, "section")
    ]


def used_slide_ids(dom) -> set[int]:
    """Every slide id <p:sldIdLst> or a section uses, whatever their prefixes."""
    return {
        int(value)
        for namespace in (P_NS, P14_NS)
        for sld_id in dom.getElementsByTagNameNS(namespace, "sldId")
        if (value := sld_id.getAttribute("id")).isascii() and value.isdigit()
    }


def next_slide_id(unpacked_dir: Path) -> int:
    """The id add_slide.py gives a new slide, which names its relationship.

    The relationship of a slide add_slide.py makes is rId<slide id>, so the
    slides made before whose <p:sldId> is not in <p:sldIdLst> yet still hold
    their ids. The new id is above those and every id <p:sldIdLst> or a
    section uses: a new slide never takes the id a section still lists for a
    deleted slide. An id whose relationship name is taken is skipped.
    """
    dom = defusedxml.minidom.parse(str(unpacked_dir / "ppt" / "presentation.xml"))
    rels = defusedxml.minidom.parse(
        str(unpacked_dir / "ppt" / "_rels" / "presentation.xml.rels")
    ).getElementsByTagName("Relationship")
    listed = {
        sld_id.getAttributeNS(R_NS, "id")
        for sld_id in dom.getElementsByTagNameNS(P_NS, "sldId")
    }
    held = {
        int(rid[3:])
        for rel in rels
        if rel.getAttribute("Type").endswith("/slide")
        and (rid := rel.getAttribute("Id")) not in listed
        and rid.startswith("rId")
        and rid[3:].isascii()
        and rid[3:].isdigit()
    }
    taken = {rel.getAttribute("Id") for rel in rels}
    slide_id = max(used_slide_ids(dom) | held | {255}) + 1
    while f"rId{slide_id}" in taken:
        slide_id += 1
    return slide_id


def sync_unpacked(unpacked_dir: Path) -> tuple[bool, list[tuple[str, int]]]:
    pres_path = unpacked_dir / "ppt" / "presentation.xml"
    if not pres_path.exists():
        return False, []

    dom = defusedxml.minidom.parse(str(pres_path))
    changed = reconcile_sections(dom)
    if changed:
        _write_unpacked(pres_path, dom)
    return changed, list_sections(dom)


def sync_pptx(pptx_path: Path) -> tuple[bool, list[tuple[str, int]]]:
    with zipfile.ZipFile(pptx_path) as zf:
        if PRESENTATION not in zf.namelist():
            return False, []
        dom = defusedxml.minidom.parseString(zf.read(PRESENTATION))

    changed = reconcile_sections(dom)
    if changed:
        _replace_in_zip(pptx_path, PRESENTATION, _serialize(dom))
    return changed, list_sections(dom)


def add_after_source(unpacked_dir: Path, source: str, new_id: int) -> str | None:
    pres_path = unpacked_dir / "ppt" / "presentation.xml"
    rels_path = unpacked_dir / "ppt" / "_rels" / "presentation.xml.rels"
    if not pres_path.exists() or not rels_path.exists():
        return None

    rels_dom = defusedxml.minidom.parse(str(rels_path))
    source_rids = {
        rel.getAttribute("Id")
        for rel in rels_dom.getElementsByTagName("Relationship")
        if rel.getAttribute("Target") in (f"slides/{source}", f"/ppt/slides/{source}")
    }

    dom = defusedxml.minidom.parse(str(pres_path))
    source_id = next(
        (
            sld_id.getAttribute("id")
            for sld_id in dom.getElementsByTagNameNS(P_NS, "sldId")
            if sld_id.getAttributeNS(R_NS, "id") in source_rids
        ),
        None,
    )
    if not source_id:
        return None

    for section in dom.getElementsByTagNameNS(P14_NS, "section"):
        for entry in _entries(section):
            if entry.getAttribute("id") == source_id:
                new_entry = entry.cloneNode(False)
                new_entry.setAttribute("id", str(new_id))
                _insert_after(entry, new_entry)
                _write_unpacked(pres_path, dom)
                return section.getAttribute("name")

    return None


def delete_slide(prs, slide) -> None:
    """Delete a slide from a python-pptx Presentation, and from its section.

    Removing only the slide's <p:sldId> leaves it listed in its section, and
    python-pptx gives the next slide it adds the highest id in <p:sldIdLst>
    plus one, so that slide can take the deleted slide's id and section. It
    also names a new slide's file after the slide count, which a remaining
    slide can still hold. This removes the slide's <p:sldId>, its
    relationship, its section entries and a section that keeps no slide
    (the section list too when none is left), and numbers the remaining
    slide files in deck order. Save the deck and run sections.py on it.
    """
    pres = prs.element
    presentation = prs.part
    sld_id_lst = pres.find(f"{{{P_NS}}}sldIdLst")
    slides = [] if sld_id_lst is None else sld_id_lst.findall(f"{{{P_NS}}}sldId")
    sld_id = next(
        (
            sld_id
            for sld_id in slides
            if presentation.related_part(sld_id.get(f"{{{R_NS}}}id")) is slide.part
        ),
        None,
    )
    if sld_id is None:
        raise ValueError("the slide is not in this presentation")

    slide_id = sld_id.get("id")
    sld_id_lst.remove(sld_id)
    presentation.drop_rel(sld_id.get(f"{{{R_NS}}}id"))

    for ext_lst in pres.findall(f"{{{P_NS}}}extLst"):
        for ext in ext_lst.findall(f"{{{P_NS}}}ext"):
            for section_lst in ext.findall(f"{{{P14_NS}}}sectionLst"):
                if _unlist(section_lst, slide_id):
                    ext.remove(section_lst)
                    if len(ext) == 0:
                        ext_lst.remove(ext)
                        if len(ext_lst) == 0:
                            pres.remove(ext_lst)

    presentation.rename_slide_parts(
        [entry.get(f"{{{R_NS}}}id") for entry in sld_id_lst.findall(f"{{{P_NS}}}sldId")]
    )
    # A slide another slide still links to stays in the package: keep its
    # file name out of the way of the slides numbered above.
    slide.part.partname = type(slide.part.partname)(
        f"/ppt/slides/deleted-slide{slide_id}.xml"
    )


def _unlist(section_lst, slide_id: str) -> bool:
    """Drop a slide's entries, and each section that leaves without a slide.

    True when that took the list's last section.
    """
    removed = False
    for section in section_lst.findall(f"{{{P14_NS}}}section"):
        dropped = False
        for entries in section.findall(f"{{{P14_NS}}}sldIdLst"):
            for entry in entries.findall(f"{{{P14_NS}}}sldId"):
                if entry.get("id") == slide_id:
                    entries.remove(entry)
                    dropped = True
        if dropped and section.find(f"{{{P14_NS}}}sldIdLst/{{{P14_NS}}}sldId") is None:
            section_lst.remove(section)
            removed = True
    return removed and section_lst.find(f"{{{P14_NS}}}section") is None


def _reconcile(section_lst, order: list[str]) -> bool:
    sections = _children(section_lst, P14_NS, "section")
    listed = [
        [entry.getAttribute("id") for entry in _entries(section)]
        for section in sections
    ]
    if [slide_id for slide_ids in listed for slide_id in slide_ids] == order:
        return False

    in_deck = set(order)
    owner = {}
    for index, slide_ids in enumerate(listed):
        for slide_id in slide_ids:
            if slide_id in in_deck:
                owner.setdefault(slide_id, index)

    runs = _plan(order, owner)
    if not runs:
        _remove_section_list(section_lst)
        return True

    # A section that listed no slide was empty on purpose (a placeholder in
    # someone's own deck): keep it after the section it followed.
    kept = [index for index, _ in runs]
    for index, slide_ids in enumerate(listed):
        if not slide_ids:
            before = next((p for p in range(index - 1, -1, -1) if p in kept), None)
            kept.insert(0 if before is None else kept.index(before) + 1, index)

    for index, slide_ids in runs:
        _set_slide_ids(sections[index], slide_ids)
    _replace_children(section_lst, [sections[index] for index in kept])
    return True


def _plan(order: list[str], owner: dict[str, int]) -> list[tuple[int, list[str]]]:
    first = next((owner[s] for s in order if s in owner), None)
    if first is None:
        return []

    assigned = []
    for slide_id in order:
        assigned.append(owner.get(slide_id, assigned[-1] if assigned else first))
    runs = _group(order, assigned)

    # Each section stays with the run holding most of its own slides (the
    # first on a tie); the slides of its other runs join their neighbours.
    home = {}
    for position, (index, slide_ids) in enumerate(runs):
        own = sum(1 for s in slide_ids if owner.get(s) == index)
        if index not in home or own > home[index][1]:
            home[index] = (position, own)

    resolved = []
    for position, (index, _) in enumerate(runs):
        if home[index][0] != position:
            index = (
                resolved[-1]
                if resolved
                else next(
                    runs[p][0]
                    for p in range(position + 1, len(runs))
                    if home[runs[p][0]][0] == p
                )
            )
        resolved.append(index)

    return _group(
        order,
        [resolved[p] for p, (_, slide_ids) in enumerate(runs) for _ in slide_ids],
    )


def _group(order: list[str], assigned: list[int]) -> list[tuple[int, list[str]]]:
    runs = []
    for slide_id, index in zip(order, assigned, strict=True):
        if runs and runs[-1][0] == index:
            runs[-1][1].append(slide_id)
        else:
            runs.append((index, [slide_id]))
    return runs


def _deck_order(dom) -> list[str]:
    order = []
    seen = set()
    for sld_id_lst in dom.getElementsByTagNameNS(P_NS, "sldIdLst"):
        for sld_id in _children(sld_id_lst, P_NS, "sldId"):
            slide_id = sld_id.getAttribute("id")
            if slide_id and slide_id not in seen:
                seen.add(slide_id)
                order.append(slide_id)
    return order


def _children(node, namespace: str, local_name: str) -> list:
    return [
        child
        for child in node.childNodes
        if child.nodeType == child.ELEMENT_NODE
        and child.namespaceURI == namespace
        and child.localName == local_name
    ]


def _entries(section) -> list:
    lists = _children(section, P14_NS, "sldIdLst")
    return _children(lists[0], P14_NS, "sldId") if lists else []


def _set_slide_ids(section, slide_ids: list[str]) -> None:
    doc = section.ownerDocument
    lists = _children(section, P14_NS, "sldIdLst")
    if lists:
        sld_id_lst = lists[0]
    else:
        sld_id_lst = doc.createElementNS(P14_NS, _qualified(section, "sldIdLst"))
        section.insertBefore(sld_id_lst, section.firstChild)

    existing = {}
    for entry in _children(sld_id_lst, P14_NS, "sldId"):
        existing.setdefault(entry.getAttribute("id"), entry)

    entries = []
    for slide_id in slide_ids:
        entry = existing.pop(slide_id, None)
        if entry is None:
            entry = doc.createElementNS(P14_NS, _qualified(section, "sldId"))
            entry.setAttribute("id", slide_id)
        entries.append(entry)
    _replace_children(sld_id_lst, entries)


def _qualified(node, local_name: str) -> str:
    return f"{node.prefix}:{local_name}" if node.prefix else local_name


def _is_blank(node) -> bool:
    return (
        node is not None and node.nodeType == node.TEXT_NODE and not node.data.strip()
    )


def _replace_children(parent, nodes: list) -> None:
    elements = [c for c in parent.childNodes if c.nodeType == c.ELEMENT_NODE]
    indent = tail = ""
    if elements:
        if _is_blank(elements[0].previousSibling):
            indent = elements[0].previousSibling.data
        if _is_blank(elements[-1].nextSibling):
            tail = elements[-1].nextSibling.data
    elif _is_blank(parent.previousSibling):
        tail = parent.previousSibling.data
        indent = tail + "  "

    for child in list(parent.childNodes):
        parent.removeChild(child)

    doc = parent.ownerDocument
    for node in nodes:
        if indent:
            parent.appendChild(doc.createTextNode(indent))
        parent.appendChild(node)
    if tail and nodes:
        parent.appendChild(doc.createTextNode(tail))


def _insert_after(node, new_node) -> None:
    parent = node.parentNode
    following = node.nextSibling
    if _is_blank(node.previousSibling):
        parent.insertBefore(
            node.ownerDocument.createTextNode(node.previousSibling.data), following
        )
    parent.insertBefore(new_node, following)


def _remove(node) -> None:
    parent = node.parentNode
    if _is_blank(node.previousSibling):
        parent.removeChild(node.previousSibling)
    parent.removeChild(node)


def _remove_section_list(section_lst) -> None:
    ext = section_lst.parentNode
    if ext.nodeType != ext.ELEMENT_NODE or ext.localName != "ext":
        _remove(section_lst)
        return
    if any(
        c.nodeType == c.ELEMENT_NODE and c is not section_lst for c in ext.childNodes
    ):
        _remove(section_lst)
        return

    ext_lst = ext.parentNode
    _remove(ext)
    if ext_lst.nodeType == ext_lst.ELEMENT_NODE and not any(
        c.nodeType == c.ELEMENT_NODE for c in ext_lst.childNodes
    ):
        _remove(ext_lst)


def _serialize(dom) -> bytes:
    return dom.toxml(encoding="UTF-8", standalone=dom.standalone)


def _write_unpacked(path: Path, dom) -> None:
    content = _serialize(dom).decode("utf-8")
    for char, entity in SMART_QUOTE_REPLACEMENTS.items():
        content = content.replace(char, entity)
    path.write_bytes(content.encode("utf-8"))


def _replace_in_zip(zip_path: Path, name: str, data: bytes) -> None:
    fd, temp_name = tempfile.mkstemp(
        dir=zip_path.parent, prefix=f".{zip_path.name}.", suffix=".tmp"
    )
    os.close(fd)
    temp_path = Path(temp_name)
    try:
        with zipfile.ZipFile(zip_path) as src, zipfile.ZipFile(temp_path, "w") as dst:
            dst.comment = src.comment
            for info in src.infolist():
                dst.writestr(info, data if info.filename == name else src.read(info))
        os.chmod(temp_path, stat.S_IMODE(zip_path.stat().st_mode))
        os.replace(temp_path, zip_path)
    finally:
        temp_path.unlink(missing_ok=True)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python sections.py <file.pptx | unpacked_dir>", file=sys.stderr)
        print("Example: python sections.py output.pptx", file=sys.stderr)
        sys.exit(1)

    target = Path(sys.argv[1])

    if target.is_dir():
        changed, sections = sync_unpacked(target)
    elif target.is_file() and target.suffix.lower() == ".pptx":
        changed, sections = sync_pptx(target)
    else:
        print(f"Error: {target} is not a .pptx file or a directory", file=sys.stderr)
        sys.exit(1)

    if changed and sections:
        print(f"Updated the sections of {target}:")
    elif changed:
        print(f"Removed the sections of {target}: no slide is left in one")
    elif sections:
        print(f"The sections of {target} already match its slides:")
    else:
        print(f"{target} has no sections")
    for name, count in sections:
        print(f"  {name}: {count} slide{'' if count == 1 else 's'}")
