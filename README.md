# Guppy the Fish

A tiny browser fish tank powered by GuppyLM.

Live site: <https://rkmax.github.io/guppy-the-fish/>

## What it is

- A single-page ASCII fish tank.
- Local browser inference with ONNX Runtime Web.
- Lightweight autonomous fish behavior driven by GuppyLM.
- Static deployment through GitHub Pages.

## Project layout

- `app.jsx`: UI, fish behavior, and interaction logic.
- `guppy-engine.js`: tokenizer and ONNX inference layer.
- `index.html`: static shell and runtime script loading.
- `scripts/build.mjs`: builds the publishable site into `dist/`.
- `.github/workflows/pages.yml`: GitHub Pages deployment workflow.

## Local development

Install dependencies:

```bash
npm ci
```

Build the site:

```bash
npm run build
```

Serve the generated files:

```bash
cd dist
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

## Deployment

`main` contains source files only.

Every push to `main` triggers GitHub Actions, builds `dist/`, and deploys the site to GitHub Pages.
