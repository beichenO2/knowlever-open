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
npm run compile -- --topic demo-parity
npm run home
```

## 4. Your own PDFs

```bash
# Place files in a topic's raw/ directory
mkdir -p data/topics/my-course/raw
cp ~/Downloads/*.pdf data/topics/my-course/raw/

# Compile (ingest handles PDF → Markdown automatically)
npm run compile -- --topic my-course
npm run home
```

For Office files that need AutoOffice conversion:

```bash
npm run office-import -- --from ./your-folder --topic my-course
npm run compile -- --topic my-course
```
