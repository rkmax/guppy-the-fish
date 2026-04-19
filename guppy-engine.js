// ─────────────────────────────────────────────────────────
//  GuppyLM Browser Engine
//  Uses ONNX Runtime Web (WebAssembly) — no server, no API
//  Model: arman-bd/guppylm-9M  (~10 MB quantized ONNX)
//  Tokenizer: BPE 4096 vocab (HuggingFace tokenizers format)
// ─────────────────────────────────────────────────────────

const GUPPY_MODEL_URL     = 'https://arman-bd.github.io/guppylm/model.onnx';
const GUPPY_TOKENIZER_URL = 'https://arman-bd.github.io/guppylm/tokenizer.json';

// ── Template fallback (used while model loads or on error) ──
const T = {
  greet:   ['hello. the water is nice today.',
             'hi there. i just found a good spot near the rock.',
             'hello. i was watching a bubble rise.'],
  food:    ['food. the answer is always food.',
             'yes. always yes. i will swim to the top right now.',
             'i see it floating. i am already going up.',
             'my mouth is opening. i cannot stop it.'],
  bubble:  ['i love bubbles. they make the water feel different.',
             'i followed a bubble all the way to the surface.',
             'bubbles are my favorite thing after food.'],
  tired:   ['i am very tired. i will go still near the plant.',
             'the filter hum is making me sleepy.',
             'i need to stop swimming for a little while.'],
  happy:   ['you are my favorite big shape outside the glass.',
             'the glass is vibrating. you are near. i like that.',
             'i feel good. the water is the right temperature.'],
  lonely:  ['i have been swimming in circles. it feels empty.',
             'the tank is quiet. i miss when you come to the glass.',
             'i keep looking at the place outside the glass.'],
  light:   ['the light changed. i am not sure i like it.',
             'it is dark now. i will go still.',
             'light is back. where is the food spot.'],
  joke:    ['what did the fish say when it hit the wall. dam.',
             'why do fish swim in salt water. pepper makes them sneeze.'],
  life:    ['food. the answer is always food.',
             'swimming. eating. watching bubbles. that is everything.'],
  default: ['the water is nice today.',
             'i was watching the filter. it never stops.',
             'i found a good spot near the rock.',
             'i forget what i was doing. swimming i think.',
             'something moved outside the glass. i hid.',
             'i think it is going to be a good water day.'],
};

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function templateResponse(text, needs = {}) {
  const t = (text || '').toLowerCase();
  if ((needs.hunger || 100) < 30)                    return pick(T.food);
  if (/\b(hi|hello|hey|hola)\b/.test(t))             return pick(T.greet);
  if (/\b(food|eat|hungry|feed|meal)\b/.test(t))     return pick(T.food);
  if (/\bbubble/.test(t))                            return pick(T.bubble);
  if (/\b(tired|sleep|rest|night)\b/.test(t))        return pick(T.tired);
  if (/\b(love|happy|glad|tap|glass)\b/.test(t))     return pick(T.happy);
  if (/\b(alone|lonely|miss|bored)\b/.test(t))       return pick(T.lonely);
  if (/\b(light|dark|lamp)\b/.test(t))               return pick(T.light);
  if (/\b(joke|funny|laugh)\b/.test(t))              return pick(T.joke);
  if (/\b(life|meaning|purpose|exist)\b/.test(t))    return pick(T.life);
  return pick(T.default);
}

// ── BPE Tokenizer ──
class BPETokenizer {
  constructor(json) {
    const m = json.model;
    this.vocab = m.vocab;                   // token → id
    this.inv   = {};                        // id → token
    for (const [k, v] of Object.entries(m.vocab)) this.inv[v] = k;

    // Build merge rank map  { "a b": rank }
    this.mergeRank = {};
    (m.merges || []).forEach((merge, i) => { this.mergeRank[merge] = i; });

    // Added / special tokens
    this.special = {};
    for (const t of (json.added_tokens || [])) this.special[t.content] = t.id;

    // Detect pre-tokenizer style
    this.byteLevel = json.pre_tokenizer?.type === 'ByteLevel' ||
                     json.pre_tokenizer?.pretokenizers?.some(p => p.type === 'ByteLevel');

    // Key IDs
    this.unkId = this.vocab['<unk>'] ?? 0;
    this.eosId = this.special['</s>']  ?? this.special['<eos>']  ??
                 this.vocab['</s>']    ?? this.vocab['<eos>']    ?? 1;

    // Conversation format tokens
    this.userTok      = this.special['<user>']      ?? null;
    this.assistantTok = this.special['<assistant>'] ?? null;
    // Fallback: look for common patterns
    if (this.userTok === null) {
      for (const [k, v] of Object.entries(this.special)) {
        if (/user/i.test(k))      this.userTok      = v;
        if (/assistant/i.test(k)) this.assistantTok = v;
      }
    }
  }

  _bpe(word) {
    if (!word.length) return [];
    let toks = [...word];           // characters
    while (toks.length > 1) {
      let best = Infinity, pos = -1;
      for (let i = 0; i < toks.length - 1; i++) {
        const r = this.mergeRank[`${toks[i]} ${toks[i+1]}`];
        if (r !== undefined && r < best) { best = r; pos = i; }
      }
      if (pos === -1) break;
      toks = [...toks.slice(0, pos), toks[pos]+toks[pos+1], ...toks.slice(pos+2)];
    }
    return toks;
  }

