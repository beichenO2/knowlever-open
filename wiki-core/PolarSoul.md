# wiki-core — PolarSoul

## 设计哲学

wiki-core 是 KnowLever 的 Wiki 构建引擎，负责将 Markdown + frontmatter 编译为可浏览的静态 HTML 站点。

- **静态优先**: 生成纯 HTML/CSS/JS，无需运行时服务器即可浏览
- **三层结构**: domain → concept → source 层级组织知识，自动生成导航树
- **Mermaid 集成**: 自动从知识结构生成 Mermaid 架构图，可视化知识拓扑

## 功能介绍

- **生态位**: KnowLever 的渲染层，将编译后的结构化 Wiki 转化为人类可浏览的形式
- **承担功能**:

| 编号 | 功能域 | 说明 |
|---|---|---|
| R1 | Wiki 构建 | 从 Markdown + YAML frontmatter 生成静态 HTML 站点 |
| R2 | 导航生成 | 根据 domain/concept/source 三层结构自动构建导航树 |
| R3 | Mermaid 图表 | 从知识关系自动生成架构图和依赖图 |

## 与其他项目的关系

- **被 KnowLever 内嵌**: wiki-core 作为 KnowLever 的内置模块，KnowLever R3（知识编译）和 R7（Wiki 构建质量）调用 wiki-core 的构建能力
- **间接服务 PolarMemory**: PolarMemory 消费 KnowLever 的 Wiki 产物，而 Wiki 产物由 wiki-core 构建

## 关键设计决策

### Why 静态 HTML 而非动态服务

**问题**: 动态 Wiki 服务（如 MediaWiki）功能更丰富但运维复杂。

**决策**: 静态站点零运维，一次构建到处浏览，且适合 Git 版本管理。

**不可妥协**: 构建产物必须是纯静态文件，不依赖运行时服务。

### Why 三层结构

**问题**: 扁平的 Wiki 页面在知识量增大后难以导航。

**决策**: domain（领域）→ concept（概念）→ source（来源）三层，对应知识的组织方式。

## 依赖与被依赖

### 依赖

无外部项目依赖。

### 被依赖

| 被依赖项 | 说明 |
|---|---|
| KnowLever | Wiki 构建引擎核心 |

---

## 详情入口

- [SSoT](polaris.json)
