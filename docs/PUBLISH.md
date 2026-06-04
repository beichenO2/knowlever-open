# Publishing to GitHub (maintainer)

Target: **Copilot / public account** (`beichenO2`), not the private homework org.

## Before push

- [ ] No API keys in `config.json` (model id only)
- [ ] `data/topics/*/raw/` not committed (contains user PDFs)
- [ ] `data/topics/*/output/` not committed (users rebuild via compile)
- [ ] `data/topics/*/normalized/` not committed (generated from raw)
- [ ] `data/topics/*/wiki/` committed (knowledge asset)
- [ ] AutoOffice `to-markdown` documented in README

## After push

- Set GitHub repo description: *CLI knowledge compiler + AutoOffice ingest*
- Add topics: `knowlever`, `knowledge-base`, `markdown`, `autooffice`
