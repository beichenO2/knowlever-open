"""Layer 5C: Reasoning Enhancement — Comparison & Contradiction.

Provides:
1. Comparison queries: compare two concepts across multiple dimensions
2. Contradiction surfacing: detect conflicting statements across sources
3. Multi-hop tracing: follow cross-references to find indirect connections

These operate on wiki pages (Layer 3) and can be augmented by
the retrieval layer (Layer 4/5A) for additional context.
"""

from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT))


@dataclass
class ComparisonResult:
    subject_a: str
    subject_b: str
    dimensions: list[dict[str, Any]]
    shared_sources: list[str]
    conflicts: list[str]


@dataclass
class ContradictionCandidate:
    page_a: str
    page_b: str
    statement_a: str
    statement_b: str
    confidence: float
    dimension: str


def _parse_frontmatter(text: str) -> tuple[dict, str]:
    if not text.startswith("---"):
        return {}, text
    end = text.find("---", 3)
    if end == -1:
        return {}, text
    fm_block = text[3:end]
    body = text[end + 3:].strip()
    meta = {}
    for line in fm_block.strip().split("\n"):
        if ":" in line:
            key, _, val = line.partition(":")
            meta[key.strip()] = val.strip().strip('"')
    return meta, body


def _load_wiki_page(wiki_dir: Path, slug: str) -> tuple[dict, str] | None:
    md_path = wiki_dir / f"{slug}.md"
    if md_path.exists():
        return _parse_frontmatter(md_path.read_text(encoding="utf-8"))
    for sub in ("sources", "entities", "concepts", "comparisons"):
        candidate = wiki_dir / sub / f"{slug}.md"
        if candidate.exists():
            return _parse_frontmatter(candidate.read_text(encoding="utf-8"))
    return None


def _extract_key_statements(body: str) -> list[str]:
    """Extract sentences that look like factual claims."""
    statements = []
    for line in body.split("\n"):
        line = line.strip()
        if not line or line.startswith("#") or line.startswith(">") or line.startswith("---"):
            continue
        if line.startswith("- ") or line.startswith("* "):
            line = line[2:]
        if len(line) > 30 and any(word in line.lower() for word in [
            "is", "are", "was", "uses", "requires", "provides", "should",
            "must", "enables", "prevents", "causes", "because", "therefore",
            "however", "unlike", "compared", "whereas", "but",
        ]):
            statements.append(line[:300])
    return statements


def _find_negation_pairs(stmts_a: list[str], stmts_b: list[str]) -> list[tuple[str, str, float]]:
    """Heuristic contradiction detection via negation patterns."""
    negation_words = {"not", "never", "no", "without", "unlike", "instead", "rather", "however"}
    contradictions = []

    for sa in stmts_a:
        sa_words = set(sa.lower().split())
        for sb in stmts_b:
            sb_words = set(sb.lower().split())
            overlap = sa_words & sb_words
            if len(overlap) < 3:
                continue

            a_neg = bool(sa_words & negation_words)
            b_neg = bool(sb_words & negation_words)

            if a_neg != b_neg and len(overlap) >= 5:
                confidence = min(len(overlap) / 10, 0.8)
                contradictions.append((sa, sb, confidence))

    return contradictions


def compare_pages(
    wiki_dir: str | Path,
    slug_a: str,
    slug_b: str,
) -> ComparisonResult | None:
    """Compare two wiki pages across structural dimensions."""
    wiki_path = Path(wiki_dir)

    page_a = _load_wiki_page(wiki_path, slug_a)
    page_b = _load_wiki_page(wiki_path, slug_b)

    if not page_a or not page_b:
        return None

    meta_a, body_a = page_a
    meta_b, body_b = page_b

    dimensions = []

    # Type comparison
    dimensions.append({
        "dimension": "Page Type",
        "a": meta_a.get("type", "?"),
        "b": meta_b.get("type", "?"),
    })

    # Confidence comparison
    dimensions.append({
        "dimension": "Confidence",
        "a": meta_a.get("confidence", "?"),
        "b": meta_b.get("confidence", "?"),
    })

    # Word count
    words_a = len(body_a.split())
    words_b = len(body_b.split())
    dimensions.append({
        "dimension": "Word Count",
        "a": str(words_a),
        "b": str(words_b),
    })

    # Headings structure
    headings_a = len(re.findall(r"^#{1,3}\s+", body_a, re.MULTILINE))
    headings_b = len(re.findall(r"^#{1,3}\s+", body_b, re.MULTILINE))
    dimensions.append({
        "dimension": "Sections",
        "a": str(headings_a),
        "b": str(headings_b),
    })

    # Wiki links
    links_a = set(re.findall(r"\[\[([^\]]+)\]\]", body_a))
    links_b = set(re.findall(r"\[\[([^\]]+)\]\]", body_b))
    shared_links = links_a & links_b
    dimensions.append({
        "dimension": "Wiki Links",
        "a": str(len(links_a)),
        "b": str(len(links_b)),
        "shared": list(shared_links),
    })

    # Tags comparison
    tags_a = set(meta_a.get("tags", "").split(","))
    tags_b = set(meta_b.get("tags", "").split(","))
    shared_tags = {t.strip() for t in tags_a & tags_b if t.strip()}
    dimensions.append({
        "dimension": "Shared Tags",
        "a": meta_a.get("tags", ""),
        "b": meta_b.get("tags", ""),
        "shared": list(shared_tags),
    })

    # Detect contradictions
    stmts_a = _extract_key_statements(body_a)
    stmts_b = _extract_key_statements(body_b)
    contradictions = _find_negation_pairs(stmts_a, stmts_b)
    conflicts = [f"A: {a[:100]} vs B: {b[:100]}" for a, b, _ in contradictions]

    return ComparisonResult(
        subject_a=meta_a.get("title", slug_a),
        subject_b=meta_b.get("title", slug_b),
        dimensions=dimensions,
        shared_sources=list(shared_links),
        conflicts=conflicts,
    )


