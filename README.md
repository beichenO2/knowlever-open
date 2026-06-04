# KnowLever Open

**Command-line knowledge compiler for solo developers** — turn Markdown (and Office/PDF via [AutoOffice](https://github.com/beichenO2/AutoOffice)) into a browsable personal wiki site.

> 中文说明见 [`docs/WHAT_IS_THIS.md`](docs/WHAT_IS_THIS.md)

---

## What you get

| Step | Tool | Output |
|------|------|--------|
| 1. Ingest | Built-in (compile-7stage) | Normalized notes under `data/topics/<topic>/normalized/` |
| 2. Compile (7 stages) | wiki-engine + your LLM | Wiki pages → `data/topics/<topic>/wiki/` |
| 3. Site | Stage 6 | Static HTML site → `data/topics/<topic>/output/` |
| Optional | **AutoOffice** `to-markdown` | PDF / DOCX / PPTX → `.md` before step 1 |

---

## Architecture

```
your-notes/          data/topics/<topic>/raw/*.md
     │                      │
     │    ┌─────────────────┴──────────────────┐
     │    │  KnowLever Open (this repo)        │
     │    │  npm run compile -- --topic <name>  │
     └───►│  office-import ──► AutoOffice CLI   │
          └─────────┬──────────────────────────┘
                    ▼
          data/topics/<topic>/
            ├── normalized/   (Stage 0: ingest)
            ├── wiki/         (Stage 1-4: wiki MD)
            └── output/       (Stage 6-7: HTML + PDF)
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

- **On your machine** (for Office/PDF → Markdown): [Pandoc](https://pandoc.org/) and/or [LibreOffice](https://www.libreoffice.org/)
- **LLM access** configured via environment variables or `config.json` (see `config.example.json`).

---

## Quick start

```bash
git clone https://github.com/beichenO2/knowlever-open.git
cd knowlever-open
git clone <your-KnowLever-url> ../KnowLever
git clone https://github.com/beichenO2/AutoOffice.git ../AutoOffice

export ECOSYSTEM_ROOT="$(cd .. && pwd)"
export KNOWLEVER_ROOT="$ECOSYSTEM_ROOT/KnowLever"
export AUTOOFFICE_DIR="$ECOSYSTEM_ROOT/AutoOffice"

bash scripts/setup.sh
npm run compile -- --topic demo-parity
npm run home
```

Open **http://127.0.0.1:4180/** → click a topic → browse your wiki.

---

## Bring your own Office / PDF files

Place files in `data/topics/<your-topic>/raw/`, then:

```bash
npm run compile -- --topic <your-topic>
```

For Office/PDF files, first convert to Markdown:

```bash
npm run office-import -- --from ./your-pdfs --topic <your-topic>
npm run compile -- --topic <your-topic>
```

---

## Commands

| npm script | Description |
|------------|-------------|
| `setup` | First-time environment check + AutoOffice build |
| `compile` | Full 7-stage pipeline (ingest → crystallize → cluster → tree → compose → validate → site → PDF) |
| `office-import` | AutoOffice → Markdown into topic `raw/` |
| `home` / `start` | Local server at port 4180 |
| `normalize-formulas` | Standalone formula normalization |
| `vlm-ocr` | VLM-based OCR for PDF/images |

---

## Configuration

| File / env | Purpose |
|------------|---------|
| `config.json` | Default topic + LLM model id |
| `config.example.json` | Template for forks |
| `KNOWLEVER_ROOT` | Path to KnowLever engine |
| `AUTOOFFICE_DIR` | Path to open-source AutoOffice |
| `ECOSYSTEM_ROOT` | Parent folder containing both clones |
| `LLM_BASE_URL` / `LLM_API_KEY` | LLM endpoint override |

---

## Project layout

```text
data/topics/<topic>/
  raw/              Original input files (PDF, DOCX, MD)
  normalized/       Ingest output (content.md per source)
  wiki/             Wiki Markdown pages (git-tracked knowledge asset)
  output/           HTML site + PDF handbook (build artifact)
lib/
  paths.js          Path resolution + ecosystem discovery
  llm-client.js     LLM API client
  normalize-formulas.js   Formula standardization
  vlm-formula-ocr.js      VLM OCR for PDF/image formulas
  wiki-engine/      7-stage pipeline core (stage1-7 + tech-decisions)
scripts/
  compile-7stage.js Sole compilation entry point
  serve-home.js     Local dev server
  office-import.js  AutoOffice integration
  setup.sh          First-time setup
docs/               WHAT_IS_THIS, SETUP, publishing notes
```

---

## Demo content

The included demo (`data/topics/demo-parity/raw/`) uses three short **public, fictional** technical articles. They are safe to ship in git.

Private study PDFs (e.g. course slides) belong in `data/topics/<topic>/raw/` and are gitignored.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Home page blank | Run `npm run home`, open `http://127.0.0.1:4180/` |
| Topic 404 | Compile first: `npm run compile -- --topic <name>` |
| `office-import` fails | Install Pandoc or LibreOffice |
| Compile fails | Set `KNOWLEVER_ROOT`; ensure KnowLever `wiki-engine` is present |

---

## Related work

- **KnowLever** — full knowledge compiler in the Polarisor ecosystem
- **AutoOffice** — AI-friendly document tooling; `to-markdown` for this project

---

## License

MIT — see [LICENSE](LICENSE).
