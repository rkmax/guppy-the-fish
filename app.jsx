const { useState, useEffect, useLayoutEffect, useRef } = React;

const TWEAK_DEFAULTS = window.TWEAK_DEFAULTS || {
  phosphorColor: '#39ff14',
  bgColor: '#050c07',
  scanlines: true,
  binaryRain: true,
  fishSize: 13,
};

// ─────────────────────────────────────────────────────────
//  ASCII FISH FRAMES  (cartoon sprite bank)
// ─────────────────────────────────────────────────────────
//  RIGHT: tail LEFT  →→  head RIGHT
//  LEFT:  tail RIGHT →→  head LEFT

const ASCII_MIRROR_MAP = Object.freeze({
  '/': '\\',
  '\\': '/',
  '(': ')',
  ')': '(',
  '<': '>',
  '>': '<',
  '[': ']',
  ']': '[',
  '{': '}',
  '}': '{',
});

function mirrorAsciiLines(lines) {
  return lines.map((line) => [...line]
    .reverse()
    .map((char) => ASCII_MIRROR_MAP[char] || char)
    .join(''));
}

function normalizeAsciiFrames(frames) {
  const height = Math.max(...frames.map((frame) => frame.length));
  const width = Math.max(
    ...frames.flatMap((frame) => frame.map((line) => line.length)),
  );

  return frames.map((frame) => Array.from({ length: height }, (_, index) => (
    (frame[index] || '').padEnd(width, ' ')
  )));
}

function buildSpriteFrames(frames) {
  return normalizeAsciiFrames(frames).map((lines) => lines.join('\n'));
}

function createMirroredSpriteSet(rightFrames) {
  return {
    right: buildSpriteFrames(rightFrames),
    left: buildSpriteFrames(rightFrames.map((frame) => mirrorAsciiLines(frame))),
  };
}

const FISH_SPRITES = {
  swim: createMirroredSpriteSet([
    [
      "  \\",
      "   \\          /\\",
      "    \\      __/  \\__",
      "     \\   _/  _    \\",
      "      \\/  _/ )  o   >",
      "      /\\\\_/__/    _/",
      "     //      \\__./",
      "    //         v",
    ],
    [
      " \\",
      "  \\           /\\",
      "   \\       __/  \\__",
      "    \\    _/  _    \\",
      "     \\__/ _/ )  o   >",
      "     //  \\__/    _/",
      "    //       \\__./",
      "   //          v",
    ],
    [
      "  \\",
      "   \\          /\\",
      "    \\      __/  \\__",
      "     \\   _/  _    \\",
      "      \\/__/ )  o   >",
      "      ///   /    _/",
      "     ///    \\__./",
      "    //         v",
    ],
  ]),
  sleep: createMirroredSpriteSet([
    [
      "  \\",
      "   \\            /\\",
      "    \\         _/  \\",
      "     \\      _/   _\\",
      "      \\    /  __   )",
      "       \\  (  - _  )>",
      "       //  \\______/ ",
      "      //",
      "     //    z z z",
      "    //   z",
      "   //",
    ],
  ]),
  eat: createMirroredSpriteSet([
    [
      "  \\          *",
      "   \\            /\\",
      "    \\         _/  \\",
      "     \\      _/   _\\",
      "      \\    /  __   ) *",
      "       \\  (  o _  )> o",
      "       //  \\______/ ",
      "      //      |  \\",
      "     //   *   |   \\",
      "    //",
      "   //",
    ],
  ]),
};

function getFishFrameSet(state) {
  // Always render the canonical right-facing ASCII and mirror at paint time.
  // Geometric mirroring preserves anatomy better than rebuilding left-facing
  // sprites from reversed characters.
  return FISH_SPRITES[state].right;
}

// ─────────────────────────────────────────────────────────
//  GUPPY SOUL  — local GuppyLM inference (ONNX + WASM)
//  Falls back to template responses while model loads
// ─────────────────────────────────────────────────────────

const FISH_INITIAL_X_RATIO = 0.4;
const FISH_MIN_X_RATIO = 0.06;
const FISH_MAX_X_RATIO = 0.82;
const FISH_SPEED_PX_PER_SEC = 60;
const FISH_TICK_MS = 40;
const FISH_SLEEP_Z_OFFSET_PX = 24;
const FISH_BUBBLE_OFFSET_PX = 18;
const FISH_BUBBLE_JITTER_PX = 10;
const FISH_CRUISE_Y_PERCENT = 42;
const FISH_FOOD_Y_PERCENT = 28;
const FISH_SLEEP_Y_PERCENT = 60;
const FISH_VERTICAL_SPEED_PERCENT_PER_SEC = 18;
const FISH_SLEEP_SETTLE_THRESHOLD = 0.6;
const FISH_BOB_AMPLITUDE_PX = 1.6;
const FISH_TILT_MAX_DEG = 7;
const FISH_TURN_DURATION_MS = 220;
const FISH_TURN_SQUASH = 0.22;
const FISH_TURN_STRETCH = 0.08;
const FOOD_PELLET_DURATION_SEC = 2.8;
const TAP_RIPPLE_DURATION_SEC = 0.75;
const LIGHT_FX_DURATION_SEC = 0.9;
const AUTONOMY_ACTION_INTERVAL_MS = 16000;
const AUTONOMY_MODE_DURATION_MS = 7000;
const SWIM_SPEED_MULTIPLIER = 1.45;
const SEEK_FOOD_SPEED_MULTIPLIER = 1.2;
const ACTION_TOKENS = ['sleep', 'wake', 'swim', 'food', 'idle'];
const AUTONOMY_IDLE_PROMPTS = [
  'what are you thinking right now',
  'what are you doing right now',
  'say one short fish thought',
];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function moveToward(current, target, maxDelta) {
  if (Math.abs(target - current) <= maxDelta) return target;
  return current + Math.sign(target - current) * maxDelta;
}

function getFishBounds(tankWidth) {
  if (!tankWidth) return { min: 0, max: 0 };
  return {
    min: tankWidth * FISH_MIN_X_RATIO,
    max: tankWidth * FISH_MAX_X_RATIO,
  };
}

