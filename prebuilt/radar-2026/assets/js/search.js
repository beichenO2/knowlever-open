const SEARCH_INDEX = [
  {title:"知识编译（Knowledge Compilation）",type:"concept",badge:"💡 Concept",href:"concepts/concept-knowledge-compilation.html",summary:"将原始资料转化为结构化、互链、可持续演化的 wiki 页面的过程",keywords:"知识编译 knowledge compilation raw wiki 编译器 有损压缩 关系重建 RAG 中间表示"},
  {title:"Wiki-first 范式",type:"concept",badge:"💡 Concept",href:"concepts/concept-wiki-first-paradigm.html",summary:"先形成稳定的 Wiki 页面网络，再由此派生所有下游输出",keywords:"wiki-first 范式 paradigm 中间层 IR 持久化 复利 知识沉淀 HTML NotebookLM"},
  {title:"Ingest / Query / Lint / Distill",type:"concept",badge:"💡 Concept",href:"concepts/concept-ingest-query-lint-distill.html",summary:"LLM Wiki 的四种核心操作——定义 Agent 的完整行为空间",keywords:"ingest query lint distill 四大操作 工作流 source 编译 检查 导出 index log"},
  {title:"Agent Wiki 系统架构",type:"structure",badge:"📊 Structure",href:"structures/structure-agent-wiki-system-architecture.html",summary:"Raw/Wiki/Schema 三层架构的系统全景",keywords:"系统架构 三层 架构 raw wiki schema 目录结构 模块 数据流 Karpathy"},
  {title:"多 Agent 拓扑",type:"structure",badge:"📊 Structure",href:"structures/structure-agent-wiki-multi-agent-topology.html",summary:"4 类 Agent 的拓扑关系和协作工作流",keywords:"多 agent 拓扑 协作 总控 mapping frontend synthesis orchestration 并行"},
  {title:"Raw Sources Layer",type:"entity",badge:"🔧 Entity",href:"entities/entity-agent-wiki-raw-layer.html",summary:"不可变的原始事实层——项目源码和文档的只读存储",keywords:"raw sources 原始 事实 只读 immutable source of truth repo docs notes citation"},
  {title:"Wiki Knowledge Layer",type:"entity",badge:"🔧 Entity",href:"entities/entity-agent-wiki-wiki-layer.html",summary:"LLM 维护的持久化知识编译层——8 类结构化页面组成的知识网络",keywords:"wiki knowledge 知识 编译 层 8类 页面 entity concept structure comparison synthesis question maintenance index log"},
  {title:"Schema Layer",type:"entity",badge:"🔧 Entity",href:"entities/entity-agent-wiki-schema-layer.html",summary:"LLM 行为规则定义层——8 个规范文件约束 Agent 行为",keywords:"schema 规则 行为 agents page_types naming linking citation ingest query lint workflow 规范"},
  {title:"知识编译 vs 文档检索（RAG）",type:"comparison",badge:"⚖️ Comparison",href:"comparisons/comparison-compilation-vs-retrieval.html",summary:"从 8 个维度系统对比知识编译与 RAG 两种范式",keywords:"编译 检索 RAG 对比 comparison 持久性 质量 跨源 综合 追溯 维护 成本"},
  {title:"知识架构模式",type:"synthesis",badge:"🔮 Synthesis",href:"syntheses/synthesis-agent-wiki-knowledge-architecture-patterns.html",summary:"三层分离 + 编译式知识管理 + Schema-driven Agent 的协同效应",keywords:"架构模式 synthesis 综合 三角 编译 schema-driven 协同 可泛化 设计模式"},
  {title:"为什么选择 Wiki-first 而不是 RAG？",type:"question",badge:"❓ Question",href:"questions/question-why-wiki-not-rag.html",summary:"从知识复利、结构化、跨项目综合等 5 个维度深入论证",keywords:"为什么 wiki-first RAG 复利 结构化 跨项目 追溯 质量 问答"},
  {title:"ToBegin.md",type:"source",badge:"📄 Source",href:"sources/src-agent-wiki-tobegin.html",summary:"Agent Wiki 设计蓝图——Karpathy LLM Wiki 理念的完整落地",keywords:"tobegin 设计 蓝图 karpathy gist 三层 页面 分类 操作 schema"},
  {title:"点火.md",type:"source",badge:"📄 Source",href:"sources/src-agent-wiki-ignition.html",summary:"项目启动指令——0 号总控 Agent 的 8 阶段执行计划",keywords:"点火 启动 bootstrap orchestrator 8阶段 目录 requirement agent 恢复"},
  {title:"PROJECT.md",type:"source",badge:"📄 Source",href:"sources/src-agent-wiki-project-md.html",summary:"项目定义——核心价值、需求、约束和关键决策",keywords:"project 项目 定义 需求 约束 决策 核心 价值 out of scope"},
];

function initSearch(inputId, resultsId, basePath) {
  const input = document.getElementById(inputId);
  const results = document.getElementById(resultsId);
  if (!input || !results) return;

  input.addEventListener('input', function() {
    const q = this.value.trim().toLowerCase();
    if (q.length < 1) { results.innerHTML = ''; results.style.display = 'none'; return; }

    const matches = SEARCH_INDEX.filter(item => {
      const haystack = (item.title + ' ' + item.summary + ' ' + item.keywords).toLowerCase();
      return q.split(/\s+/).every(term => haystack.includes(term));
    });

    if (matches.length === 0) {
      results.innerHTML = '<div style="padding:1rem;color:var(--text-muted,#888);font-size:0.9rem;">无匹配结果</div>';
      results.style.display = 'block';
      return;
    }

    const prefix = basePath || '';
    results.innerHTML = matches.map(m => `
      <a href="${prefix}${m.href}" style="display:block;padding:0.8rem 1rem;text-decoration:none;color:inherit;border-bottom:1px solid var(--border,#eee);">
        <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.2rem;">
          <span style="font-size:0.75rem;padding:2px 6px;border-radius:4px;background:var(--bg-secondary,#f0f0f0);">${m.badge}</span>
          <strong style="font-size:0.95rem;">${m.title}</strong>
        </div>
        <div style="font-size:0.85rem;color:var(--text-muted,#888);">${m.summary}</div>
      </a>
    `).join('');
    results.style.display = 'block';
  });

  document.addEventListener('click', function(e) {
    if (!input.contains(e.target) && !results.contains(e.target)) {
      results.style.display = 'none';
    }
  });

  input.addEventListener('focus', function() {
    if (this.value.trim().length > 0) results.style.display = 'block';
  });
}
