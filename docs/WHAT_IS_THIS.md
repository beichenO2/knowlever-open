# 这份开源包在干什么？

## 一句话

**把笔记（Markdown 或 Office/PDF）编成可浏览的知识网站。**  
**不生成 PDF**；**AutoOffice 负责把 PPT/PDF/Word 变成 Markdown**，再交给 KnowLever 编译。

---

## 两条素材来源

| 来源 | 说明 |
|------|------|
| `examples/demo-parity/raw/` | 演示用 **3 篇公开 .md**（默认 pipeline 用这个） |
| `示例/` | 你的 **PDF/PPT 等**；需先 `npm run office-import` 转成 `.md` 再编译 |

---

## 标准流程

```bash
# 仅演示 md（最常见）
npm run pipeline -- --topic demo-parity

# 先把 示例/ 里的 Office 文件转成 md，再编译
npm run office-import -- --from 示例 --topic demo-parity
npm run pipeline -- --topic demo-parity

# 或一条命令
npm run pipeline -- --topic demo-parity --with-office
```

产物：`data/topics/<topic>/output/index.html`（约 20 页网站，含 glossary）

主页：`npm run home` → http://127.0.0.1:4180/

---

## AutoOffice 在本项目里的角色

- **要做**：`autooffice to-markdown` — PDF/DOCX/PPTX → Markdown（给 LLM / KnowLever ingest）
- **不做**：导出 PDF 报告（那是别的场景，本开源版已去掉）

须搭配 **开源 AutoOffice**（见 README）。转换依赖本机 **Pandoc** 或 **LibreOffice**（`autooffice tools` 可查看）。

---

## 和 PolarUI 实验

B 路径 = 上面这些 npm 命令；A 路径 = 画布原子组件，目标产出相同网站。见 `Polarisor/任务书/260601/KnowLever-Parity-Demo.md`。
