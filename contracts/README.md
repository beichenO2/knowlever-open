# KnowLever 产物契约

## Schema 列表

| Schema | 用途 | Stage |
|--------|------|-------|
| `lobster-event.schema.json` | 龙虾事件总线事件格式 | — |
| `atom.schema.json` | Stage 1 知识原子（claim + evidence + offset） | 1 |
| `clusters.schema.json` | Stage 2 Leiden 聚类结果 | 2 |
| `tree.schema.json` | Stage 3 知识树（slug 唯一发放点） | 3 |
| `page.schema.json` | Stage 4 wiki 页面（五段故事模板） | 4 |
| `link-report.schema.json` | Stage 5 链接校验报告（E1-E5 / W1-W3） | 5 |
| `tech-decisions.schema.json` | 横切技术取舍记录（每 stage 至少一条） | 1-7 |

## Examples

- `examples/atom.example.json` — 药理学知识原子（竞争性抑制）
- `examples/link-report.example.json` — 链接校验清洁报告
- `examples/tech-decisions.example.json` — embedding 模型选择记录

## Contract Tests

- `../tests/contracts/pipeline-schemas.contract.test.py` — 全部 6 个 pipeline schema 校验

## 变更历史

- 2026-05-08: 新增 6 个 pipeline schema + examples + contract test（260505 批次）
- 2026-05-01: 初始创建，lobster-event schema
