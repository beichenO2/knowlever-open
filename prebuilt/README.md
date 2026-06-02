# Prebuilt static sites (shipped in git)

Cloned repos serve these under `/library/<topic>/` when `data/topics/<topic>/output/` is absent.

- `demo-parity/` — public demo (~20 HTML pages). Regenerate locally with `npm run pipeline -- --topic demo-parity` then optionally refresh this folder for maintainers only.

- `radar-2026/` — course wiki (HTML for browsing). Source PDFs are **not** in git; see `wiki/radar-2026/` for Markdown.
