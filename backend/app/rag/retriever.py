"""Hybrid lexical retriever: BM25 + TF-IDF cosine, fused with reciprocal rank fusion.

Dependency-free and deterministic, so retrieval quality and confidence scores are
reproducible in tests. The `KnowledgeRetriever` interface (`search`, `reload`) is the
seam for swapping in a vector store (pgvector, Pinecone, etc.) in production.
"""

from __future__ import annotations

import math
import re
import threading
from collections import Counter
from dataclasses import dataclass

from ..config import get_settings
from .ingest import Chunk, Document, chunk_document, load_documents

STOPWORDS = set(
    """a an the and or but if then of to in on at for from by with about as is are was were be been being
    do does did doing have has had i me my we our you your it its this that these those can could would should
    will just so not no any some there here what when where which who how why please hi hello hey thanks
    thank am get got also into up out than too very one two want need know tell""".split()
)

# Support-domain query expansion so customer phrasing matches policy language.
SYNONYMS: dict[str, list[str]] = {
    "refund": ["return", "refund"],
    "money": ["refund"],
    "send": ["return"],
    "package": ["shipment", "order", "delivery"],
    "parcel": ["shipment", "package"],
    "arrive": ["delivery", "delivered"],
    "late": ["delayed"],
    "lost": ["delayed", "lost"],
    "charge": ["charged", "payment", "billing"],
    "charged": ["charge", "payment"],
    "bill": ["billing", "charge"],
    "login": ["password", "sign"],
    "hacked": ["compromise", "takeover"],
    "cancel": ["cancel", "canceling"],
    "membership": ["aurora+", "member"],
    "prime": ["aurora+", "membership"],
    "broken": ["damaged", "defective"],
    "fit": ["sizing", "size"],
    "coupon": ["promo", "code"],
    "discount": ["promo", "code"],
    "track": ["tracking"],
    "ship": ["shipping"],
    "abroad": ["international"],
    "overseas": ["international"],
    "human": ["specialist"],
    "agent": ["specialist"],
}


def _stem(token: str) -> str:
    """Tiny suffix stripper: good enough to conflate ship/shipping, charge/charged/charges."""
    t = token
    if len(t) <= 3:
        return t
    if t.endswith("ies") and len(t) > 5:
        t = t[:-3] + "y"
    elif t.endswith("ing") and len(t) > 5:
        t = t[:-3]
    elif t.endswith("ed") and len(t) > 4:
        t = t[:-2]
    elif t.endswith("es") and len(t) > 4 and t[-3] in "sxh":
        t = t[:-2]
    elif t.endswith("s") and not t.endswith("ss") and len(t) > 3:
        t = t[:-1]
    if len(t) > 4 and t[-1] == t[-2] and t[-1] not in "lsz":
        t = t[:-1]
    if len(t) > 4 and t.endswith("e"):
        t = t[:-1]
    if len(t) > 5 and t.endswith("y"):
        t = t[:-1]
    return t


def tokenize(text: str, expand: bool = False) -> list[str]:
    raw = re.findall(r"[a-z0-9+]+", text.lower())
    tokens: list[str] = []
    for tok in raw:
        if tok in STOPWORDS or len(tok) < 2:
            continue
        tokens.append(_stem(tok))
        if expand and tok in SYNONYMS:
            tokens.extend(_stem(s) for s in SYNONYMS[tok])
    return tokens


@dataclass
class SearchHit:
    chunk: Chunk
    score: float  # calibrated relevance 0..1
    bm25: float
    cosine: float

    def to_dict(self) -> dict:
        return {
            "id": self.chunk.id,
            "doc_id": self.chunk.doc_id,
            "title": self.chunk.doc_title,
            "section": self.chunk.section,
            "category": self.chunk.category,
            "text": self.chunk.text,
            "score": round(self.score, 3),
        }