function pickPrompt(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function buildNeedsCue(needs, context = {}) {
  if (!needs) return '';

  const cues = [];

  if (context.sleeping) {
    cues.push('sleeping');
  } else if (context.behaviorMode === 'swim') {
    cues.push('active');
  } else if (context.behaviorMode === 'food') {
    cues.push('looking for food');
  }

  if (context.lightsOff) {
    cues.push('dark');
  }

  if (needs.hunger < 25) {
    cues.push('hungry', 'food');
  } else if (needs.hunger < 45) {
    cues.push('hungry');
  }

  if (needs.happiness < 25) {
    cues.push('lonely');
  } else if (needs.happiness > 80) {
    cues.push('happy');
  }

  if (needs.energy < 20) {
    cues.push('tired', 'rest');
  } else if (needs.energy > 80) {
    cues.push('swim');
  }

  return [...new Set(cues)].join('. ');
}

function buildNeedsAwarePrompt(userText, needs, context = {}) {
  const cue = buildNeedsCue(needs, context);
  const prompt = String(userText || '').trim();
  if (!cue) return prompt;
  if (!prompt) return `${cue}.`;
  return `${cue}. ${prompt}`;
}

function buildBehaviorPrompt(needs, context = {}) {
  const cue = buildNeedsCue(needs, context);
  const parts = [
    'choose one next fish action',
    `actions only. ${ACTION_TOKENS.join('. ')}`,
    context.sleeping ? 'you are sleeping now' : 'you are awake now',
  ];

  if (cue) {
    parts.push(`state. ${cue}`);
  }

  parts.push(`answer with one word only. ${ACTION_TOKENS.join(' or ')}`);
  return parts.join('. ');
}

function parseBehaviorAction(text, context = {}) {
  const normalized = String(text || '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return null;

  const tokens = normalized.split(' ').filter(Boolean);
  const matches = tokens.filter(token => ACTION_TOKENS.includes(token));
  const uniqueMatches = [...new Set(matches)];
  if (uniqueMatches.length === 1) return uniqueMatches[0];

  if (tokens.length === 1) {
    if (tokens[0] === 'rest') return 'sleep';
    if (tokens[0] === 'eat' || tokens[0] === 'hungry') return 'food';
    if (tokens[0] === 'move' || tokens[0] === 'explore') return 'swim';
    if (tokens[0] === 'wait' || tokens[0] === 'still') return 'idle';
  }

  return null;
}

function fallbackBehaviorAction(needs, context = {}) {
  if (context.sleeping) {
    return needs.energy > 72 ? 'wake' : 'sleep';
  }

  if (needs.energy < 18) return 'sleep';
  if (needs.hunger < 30) return 'food';
  if (needs.happiness < 35 || needs.energy > 80) return 'swim';
  return 'idle';
}

function buildActionThoughtPrompt(action) {
  if (action === 'sleep') return 'you decide to sleep now';
  if (action === 'wake') return 'you wake up again';
  if (action === 'swim') return 'you swim around the tank';
  if (action === 'food') return 'you look for food near the surface';
  return '';
}

async function guppyReply(userText, needs, context = {}) {
  const engine = window.guppyEngine;
  const prompt = buildNeedsAwarePrompt(userText, needs, context);
  if (engine && engine.ready) {
    try {
      const result = await engine.generate([{ role: 'user', content: prompt }], {
        maxTokens: 32,
        temperature: 0.7,
        topK: 50,
      });
      if (result) return result;
    } catch (err) {
      console.error('[GuppyUI] reply generation failed:', err);
    }
  }
  return window.templateResponse(prompt, needs);
}

async function guppyPlanAction(needs, context = {}) {
  const engine = window.guppyEngine;
  const prompt = buildBehaviorPrompt(needs, context);

  if (engine && engine.ready) {
    try {
      const result = await engine.generate(
        [{ role: 'user', content: prompt }],
        { maxTokens: 6, temperature: 0.1, topK: 5 },
      );
      return parseBehaviorAction(result, context) || fallbackBehaviorAction(needs, context);
    } catch (err) {
      console.error('[GuppyUI] autonomy planning failed:', err);
    }
  }

  return fallbackBehaviorAction(needs, context);
}

async function guppyAutoThought(needs, context = {}, seedPrompt = '') {
  const engine = window.guppyEngine;
  const prompt = seedPrompt || pickPrompt(AUTONOMY_IDLE_PROMPTS);
  const promptWithNeeds = buildNeedsAwarePrompt(prompt, needs, context);

  if (engine && engine.ready) {
    try {
      const result = await engine.generate(
        [{ role: 'user', content: promptWithNeeds }],
        { maxTokens: 32, temperature: 0.7, topK: 50 },
      );
      if (result) return result;
    } catch (err) {
      console.error('[GuppyUI] auto-thought generation failed:', err);
    }
  }
  return window.templateResponse(promptWithNeeds, needs);
}

// ─────────────────────────────────────────────────────────
//  BINARY RAIN  (background decoration)
// ─────────────────────────────────────────────────────────
function BinaryRain({ color, enabled }) {
  const [cols, setCols] = useState(() =>
    Array.from({ length: 10 }, (_, i) => ({
      id: i,
      x: 6 + i * 8.4,
      y: Math.random() * 100,
      str: Array.from({ length: 6 }, () => Math.random() > 0.5 ? '1' : '0').join('\n'),
      speed: 0.05 + Math.random() * 0.07,
      opacity: 0.01 + Math.random() * 0.024,
    }))
  );

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => {
      setCols(c => c.map(col => ({
        ...col,
        y: col.y > 100 ? -15 : col.y + col.speed,
        str: Math.random() < 0.06
          ? Array.from({ length: 6 }, () => Math.random() > 0.5 ? '1' : '0').join('\n')
          : col.str,
      })));
    }, 120);
    return () => clearInterval(id);
  }, [enabled]);

  if (!enabled) return null;
  return (
    <>
      {cols.map(col => (
        <pre key={col.id} style={{
          position: 'absolute', left: `${col.x}%`, top: `${col.y}%`,
          color, opacity: col.opacity, fontSize: 10, lineHeight: 1.6,
          pointerEvents: 'none', zIndex: 1,
        }}>{col.str}</pre>
      ))}
    </>
  );
}

const FLOOR_FONT_SIZE_PX = 13;
const FLOOR_FONT_FAMILY = "'Share Tech Mono', 'Courier New', monospace";
const FLOOR_PADDING_PX = 12;
const FLOOR_PROBE_CHARS = 100;

function useMeasuredMonospaceCharWidth(fontSizePx, fontFamily) {
  const probeRef = useRef(null);
  const [charWidthPx, setCharWidthPx] = useState(0);

  useLayoutEffect(() => {
    const probe = probeRef.current;
    if (!probe) return;

    const measure = () => {
      const rect = probe.getBoundingClientRect();
      const next = rect.width / FLOOR_PROBE_CHARS;
      if (Number.isFinite(next) && next > 0) {
        setCharWidthPx((prev) => (Math.abs(prev - next) < 0.05 ? prev : next));
      }
    };

    measure();

    let disposed = false;
    const onResize = () => measure();
    window.addEventListener('resize', onResize);
    window.visualViewport?.addEventListener('resize', onResize);

    const fontReady = document.fonts?.ready;
    if (fontReady?.then) {
      fontReady.then(() => {
        if (!disposed) measure();
      });
    }

    let observer;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => measure());
      observer.observe(probe);
    }

    return () => {
      disposed = true;
      window.removeEventListener('resize', onResize);
      window.visualViewport?.removeEventListener('resize', onResize);
      observer?.disconnect();
    };
  }, [fontFamily, fontSizePx]);

  return [probeRef, charWidthPx];
}

function SurfaceRibbon({ weedPhase, color, tankWidth }) {
  const [probeRef, charWidthPx] = useMeasuredMonospaceCharWidth(FLOOR_FONT_SIZE_PX, FLOOR_FONT_FAMILY);
  const usableWidth = Math.max(0, tankWidth * 0.96);
  const cols = tankWidth > 0 && charWidthPx > 0
    ? Math.max(32, Math.floor(usableWidth / charWidthPx))
    : 64;
  const pattern = ['~', '≈', '~', '~', '-', '≈', '~'];
  const ribbon = Array.from({ length: cols }, (_, index) => (
    pattern[(index + Math.floor(weedPhase * 1.5)) % pattern.length]
  )).join('');

  return (
    <pre style={{
      position:'absolute',
      top:'5%',
      left:'2%',
      right:'2%',
      margin:0,
      fontFamily:FLOOR_FONT_FAMILY,
      fontSize:FLOOR_FONT_SIZE_PX,
      lineHeight:'13px',
      color,
      overflow:'hidden',
      whiteSpace:'pre',
      pointerEvents:'none',
      zIndex:2,
    }}>
      <span
        ref={probeRef}
        aria-hidden="true"
        style={{
          position:'absolute',
          top:0,
          left:0,
          visibility:'hidden',
          pointerEvents:'none',
          whiteSpace:'pre',
        }}
      >{'0'.repeat(FLOOR_PROBE_CHARS)}</span>
      {ribbon}
    </pre>
  );
}

