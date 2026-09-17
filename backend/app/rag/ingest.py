"""Knowledge-base ingestion: markdown files with front matter, chunked by `##` section."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

FRONT_MATTER = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)
SAFE_DOC_ID = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")


@dataclass
class Document:
    id: str
    title: str
    category: str
    body: str
    path: Path
    meta: dict[str, str] = field(default_factory=dict)


@dataclass
class Chunk:
    id: str
    doc_id: str
    doc_title: str
    category: str
    section: str
    text: str


def parse_markdown(path: Path) -> Document:
    raw = path.read_text(encoding="utf-8")
    meta: dict[str, str] = {}
    match = FRONT_MATTER.match(raw)
    body = raw
    if match:
        for line in match.group(1).splitlines():
            if ":" in line:
                key, value = line.split(":", 1)
                meta[key.strip()] = value.strip()
        body = raw[match.end():]
    title = meta.get("title")
    if not title:
        h1 = re.search(r"^#\s+(.+)$", body, re.MULTILINE)
        title = h1.group(1).strip() if h1 else path.stem.replace("_", " ").title()
    return Document(
        id=path.stem,
        title=title,
        category=meta.get("category", "general"),
        body=body.strip(),
        path=path,
        meta=meta,
    )


def chunk_document(doc: Document) -> list[Chunk]:
    chunks: list[Chunk] = []
    parts = re.split(r"^##\s+", doc.body, flags=re.MULTILINE)
    intro = re.sub(r"^#\s+.+$", "", parts[0], flags=re.MULTILINE).strip()
    if intro:
        chunks.append(Chunk(f"{doc.id}#intro", doc.id, doc.title, doc.category, doc.title, intro))
    for i, part in enumerate(parts[1:], start=1):
        heading, _, text = part.partition("\n")
        text = text.strip()
        if not text:
            continue
        slug = re.sub(r"[^a-z0-9]+", "-", heading.lower()).strip("-") or str(i)
        chunks.append(Chunk(f"{doc.id}#{slug}", doc.id, doc.title, doc.category, heading.strip(), text))
    return chunks


def load_documents(directory: Path) -> list[Document]:
    directory.mkdir(parents=True, exist_ok=True)
    return [parse_markdown(p) for p in sorted(directory.glob("*.md"))]


def render_markdown(title: str, category: str, body: str) -> str:
    return f"---\ntitle: {title}\ncategory: {category}\n---\n\n{body.strip()}\n"
