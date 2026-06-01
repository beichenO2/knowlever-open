# Setup guide

## 1. Directory layout

```bash
mkdir -p ~/workspace && cd ~/workspace
git clone <knowlever-open-url> knowlever-open
git clone <KnowLever-url> KnowLever
git clone <AutoOffice-url> AutoOffice
```

Set:

```bash
export ECOSYSTEM_ROOT=~/workspace
export KNOWLEVER_ROOT=~/workspace/KnowLever
export AUTOOFFICE_DIR=~/workspace/AutoOffice
```

## 2. Bootstrap

```bash
cd knowlever-open
bash scripts/setup.sh
```

## 3. Run demo

```bash
npm run pipeline -- --topic demo-parity
npm run home
```

## 4. Private PDFs

```bash
mkdir -p samples-private
# copy your PDFs here (never git commit)
npm run office-import -- --from samples-private --topic my-course
npm run pipeline -- --topic my-course
```

Add a card in `site/topics.json`:

```json
{
  "id": "my-course",
  "title": "My course notes",
  "description": "Converted from PDF via AutoOffice",
  "href": "/library/my-course/",
  "status": "ready",
  "pages": 0
}
```

Re-run `npm run home` after build updates `pages` manually or via script.