function FloorScape({ weedPhase, color, tankWidth }) {
  const [probeRef, charWidthPx] = useMeasuredMonospaceCharWidth(FLOOR_FONT_SIZE_PX, FLOOR_FONT_FAMILY);

  const usableWidth = Math.max(0, tankWidth - FLOOR_PADDING_PX);
  const COLS = tankWidth > 0 && charWidthPx > 0
    ? Math.max(40, Math.floor(usableWidth / charWidthPx))
    : 80;
  const ROWS = 10;
  const grid = Array.from({ length: ROWS }, () => new Array(COLS).fill(' '));

  const writeText = (row, col, text) => {
    if (row < 0 || row >= ROWS) return;
    [...text].forEach((char, index) => {
      const x = col + index;
      if (char === ' ' || x < 0 || x >= COLS) return;
      grid[row][x] = char;
    });
  };

  const gravelPattern = "._,.__.,_,._.__,,._";
  for (let col = 0; col < COLS; col++) {
    grid[ROWS - 1][col] = gravelPattern[(col + Math.floor(weedPhase * 1.4)) % gravelPattern.length];
    if (col % 3 === 0) {
      grid[ROWS - 2][col] = col % 11 === 0 ? '_' : '.';
    }
  }

  const plantClusters = [
    { baseRatio: 0.1, stems: [0, 1, -1], height: 5, sway: 1.5 },
    { baseRatio: 0.23, stems: [0, 1], height: 4, sway: 1.2 },
    { baseRatio: 0.76, stems: [0, 1, -1, 2], height: 5, sway: 1.6 },
    { baseRatio: 0.9, stems: [0, -1], height: 4, sway: 1.1 },
  ];

  plantClusters.forEach((cluster, clusterIndex) => {
    const baseCol = Math.round((COLS - 1) * cluster.baseRatio);
    cluster.stems.forEach((stemOffset, stemIndex) => {
      for (let heightIndex = 0; heightIndex < cluster.height; heightIndex++) {
        const row = ROWS - 2 - heightIndex;
        const drift = Math.sin(
          weedPhase + clusterIndex * 1.35 + stemIndex * 0.72 + heightIndex * 0.34,
        );
        const sway = Math.round(drift * (cluster.sway + heightIndex * 0.12));
        const col = Math.max(0, Math.min(COLS - 1, baseCol + stemOffset + sway));
        const isTip = heightIndex === cluster.height - 1;
        const char = isTip
          ? drift > 0.45 ? '\'' : drift < -0.45 ? '`' : '|'
          : drift > 0.58 ? '/' : drift < -0.58 ? '\\' : '|';
        grid[row][col] = char;
      }
    });
  });

  const placeCentered = (row, centerRatio, text) => {
    const centerCol = Math.round((COLS - 1) * centerRatio);
    const startCol = centerCol - Math.floor(text.length / 2);
    writeText(row, startCol, text);
  };

  [
    { row: ROWS - 4, ratio: 0.09, text: "   __   " },
    { row: ROWS - 3, ratio: 0.09, text: " _/  \\_ " },
    { row: ROWS - 2, ratio: 0.09, text: "/______\\" },
    { row: ROWS - 3, ratio: 0.5, text: "  ____  " },
    { row: ROWS - 2, ratio: 0.5, text: " /____\\ " },
    { row: ROWS - 4, ratio: 0.8, text: "    ___   " },
    { row: ROWS - 3, ratio: 0.8, text: " __/   \\_ " },
    { row: ROWS - 2, ratio: 0.8, text: "/________\\" },
    { row: ROWS - 3, ratio: 0.64, text: "(_)" },
    { row: ROWS - 2, ratio: 0.69, text: "o" },
    { row: ROWS - 2, ratio: 0.72, text: "." },
  ].forEach(({ row, ratio, text }) => placeCentered(row, ratio, text));

  return (
    <pre style={{
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: '2%',
      fontFamily: FLOOR_FONT_FAMILY,
      fontSize: FLOOR_FONT_SIZE_PX,
      lineHeight: '13px',
      color,
      pointerEvents: 'none',
      zIndex: 3,
      margin: 0,
      padding: `0 ${FLOOR_PADDING_PX / 2}px`,
      width: '100%',
      boxSizing: 'border-box',
      whiteSpace: 'pre',
      overflow: 'visible',
    }}>
      <span
        ref={probeRef}
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          visibility: 'hidden',
          pointerEvents: 'none',
          whiteSpace: 'pre',
        }}
      >{'0'.repeat(FLOOR_PROBE_CHARS)}</span>
      {grid.map((row) => row.join('')).join('\n')}
    </pre>
  );
}

