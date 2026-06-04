# 这份开源包在干什么？

## 一句话

**把笔记（Markdown 或 Office/PDF）编成可浏览的知识网站。**  
**不生成 PDF**；**AutoOffice 负责把 PPT/PDF/Word 变成 Markdown**，再交给 KnowLever 编译。

---

## 素材来源

| 来源 | 说明 |
|------|------|
| `data/topics/<topic>/raw/` | 原始输入（.md / .pdf / .docx 等） |

演示 topic `demo-parity` 自带 3 篇公开 .md。

---

## 标准流程

```bash
# 编译一个 topic
npm run compile -- --topic demo-parity

# Office/PDF 先转 Markdown 再编译
npm run office-import -- --from ./your-pdfs --topic my-topic
npm run compile -- --topic my-topic

# 启动本地服务
npm run home
```

产物：`data/topics/<topic>/output/`（HTML 站点 + PDF handbook）

主页：`npm run home` → http://127.0.0.1:4180/

---

## 数据目录结构

```
data/topics/<topic>/
  raw/           原始输入（PDF/DOCX/MD）
  normalized/    归一化后（每个源一个 content.md）
  wiki/          Wiki Markdown 页面（知识资产，进 git）
  output/        HTML 站点 + PDF（构建产物）
```

---

## AutoOffice 在本项目里的角色

- **要做**：`autooffice to-markdown` — PDF/DOCX/PPTX → Markdown（给 LLM / KnowLever ingest）
- **不做**：导出 PDF 报告（那是别的场景，本开源版已去掉）

须搭配 **开源 AutoOffice**（见 README）。转换依赖本机 **Pandoc** 或 **LibreOffice**。