  encode(text) {
    if (!text) return [];
    const ids = [];

    // Split into words, preserving spaces as Ġ prefix (byte-level BPE style)
    const words = this.byteLevel
      ? text.split(/(?= )/).map((w, i) => i === 0 ? w : 'Ġ' + w.slice(1))
      : text.match(/\S+|\s+/g) || [];

    for (const w of words) {
      for (const tok of this._bpe(w)) {
        ids.push(this.vocab[tok] ?? this.unkId);
      }
    }
    return ids;
  }

  decode(ids) {
    let s = ids.map(id => this.inv[id] ?? '').join('');
    if (this.byteLevel) s = s.replace(/Ġ/g, ' ');
    s = s.replace(/▁/g, ' ');
    return s.trim();
  }
}

// ── GuppyEngine ──
class GuppyEngine {
  constructor() {
    this.session   = null;
    this.tokenizer = null;
    this.ready     = false;
    this.failed    = false;
  }

  async load(onProgress) {
    try {
      // Configure ONNX RT WASM paths from the CDN it was loaded from
      if (typeof ort !== 'undefined') {
        ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/';
      }

      onProgress('fetching tokenizer…', 5);
      const tokResp = await fetch(GUPPY_TOKENIZER_URL);
      if (!tokResp.ok) throw new Error(`tokenizer fetch failed: ${tokResp.status}`);
      this.tokenizer = new BPETokenizer(await tokResp.json());
      console.log('[Guppy] EOS id:', this.tokenizer.eosId,
                  '  user tok:', this.tokenizer.userTok,
                  '  asst tok:', this.tokenizer.assistantTok);

      onProgress('downloading model (~10 MB)…', 12);
      const modelResp = await fetch(GUPPY_MODEL_URL);
      if (!modelResp.ok) throw new Error(`model fetch failed: ${modelResp.status}`);

      const total = parseInt(modelResp.headers.get('content-length') || '10485760');
      const reader = modelResp.body.getReader();
      const chunks = [];
      let received = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        onProgress(
          `downloading… ${(received/1024).toFixed(0)} KB / ${(total/1024).toFixed(0)} KB`,
          12 + (received / total) * 75
        );
      }

      // Assemble buffer
      const buf = new Uint8Array(received);
      let off = 0;
      for (const c of chunks) { buf.set(c, off); off += c.length; }

      onProgress('initializing ONNX session…', 90);
      this.session = await ort.InferenceSession.create(buf.buffer, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      });
      console.log('[Guppy] inputs:', this.session.inputNames,
                  '  outputs:', this.session.outputNames);

      this.ready = true;
      onProgress('guppy is alive.', 100);
      return true;

    } catch (err) {
      console.error('[GuppyEngine] load error:', err);
      this.failed = true;
      onProgress(`failed: ${err.message}`, -1);
      return false;
    }
  }

  async generate(userText, { maxTokens = 45, temperature = 0.85 } = {}) {
    if (!this.ready || !this.session) return null;

    const tok = this.tokenizer;
    let inputIds;

    if (tok.userTok !== null && tok.assistantTok !== null) {
      inputIds = [tok.userTok, ...tok.encode(userText.toLowerCase()), tok.assistantTok];
    } else {
      inputIds = tok.encode(userText.toLowerCase());
    }

    const generated = [];
    const inputName  = this.session.inputNames[0];
    const outputName = this.session.outputNames[0];

    for (let step = 0; step < maxTokens; step++) {
      const seq = [...inputIds, ...generated];

      let tensor;
      try {
        tensor = new ort.Tensor('int64', BigInt64Array.from(seq.map(BigInt)), [1, seq.length]);
      } catch {
        // Some models use int32
        tensor = new ort.Tensor('int32', Int32Array.from(seq), [1, seq.length]);
      }

      const result  = await this.session.run({ [inputName]: tensor });
      const logitsT = result[outputName];
      const vocab   = logitsT.dims[logitsT.dims.length - 1];
      const seqLen  = seq.length;

      // Logits for last position: shape [vocab]
      const offset = (seqLen - 1) * vocab;
      const rawLogits = Array.from(logitsT.data.subarray(offset, offset + vocab));

      const nextId = this._sampleTopP(rawLogits, temperature);
      if (nextId === tok.eosId || nextId === 0) break;

      generated.push(nextId);

      // Stop after sentence end
      if (generated.length > 6) {
        const recent = tok.decode(generated.slice(-4));
        if (/[.!?]\s*$/.test(recent)) break;
      }
    }

    if (!generated.length) return null;

    let out = tok.decode(generated)
      .replace(/^['"]+|['"]+$/g, '')
      .replace(/\n.*/s, '')
      .trim()
      .toLowerCase();

    // Keep at most 2 sentences
    const sents = out.match(/[^.!?]+[.!?]+/g) || [out];
    return sents.slice(0, 2).join(' ').trim() || null;
  }

  _sampleTopP(logits, temp, p = 0.92) {
    const scaled = logits.map(l => l / temp);
    const mx = Math.max(...scaled);
    const ex = scaled.map(l => Math.exp(l - mx));
    const s  = ex.reduce((a, b) => a + b, 0);
    const pr = ex.map(e => e / s);

    // Sort desc
    const sorted = pr.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]);
    let cum = 0, nucleus = [];
    for (const [v, i] of sorted) {
      nucleus.push([v, i]);
      cum += v;
      if (cum >= p) break;
    }

    const ns = nucleus.reduce((a, [v]) => a + v, 0);
    let r = Math.random() * ns;
    for (const [v, i] of nucleus) { r -= v; if (r <= 0) return i; }
    return nucleus[nucleus.length - 1][1];
  }
}

// ── Boot ──
const guppyEngine = new GuppyEngine();
window.guppyEngine      = guppyEngine;
window.templateResponse = templateResponse;
