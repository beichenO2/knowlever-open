# Publishing to GitHub (maintainer)

Target: **Copilot / public account** (`beichenO2`), not the private homework org.

## Before push

- [ ] `示例/` and `samples-private/` are gitignored
- [ ] No API keys in `config.json` (model id only)
- [ ] `data/topics/*/output` not committed (users rebuild via pipeline)
- [ ] AutoOffice `to-markdown` documented in README

## Create repo (example)

```bash
cd knowlever-open
git init
git add .
git commit -m "Initial open-source release: KnowLever Open"
gh repo create knowlever-open --public --source=. --remote=origin --push
```

If the repo name exists, pick `knowlever-open-source` or ask the owner.

## After push

- Set GitHub repo description: *CLI knowledge compiler + AutoOffice ingest*
- Add topics: `knowlever`, `knowledge-base`, `markdown`, `autooffice`
- Pin README section «Open-source policy: AutoOffice»