// ─────────────────────────────────────────────────────────
//  TANK
// ─────────────────────────────────────────────────────────
function Tank({
  tw,
  fishX,
  tankWidth,
  fishY,
  fishPose,
  fishMirrorX,
  fishAscii,
  bubbles,
  foodPellets,
  tapRipples,
  lightFx,
  weedPhase,
  sleeping,
  lightsOff,
  guppySpeech,
  bgColor,
}) {
  const ph = tw.phosphorColor;

  // Build a consistent dim color from phosphor hex
  const hexToDimRgba = (hex, alpha) => {
    const r = parseInt(hex.slice(1,3),16);
    const g = parseInt(hex.slice(3,5),16);
    const b = parseInt(hex.slice(5,7),16);
    return `rgba(${r},${g},${b},${alpha})`;
  };
  const dimPh = (a) => hexToDimRgba(ph, a);

  const safeFishX = Number.isFinite(fishX) ? fishX : 0;
  const speechLeft = tankWidth ? clamp(safeFishX, tankWidth * 0.18, tankWidth * 0.72) : safeFishX;

  return (
    <div style={{ width:'100%', height:'100%', position:'relative', background: bgColor, overflow:'hidden' }}>
      <div style={{
        position:'absolute', inset:0, pointerEvents:'none', zIndex:0,
        background: `
          linear-gradient(180deg, ${dimPh(lightsOff ? 0.035 : 0.07)} 0%, transparent 18%, transparent 70%, ${dimPh(lightsOff ? 0.03 : 0.06)} 100%),
          linear-gradient(90deg, ${dimPh(lightsOff ? 0.016 : 0.03)} 0%, transparent 14%, transparent 86%, ${dimPh(lightsOff ? 0.01 : 0.02)} 100%)
        `,
      }}/>

      <div style={{
        position:'absolute', inset:'6% 3% 11% 3%', pointerEvents:'none', zIndex:1,
        backgroundImage:`repeating-linear-gradient(180deg, transparent 0 16px, ${dimPh(lightsOff ? 0.01 : 0.022)} 16px 17px, transparent 17px 34px)`,
        opacity: lightsOff ? 0.45 : 0.75,
      }}/>

      <div style={{
        position:'absolute', top:'7%', left:'4%', right:'4%', height:'10%',
        pointerEvents:'none', zIndex:2,
        background:`linear-gradient(180deg, ${dimPh(lightsOff ? 0.018 : 0.045)} 0%, ${dimPh(0)} 100%)`,
      }}/>

      {/* CRT scanline sweep */}
      {tw.scanlines && (
        <div style={{
          position:'absolute', inset:0, pointerEvents:'none', zIndex:30,
          backgroundImage:`repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,0,0,0.06) 3px, rgba(0,0,0,0.06) 4px)`,
        }}/>
      )}

      {/* Binary rain */}
      <BinaryRain color={dimPh(lightsOff ? 0.1 : 0.18)} enabled={tw.binaryRain} />

      {/* Light dim */}
      <div style={{
        position:'absolute', inset:0,
        background:'rgba(0,0,0,0.36)',
        boxShadow:'inset 0 0 42px rgba(0,0,0,0.48)',
        pointerEvents:'none', zIndex:5,
        opacity: lightsOff ? 1 : 0,
        transition:'opacity 0.65s ease, box-shadow 0.65s ease',
      }}/>

      {lightFx && (
        <React.Fragment>
          <div style={{
            position:'absolute',
            inset:0,
            pointerEvents:'none',
            zIndex:6,
            opacity: 1 - lightFx.life,
            background: lightFx.mode === 'off'
              ? `linear-gradient(180deg, ${dimPh(0.2)} 0%, ${dimPh(0.08)} 18%, ${dimPh(0)} 42%)`
              : `radial-gradient(circle at 50% 10%, ${dimPh(0.34)} 0%, ${dimPh(0.12)} 22%, ${dimPh(0)} 48%)`,
            transform: lightFx.mode === 'off'
              ? `translateY(${lightFx.life * 14}px)`
              : `scale(${1 + lightFx.life * 0.05})`,
          }}/>
          <div style={{
            position:'absolute',
            left:'4%',
            right:'4%',
            top:`${6 + lightFx.life * (lightFx.mode === 'off' ? 20 : 8)}%`,
            height:1,
            background: dimPh(lightFx.mode === 'off' ? 0.26 * (1 - lightFx.life) : 0.34 * (1 - lightFx.life)),
            pointerEvents:'none',
            zIndex:7,
          }}/>
        </React.Fragment>
      )}

      {/* Surface shimmer */}
      <SurfaceRibbon
        weedPhase={weedPhase}
        color={dimPh(0.25)}
        tankWidth={tankWidth}
      />

      {/* Food pellets */}
      {foodPellets.map((pellet) => (
        <div key={pellet.id} style={{
          position:'absolute',
          left:`${pellet.x}px`,
          top:`${pellet.y}%`,
          color: dimPh(0.22 + (1 - pellet.life) * 0.3),
          fontSize:12,
          fontFamily:'monospace',
          transform:`translate(-50%, -50%) translateX(${Math.sin(pellet.phase + pellet.life * 7) * pellet.wobble}px)`,
          pointerEvents:'none',
          zIndex:5,
        }}>{pellet.char}</div>
      ))}

      {/* Bubbles */}
      {bubbles.map(b => (
        <div key={b.id} style={{
          position:'absolute', left:`${b.x}px`, top:`${b.y}%`,
          color: dimPh(0.15 + (1 - b.y/60)*0.25),
          fontSize:12, fontFamily:'monospace',
          transform:`translateX(${Math.sin(b.y * 0.25 + b.id) * 10}px)`,
          pointerEvents:'none', zIndex:4,
        }}>{b.char}</div>
      ))}

      {/* Tap ripples */}
      {tapRipples.map((ripple) => {
        const size = 18 + ripple.life * 120;
        const innerSize = size * 0.62;
        const opacity = (1 - ripple.life) * 0.55;
        return (
          <React.Fragment key={ripple.id}>
            <div style={{
              position:'absolute',
              left:`${ripple.x}px`,
              top:`${ripple.y}%`,
              width:size,
              height:size * 0.42,
              transform:'translate(-50%, -50%)',
              border:`1px solid ${dimPh(opacity)}`,
              borderRadius:'999px',
              pointerEvents:'none',
              zIndex:8,
            }}/>
            <div style={{
              position:'absolute',
              left:`${ripple.x}px`,
              top:`${ripple.y}%`,
              width:innerSize,
              height:innerSize * 0.38,
              transform:'translate(-50%, -50%)',
              border:`1px solid ${dimPh(opacity * 0.7)}`,
              borderRadius:'999px',
              pointerEvents:'none',
              zIndex:8,
            }}/>
            <div style={{
              position:'absolute',
              left:`${ripple.x}px`,
              top:`${Math.max(ripple.y - 10, 8)}%`,
              width:1,
              height:22 + ripple.life * 10,
              background:`linear-gradient(180deg, ${dimPh(opacity * 0.9)} 0%, ${dimPh(0)} 100%)`,
              transform:'translateX(-50%)',
              pointerEvents:'none',
              zIndex:8,
            }}/>
          </React.Fragment>
        );
      })}

      {/* Lower hardscape */}
      <FloorScape
        weedPhase={weedPhase}
        color={dimPh(lightsOff ? 0.16 : 0.27)}
        tankWidth={tankWidth}
      />

      <div style={{
        position:'absolute',
        left:0,
        right:0,
        bottom:0,
        height:'20%',
        background:`linear-gradient(180deg, transparent 0%, ${dimPh(lightsOff ? 0.025 : 0.055)} 58%, ${dimPh(lightsOff ? 0.05 : 0.08)} 100%)`,
        pointerEvents:'none',
        zIndex:3,
      }}/>

      {/* Fish */}
      <div style={{
        position:'absolute',
        left:`${safeFishX}px`, top:`${fishY}%`,
        transform:`
          translate(-50%, -50%)
          translateY(${fishPose.bobPx}px)
          rotate(${fishPose.tiltDeg}deg)
          scaleY(${fishPose.squashY})
        `,
        transformOrigin:'50% 50%',
        zIndex:6, pointerEvents:'none',
      }}>
        <div style={{
          transform:`scaleX(${fishMirrorX * fishPose.squashX})`,
          transformOrigin:'50% 50%',
          fontFamily:'monospace', fontSize: tw.fishSize,
          color: sleeping ? dimPh(0.35) : ph,
          whiteSpace:'pre', lineHeight:1.15,
          textShadow: sleeping ? 'none' : `0 0 12px ${dimPh(0.5)}`,
          transition:'color 1.5s, text-shadow 1.5s',
        }}>{fishAscii}</div>
      </div>

      {/* Sleep Zs */}
      {sleeping && (
        <div style={{
          position:'absolute',
          left:`${safeFishX + FISH_SLEEP_Z_OFFSET_PX}px`, top:`${fishY - 10}%`,
          fontFamily:'monospace', fontSize:12,
          color: dimPh(0.5),
          animation:'zzzFloat 2s ease-out infinite',
          pointerEvents:'none', zIndex:7,
        }}>z z z</div>
      )}

      {/* Speech bubble */}
      {guppySpeech && (
        <div style={{
          position:'absolute',
          left:`${speechLeft}px`,
          top:`${Math.max(fishY - 24, 8)}%`,
          transform:'translateX(-50%)',
          background: bgColor,
          border:`1px solid ${ph}`,
          color: ph,
          padding:'6px 12px',
          fontSize:12, fontFamily:'monospace',
          maxWidth:240, lineHeight:1.5,
          zIndex:20,
          boxShadow:`0 0 16px ${dimPh(0.3)}`,
          animation:'fadeInUp 0.25s ease',
          whiteSpace:'normal',
        }}>
          <div style={{
            position:'absolute', bottom:-8, left:'50%', transform:'translateX(-50%)',
            color: ph, fontSize:10, lineHeight:1,
          }}>▼</div>
          {guppySpeech}
        </div>
      )}

      <div style={{
        position:'absolute',
        inset:0,
        pointerEvents:'none',
        zIndex:25,
        boxShadow:`
          inset 0 0 0 1px ${dimPh(lightsOff ? 0.12 : 0.18)},
          inset 0 16px 26px ${dimPh(lightsOff ? 0.05 : 0.1)},
          inset 16px 0 30px ${dimPh(lightsOff ? 0.03 : 0.06)},
          inset -10px 0 18px ${dimPh(lightsOff ? 0.015 : 0.035)}
        `,
      }}/>

      <div style={{
        position:'absolute',
        top:'4%',
        bottom:'12%',
        left:'3%',
        width:1,
        background:`linear-gradient(180deg, ${dimPh(lightsOff ? 0.12 : 0.24)} 0%, ${dimPh(0)} 52%, ${dimPh(lightsOff ? 0.05 : 0.1)} 100%)`,
        pointerEvents:'none',
        zIndex:26,
      }}/>

      <div style={{
        position:'absolute',
        top:'4%',
        bottom:'12%',
        right:'4%',
        width:1,
        background:`linear-gradient(180deg, ${dimPh(lightsOff ? 0.05 : 0.1)} 0%, ${dimPh(0)} 45%, ${dimPh(lightsOff ? 0.02 : 0.06)} 100%)`,
        pointerEvents:'none',
        zIndex:26,
      }}/>

      {/* Corner decoration */}
      <div style={{ position:'absolute', top:8, left:8, color: dimPh(0.18), fontSize:10, fontFamily:'monospace', pointerEvents:'none' }}>┌─</div>
      <div style={{ position:'absolute', top:8, right:8, color: dimPh(0.18), fontSize:10, fontFamily:'monospace', pointerEvents:'none' }}>─┐</div>
      <div style={{ position:'absolute', bottom:'9%', left:8, color: dimPh(0.18), fontSize:10, fontFamily:'monospace', pointerEvents:'none' }}>└─</div>
      <div style={{ position:'absolute', bottom:'9%', right:8, color: dimPh(0.18), fontSize:10, fontFamily:'monospace', pointerEvents:'none' }}>─┘</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
//  STATUS BAR
// ─────────────────────────────────────────────────────────
function StatBar({ label, value, ph }) {
  const filled = Math.round(value / 10);
  const col = value > 60 ? ph : value > 30 ? '#ffc947' : '#ff4d4d';
  return (
    <div style={{ marginBottom:8 }}>
      <div style={{ color:`rgba(${hexR(ph)},${hexG(ph)},${hexB(ph)},0.4)`, fontSize:10, marginBottom:2 }}>{label}</div>
      <div style={{ color:col, fontSize:12, fontFamily:'monospace', letterSpacing:0.5 }}>
        [{`█`.repeat(filled)}{`░`.repeat(10-filled)}] {Math.round(value)}%
      </div>
    </div>
  );
}

const hexR = h => parseInt(h.slice(1,3),16);
const hexG = h => parseInt(h.slice(3,5),16);
const hexB = h => parseInt(h.slice(5,7),16);
const rgba = (h, a) => `rgba(${hexR(h)},${hexG(h)},${hexB(h)},${a})`;

// ─────────────────────────────────────────────────────────
//  TWEAKS PANEL
// ─────────────────────────────────────────────────────────
function TweaksPanel({ tw, setTw, visible }) {
  if (!visible) return null;
  const update = (k, v) => {
    setTw(prev => { const n = {...prev, [k]:v}; window.parent?.postMessage({type:'__edit_mode_set_keys', edits:n},'*'); return n; });
  };
  const presets = [
    { label:'phosphor', color:'#39ff14' },
    { label:'amber',    color:'#ffb000' },
    { label:'cyan',     color:'#00fff5' },
    { label:'sakura',   color:'#ff7eb3' },
  ];
  return (
    <div style={{
      position:'fixed', bottom:60, right:12, width:200,
      background: tw.bgColor, border:`1px solid ${rgba(tw.phosphorColor,0.4)}`,
      padding:14, fontSize:12, fontFamily:'monospace', color: tw.phosphorColor,
      zIndex:100, boxShadow:`0 0 20px ${rgba(tw.phosphorColor,0.15)}`,
    }}>
      <div style={{ marginBottom:10, opacity:0.6 }}>[ TWEAKS ]</div>

      <div style={{ marginBottom:8, fontSize:11, opacity:0.5 }}>PHOSPHOR COLOR</div>
      <div style={{ display:'flex', gap:6, marginBottom:12, flexWrap:'wrap' }}>
        {presets.map(p => (
          <div key={p.label} onClick={() => update('phosphorColor', p.color)} style={{
            width:24, height:24, background:p.color, cursor:'pointer', borderRadius:2,
            border: tw.phosphorColor === p.color ? '2px solid white' : '2px solid transparent',
          }}/>
        ))}
      </div>

      <div style={{ marginBottom:8, fontSize:11, opacity:0.5 }}>FISH SIZE</div>
      <input type="range" min={11} max={20} value={tw.fishSize} onChange={e => update('fishSize', Number(e.target.value))} style={{ width:'100%', marginBottom:10, accentColor: tw.phosphorColor }}/>

      {[
        { key:'scanlines',   label:'CRT SCANLINES' },
        { key:'binaryRain',  label:'BINARY RAIN' },
      ].map(({ key, label }) => (
        <div key={key} onClick={() => update(key, !tw[key])} style={{ cursor:'pointer', display:'flex', justifyContent:'space-between', marginBottom:6 }}>
          <span style={{ opacity:0.7 }}>{label}</span>
          <span style={{ color: tw[key] ? tw.phosphorColor : rgba(tw.phosphorColor,0.3) }}>{tw[key] ? '[ON]' : '[OFF]'}</span>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
//  APP
// ─────────────────────────────────────────────────────────
function App() {
  const [tw, setTw] = useState(TWEAK_DEFAULTS);
  const [tweaksVisible, setTweaksVisible] = useState(false);

  // Model loading state
  const [modelStatus, setModelStatus] = useState({ pct: 0, msg: 'initializing…', done: false, err: false });

  // Tweaks host bridge
  useEffect(() => {
    const handler = e => {
      if (e.data?.type === '__activate_edit_mode')   setTweaksVisible(true);
      if (e.data?.type === '__deactivate_edit_mode') setTweaksVisible(false);
    };
    window.addEventListener('message', handler);
    window.parent?.postMessage({ type:'__edit_mode_available' }, '*');
    return () => window.removeEventListener('message', handler);
  }, []);

  // Fish physics
  const [fishX, setFishX]   = useState(0);
  const [fishY, setFishY]   = useState(FISH_CRUISE_Y_PERCENT);
  const [fishDir, setFishDir] = useState(1);
  const [frame, setFrame]   = useState(0);
  const [fishPose, setFishPose] = useState({ bobPx: 0, tiltDeg: 0, squashX: 1, squashY: 1 });
  const fishDirRef = useRef(1);
  const fishXRef = useRef(0);
  const fishYRef = useRef(FISH_CRUISE_Y_PERCENT);
  const fishDRef = useRef(1);
  const frameRef = useRef(0);
  const framePhaseRef = useRef(0);
  const swimPhaseRef = useRef(0);
  const turnRef = useRef({ start: 0, until: 0, switchAt: 0, pendingDir: 0 });
  const tankRef = useRef(null);
  const [tankWidth, setTankWidth] = useState(0);
  const tankWidthRef = useRef(0);

  // States
  const [sleeping, setSleeping] = useState(false);
  const [eating, setEating]     = useState(false);
  const sleepingRef = useRef(false);
  const eatingRef = useRef(false);
  const sleepPendingRef = useRef(false);
  const [lightsOff, setLightsOff] = useState(false);
  const lightsOffRef = useRef(false);
  const [behaviorMode, setBehaviorMode] = useState('idle');
  const behaviorModeRef = useRef('idle');
  const behaviorTimerRef = useRef(null);

  // Bubbles
  const [bubbles, setBubbles] = useState([]);
  const [foodPellets, setFoodPellets] = useState([]);
  const [tapRipples, setTapRipples] = useState([]);
  const [lightFx, setLightFx] = useState(null);
  const bubbleId = useRef(0);
  const effectIdRef = useRef(0);

  // Needs
  const [hunger,    setHunger]    = useState(72);
  const [happiness, setHappiness] = useState(85);
  const [energy,    setEnergy]    = useState(90);
  const needsRef = useRef({ hunger:72, happiness:85, energy:90 });

  useEffect(() => { needsRef.current = { hunger, happiness, energy }; }, [hunger, happiness, energy]);
  useEffect(() => { lightsOffRef.current = lightsOff; }, [lightsOff]);
  useEffect(() => { behaviorModeRef.current = behaviorMode; }, [behaviorMode]);
  useEffect(() => { eatingRef.current = eating; }, [eating]);

  // Weed phase
  const [weedPhase, setWeedPhase] = useState(0);

  // Chat
  const [messages, setMessages] = useState([]);
  const [input,   setInput]   = useState('');
  const [thinking, setThinking] = useState(false);
  const [speech,  setSpeech]  = useState('');
  const [busy, setBusy] = useState(false);
  const speechTimerRef = useRef(null);
  const busyRef = useRef(false);
  const chatEndRef = useRef(null);
  const messagesRef = useRef([]);

  // scroll chat
  useEffect(() => { chatEndRef.current?.scrollIntoView({ block:'nearest' }); }, [messages, thinking]);

  useEffect(() => () => {
    if (speechTimerRef.current) clearTimeout(speechTimerRef.current);
    if (behaviorTimerRef.current) clearTimeout(behaviorTimerRef.current);
  }, []);

  useEffect(() => {
    const node = tankRef.current;
    if (!node) return;

    const updateWidth = (nextWidth) => {
      if (!Number.isFinite(nextWidth) || nextWidth <= 0) return;
      setTankWidth(width => width === nextWidth ? width : nextWidth);
    };

    updateWidth(node.getBoundingClientRect().width);

    if (typeof ResizeObserver === 'undefined') {
      const handleResize = () => updateWidth(node.getBoundingClientRect().width);
      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
    }

    const observer = new ResizeObserver(entries => {
      const entry = entries[0];
      const nextWidth = entry?.contentRect?.width ?? node.getBoundingClientRect().width;
      updateWidth(nextWidth);
    });

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // ── Boot GuppyLM engine on mount
  useEffect(() => {
    window.guppyEngine.load((msg, pct) => {
      if (pct === -1) {
        setModelStatus({ pct: 0, msg, done: false, err: true });
      } else if (pct >= 100) {
        setModelStatus({ pct: 100, msg, done: true, err: false });
      } else {
        setModelStatus({ pct, msg, done: false, err: false });
      }
    });
  }, []);

  useEffect(() => {
    if (!tankWidth) return;

    const previousWidth = tankWidthRef.current;
    const bounds = getFishBounds(tankWidth);

    setFishX(current => {
      const next = previousWidth > 0
        ? clamp(current * (tankWidth / previousWidth), bounds.min, bounds.max)
        : clamp(tankWidth * FISH_INITIAL_X_RATIO, bounds.min, bounds.max);

      fishXRef.current = next;
      return next;
    });

    tankWidthRef.current = tankWidth;
  }, [tankWidth]);

  // ── Generate greeting on mount
  useEffect(() => {
    (async () => {
      const greeting = await guppyAutoThought(
        { hunger: 72, happiness: 85, energy: 90 },
        { sleeping: false, lightsOff: false, behaviorMode: 'idle' },
      );
      showSpeech(greeting);
      const initialMessages = greeting
        ? [{ from:'guppy', text: greeting, channel:'ambient' }]
        : [];
      messagesRef.current = initialMessages;
      setMessages(initialMessages);
    })();
  }, []);

  // ── Fish movement
  useEffect(() => {
    if (!tankWidth) return;

    let lastTick = performance.now();

    const applyFishDirection = (nextDir) => {
      fishDirRef.current = nextDir;
      fishDRef.current = nextDir;
      setFishDir(current => current === nextDir ? current : nextDir);
    };

    const beginTurn = (nextDir, now) => {
      turnRef.current = {
        start: now,
        until: now + FISH_TURN_DURATION_MS,
        switchAt: now + FISH_TURN_DURATION_MS / 2,
        pendingDir: nextDir,
      };
    };

    const id = setInterval(() => {
      const now = performance.now();
      const deltaSeconds = Math.min((now - lastTick) / 1000, 0.08);
      lastTick = now;
      const previousY = fishYRef.current;

      const nextTargetY = getFishTargetY();
      const nextY = moveToward(
        previousY,
        nextTargetY,
        FISH_VERTICAL_SPEED_PERCENT_PER_SEC * deltaSeconds,
      );

      if (nextY !== previousY) {
        fishYRef.current = nextY;
        setFishY(current => current === nextY ? current : nextY);
      }

      if (
        sleepPendingRef.current
        && !sleepingRef.current
        && Math.abs(nextY - FISH_SLEEP_Y_PERCENT) <= FISH_SLEEP_SETTLE_THRESHOLD
      ) {
        setSleepingState(true);
        return;
      }

      const speedMultiplier = behaviorModeRef.current === 'swim'
        ? SWIM_SPEED_MULTIPLIER
        : behaviorModeRef.current === 'food'
          ? SEEK_FOOD_SPEED_MULTIPLIER
          : 1;

      const activeTurn = turnRef.current.until > now;
      if (activeTurn && turnRef.current.pendingDir && now >= turnRef.current.switchAt && fishDirRef.current !== turnRef.current.pendingDir) {
        applyFishDirection(turnRef.current.pendingDir);
      }

      if (!activeTurn && turnRef.current.pendingDir) {
        turnRef.current = { start: 0, until: 0, switchAt: 0, pendingDir: 0 };
      }

      if (!sleepingRef.current && !sleepPendingRef.current && !(turnRef.current.until > now)) {
        setFishX(x => {
          const bounds = getFishBounds(tankWidthRef.current);
          let nx = x + fishDirRef.current * FISH_SPEED_PX_PER_SEC * speedMultiplier * deltaSeconds;

          if (nx > bounds.max) {
            nx = bounds.max;
            beginTurn(-1, now);
          } else if (nx < bounds.min) {
            nx = bounds.min;
            beginTurn(1, now);
          }

          fishXRef.current = nx;
          return nx;
        });
      }

      const turnState = turnRef.current;
      const turnProgress = turnState.until > now
        ? clamp((now - turnState.start) / FISH_TURN_DURATION_MS, 0, 1)
        : 0;
      const turnWave = Math.sin(turnProgress * Math.PI);
      const verticalVelocity = deltaSeconds > 0 ? (nextY - previousY) / deltaSeconds : 0;
      const verticalIntent = clamp((previousY - nextTargetY) / 10, -1, 1);
      const bobAmplitude = sleepingRef.current
        ? 0
        : behaviorModeRef.current === 'swim'
          ? FISH_BOB_AMPLITUDE_PX * 1.45
          : behaviorModeRef.current === 'food'
            ? FISH_BOB_AMPLITUDE_PX * 1.15
            : FISH_BOB_AMPLITUDE_PX;

      swimPhaseRef.current += deltaSeconds * (
        sleepingRef.current
          ? 0.35
          : 1.4 + speedMultiplier * 1.1 + Math.min(Math.abs(verticalVelocity) / FISH_VERTICAL_SPEED_PERCENT_PER_SEC, 1) * 0.5
      );

      const bobPx = sleepingRef.current
        ? 0
        : Math.sin(swimPhaseRef.current) * bobAmplitude + turnWave * 0.9;

      const tiltBase = sleepingRef.current
        ? 0
        : (-fishDirRef.current * verticalIntent * FISH_TILT_MAX_DEG) + Math.cos(swimPhaseRef.current) * 1.25;

      const tiltDeg = turnWave > 0
        ? tiltBase * (1 - turnWave * 0.85)
        : tiltBase;

      setFishPose({
        bobPx,
        tiltDeg,
        squashX: 1 - turnWave * FISH_TURN_SQUASH,
        squashY: 1 + turnWave * FISH_TURN_STRETCH,
      });

      framePhaseRef.current += deltaSeconds * (
        sleepingRef.current
          ? 0.25
          : 1.5 + speedMultiplier * 1.6 + Math.min(Math.abs(verticalVelocity) / FISH_VERTICAL_SPEED_PERCENT_PER_SEC, 1) * 0.75
      ) * (turnWave > 0 ? 0.55 : 1);

      const activeFishState = sleepingRef.current
        ? 'sleep'
        : eatingRef.current
          ? 'eat'
          : 'swim';
      const activeFishDirection = fishDirRef.current > 0 ? 'right' : 'left';
      const nextFrame = Math.floor(framePhaseRef.current) % getFishFrameSet(activeFishState).length;
      if (nextFrame !== frameRef.current) {
        frameRef.current = nextFrame;
        setFrame(nextFrame);
      }
    }, FISH_TICK_MS);

    return () => clearInterval(id);
  }, [tankWidth]);

  // ── Weed sway
  useEffect(() => {
    const id = setInterval(() => setWeedPhase(p => p + 0.07), 70);
    return () => clearInterval(id);
  }, []);

  // ── Bubble emitter
  useEffect(() => {
    const id = setInterval(() => {
      if (sleepingRef.current) return;
      const bid = bubbleId.current++;
      setBubbles(b => [...b.slice(-25), {
        id: bid,
        x: fishXRef.current
          + (fishDRef.current > 0 ? FISH_BUBBLE_OFFSET_PX : -FISH_BUBBLE_OFFSET_PX)
          + (Math.random() * FISH_BUBBLE_JITTER_PX - FISH_BUBBLE_JITTER_PX / 2),
        y: 55,
        char: ['o','°','·','O','.'][Math.floor(Math.random()*5)],
        speed: 0.25 + Math.random() * 0.35,
      }]);
    }, 1600);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      setBubbles(b => b.map(bb => ({ ...bb, y: bb.y - bb.speed })).filter(bb => bb.y > 4));
    }, 55);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let lastTick = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      const deltaSeconds = Math.min((now - lastTick) / 1000, 0.08);
      lastTick = now;

      setFoodPellets((items) => items
        .map((pellet) => ({
          ...pellet,
          y: pellet.y + pellet.speed * deltaSeconds,
          life: pellet.life + deltaSeconds / FOOD_PELLET_DURATION_SEC,
        }))
        .filter((pellet) => pellet.life < 1 && pellet.y < pellet.maxY));

      setTapRipples((items) => items
        .map((ripple) => ({
          ...ripple,
          life: ripple.life + deltaSeconds / TAP_RIPPLE_DURATION_SEC,
        }))
        .filter((ripple) => ripple.life < 1));

      setLightFx((current) => {
        if (!current) return null;
        const nextLife = current.life + deltaSeconds / LIGHT_FX_DURATION_SEC;
        return nextLife >= 1 ? null : { ...current, life: nextLife };
      });
    }, 55);

    return () => clearInterval(id);
  }, []);

  // ── Needs decay
  useEffect(() => {
    const id = setInterval(() => {
      if (sleepingRef.current) {
        setEnergy(e => Math.min(100, e + 1.2));
      } else {
        setHunger(h    => Math.max(0, h    - 0.45));
        setHappiness(hp => Math.max(0, hp - 0.28));
        setEnergy(e    => Math.max(0, e    - 0.18));
      }
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // ── Autonomy cycle
  useEffect(() => {
    const id = setInterval(async () => {
      if (busyRef.current) return;
      setBusyState(true);
      try {
        const action = await guppyPlanAction(needsRef.current, getPromptContext());
        await executeBehaviorAction(action);
      } finally {
        setBusyState(false);
      }
    }, AUTONOMY_ACTION_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  function pushMessage(message) {
    const next = [...messagesRef.current, message];
    messagesRef.current = next;
    setMessages(next);
    return next;
  }

  function showSpeech(text) {
    if (!text) return;
    setSpeech(text);
    if (speechTimerRef.current) clearTimeout(speechTimerRef.current);
    speechTimerRef.current = setTimeout(() => setSpeech(''), 7000);
  }

  function setBusyState(nextBusy) {
    busyRef.current = nextBusy;
    setBusy(nextBusy);
  }

  function getPromptContext(overrides = {}) {
    return {
      sleeping: overrides.sleeping ?? sleepingRef.current,
      lightsOff: overrides.lightsOff ?? lightsOffRef.current,
      behaviorMode: overrides.behaviorMode ?? behaviorModeRef.current,
    };
  }

  function updateNeeds(updater) {
    const nextNeeds = typeof updater === 'function' ? updater(needsRef.current) : updater;
    needsRef.current = nextNeeds;
    setHunger(nextNeeds.hunger);
    setHappiness(nextNeeds.happiness);
    setEnergy(nextNeeds.energy);
    return nextNeeds;
  }

  function setTimedBehaviorMode(nextMode, durationMs = 0) {
    if (behaviorTimerRef.current) {
      clearTimeout(behaviorTimerRef.current);
      behaviorTimerRef.current = null;
    }

    behaviorModeRef.current = nextMode;
    setBehaviorMode(nextMode);

    if (!durationMs) return;

    behaviorTimerRef.current = setTimeout(() => {
      behaviorTimerRef.current = null;
      behaviorModeRef.current = 'idle';
      setBehaviorMode(current => current === nextMode ? 'idle' : current);
    }, durationMs);
  }

  function setSleepingState(nextSleeping) {
    sleepingRef.current = nextSleeping;
    setSleeping(nextSleeping);
    if (nextSleeping) {
      sleepPendingRef.current = false;
    }
    if (nextSleeping) {
      setTimedBehaviorMode('idle');
    }
  }

  function requestSleep() {
    sleepPendingRef.current = true;
    setTimedBehaviorMode('idle');
  }

  function wakeFish() {
    sleepPendingRef.current = false;
    if (sleepingRef.current) {
      setSleepingState(false);
    }
  }

  function getFishTargetY() {
    if (sleepPendingRef.current || sleepingRef.current) return FISH_SLEEP_Y_PERCENT;
    if (behaviorModeRef.current === 'food') return FISH_FOOD_Y_PERCENT;
    return FISH_CRUISE_Y_PERCENT;
  }

  function setLightsOffState(nextLightsOff) {
    lightsOffRef.current = nextLightsOff;
    setLightsOff(nextLightsOff);
  }

  function spawnFoodPellets() {
    const bounds = getFishBounds(tankWidthRef.current);
    const baseX = tankWidthRef.current
      ? clamp(fishXRef.current, bounds.min + 18, bounds.max - 18)
      : fishXRef.current;
    const nextPellets = Array.from({ length: 6 }, (_, index) => ({
      id: effectIdRef.current++,
      x: baseX + (index - 2.5) * 8 + (Math.random() * 10 - 5),
      y: 8 + Math.random() * 2.5,
      maxY: 24 + Math.random() * 11,
      speed: 7 + Math.random() * 8,
      wobble: 2 + Math.random() * 4,
      phase: Math.random() * Math.PI * 2,
      char: ['·', '•', '°'][Math.floor(Math.random() * 3)],
      life: 0,
    }));
    setFoodPellets((current) => [...current.slice(-14), ...nextPellets]);
  }

  function spawnTapRipple() {
    const x = tankWidthRef.current
      ? clamp(fishXRef.current + (Math.random() * 36 - 18), 40, tankWidthRef.current - 40)
      : fishXRef.current;
    const y = clamp(fishYRef.current - 6, 14, 52);
    setTapRipples((current) => [
      ...current.slice(-4),
      { id: effectIdRef.current++, x, y, life: 0 },
    ]);
  }

  function spawnLightFx(mode) {
    setLightFx({ id: effectIdRef.current++, mode, life: 0 });
  }

  async function executeBehaviorAction(action) {
    let plannedAction = action;

    if (sleepingRef.current && action === 'sleep') {
      plannedAction = 'idle';
    } else if (!sleepingRef.current && action === 'wake') {
      plannedAction = 'idle';
    }

    if (sleepingRef.current && plannedAction === 'idle') {
      return;
    }

    let eventText = '';
    let channel = 'ambient';

    if (plannedAction === 'sleep') {
      requestSleep();
      eventText = 'guppy decided to sleep';
      channel = 'event';
    } else if (plannedAction === 'wake') {
      wakeFish();
      eventText = 'guppy woke up';
      channel = 'event';
    } else if (plannedAction === 'swim') {
      wakeFish();
      setTimedBehaviorMode('swim', AUTONOMY_MODE_DURATION_MS);
      updateNeeds(current => ({
        ...current,
        happiness: clamp(current.happiness + 4, 0, 100),
        energy: clamp(current.energy - 3, 0, 100),
      }));
      eventText = 'guppy started swimming laps';
      channel = 'event';
    } else if (plannedAction === 'food') {
      wakeFish();
      setTimedBehaviorMode('food', AUTONOMY_MODE_DURATION_MS);
      updateNeeds(current => ({
        ...current,
        happiness: clamp(current.happiness + 2, 0, 100),
      }));
      eventText = 'guppy looked for food near the surface';
      channel = 'event';
    }

    if (eventText) {
      pushMessage({ from:'tank', text: eventText, channel:'event' });
    }

    const thoughtPrompt = buildActionThoughtPrompt(plannedAction);
    if (!thoughtPrompt) {
      return;
    }

    const thought = await guppyAutoThought(
      needsRef.current,
      getPromptContext(),
      thoughtPrompt,
    );

    if (thought) {
      showSpeech(thought);
      pushMessage({ from:'guppy', text: thought, channel });
    }
  }

  // ── Actions
  async function feed() {
    if (busyRef.current) return;
    setBusyState(true);
    try {
      wakeFish();
      setTimedBehaviorMode('food', 3600);
      spawnFoodPellets();
      const newNeeds = updateNeeds(current => ({
        ...current,
        hunger: clamp(current.hunger + 38, 0, 100),
      }));
      setEating(true);
      setTimeout(() => setEating(false), 2200);
      const trigger = 'you dropped food in the water';
      pushMessage({ from:'tank', text: trigger, channel:'event' });
      const msg = await guppyReply(trigger, newNeeds, getPromptContext({ behaviorMode: 'food' }));
      showSpeech(msg);
      pushMessage({ from:'guppy', text: msg, channel:'event' });
    } finally {
      setBusyState(false);
    }
  }

  async function tap() {
    if (busyRef.current) return;
    setBusyState(true);
    try {
      wakeFish();
      spawnTapRipple();
      const newNeeds = updateNeeds(current => ({
        ...current,
        happiness: clamp(current.happiness + 28, 0, 100),
      }));
      const trigger = 'you tapped on the glass';
      pushMessage({ from:'tank', text: trigger, channel:'event' });
      const msg = await guppyReply(trigger, newNeeds, getPromptContext());
      showSpeech(msg);
      pushMessage({ from:'guppy', text: msg, channel:'event' });
    } finally {
      setBusyState(false);
    }
  }

  async function toggleLight() {
    if (busyRef.current) return;
    setBusyState(true);
    try {
      const nextLightsOff = !lightsOffRef.current;
      setLightsOffState(nextLightsOff);
      spawnLightFx(nextLightsOff ? 'off' : 'on');
      if (!nextLightsOff && (sleepingRef.current || sleepPendingRef.current)) {
        wakeFish();
      }
      const trigger = nextLightsOff ? 'the light just turned off' : 'the light just came back on';
      const eventText = nextLightsOff ? 'lights off' : 'lights on';
      pushMessage({ from:'tank', text: eventText, channel:'event' });
      const msg = await guppyReply(trigger, needsRef.current, getPromptContext({ lightsOff: nextLightsOff }));
      showSpeech(msg);
      pushMessage({ from:'guppy', text: msg, channel:'event' });
    } finally {
      setBusyState(false);
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || thinking || busyRef.current) return;
    setInput('');
    pushMessage({ from:'human', text, channel:'chat' });
    setThinking(true);
    setBusyState(true);
    try {
      const reply = await guppyReply(text, needsRef.current, getPromptContext());
      showSpeech(reply);
      pushMessage({ from:'guppy', text: reply, channel:'chat' });
      updateNeeds(current => ({
        ...current,
        happiness: clamp(current.happiness + 4, 0, 100),
      }));
    } finally {
      setThinking(false);
      setBusyState(false);
    }
  }

  // ── Compose fish ASCII
  const fishState = sleeping ? 'sleep' : eating ? 'eat' : 'swim';
  const fishDirection = fishDir > 0 ? 'right' : 'left';
  const fishFrames = getFishFrameSet(fishState);
  const fishAscii = fishFrames[frame % fishFrames.length];

  const ph  = tw.phosphorColor;
  const bg  = tw.bgColor;
  const dim = (a) => rgba(ph, a);

  const needsLow = hunger < 30 || happiness < 30 || energy < 25;

  const messageStyle = (message) => {
    if (message.channel === 'ambient') {
      return {
        label: 'drift> ',
        labelColor: dim(0.38),
        textColor: dim(0.8),
      };
    }

    if (message.from === 'tank') {
      return {
        label: 'tank>  ',
        labelColor: rgba('#ffb000', 0.55),
        textColor: '#ffb000',
      };
    }

    if (message.from === 'guppy') {
      return {
        label: 'guppy> ',
        labelColor: dim(0.4),
        textColor: ph,
      };
    }

    return {
      label: 'you>   ',
      labelColor: rgba('#6ec6ff', 0.5),
      textColor: '#6ec6ff',
    };
  };

  return (
    <div style={{
      width:'100%', height:'100%',
      display:'flex', flexDirection:'column',
      fontFamily:"'Share Tech Mono', 'Courier New', monospace",
      background: bg, color: ph,
    }}>
      {/* ── HEADER */}
      <div style={{
        padding:'5px 14px',
        borderBottom:`1px solid ${dim(0.18)}`,
        display:'flex', justifyContent:'space-between', alignItems:'center',
        flexShrink:0,
      }}>
        <div>
          <span style={{ fontSize:15, letterSpacing:2 }}>GUPPY.EXE</span>
          <span style={{ fontSize:10, color: dim(0.4), marginLeft:10 }}>
            // guppylm-9m · onnx ·{' '}
            <span style={{ color: modelStatus.err ? '#ff5555' : modelStatus.done ? ph : rgba(ph, 0.5) }}>
              {modelStatus.done ? 'local inference ✓' : modelStatus.err ? 'templates (offline)' : 'loading…'}
            </span>
          </span>
        </div>
        <div style={{ fontSize:10, color: dim(0.35), display:'flex', gap:16 }}>
          {needsLow && <span style={{ color:'#ff4d4d', animation:'blink 1s infinite' }}>⚠ needs attention</span>}
          <span style={{ cursor:'pointer' }} onClick={() => setTweaksVisible(v => !v)}>[tweaks]</span>
          <span id="clock">{new Date().toLocaleTimeString()}</span>
        </div>
      </div>

      {/* ── BODY */}
      <div style={{ flex:1, display:'flex', overflow:'hidden', minHeight:0 }}>

        {/* Tank */}
        <div ref={tankRef} style={{ flex:1, position:'relative', overflow:'hidden', borderRight:`1px solid ${dim(0.15)}` }}>
          <Tank
            tw={tw}
            fishX={fishX}
            tankWidth={tankWidth}
            fishY={fishY}
            fishPose={fishPose}
            fishMirrorX={fishDirection === 'right' ? 1 : -1}
            fishAscii={fishAscii}
            bubbles={bubbles}
            foodPellets={foodPellets}
            tapRipples={tapRipples}
            lightFx={lightFx}
            weedPhase={weedPhase}
            sleeping={sleeping}
            lightsOff={lightsOff}
            guppySpeech={speech}
            bgColor={bg}
          />
          {/* Model loading overlay */}
          {!modelStatus.done && (
            <div style={{
              position:'absolute', bottom:16, left:'50%', transform:'translateX(-50%)',
              background: rgba(bg === '#050c07' ? '#060d0a' : bg, 0.95),
              border:`1px solid ${rgba(ph, 0.3)}`,
              padding:'10px 18px', minWidth:260,
              fontFamily:'monospace', fontSize:11,
              color: modelStatus.err ? '#ff5555' : ph,
              zIndex:50, textAlign:'center',
            }}>
              <div style={{ marginBottom:6, opacity:0.7 }}>
                {modelStatus.err ? '⚠ ' : ''}guppylm-9m · onnx · wasm
              </div>
              <div style={{ marginBottom:6 }}>{modelStatus.msg}</div>
              {!modelStatus.err && (
                <div style={{
                  height:4, background: rgba(ph, 0.15), borderRadius:2, overflow:'hidden',
                }}>
                  <div style={{
                    height:'100%', width:`${modelStatus.pct}%`,
                    background: ph, borderRadius:2, transition:'width 0.3s ease',
                  }}/>
                </div>
              )}
              {modelStatus.err && (
                <div style={{ marginTop:6, opacity:0.6, fontSize:10 }}>
                  using offline templates ↓
                </div>
              )}
            </div>
          )}
        </div>

        {/* Side panel */}
        <div style={{
          width:210, flexShrink:0,
          display:'flex', flexDirection:'column',
          padding:'10px 12px', gap:0,
          overflowY:'auto',
        }}>

          {/* Status */}
          <div style={{ marginBottom:14 }}>
            <div style={{ fontSize:11, color: dim(0.5), borderBottom:`1px solid ${dim(0.15)}`, paddingBottom:4, marginBottom:8, letterSpacing:1 }}>[ STATUS ]</div>
            <StatBar label="HUNGER"    value={hunger}    ph={ph}/>
            <StatBar label="HAPPINESS" value={happiness} ph={ph}/>
            <StatBar label="ENERGY"    value={energy}    ph={ph}/>
          </div>

          {/* Actions */}
          <div style={{ marginBottom:14 }}>
            <div style={{ fontSize:11, color: dim(0.5), borderBottom:`1px solid ${dim(0.15)}`, paddingBottom:4, marginBottom:8, letterSpacing:1 }}>[ ACTIONS ]</div>
            {[
              { label:'feed guppy', action: feed, hot: hunger < 35 },
              { label:'tap the glass', action: tap, hot: happiness < 35 },
              { label: lightsOff ? 'lights on' : 'lights off', action: toggleLight, hot: energy < 25 },
            ].map(({ label, action, hot }) => (
              <div
                key={label}
                onClick={busy ? undefined : action}
                className="action-btn"
                style={{
                  cursor: busy ? 'default' : 'pointer', padding:'5px 8px', marginBottom:5,
                  color: busy ? dim(0.28) : hot ? '#ff9944' : ph,
                  border:`1px solid ${hot ? 'rgba(255,153,68,0.5)' : dim(0.18)}`,
                  fontSize:12, borderRadius:2,
                  display:'flex', justifyContent:'space-between', alignItems:'center',
                  opacity: busy ? 0.6 : 1,
                }}
              >
                <span>&gt; {label}</span>
                {hot && <span style={{ fontSize:10, color:'#ff9944', animation:'blink 0.8s infinite' }}>LOW</span>}
              </div>
            ))}
          </div>

          {/* Log */}
          <div style={{ flex:1, display:'flex', flexDirection:'column', minHeight:0 }}>
            <div style={{ fontSize:11, color: dim(0.5), borderBottom:`1px solid ${dim(0.15)}`, paddingBottom:4, marginBottom:8, letterSpacing:1, flexShrink:0 }}>[ LOG ]</div>
            <div style={{ flex:1, overflowY:'auto', display:'flex', flexDirection:'column', gap:5 }}>
              {messages.slice(-30).map((m, i) => (
                <div key={i} style={{ fontSize:11, lineHeight:1.4, wordBreak:'break-word' }}>
                  <span style={{ color: messageStyle(m).labelColor }}>
                    {messageStyle(m).label}
                  </span>
                  <span style={{ color: messageStyle(m).textColor }}>{m.text}</span>
                </div>
              ))}
              {thinking && (
                <div style={{ fontSize:11, color: dim(0.4) }}>
                  guppy&gt; <span style={{ animation:'blink 0.7s infinite' }}>...</span>
                </div>
              )}
              <div ref={chatEndRef}/>
            </div>
          </div>
        </div>
      </div>

      {/* ── INPUT */}
      <div style={{
        borderTop:`1px solid ${dim(0.18)}`,
        padding:'7px 12px',
        display:'flex', gap:10, alignItems:'center',
        flexShrink:0,
      }}>
        <span style={{ color: dim(0.45), fontSize:13 }}>you&gt;</span>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && send()}
          placeholder="say something to guppy..."
          style={{
            flex:1, background:'transparent', border:'none', outline:'none',
            color:'#6ec6ff', fontFamily:'inherit', fontSize:13,
            caretColor: ph,
          }}
        />
        <button onClick={send} disabled={thinking || busy} style={{
          background:'transparent', border:`1px solid ${dim(0.25)}`,
          color: thinking || busy ? dim(0.3) : ph,
          fontFamily:'inherit', fontSize:12,
          padding:'3px 12px', cursor: thinking || busy ? 'default' : 'pointer',
          borderRadius:2,
        }}>
          {thinking || busy ? '···' : 'SEND'}
        </button>
      </div>

      {/* Tweaks */}
      <TweaksPanel tw={tw} setTw={setTw} visible={tweaksVisible}/>
    </div>
  );
}

// ── clock tick
setInterval(() => {
  const el = document.getElementById('clock');
  if (el) el.textContent = new Date().toLocaleTimeString();
}, 1000);

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
