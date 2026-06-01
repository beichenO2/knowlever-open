const PAGE_DATA = {
  "concept-knowledge-compilation": {
    title: "知识编译（Knowledge Compilation）",
    type: "concept",
    summary: "将原始资料转化为结构化、互链、可持续演化的 wiki 页面的过程——不是简单的摘抄，而是有损压缩 + 关系重建。"
  },
  "concept-wiki-first-paradigm": {
    title: "Wiki-first 范式",
    type: "concept",
    summary: "先构建持久化的 wiki 知识网络，再从这个网络派生所有下游输出。Wiki 是系统的中间层，不是副产品。"
  },
  "concept-ingest-query-lint-distill": {
    title: "四大操作：Ingest / Query / Lint / Distill",
    type: "concept",
    summary: "LLM Wiki 系统的四种核心操作模式，定义了 LLM 作为 wiki maintainer 的完整行为空间。"
  },
  "entity-agent-wiki-raw-layer": {
    title: "Raw Sources Layer",
    type: "entity",
    summary: "不可变原始事实层（llm-wiki/raw/），存储三个开源项目的 Git 仓库快照，是系统的 source of truth。"
  },
  "entity-agent-wiki-wiki-layer": {
    title: "Wiki Knowledge Layer",
    type: "entity",
    summary: "持久化知识编译层（llm-wiki/wiki/），由 LLM agent 维护的互链 Markdown 知识网络。"
  },
  "entity-agent-wiki-schema-layer": {
    title: "Schema / LLM Behavior Rules Layer",
    type: "entity",
    summary: "LLM 行为规则定义层（llm-wiki/schema/），约束 agent 的页面创建、命名、链接和工作流规则。"
  },
  "structure-agent-wiki-system-architecture": {
    title: "Agent Wiki 系统架构",
    type: "structure",
    summary: "基于 Karpathy LLM Wiki 理念的三层架构（Raw/Wiki/Schema），外加协调层和输出层。"
  },
  "structure-agent-wiki-multi-agent-topology": {
    title: "Agent Wiki 多 Agent 拓扑",
    type: "structure",
    summary: "4 类 Agent（总控/Mapping/Synthesis/Frontend）通过共享文件实现去中心化状态同步。"
  },
  "comparison-compilation-vs-retrieval": {
    title: "编译 vs 检索：Wiki-first 与 RAG 的范式对比",
    type: "comparison",
    summary: "知识编译（预编译+持续维护）与 RAG（运行时检索+即时生成）两种范式的系统对比。"
  },
  "synthesis-agent-wiki-knowledge-architecture-patterns": {
    title: "Agent Wiki 知识架构模式",
    type: "synthesis",
    summary: "从 Agent Wiki 项目实践中提炼的知识系统架构模式和可迁移经验。"
  },
  "question-why-wiki-not-rag": {
    title: "为什么选择 Wiki-first 而不是 RAG？",
    type: "question",
    summary: "Wiki-first 主张预编译知识并持续维护，RAG 主张运行时检索并即时生成。Agent Wiki 选择前者的设计理由。"
  },
  "src-agent-wiki-tobegin": {
    title: "ToBegin.md — 项目设计蓝图",
    type: "source",
    summary: "882 行核心设计文档，定义三层架构、8 类页面、4 种操作和 Wiki Maintainer 系统提示词。"
  },
  "src-agent-wiki-ignition": {
    title: "点火.md — 项目启动指令",
    type: "source",
    summary: "0 号总控 Agent 的 8 个执行阶段、10 条强约束和恢复机制要求。"
  },
  "src-agent-wiki-project-md": {
    title: "PROJECT.md — 项目定义",
    type: "source",
    summary: "项目核心价值、需求列表、5 项关键决策和 6 条架构约束的正式定义。"
  }
};

const TYPE_COLORS = {
  concept:    { bg: "#e8f4fd", color: "#1976d2", label: "概念" },
  entity:     { bg: "#fff3e0", color: "#e65100", label: "实体" },
  structure:  { bg: "#e8f5e9", color: "#2e7d32", label: "结构" },
  comparison: { bg: "#fce4ec", color: "#c62828", label: "对比" },
  synthesis:  { bg: "#e0f2f1", color: "#00695c", label: "综合" },
  question:   { bg: "#e0f7fa", color: "#00838f", label: "问答" },
  source:     { bg: "#f3e5f5", color: "#7b1fa2", label: "来源" }
};

let tooltip = null;
let hideTimeout = null;

function createTooltip() {
  tooltip = document.createElement("div");
  tooltip.className = "wiki-tooltip";
  tooltip.style.display = "none";
  document.body.appendChild(tooltip);
}

function showTooltip(anchor) {
  const slug = anchor.dataset.slug;
  if (!slug || !PAGE_DATA[slug]) return;

  const data = PAGE_DATA[slug];
  const typeInfo = TYPE_COLORS[data.type] || { bg: "#eee", color: "#333", label: data.type };

  tooltip.innerHTML = `
    <div class="tooltip-header">
      <span class="tooltip-badge" style="background:${typeInfo.bg};color:${typeInfo.color}">${typeInfo.label}</span>
      <span class="tooltip-title">${data.title}</span>
    </div>
    <p class="tooltip-summary">${data.summary}</p>
    <span class="tooltip-hint">点击查看详情 →</span>
  `;

  tooltip.style.display = "block";
  const rect = anchor.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();
  let left = rect.left + window.scrollX;
  let top = rect.bottom + window.scrollY + 6;

  if (left + tooltipRect.width > window.innerWidth - 16) {
    left = window.innerWidth - tooltipRect.width - 16;
  }
  if (left < 8) left = 8;

  tooltip.style.left = left + "px";
  tooltip.style.top = top + "px";
}

function hideTooltip() {
  if (tooltip) tooltip.style.display = "none";
}

document.addEventListener("DOMContentLoaded", () => {
  createTooltip();

  document.querySelectorAll("a[data-slug]").forEach(a => {
    a.addEventListener("mouseenter", () => {
      clearTimeout(hideTimeout);
      showTooltip(a);
    });
    a.addEventListener("mouseleave", () => {
      hideTimeout = setTimeout(hideTooltip, 200);
    });
  });

  if (tooltip) {
    tooltip.addEventListener("mouseenter", () => clearTimeout(hideTimeout));
    tooltip.addEventListener("mouseleave", () => {
      hideTimeout = setTimeout(hideTooltip, 200);
    });
  }
});