def surface_contradictions(
    wiki_dir: str | Path,
    min_confidence: float = 0.3,
) -> list[ContradictionCandidate]:
    """Scan all wiki pages for potential contradictions."""
    wiki_path = Path(wiki_dir)
    pages = {}

    for md_file in sorted(wiki_path.rglob("*.md")):
        content = md_file.read_text(encoding="utf-8")
        meta, body = _parse_frontmatter(content)
        slug = md_file.stem
        pages[slug] = {
            "meta": meta,
            "statements": _extract_key_statements(body),
        }

    candidates = []
    slugs = list(pages.keys())

    for i in range(len(slugs)):
        for j in range(i + 1, len(slugs)):
            slug_a, slug_b = slugs[i], slugs[j]
            stmts_a = pages[slug_a]["statements"]
            stmts_b = pages[slug_b]["statements"]

            for sa, sb, conf in _find_negation_pairs(stmts_a, stmts_b):
                if conf >= min_confidence:
                    candidates.append(ContradictionCandidate(
                        page_a=slug_a,
                        page_b=slug_b,
                        statement_a=sa[:200],
                        statement_b=sb[:200],
                        confidence=conf,
                        dimension="negation",
                    ))

    candidates.sort(key=lambda c: c.confidence, reverse=True)
    return candidates


def multi_hop_trace(
    wiki_dir: str | Path,
    start_slug: str,
    max_hops: int = 3,
) -> dict[str, list[str]]:
    """Trace wiki-link paths from a starting page."""
    wiki_path = Path(wiki_dir)
    visited = set()
    paths = {}

    def _trace(slug: str, depth: int, path: list[str]):
        if depth > max_hops or slug in visited:
            return
        visited.add(slug)

        page = _load_wiki_page(wiki_path, slug)
        if not page:
            return

        _, body = page
        links = re.findall(r"\[\[([^\]]+)\]\]", body)
        targets = [l.strip().lower().replace(" ", "-") for l in links]

        for target in targets:
            new_path = path + [target]
            if target not in paths or len(new_path) < len(paths[target]):
                paths[target] = new_path
            _trace(target, depth + 1, new_path)

    _trace(start_slug, 0, [start_slug])
    return paths


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Layer 5C Reasoning Enhancement")
    sub = parser.add_subparsers(dest="command")

    p_compare = sub.add_parser("compare", help="Compare two wiki pages")
    p_compare.add_argument("page_a")
    p_compare.add_argument("page_b")
    p_compare.add_argument("--topic", required=True)
    p_compare.add_argument("--user", default="admin")

    p_contra = sub.add_parser("contradictions", help="Surface contradictions")
    p_contra.add_argument("--topic", required=True)
    p_contra.add_argument("--user", default="admin")
    p_contra.add_argument("--min-confidence", type=float, default=0.3)

    p_trace = sub.add_parser("trace", help="Multi-hop trace from a page")
    p_trace.add_argument("start_page")
    p_trace.add_argument("--topic", required=True)
    p_trace.add_argument("--user", default="admin")
    p_trace.add_argument("--max-hops", type=int, default=3)

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        return

    wiki_dir = ROOT / "data" / "users" / args.user / "topics" / args.topic / "wiki"
    if not wiki_dir.exists():
        print(f"Error: topic not found: {wiki_dir}", file=sys.stderr)
        sys.exit(1)

    if args.command == "compare":
        result = compare_pages(str(wiki_dir), args.page_a, args.page_b)
        if not result:
            print("One or both pages not found")
            sys.exit(1)
        print(f"=== Comparison: {result.subject_a} vs {result.subject_b} ===\n")
        for d in result.dimensions:
            shared = f" (shared: {d['shared']})" if 'shared' in d else ""
            print(f"  {d['dimension']}:")
            print(f"    A: {d['a']}")
            print(f"    B: {d['b']}{shared}")
        if result.conflicts:
            print(f"\n  Potential Conflicts ({len(result.conflicts)}):")
            for c in result.conflicts:
                print(f"    ⚠️  {c}")

    elif args.command == "contradictions":
        candidates = surface_contradictions(str(wiki_dir), args.min_confidence)
        print(f"=== Contradictions in {args.topic} ({len(candidates)} found) ===\n")
        for c in candidates:
            print(f"  [{c.confidence:.2f}] {c.page_a} ↔ {c.page_b}")
            print(f"    A: {c.statement_a[:150]}")
            print(f"    B: {c.statement_b[:150]}")
            print()

    elif args.command == "trace":
        paths = multi_hop_trace(str(wiki_dir), args.start_page, args.max_hops)
        print(f"=== Trace from {args.start_page} (max {args.max_hops} hops) ===\n")
        for target, path in sorted(paths.items(), key=lambda x: len(x[1])):
            print(f"  {' → '.join(path)} ({len(path)-1} hops)")


if __name__ == "__main__":
    main()
