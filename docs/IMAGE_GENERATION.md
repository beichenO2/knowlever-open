# 图像生成（MiniMax）

## 当前状态

| 路径 | 能力 |
|------|------|
| PolarUI `ImageGenerate` 节点 | **stub**（`executor.ts` 返回 `stub://headless/image`） |
| 生态口径 | MiniMax **`image-01`** 经 PolarPrivate / codingplan（见 `任务书/Done/260430_2_1/LLM_related.md`） |
| 本仓库主页 Logo | **内联 SVG**（`site/assets/logo.svg`：杠杆 + 书），不依赖生图 API |

## 若要用 MiniMax 生图

1. 确认 PolarPrivate（默认 `127.0.0.1:12790`）已配置 **MiniMax media** 路由，模型名 **`image-01`**。
2. 调用方式与 OpenAI Images API 类似（以你方 Proxy 文档为准），示例形态：

```bash
curl -s http://127.0.0.1:12790/v1/images/generations \
  -H "Content-Type: application/json" \
  -d '{"model":"image-01","prompt":"minimal logo, book and lever, blue gold, flat vector"}'
```

3. 生成 PNG 后可替换 `site/assets/logo.png`，并在 `index.html` 中改用 `<img src="assets/logo.png">`。

## 不建议

- 在未核对 Proxy 契约前，在开源仓库硬编码 API Key。
- 用 Cursor `GenerateImage` 作为产品 Logo SSOT（无法复现、无版本追溯）。
