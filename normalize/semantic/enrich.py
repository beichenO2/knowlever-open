#!/usr/bin/env python3
"""Layer 2B Semantic Enrichment — Agent/Claw mode via PolarPrivate Proxy.

Produces semantic.json for normalized sources:
- noise_score: 0.0 (clean) to 1.0 (mostly noise)
- concepts: extracted key concepts
- summary: brief content summary
- suggested_confidence: quality confidence (when noise < 0.5)

Image sources: enrichment runs on OCR text from Layer 2A. Sources still
awaiting OCR (processing_status == ocr_pending / deterministic_normalized
with source_type == image) are skipped with a marker in semantic.json.

LLM backends (degradation chain):
1. PolarPrivate Proxy → cloud capability codes (4-bit QCSA: 0000–1111, V-prefix)
2. PolarPrivate local L-codes → Ollama (L0000 embedding)
3. Heuristic fallback (no LLM)

The LLM is treated as a Claw/Agent with a system prompt defining its role,
and each enrichment task is a multi-turn conversation (not single-shot).

Usage:
    python normalize/semantic/enrich.py <normalized_source_dir>
    python normalize/semantic/enrich.py --topic <name> --user admin  # enrich all
    python normalize/semantic/enrich.py --topic <name> --backend polarprivate
    python normalize/semantic/enrich.py --topic <name> --backend local
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Any
from urllib.request import Request, urlopen
from urllib.error import URLError

ROOT = Path(__file__).resolve().parent.parent.parent

sys.path.insert(0, str(ROOT / "adapters"))
_create_compiler = None
try:
    from llm_compiler import create_compiler as _create_compiler
except ImportError:
    pass

def _discover_polarprivate_url() -> str:
    config_path = ROOT / "config.json"
    if config_path.exists():
        try:
            cfg = json.loads(config_path.read_text())
            base = cfg.get("llm", {}).get("base_url")
            if base:
                return base
        except Exception:
            pass
    return f"http://127.0.0.1:{os.environ.get('POLARPRIVATE_PORT', '12790')}"

POLARPRIVATE_URL = os.environ.get("POLARPRIVATE_URL") or _discover_polarprivate_url()

SYSTEM_PROMPT = """\
你是 KnowLever 知识质量分析师，负责分析文档并生成结构化评估。

