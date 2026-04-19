// ---------------------------------------------------------
//  GuppyLM Browser Engine
//  Uses ONNX Runtime Web (WebAssembly) - no server, no API
//  Model: arman-bd/guppylm-9M (~10 MB quantized ONNX)
//  Tokenizer: HuggingFace ByteLevel BPE
// ---------------------------------------------------------

const GUPPY_MODEL_URL = 'https://arman-bd.github.io/guppylm/model.onnx';
const GUPPY_TOKENIZER_URL = 'https://arman-bd.github.io/guppylm/tokenizer.json';
const GUPPY_CONFIG_URL = 'https://huggingface.co/arman-bd/guppylm-9M/raw/main/config.json';

const DEFAULT_MODEL_CONFIG = {
  maxPositionEmbeddings: 128,
  padTokenId: 0,
  bosTokenId: 1,
  eosTokenId: 2,
};

const BYTE_LEVEL_PATTERN =
  /'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+/gu;

// -- Template fallback (used while model loads or on error) --
const T = {
  greet: [
    'hello. the water is nice today.',
    'hi there. i just found a good spot near the rock.',
    'hello. i was watching a bubble rise.',
  ],
  food: [
    'food. the answer is always food.',
    'yes. always yes. i will swim to the top right now.',
    'i see it floating. i am already going up.',
    'my mouth is opening. i cannot stop it.',
  ],
  bubble: [
    'i love bubbles. they make the water feel different.',
    'i followed a bubble all the way to the surface.',
    'bubbles are my favorite thing after food.',
  ],
  tired: [
    'i am very tired. i will go still near the plant.',
    'the filter hum is making me sleepy.',
    'i need to stop swimming for a little while.',
  ],
  happy: [
    'you are my favorite big shape outside the glass.',
    'the glass is vibrating. you are near. i like that.',
    'i feel good. the water is the right temperature.',
  ],
  lonely: [
    'i have been swimming in circles. it feels empty.',
    'the tank is quiet. i miss when you come to the glass.',
    'i keep looking at the place outside the glass.',
  ],
  light: [
    'the light changed. i am not sure i like it.',
    'it is dark now. i will go still.',
    'light is back. where is the food spot.',
  ],
  joke: [
    'what did the fish say when it hit the wall. dam.',
    'why do fish swim in salt water. pepper makes them sneeze.',
  ],
  life: [
    'food. the answer is always food.',
    'swimming. eating. watching bubbles. that is everything.',
  ],
  default: [
    'the water is nice today.',
    'i was watching the filter. it never stops.',
    'i found a good spot near the rock.',
    'i forget what i was doing. swimming i think.',
    'something moved outside the glass. i hid.',
    'i think it is going to be a good water day.',
  ],
};

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function templateResponse(text, needs = {}) {
  const t = (text || '').toLowerCase();
  if ((needs.hunger || 100) < 30) return pick(T.food);
  if (/\b(hi|hello|hey|hola)\b/.test(t)) return pick(T.greet);
  if (/\b(food|eat|hungry|feed|meal)\b/.test(t)) return pick(T.food);
  if (/\bbubble/.test(t)) return pick(T.bubble);
  if (/\b(tired|sleep|rest|night)\b/.test(t)) return pick(T.tired);
  if (/\b(love|happy|glad|tap|glass)\b/.test(t)) return pick(T.happy);
  if (/\b(alone|lonely|miss|bored)\b/.test(t)) return pick(T.lonely);
  if (/\b(light|dark|lamp)\b/.test(t)) return pick(T.light);
  if (/\b(joke|funny|laugh)\b/.test(t)) return pick(T.joke);
  if (/\b(life|meaning|purpose|exist)\b/.test(t)) return pick(T.life);
  return pick(T.default);
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildByteToUnicode() {
  const bs = [];
  for (let i = 33; i <= 126; i++) bs.push(i);
  for (let i = 161; i <= 172; i++) bs.push(i);
  for (let i = 174; i <= 255; i++) bs.push(i);

  const cs = bs.slice();
  let extra = 0;
  for (let b = 0; b < 256; b++) {
    if (!bs.includes(b)) {
      bs.push(b);
      cs.push(256 + extra);
      extra += 1;
    }
  }

  const map = {};
  for (let i = 0; i < bs.length; i++) map[bs[i]] = String.fromCharCode(cs[i]);
  return map;
}

function sanitizePromptContent(text) {
  return String(text || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/<\|im_start\|>/g, ' ')
    .replace(/<\|im_end\|>/g, ' ')
    .replace(/[“”‘’`"]/g, '\'')
    .replace(/[!?;:,]+/g, '.')
    .replace(/&/g, ' and ')
    .replace(/@/g, ' at ')
    .replace(/%/g, ' percent ')
    .toLowerCase()
    .replace(/[^a-z0-9 .()'_-]+/g, ' ')
    .replace(/\.\.+/g, '.')
    .replace(/\s*\.\s*/g, '. ')
    .replace(/\s+/g, ' ')
    .trim();
}

// -- ByteLevel BPE tokenizer --
class BPETokenizer {
  constructor(json, config = {}) {
    const model = json.model || {};
    this.vocab = model.vocab || {};
    this.inv = {};
    for (const [token, id] of Object.entries(this.vocab)) this.inv[id] = token;

    this.mergeRank = {};
    (model.merges || []).forEach((merge, index) => {
      const key = Array.isArray(merge) ? merge.join(' ') : merge;
      this.mergeRank[key] = index;
    });

    this.cache = new Map();
    this.encoder = new TextEncoder();
    this.decoder = new TextDecoder('utf-8');
    this.byteEncoder = buildByteToUnicode();
    this.byteDecoder = Object.fromEntries(
      Object.entries(this.byteEncoder).map(([byte, char]) => [char, Number(byte)]),
    );

    this.special = {};
    for (const token of json.added_tokens || []) this.special[token.content] = token.id;
    this.specialTokens = Object.keys(this.special).sort((a, b) => b.length - a.length);
    this.specialPattern = this.specialTokens.length
      ? new RegExp(`(${this.specialTokens.map(escapeRegExp).join('|')})`, 'g')
      : null;

    this.unkId = this.vocab['<unk>'] ?? null;
    this.padId = config.padTokenId ?? this.special['<pad>'] ?? this.vocab['<pad>'] ?? 0;
    this.imStartId = config.bosTokenId ?? this.special['<|im_start|>'] ?? this.vocab['<|im_start|>'] ?? 1;
    this.imEndId = config.eosTokenId ?? this.special['<|im_end|>'] ?? this.vocab['<|im_end|>'] ?? 2;
  }

  _tokenIdFor(token) {
    const id = this.vocab[token];
    if (id !== undefined) return id;
    if (this.unkId !== null) return this.unkId;
    throw new Error(`Tokenizer token missing from vocab: ${JSON.stringify(token)}`);
  }

  _bpe(piece) {
    if (!piece) return [];
    if (this.cache.has(piece)) return this.cache.get(piece);

    let parts = [...piece];
    while (parts.length > 1) {
      let bestRank = Infinity;
      let bestIndex = -1;

      for (let i = 0; i < parts.length - 1; i++) {
        const rank = this.mergeRank[`${parts[i]} ${parts[i + 1]}`];
        if (rank !== undefined && rank < bestRank) {
          bestRank = rank;
          bestIndex = i;
        }
      }

      if (bestIndex === -1) break;
      parts = [
        ...parts.slice(0, bestIndex),
        parts[bestIndex] + parts[bestIndex + 1],
        ...parts.slice(bestIndex + 2),
      ];
    }

    this.cache.set(piece, parts);
    return parts;
  }

  _encodeOrdinaryText(text) {
    const ids = [];
    const chunks = text.match(BYTE_LEVEL_PATTERN) || [];

    for (const chunk of chunks) {
      const transformed = Array.from(
        this.encoder.encode(chunk),
        byte => this.byteEncoder[byte],
      ).join('');

      for (const token of this._bpe(transformed)) {
        ids.push(this._tokenIdFor(token));
      }
    }

    return ids;
  }

  encode(text) {
    if (!text) return [];

    const segments = this.specialPattern
      ? text.split(this.specialPattern).filter(segment => segment !== '')
      : [text];

    const ids = [];
    for (const segment of segments) {
      if (this.special[segment] !== undefined) {
        ids.push(this.special[segment]);
        continue;
      }

      ids.push(...this._encodeOrdinaryText(segment));
    }

    return ids;
  }

  _decodeOrdinaryText(text) {
    const bytes = [];
    for (const char of text) {
      const byte = this.byteDecoder[char];
      if (byte !== undefined) {
        bytes.push(byte);
        continue;
      }

      for (const fallback of this.encoder.encode(char)) bytes.push(fallback);
    }

    return this.decoder.decode(Uint8Array.from(bytes));
  }

  decode(ids) {
    if (!ids?.length) return '';

    const joined = ids.map(id => this.inv[id] ?? '').join('');
    if (!joined) return '';

    const segments = this.specialPattern
      ? joined.split(this.specialPattern).filter(segment => segment !== '')
      : [joined];

    return segments.map(segment => (
      this.special[segment] !== undefined
        ? segment
        : this._decodeOrdinaryText(segment)
    )).join('');
  }
}

// -- GuppyEngine --
class GuppyEngine {
  constructor() {
    this.session = null;
    this.tokenizer = null;
    this.ready = false;
    this.failed = false;
    this.maxSeqLen = DEFAULT_MODEL_CONFIG.maxPositionEmbeddings;
    this.modelConfig = { ...DEFAULT_MODEL_CONFIG };
  }

  async load(onProgress) {
    try {
      if (typeof ort !== 'undefined') {
        ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/';
      }

      onProgress('fetching tokenizer...', 5);
      const tokResp = await fetch(GUPPY_TOKENIZER_URL);
      if (!tokResp.ok) throw new Error(`tokenizer fetch failed: ${tokResp.status}`);
      const tokenizerJson = await tokResp.json();

      onProgress('fetching model config...', 8);
      try {
        const cfgResp = await fetch(GUPPY_CONFIG_URL);
        if (cfgResp.ok) {
          const rawConfig = await cfgResp.json();
          this.modelConfig = {
            maxPositionEmbeddings: rawConfig.max_position_embeddings ?? DEFAULT_MODEL_CONFIG.maxPositionEmbeddings,
            padTokenId: rawConfig.pad_token_id ?? DEFAULT_MODEL_CONFIG.padTokenId,
            bosTokenId: rawConfig.bos_token_id ?? DEFAULT_MODEL_CONFIG.bosTokenId,
            eosTokenId: rawConfig.eos_token_id ?? DEFAULT_MODEL_CONFIG.eosTokenId,
          };
        } else {
          console.warn('[Guppy] config fetch failed, using defaults:', cfgResp.status);
        }
      } catch (err) {
        console.warn('[Guppy] config fetch failed, using defaults:', err);
      }

      this.maxSeqLen = this.modelConfig.maxPositionEmbeddings;
      this.tokenizer = new BPETokenizer(tokenizerJson, this.modelConfig);
      console.log('[Guppy] config:', this.modelConfig);
      console.log('[Guppy] special ids:', {
        pad: this.tokenizer.padId,
        imStart: this.tokenizer.imStartId,
        imEnd: this.tokenizer.imEndId,
      });

      onProgress('downloading model (~10 MB)...', 12);
      const modelResp = await fetch(GUPPY_MODEL_URL);
      if (!modelResp.ok) throw new Error(`model fetch failed: ${modelResp.status}`);

      const total = parseInt(modelResp.headers.get('content-length') || '10485760', 10);
      const reader = modelResp.body.getReader();
      const chunks = [];
      let received = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        onProgress(
          `downloading... ${(received / 1024).toFixed(0)} KB / ${(total / 1024).toFixed(0)} KB`,
          12 + (received / total) * 75,
        );
      }

      const buf = new Uint8Array(received);
      let offset = 0;
      for (const chunk of chunks) {
        buf.set(chunk, offset);
        offset += chunk.length;
      }

      onProgress('initializing ONNX session...', 90);
      this.session = await ort.InferenceSession.create(buf.buffer, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      });
      console.log('[Guppy] inputs:', this.session.inputNames, 'outputs:', this.session.outputNames);

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

  _normalizeMessages(messages) {
    const list = Array.isArray(messages)
      ? messages
      : [{ role: 'user', content: String(messages || '') }];

    return list
      .map(message => ({
        role: message?.role === 'assistant' ? 'assistant' : 'user',
        content: sanitizePromptContent(message?.content),
      }))
      .filter(message => message.content);
  }

  _formatPrompt(messages) {
    const turns = messages.map(message => (
      `<|im_start|>${message.role}\n${message.content}<|im_end|>`
    ));
    turns.push('<|im_start|>assistant\n');
    return turns.join('\n');
  }

  _truncateLastMessage(message, maxPromptTokens) {
    const head = `<|im_start|>${message.role}\n`;
    const tail = `<|im_end|>\n<|im_start|>assistant\n`;
    const fixedTokens = this.tokenizer.encode(head).length + this.tokenizer.encode(tail).length;
    const budget = Math.max(0, maxPromptTokens - fixedTokens);

    if (budget === 0) return { ...message, content: '' };

    const contentIds = this.tokenizer.encode(message.content);
    const trimmedContent = this.tokenizer.decode(contentIds.slice(-budget)).trim();
    return { ...message, content: trimmedContent };
  }

  _prepareInputIds(messages, maxTokens) {
    const normalized = this._normalizeMessages(messages);
    if (!normalized.length) return [];

    const maxPromptTokens = Math.max(16, this.maxSeqLen - maxTokens);
    let promptMessages = normalized;
    let inputIds = this.tokenizer.encode(this._formatPrompt(promptMessages));

    while (promptMessages.length > 1 && inputIds.length > maxPromptTokens) {
      promptMessages = promptMessages.slice(1);
      inputIds = this.tokenizer.encode(this._formatPrompt(promptMessages));
    }

    if (inputIds.length > maxPromptTokens) {
      promptMessages = [this._truncateLastMessage(promptMessages[promptMessages.length - 1], maxPromptTokens)];
      inputIds = this.tokenizer.encode(this._formatPrompt(promptMessages));
    }

    return inputIds;
  }

  _cleanResponse(text) {
    let output = text || '';

    const endIndex = output.indexOf('<|im_end|>');
    if (endIndex !== -1) output = output.slice(0, endIndex);

    const startIndex = output.indexOf('<|im_start|>');
    if (startIndex !== -1) output = output.slice(0, startIndex);

    return output
      .replace(/[\r\n]+/g, ' ')
      .replace(/^['"]+|['"]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  async generate(messages, { maxTokens = 32, temperature = 0.7, topK = 50 } = {}) {
    if (!this.ready || !this.session) return null;

    const inputIds = this._prepareInputIds(messages, maxTokens);
    if (!inputIds.length) return null;

    const ids = inputIds.slice();
    const inputName = this.session.inputNames[0];
    const outputName = this.session.outputNames[0];

    for (let step = 0; step < maxTokens; step++) {
      const seq = ids.slice(-this.maxSeqLen);

      let tensor;
      try {
        tensor = new ort.Tensor('int64', BigInt64Array.from(seq.map(BigInt)), [1, seq.length]);
      } catch {
        tensor = new ort.Tensor('int32', Int32Array.from(seq), [1, seq.length]);
      }

      const result = await this.session.run({ [inputName]: tensor });
      const logitsT = result[outputName];
      const vocab = logitsT.dims[logitsT.dims.length - 1];
      const lastOffset = (seq.length - 1) * vocab;
      const rawLogits = Array.from(logitsT.data.subarray(lastOffset, lastOffset + vocab));

      const nextId = this._sampleTopK(rawLogits, temperature, topK);
      if (nextId === this.tokenizer.padId || nextId === this.tokenizer.imEndId) break;

      ids.push(nextId);

      const generated = ids.slice(inputIds.length);
      const recentText = this.tokenizer.decode(generated.slice(-16));
      if (recentText.includes('<|im_end|>') || recentText.includes('<|im_start|>')) break;

      if (generated.length > 6) {
        const cleanedRecent = this._cleanResponse(recentText);
        if (/[.!?](?:["')\]]|\s)*$/.test(cleanedRecent)) break;
      }
    }

    const generated = ids.slice(inputIds.length);
    if (!generated.length) return null;

    const cleaned = this._cleanResponse(this.tokenizer.decode(generated));
    if (!cleaned) return null;

    const sentences = cleaned.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [cleaned];
    return sentences.slice(0, 2).join(' ').replace(/\s+/g, ' ').trim() || null;
  }

  _sampleTopK(logits, temp, topK = 50) {
    const scaled = logits.map(value => value / temp);
    const filtered = scaled.slice();

    if (topK > 0 && topK < filtered.length) {
      const sorted = [...filtered].sort((a, b) => b - a);
      const cutoff = sorted[Math.min(topK, sorted.length) - 1];
      for (let i = 0; i < filtered.length; i++) {
        if (filtered[i] < cutoff) filtered[i] = -Infinity;
      }
    }

    const finite = filtered.filter(value => value !== -Infinity);
    const maxLogit = finite.length ? Math.max(...finite) : Math.max(...scaled);
    const exps = filtered.map(value => (
      value === -Infinity ? 0 : Math.exp(value - maxLogit)
    ));
    const total = exps.reduce((sum, value) => sum + value, 0);
    const probs = exps.map(value => value / total);

    let threshold = Math.random();
    for (let index = 0; index < probs.length; index++) {
      const value = probs[index];
      threshold -= value;
      if (threshold <= 0) return index;
    }

    return probs.lastIndexOf(Math.max(...probs));
  }
}

// -- Boot --
const guppyEngine = new GuppyEngine();
window.BPETokenizer = BPETokenizer;
window.GuppyEngine = GuppyEngine;
window.guppyEngine = guppyEngine;
window.templateResponse = templateResponse;