class KnowledgeRetriever:
    k1 = 1.5
    b = 0.75

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self.documents: list[Document] = []
        self.chunks: list[Chunk] = []
        self.reload()

    # ------------------------------------------------------------------ indexing
    def reload(self) -> None:
        with self._lock:
            self.documents = load_documents(get_settings().knowledge_base_dir)
            self.chunks = [c for d in self.documents for c in chunk_document(d)]
            self._tfs: list[Counter[str]] = []
            df: Counter[str] = Counter()
            for c in self.chunks:
                # Section headings are strong signals; weight them by repeating.
                tokens = tokenize(f"{c.section} {c.section} {c.doc_title} {c.text}")
                tf = Counter(tokens)
                self._tfs.append(tf)
                df.update(tf.keys())
            n = max(len(self.chunks), 1)
            self._idf = {t: math.log(1 + (n - f + 0.5) / (f + 0.5)) for t, f in df.items()}
            self._lens = [sum(tf.values()) for tf in self._tfs]
            self._avgdl = (sum(self._lens) / n) if self._lens else 0.0
            self._norms = [
                math.sqrt(sum((cnt * self._idf[t]) ** 2 for t, cnt in tf.items())) or 1.0 for tf in self._tfs
            ]

    # ------------------------------------------------------------------ search
    def search(self, query: str, top_k: int | None = None, category_hint: str | None = None) -> list[SearchHit]:
        top_k = top_k or get_settings().retrieval_top_k
        q_tokens = tokenize(query, expand=True)
        if not q_tokens or not self.chunks:
            return []
        q_tf = Counter(q_tokens)
        with self._lock:
            bm25_scores: list[float] = []
            cos_scores: list[float] = []
            q_norm = math.sqrt(sum((c * self._idf.get(t, 0)) ** 2 for t, c in q_tf.items())) or 1.0
            for i, tf in enumerate(self._tfs):
                dl = self._lens[i]
                bm = 0.0
                dot = 0.0
                for t, qc in q_tf.items():
                    if t not in tf:
                        continue
                    idf = self._idf[t]
                    f = tf[t]
                    bm += idf * (f * (self.k1 + 1)) / (f + self.k1 * (1 - self.b + self.b * dl / self._avgdl))
                    dot += (qc * idf) * (f * idf)
                cos = dot / (q_norm * self._norms[i])
                if category_hint and self.chunks[i].category == category_hint:
                    bm *= 1.15
                    cos *= 1.15
                bm25_scores.append(bm)
                cos_scores.append(cos)

            rank_bm = {i: r for r, i in enumerate(sorted(range(len(bm25_scores)), key=lambda i: -bm25_scores[i]))}
            rank_cos = {i: r for r, i in enumerate(sorted(range(len(cos_scores)), key=lambda i: -cos_scores[i]))}
            fused = {i: 1 / (60 + rank_bm[i]) + 1 / (60 + rank_cos[i]) for i in range(len(self.chunks))}
            candidates = sorted((i for i in fused if bm25_scores[i] > 0), key=lambda i: -fused[i])[: top_k * 2]

            # Coverage = share of distinct (non-expanded) query terms present in the chunk.
            base_terms = set(tokenize(query)) or set(q_tokens)
            hits = []
            for i in candidates:
                coverage = len(base_terms & self._tfs[i].keys()) / len(base_terms)
                hits.append(SearchHit(self.chunks[i], self._calibrate(cos_scores[i], coverage), bm25_scores[i], cos_scores[i]))
            # Rerank fused candidates by calibrated relevance (blends similarity and term coverage).
            hits.sort(key=lambda h: -(h.score + 0.5 * h.cosine))
            return hits[:top_k]

    @staticmethod
    def _calibrate(cosine: float, coverage: float) -> float:
        """Map raw similarity into a 0..1 relevance score used for confidence scoring."""
        sim = 1 - math.exp(-cosine / 0.18)  # saturating: cos 0.18 -> 0.63, 0.4 -> 0.89
        return max(0.0, min(1.0, 0.65 * sim + 0.35 * coverage))


_retriever: KnowledgeRetriever | None = None
_init_lock = threading.Lock()


def get_retriever() -> KnowledgeRetriever:
    global _retriever
    with _init_lock:
        if _retriever is None:
            _retriever = KnowledgeRetriever()
        return _retriever
