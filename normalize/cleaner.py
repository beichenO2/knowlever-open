#!/usr/bin/env python3
"""Content Cleaner — Layer 2.5 between normalize and compile.

Filters normalized content to retain only knowledge and methodology,
removing software tutorials, promotional content, and other non-knowledge material.

Two modes:
  1. Rule-based (fast, no LLM): pattern matching for common non-knowledge indicators
  2. LLM-powered (thorough): uses LLM to classify sections as knowledge vs noise

Pipeline position:
  raw → normalize (L2A/L2B) → **cleaner (L2.5)** → compile (L3) → build (L6)

Usage:
    python normalize/cleaner.py --topic <name> [--user admin] [--dry-run]
    python normalize/cleaner.py --topic <name> --mode llm [--backend polarprivate]
    python normalize/cleaner.py --topic <name> --source <source_id>
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

SOFTWARE_PATTERNS = [
    r"点击[「「\"]?.*?[」」\"]?按钮",
    r"打开.*?(软件|平台|界面|工具|app|应用)",
    r"(登录|登入|注册|下载|安装|卸载)",
    r"(鼠标|右键|左键|双击|拖拽|拖动)",
    r"(菜单栏|工具栏|状态栏|导航栏|侧边栏)",
    r"(截图|屏幕|桌面|窗口|弹窗|对话框)",
    r"(复制|粘贴|ctrl\+|command\+|快捷键)",
    r"(版本号|升级|更新.*?版本)",
    r"(设置.*?选项|参数.*?配置|首选项)",
    r"如图所示|如下图|见图\d|参见截图",
]

PROMO_PATTERNS = [
    r"(扫码|二维码|关注|订阅|分享|转发)",
    r"(微信群|QQ群|加群|入群|联系客服)",
    r"(优惠|折扣|限时|特价|原价|现价)",
    r"(课程链接|购买|下单|报名|付款)",
    r"(免费领取|赠送|福利|抽奖)",
    r"(广告|推广|合作|赞助)",
]

KNOWLEDGE_INDICATORS = [
    r"(原理|机制|理论|规律|定律|公式|模型)",
    r"(策略|方法论|框架|体系|思路|逻辑)",
    r"(分析|研究|论证|推导|证明)",
    r"(风险管理|资金管理|仓位|止损|止盈)",
    r"(趋势|支撑|阻力|形态|指标|信号)",
    r"(概率|统计|回测|绩效|收益率)",
    r"(市场结构|价格行为|供需|多空)",
    r"(经验|教训|案例|实战|复盘)",
    r"(核心|本质|关键|根本|底层)",
]

compiled_software = [re.compile(p, re.I) for p in SOFTWARE_PATTERNS]
compiled_promo = [re.compile(p, re.I) for p in PROMO_PATTERNS]
compiled_knowledge = [re.compile(p, re.I) for p in KNOWLEDGE_INDICATORS]


def classify_line(line: str) -> str:
    """Classify a single line as 'knowledge', 'software', 'promo', or 'neutral'."""
    stripped = line.strip()
    if not stripped or stripped.startswith("#") or stripped.startswith("---"):
        return "neutral"

    sw_hits = sum(1 for p in compiled_software if p.search(stripped))
    pr_hits = sum(1 for p in compiled_promo if p.search(stripped))
    kn_hits = sum(1 for p in compiled_knowledge if p.search(stripped))

    if sw_hits >= 2:
        return "software"
    if pr_hits >= 1:
        return "promo"
    if sw_hits >= 1 and kn_hits == 0:
        return "software"
    if kn_hits >= 1:
        return "knowledge"
    return "neutral"


def classify_section(lines: list[str]) -> dict:
    """Classify a section (group of lines) and return stats."""
    classifications = [classify_line(line) for line in lines]
    total = len([c for c in classifications if c != "neutral"])
    if total == 0:
        return {"type": "neutral", "knowledge_ratio": 0.5, "lines": len(lines)}

    knowledge = sum(1 for c in classifications if c == "knowledge")
    software = sum(1 for c in classifications if c == "software")
    promo = sum(1 for c in classifications if c == "promo")

    ratio = knowledge / total if total > 0 else 0.5
    dominant = "knowledge" if knowledge >= software + promo else (
        "software" if software > promo else "promo"
    )

    return {
        "type": dominant,
        "knowledge_ratio": round(ratio, 2),
        "knowledge_lines": knowledge,
        "software_lines": software,
        "promo_lines": promo,
        "neutral_lines": sum(1 for c in classifications if c == "neutral"),
        "lines": len(lines),
    }


def split_into_sections(content: str) -> list[dict]:
    """Split content into sections by headings."""
    sections = []
    current_heading = "(intro)"
    current_lines: list[str] = []

    for line in content.split("\n"):
        heading_match = re.match(r"^(#{1,4})\s+(.+)$", line)
        if heading_match:
            if current_lines:
                sections.append({
                    "heading": current_heading,
                    "lines": current_lines,
                })
            current_heading = heading_match.group(2).strip()
            current_lines = [line]
        else:
            current_lines.append(line)

    if current_lines:
        sections.append({
            "heading": current_heading,
            "lines": current_lines,
        })

    return sections


def clean_content(content: str, threshold: float = 0.2) -> dict:
    """Clean content by removing non-knowledge sections.

    Args:
        content: The full markdown content
        threshold: Minimum knowledge ratio to keep a section (0.0-1.0)

    Returns:
        dict with 'cleaned' content, 'removed' sections, and 'stats'
    """
    sections = split_into_sections(content)

    kept = []
    removed = []

    for section in sections:
        stats = classify_section(section["lines"])
        section["stats"] = stats

        if stats["type"] in ("software", "promo") and stats["knowledge_ratio"] < threshold:
            removed.append(section)
        else:
            kept.append(section)

    cleaned_content = "\n".join(
        "\n".join(s["lines"]) for s in kept
    )

    total_lines = sum(len(s["lines"]) for s in sections)
    kept_lines = sum(len(s["lines"]) for s in kept)
    removed_lines = sum(len(s["lines"]) for s in removed)

    return {
        "cleaned": cleaned_content,
        "removed_sections": [
            {"heading": s["heading"], "type": s["stats"]["type"],
             "lines": len(s["lines"]), "knowledge_ratio": s["stats"]["knowledge_ratio"]}
            for s in removed
        ],
        "stats": {
            "total_sections": len(sections),
            "kept_sections": len(kept),
            "removed_sections_count": len(removed),
            "total_lines": total_lines,
            "kept_lines": kept_lines,
            "removed_lines": removed_lines,
            "retention_ratio": round(kept_lines / total_lines, 2) if total_lines > 0 else 1.0,
        },
    }


def clean_source(normalized_dir: Path, source_id: str, dry_run: bool = False) -> dict | None:
    """Clean a single normalized source's content.md."""
    source_dir = normalized_dir / source_id
    content_file = source_dir / "content.md"

    if not content_file.exists():
        return None

    content = content_file.read_text(encoding="utf-8")

    fm_end = -1
    if content.startswith("---"):
        fm_end = content.find("---", 3)
        if fm_end > 0:
            fm_end = content.index("\n", fm_end) + 1

    frontmatter = content[:fm_end] if fm_end > 0 else ""
    body = content[fm_end:] if fm_end > 0 else content

    result = clean_content(body)

    if not dry_run and result["stats"]["removed_sections_count"] > 0:
        backup_file = source_dir / "content.md.pre-clean"
        if not backup_file.exists():
            backup_file.write_text(content, encoding="utf-8")

        cleaned_full = frontmatter + result["cleaned"]
        content_file.write_text(cleaned_full, encoding="utf-8")

        clean_log = source_dir / "clean-log.json"
        clean_log.write_text(
            json.dumps({
                "source_id": source_id,
                "removed": result["removed_sections"],
                "stats": result["stats"],
            }, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )

    return {
        "source_id": source_id,
        **result["stats"],
    }


def main():
    parser = argparse.ArgumentParser(description="Content Cleaner (Layer 2.5)")
    parser.add_argument("--topic", required=True)
    parser.add_argument("--user", default="admin")
    parser.add_argument("--source", help="Clean a specific source")
    parser.add_argument("--dry-run", action="store_true", help="Analyze without modifying")
    parser.add_argument("--threshold", type=float, default=0.2,
                        help="Min knowledge ratio to keep a section (default: 0.2)")
    args = parser.parse_args()

    base = ROOT / "data" / "users" / args.user / "topics" / args.topic
    normalized_dir = base / "normalized"

    if not normalized_dir.exists():
        print(f"Error: normalized directory not found: {normalized_dir}", file=sys.stderr)
        sys.exit(1)

    if args.source:
        result = clean_source(normalized_dir, args.source, dry_run=args.dry_run)
        if result:
            print(f"[clean] {result['source_id']}: "
                  f"kept {result['kept_sections']}/{result['total_sections']} sections, "
                  f"retention {result['retention_ratio']:.0%}")
            if result["removed_sections_count"] > 0:
                print(f"  Removed {result['removed_sections_count']} non-knowledge sections "
                      f"({result['removed_lines']} lines)")
        else:
            print(f"Source not found: {args.source}")
        return

    sources = sorted([
        d.name for d in normalized_dir.iterdir()
        if d.is_dir() and (d / "content.md").exists()
    ])

    print(f"[clean] Topic: {args.topic}")
    print(f"[clean] Sources: {len(sources)}")
    print(f"[clean] Mode: {'DRY RUN' if args.dry_run else 'LIVE'}")
    print(f"[clean] Threshold: {args.threshold}")
    print()

    total_removed = 0
    total_kept = 0
    cleaned_sources = 0

    for source_id in sources:
        result = clean_source(normalized_dir, source_id, dry_run=args.dry_run)
        if result and result["removed_sections_count"] > 0:
            cleaned_sources += 1
            total_removed += result["removed_lines"]
            total_kept += result["kept_lines"]
            print(f"  🧹 {source_id}: removed {result['removed_sections_count']} sections "
                  f"({result['removed_lines']} lines), retention {result['retention_ratio']:.0%}")
        elif result:
            total_kept += result["total_lines"]

    print(f"\n[clean] Done — {cleaned_sources}/{len(sources)} sources had content cleaned")
    if total_removed > 0:
        print(f"[clean] Removed: {total_removed} lines, Kept: {total_kept} lines")
        if args.dry_run:
            print("[clean] DRY RUN — no files modified")


if __name__ == "__main__":
    main()