规则：
- 结构化输出时必须返回合法 JSON
- 精确简洁
- 噪声评分要诚实 — 结构良好的学习指南得 0.1，广告充斥的页面得 0.9
- 提取的概念（concepts）必须使用中文，代表真正重要的知识点，不是表面词汇
- 摘要（summary）必须使用中文，抓住核心论点，而非简单列举主题
- 所有面向用户的输出全部使用中文
"""


def _post_json(url: str, payload: dict, timeout: float = 120.0) -> dict:
    data = json.dumps(payload).encode("utf-8")
    req = Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    with urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read())


class AgentChat:
    """Multi-turn chat session via PolarPrivate (cloud codes or local L-codes)."""

    def __init__(self, backend: str = "auto", model: str | None = None):
        self.backend = backend
        self.model = model
        self.messages: list[dict[str, str]] = [
            {"role": "system", "content": SYSTEM_PROMPT}
        ]
        self._resolved_backend: str | None = None

    def _detect_backend(self) -> str:
        """Detect available backend via llm-compiler: polarprivate → local → heuristic."""
        if self.backend != "auto":
            return self.backend

        compiler = _create_compiler()
        detected = compiler.detect_backend()
        if "fallback" in detected:
            return "heuristic"
        if detected in ("polarprivate", "local"):
            return detected
        return "heuristic"

    @property
    def active_backend(self) -> str:
        if self._resolved_backend is None:
            self._resolved_backend = self._detect_backend()
        return self._resolved_backend

    def send(self, user_message: str) -> str | None:
        """Send a message and get the assistant's reply. Returns None if LLM unavailable."""
        self.messages.append({"role": "user", "content": user_message})

        backend = self.active_backend
        reply: str | None = None

        if backend == "polarprivate":
            reply = self._call_polarprivate()
        elif backend == "local":
            reply = self._call_local()

        if reply:
            self.messages.append({"role": "assistant", "content": reply})

        return reply

    @staticmethod
    def _capability_code(raw: str | None) -> str:
        if raw and len(raw) == 4 and set(raw) <= {"0", "1"}:
            return raw
        if raw and raw.upper().startswith("V") and len(raw) == 5:
            return raw.upper()
        if raw and raw.upper().startswith("L") and len(raw) == 5:
            return raw.upper()
        return "0001"

    def _call_polarprivate(self) -> str | None:
        """Call PolarPrivate with opaque cloud capability code (no vendor model names)."""
        capability = self._capability_code(self.model)
        try:
            resp = _post_json(
                f"{POLARPRIVATE_URL}/v1/chat/completions",
                {
                    "model": capability,
                    "messages": self.messages,
                    "temperature": 0.2,
                    "max_tokens": 800,
                    "stream": False,
                },
                timeout=120.0,
            )
            choices = resp.get("choices", [])
            if choices:
                return choices[0].get("message", {}).get("content", "").strip()
        except (URLError, OSError, KeyError) as e:
            print(f"  [warn] PolarPrivate error: {e}", file=sys.stderr)
        return None

    def _call_local(self) -> str | None:
        """Call PolarPrivate local tier (L-prefix → Ollama)."""
        cap = self._capability_code(self.model)
        model = f"L{cap}"
        try:
            resp = _post_json(
                f"{POLARPRIVATE_URL}/v1/chat/completions",
                {
                    "model": model,
                    "messages": self.messages,
                    "max_tokens": 800,
                    "temperature": 0.2,
                    "stream": False,
                },
                timeout=120.0,
            )
            choices = resp.get("choices", [])
            if choices:
                return choices[0].get("message", {}).get("content", "").strip()
            return None
        except (URLError, OSError):
            return None

    def reset_turns(self):
        """Keep system prompt but clear conversation history."""
        self.messages = [self.messages[0]]


def _heuristic_noise_score(text: str) -> float:
    if not text.strip():
        return 1.0
    lines = text.strip().split("\n")
    non_empty = [l for l in lines if l.strip()]
    if not non_empty:
        return 1.0

    heading_count = sum(1 for l in non_empty if l.strip().startswith("#"))
    avg_line_len = sum(len(l) for l in non_empty) / len(non_empty)
    short_line_ratio = sum(1 for l in non_empty if len(l.strip()) < 10) / len(non_empty)

    score = 0.0
    if heading_count == 0:
        score += 0.2
    if avg_line_len < 20:
        score += 0.3
    if short_line_ratio > 0.5:
        score += 0.2
    if len(text) < 200:
        score += 0.2
    return min(score, 1.0)


def _heuristic_concepts(text: str) -> list[str]:
    concepts = []
    for match in re.finditer(r"^#{1,3}\s+(.+)$", text, re.MULTILINE):
        heading = match.group(1).strip()
        if 3 < len(heading) < 80:
            concepts.append(heading)
    return concepts[:20]


def _parse_json_from_reply(reply: str) -> Any:
    """Extract JSON from an LLM reply that may contain markdown fences."""
    # Try direct parse first
    reply = reply.strip()
    if reply.startswith("```"):
        lines = reply.split("\n")
        lines = [l for l in lines if not l.strip().startswith("```")]
        reply = "\n".join(lines).strip()

    try:
        return json.loads(reply)
    except json.JSONDecodeError:
        pass

    # Try extracting JSON object or array
    for pattern in [r"\{[\s\S]*\}", r"\[[\s\S]*?\]"]:
        m = re.search(pattern, reply)
        if m:
            try:
                return json.loads(m.group(0))
            except json.JSONDecodeError:
                continue

    return None


