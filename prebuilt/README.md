# Prebuilt static sites (shipped in git)

Cloned repos serve these under `/library/<topic>/` when `data/topics/<topic>/output/` is absent.

- `demo-parity/` — public demo (~20 HTML pages). Regenerate locally with `npm run pipeline -- --topic demo-parity` then optionally refresh this folder for maintainers only.

Do **not** add private topics (e.g. `radar-2026`) here.
