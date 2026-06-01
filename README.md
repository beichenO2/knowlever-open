# KnowLever Open

**Command-line knowledge compiler for solo developers** — turn Markdown (and Office/PDF via [AutoOffice](https://github.com/beichenO2/AutoOffice)) into a browsable personal wiki site.

> 中文说明见 [`docs/WHAT_IS_THIS.md`](docs/WHAT_IS_THIS.md)

---

## What you get

| Step | Tool | Output |
|------|------|--------|
| 1. Ingest | KnowLever engine | Normalized notes under `data/topics/<topic>/` |
| 2. Compile | KnowLever + your LLM | Linked wiki pages |
| 3. Build | KnowLever | Static HTML site (`index.html`, glossary, …) |
| Optional | **AutoOffice** `to-markdown` | PDF / DOCX / PPTX → `.md` before step 1 |

**This repo does not export PDF reports.** AutoOffice is required as an **open-source companion** for **document → Markdown** conversion (PPT/PDF/Word → text suitable for LLM ingest), not for PDF generation.

---

## Architecture

```
your-notes/          examples/demo-parity/raw/*.md   (shipped demo)
     │                      │
     │    ┌─────────────────┴──────────────────┐
     │    │  KnowLever Open (this repo)        │
     │    │  npm run pipeline                  │
     └───►│  office-import ──► AutoOffice CLI  │
          └─────────┬──────────────────────────┘
                    ▼
          KnowLever engine (clone separately)
                    ▼
          data/topics/<topic>/output/   ← static site
                    ▼
          npm run home  →  http://127.0.0.1:4180/
```

---

## Prerequisites

- **Node.js** ≥ 18
- **Git clones** (sibling folders recommended):

```text
workspace/
├── knowlever-open/     ← this repository
├── KnowLever/          ← compile engine (required)
└── AutoOffice/         ← open-source companion (required for Office/PDF ingest)
```

- **On your machine** (for Office/PDF → Markdown): [Pandoc](https://pandoc.org/) and/or [LibreOffice](https://www.libreoffice.org/) — check with:

```bash
node "$AUTOOFFICE_DIR/dist/cli.js" tools
```

- **LLM access** configured inside your KnowLever / proxy setup (demo uses `MiniMax-M2.7-highspeed` in `config.json`; copy `config.example.json` to customize).

---

## Quick start — open the box (30 seconds)

**No LLM, no engine clones required** — a demo site is already in `prebuilt/`:

```bash
git clone https://github.com/beichenO2/knowlever-open.git
cd knowlever-open
npm run home
```

Open **http://127.0.0.1:4180/** → click **Agent Wiki 演示库** → browse ~20 pages (Chinese titles, knowledge graph).

## Full pipeline (compile your own notes)

```bash
git clone https://github.com/beichenO2/knowlever-open.git
cd knowlever-open
git clone <your-KnowLever-url> ../KnowLever
git clone https://github.com/beichenO2/AutoOffice.git ../AutoOffice

export ECOSYSTEM_ROOT="$(cd .. && pwd)"
export KNOWLEVER_ROOT="$ECOSYSTEM_ROOT/KnowLever"
export AUTOOFFICE_DIR="$ECOSYSTEM_ROOT/AutoOffice"

bash scripts/setup.sh
npm run pipeline -- --topic demo-parity
npm run home
```

Private PDFs stay local (`samples-private/`, `示例/`) — **never committed** to GitHub.

---

## Bring your own Office / PDF files

Put files in a local folder (e.g. `samples-private/` — **gitignored**, never commit course PDFs).

```bash
npm run office-import -- --from ./samples-private --topic my-topic
npm run pipeline -- --topic my-topic
```

Or one shot:

```bash
npm run pipeline -- --topic my-topic --with-office
```

`office-import` calls:

```bash
autooffice to-markdown -i <folder> -o data/topics/<topic>/raw/
```

---

## Commands

| npm script | Description |
|------------|-------------|
| `setup` (bash `scripts/setup.sh`) | First-time dependency check + AutoOffice build + `init:demo` |
| `check-deps` | Verify KnowLever + AutoOffice paths |
| `init:demo` | Copy public demo Markdown into `data/topics/demo-parity/raw/` |
| `office-import` | AutoOffice → Markdown into topic `raw/` |
| `compile` | Ingest + LLM wiki compile |
| `build` | HTML static site + copy to `data/topics/.../output/` |
| `pipeline` | `compile` + `build` (add `--with-office` to import first) |
| `home` | Local hub at port 4180 |

---

## Configuration

| File / env | Purpose |
|------------|---------|
| `config.json` | Default topic + LLM model id |
| `config.example.json` | Template for forks |
| `KNOWLEVER_ROOT` | Path to KnowLever engine |
| `AUTOOFFICE_DIR` | Path to **open-source AutoOffice** |
| `ECOSYSTEM_ROOT` | Parent folder containing both clones |

---

## Project layout

```text
examples/demo-parity/raw/   Public demo sources (3 articles, fiction-safe)
data/topics/                Runtime wiki + HTML output (partially gitignored)
site/                       Open-source landing page + topic cards
scripts/                    pipeline, office-import, serve-home, setup
lib/                        Paths + ecosystem resolution
docs/                       WHAT_IS_THIS, SETUP, publishing notes
```

---

## Open-source policy: AutoOffice

When you publish a fork or derivative:

1. State clearly that **KnowLever Open must be used with open-source AutoOffice** for non-Markdown sources.
2. Do **not** imply that AutoOffice is only for PDF report export; its role here is **document → Markdown for knowledge ingest**.
3. Link to the AutoOffice repository and license.

---

## Demo content

The included demo (`examples/demo-parity/raw/`) uses three short **public, fictional** technical articles (Agent Wiki concepts, pipeline overview, Zettelkasten). They are safe to ship in git.

Private study PDFs (e.g. course slides) belong in a **local-only** directory such as `samples-private/` and must stay out of version control.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Home page blank / no topic cards | Run `npm run home`, open `http://127.0.0.1:4180/` — do not open `site/index.html` via `file://` |
| Card opens 404 | Use `npm run home`; built sites are served under `/library/<topic>/` |
| `office-import` fails | Install Pandoc or LibreOffice; run `autooffice tools` |
| Compile fails | Set `KNOWLEVER_ROOT`; ensure KnowLever `wiki-engine` is present |

---

## Related work

- **KnowLever** — full knowledge compiler in the Polarisor ecosystem
- **AutoOffice** — AI-friendly document tooling; `to-markdown` for this project
- **PolarUI** (optional) — visual workflow parity experiments; see upstream task docs

---

## License

MIT — see [LICENSE](LICENSE).