def enrich_source(source_dir: Path, agent: AgentChat) -> dict[str, Any]:
    """Run semantic enrichment on a single normalized source via multi-turn agent chat."""
    content_path = source_dir / "content.md"
    metadata_path = source_dir / "metadata.json"

    if not content_path.exists():
        return {"error": "no content.md"}

    content = content_path.read_text(encoding="utf-8")
    metadata = json.loads(metadata_path.read_text()) if metadata_path.exists() else {}

    is_image = metadata.get("source_type") == "image"
    ocr_ready = metadata.get("processing_status") == "ocr_complete"
    if is_image and not ocr_ready:
        skip_result = {
            "source_id": metadata.get("source_id", source_dir.name),
            "skipped": True,
            "skip_reason": "image source awaiting OCR — enrich after Layer 2A OCR completes",
            "processing_status": metadata.get("processing_status", "unknown"),
            "enrichment_time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        (source_dir / "semantic.json").write_text(
            json.dumps(skip_result, ensure_ascii=False, indent=2) + "\n"
        )
        return skip_result

    start = time.time()
    result: dict[str, Any] = {
        "source_id": metadata.get("source_id", source_dir.name),
        "enrichment_time": "",
        "methods_used": [],
        "backend": agent.active_backend,
    }

    agent.reset_turns()
    content_snippet = content[:3000]
    using_llm = agent.active_backend != "heuristic"

    # Turn 1: Introduce document and get noise assessment
    if using_llm:
        reply = agent.send(
            f"我在分析一篇文档的知识质量。以下是内容（可能被截取）：\n\n"
            f"---\n{content_snippet}\n---\n\n"
            f"首先，评估这篇文档的噪声水平。"
            f"从 0.0（干净、结构良好的知识）到 1.0（主要是噪声、广告、模板内容）打分。"
            f"只返回一个 JSON 对象：{{\"noise_score\": <float>, \"reasoning\": \"<简要理由，中文>\"}}"
        )

        if reply:
            parsed = _parse_json_from_reply(reply)
            if parsed and isinstance(parsed, dict) and "noise_score" in parsed:
                result["noise_score"] = min(max(float(parsed["noise_score"]), 0.0), 1.0)
                result["noise_reasoning"] = parsed.get("reasoning", "")
                result["methods_used"].append(f"{agent.active_backend}-noise")
            else:
                try:
                    score = float(re.search(r"(\d+\.?\d*)", reply).group(1))
                    result["noise_score"] = min(max(score, 0.0), 1.0)
                    result["methods_used"].append(f"{agent.active_backend}-noise")
                except (ValueError, AttributeError):
                    result["noise_score"] = _heuristic_noise_score(content)
                    result["methods_used"].append("heuristic-noise")
        else:
            result["noise_score"] = _heuristic_noise_score(content)
            result["methods_used"].append("heuristic-noise")
    else:
        result["noise_score"] = _heuristic_noise_score(content)
        result["methods_used"].append("heuristic-noise")

    # Turn 2: Extract concepts (building on agent's understanding from Turn 1)
    if using_llm:
        reply = agent.send(
            "现在从这篇文档中提取 5-10 个最重要的概念。"
            "这些应该是领域特定的知识点（中文），而非泛泛的词汇。"
            "只返回一个 JSON 字符串数组（中文概念名），例如：[\"套利策略\", \"风险管理\", \"Agent架构\"]"
        )

        if reply:
            parsed = _parse_json_from_reply(reply)
            if isinstance(parsed, list) and len(parsed) > 0:
                result["concepts"] = [str(c) for c in parsed[:15]]
                result["methods_used"].append(f"{agent.active_backend}-concepts")
            else:
                result["concepts"] = _heuristic_concepts(content)
                result["methods_used"].append("heuristic-concepts")
        else:
            result["concepts"] = _heuristic_concepts(content)
            result["methods_used"].append("heuristic-concepts")
    else:
        result["concepts"] = _heuristic_concepts(content)
        result["methods_used"].append("heuristic-concepts")

    # Turn 3: Generate summary (agent already knows the document and concepts)
    if using_llm:
        reply = agent.send(
            "基于你的分析，用中文写 1-2 句摘要，抓住这篇文档的核心论点或目的。要具体，不要泛泛而谈。"
        )

        if reply and len(reply) > 10:
            cleaned = reply.strip().strip('"').strip("'")
            result["summary"] = cleaned[:500]
            result["methods_used"].append(f"{agent.active_backend}-summary")
        else:
            first_para = _extract_first_paragraph(content)
            result["summary"] = first_para
            result["methods_used"].append("heuristic-summary")
    else:
        result["summary"] = _extract_first_paragraph(content)
        result["methods_used"].append("heuristic-summary")

    # Turn 4 (optional): If noise is low enough, ask for quality assessment
    if using_llm and result.get("noise_score", 1.0) < 0.5:
        reply = agent.send(
            "最终评估：从 0.0 到 1.0，你对这篇文档包含可靠、有据可查的知识有多少信心？"
            "考虑：深度、引用质量、内部一致性和具体性。"
            "只返回一个 JSON 对象：{\"confidence\": <float>, \"notes\": \"<简要说明，中文>\"}"
        )

        if reply:
            parsed = _parse_json_from_reply(reply)
            if parsed and isinstance(parsed, dict) and "confidence" in parsed:
                result["suggested_confidence"] = min(max(float(parsed["confidence"]), 0.0), 1.0)
                result["confidence_notes"] = parsed.get("notes", "")
                result["methods_used"].append(f"{agent.active_backend}-confidence")

    result["enrichment_time"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    result["duration_ms"] = int((time.time() - start) * 1000)
    result["turns"] = len(agent.messages) - 1  # exclude system prompt

    # Write semantic.json
    semantic_path = source_dir / "semantic.json"
    semantic_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")

    # Update metadata processing_status
    if metadata_path.exists():
        metadata["processing_status"] = "semantic_enriched"
        metadata_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n")

    return result


def _extract_first_paragraph(content: str) -> str:
    for line in content.split("\n"):
        s = line.strip()
        if s and not s.startswith("#") and not s.startswith("---") and not s.startswith(">") and len(s) > 20:
            return s[:200]
    return ""


def enrich_topic(topic: str, user: str = "admin", agent: AgentChat | None = None) -> list[dict]:
    """Enrich all normalized sources in a topic."""
    topic_dir = ROOT / "data" / "users" / user / "topics" / topic / "normalized"
    if not topic_dir.exists():
        print(f"No normalized/ directory for topic '{topic}'", file=sys.stderr)
        return []

    if agent is None:
        agent = AgentChat()

    print(f"[enrich] Backend: {agent.active_backend}")

    results = []
    sources = sorted(d for d in topic_dir.iterdir() if d.is_dir() and (d / "content.md").exists())
    total = len(sources)

    for i, source_dir in enumerate(sources, 1):
        print(f"  [{i}/{total}] {source_dir.name}...", end=" ", flush=True)
        result = enrich_source(source_dir, agent)
        methods = ", ".join(result.get("methods_used", []))
        turns = result.get("turns", 0)
        print(f"done ({methods}, {turns} turns, {result.get('duration_ms', 0)}ms)")
        results.append(result)

    return results


def main():
    parser = argparse.ArgumentParser(description="Layer 2B Semantic Enrichment (Agent/Claw mode)")
    parser.add_argument("source_dir", nargs="?", help="Path to normalized source directory")
    parser.add_argument("--topic", help="Enrich all sources in a topic")
    parser.add_argument("--user", default="admin")
    parser.add_argument("--backend", default="auto", choices=["auto", "polarprivate", "local", "heuristic"])
    parser.add_argument("--model", default=None, help="Capability code (4-bit QCSA 0000–1111 / V-prefix) or L-code")
    args = parser.parse_args()

    agent = AgentChat(backend=args.backend, model=args.model)

    if args.topic:
        print(f"[enrich] Topic: {args.topic} (user: {args.user})")
        results = enrich_topic(args.topic, args.user, agent)
        total_turns = sum(r.get("turns", 0) for r in results)
        print(f"\n[enrich] Done — {len(results)} source(s) enriched, {total_turns} total LLM turns")
    elif args.source_dir:
        source_dir = Path(args.source_dir)
        if not source_dir.exists():
            print(f"Error: {source_dir} not found", file=sys.stderr)
            sys.exit(1)
        result = enrich_source(source_dir, agent)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
