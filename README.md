# Guppy the Fish

An ASCII fish tank that runs GuppyLM locally in the browser.

Live site: <https://rkmax.github.io/guppy-the-fish/>

Guppy combines a small ONNX-backed language model runtime with a lightweight
fish simulation. It reacts to chat, tracks a few basic needs, and picks simple
autonomous actions without relying on a backend service.

## Structure

- `app.jsx`: UI, fish behavior, and interaction logic.
- `guppy-engine.js`: tokenizer and ONNX inference layer.
- `index.html`: static shell and runtime script loading.
- `scripts/build.mjs`: builds the publishable output into `dist/`.

## Local development

```bash
npm ci
npm run build
cd dist
python3 -m http.server 8000
```

Open <http://localhost:8000>.
