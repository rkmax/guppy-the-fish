(() => {
  const { useState, useEffect, useRef } = React;
  const TWEAK_DEFAULTS = window.TWEAK_DEFAULTS || {
    phosphorColor: "#39ff14",
    bgColor: "#050c07",
    scanlines: true,
    binaryRain: true,
    fishSize: 13
  };
  const FR = [
    // Frame 0 — neutral
    [
      "  \\",
      "   \\            /\\",
      "    \\           | \\",
      "     \\         /   \\",
      "      \\       /     )",
      "       \\     ( \xB0   )>",
      "       //     \\____/",
      "      //        | \\",
      "     //         |  \\",
      "    //",
      "   //"
    ],
    // Frame 1 — tail sweeps up
    [
      " \\",
      "  \\             /\\",
      "   \\            | \\",
      "    \\          /   \\",
      "     \\        /     )",
      "      \\      ( \xB0   )>",
      "      //      \\____/",
      "     //         | \\",
      "    //          |  \\",
      "   //",
      "  //"
    ],
    // Frame 2 — neutral + wake ripple
    [
      "  \\",
      "   \\            /\\",
      "    \\           | \\",
      "     \\         /   \\",
      "      \\       /     )",
      "       \\     ( \xB0   )>~~",
      "       //     \\____/",
      "      //        | \\",
      "     //         |  \\",
      "    //",
      "   //"
    ],
    // Frame 3 — tail sweeps down
    [
      "  \\",
      "   \\            /\\",
      "    \\           | \\",
      "     \\         /   \\",
      "      \\       /     )",
      "       \\     ( \xB0   )>",
      "       //     \\____/",
      "      ///       | \\",
      "     ///        |  \\",
      "    ///",
      "   ///"
    ]
  ].map((lines) => lines.join("\n"));
  const FL = [
    // Frame 0 — neutral
    [
      "              //",
      "   /\\         //",
      "  /  \\       //",
      " /    \\     //",
      "(      \\   //",
      "<( \xB0    ) //",
      " \\____/ \\\\",
      "  /  |   \\\\",
      " /   |    \\\\",
      "          \\\\",
      "           \\\\"
    ],
    // Frame 1 — tail sweeps up
    [
      "             //",
      "            //",
      "   /\\      //",
      "  /  \\    //",
      " (    \\  //",
      "<( \xB0   )//",
      " \\____/\\\\",
      "  /  | \\\\",
      " /   |  \\\\",
      "         \\\\",
      "          \\\\"
    ],
    // Frame 2 — neutral + wake ripple
    [
      "              //",
      "   /\\         //",
      "  /  \\       //",
      " /    \\     //",
      "(      \\   //",
      "~~<( \xB0  ) //",
      "  \\____/ \\\\",
      "   /  |   \\\\",
      "  /   |    \\\\",
      "           \\\\",
      "            \\\\"
    ],
    // Frame 3 — tail sweeps down
    [
      "              //",
      "   /\\         //",
      "  /  \\       //",
      " /    \\     //",
      "(      \\   //",
      "<( \xB0    ) //",
      " \\____/ \\\\",
      "  /  |  ///",
      " /   |  ///",
      "        ///",
      "         ///"
    ]
  ].map((lines) => lines.join("\n"));
  const FISH_SLEEP_R = [
    "  \\",
    "   \\            /\\",
    "    \\           | \\",
    "     \\         /   \\",
    "      \\       /     )",
    "       \\     ( -   )>",
    "       //     \\____/",
    "      //",
    "     //   z z z",
    "    //  z",
    "   //"
  ].join("\n");
  const FISH_SLEEP_L = [
    "              //",
    "   /\\         //",
    "  /  \\       //",
    " /    \\     //",
    "(      \\   //",
    "<( -    ) //",
    " \\____/ \\\\",
    "          \\\\",
    "  z z z   \\\\",
    "      z    \\\\",
    "            \\\\"
  ].join("\n");
  const FISH_EAT_R = [
    "  \\          *",
    "   \\            /\\",
    "    \\           | \\",
    "     \\         /   \\",
    "      \\       /     ) *",
    "       \\     ( \xB0   )> o",
    "       //     \\____/",
    "      //        | \\",
    "     //    *    |  \\",
    "    //",
    "   //"
  ].join("\n");
  const FISH_EAT_L = [
    " *            //",
    "   /\\         //",
    "  /  \\       //",
    " /    \\     //",
    "(      \\   //",
    " o <( \xB0  )//",
    "   \\____/\\\\",
    "    /  |  \\\\",
    " * /   |   \\\\",
    "           \\\\",
    "            \\\\"
  ].join("\n");
  const FISH_INITIAL_X_RATIO = 0.4;
  const FISH_MIN_X_RATIO = 0.06;
  const FISH_MAX_X_RATIO = 0.82;
  const FISH_SPEED_PX_PER_SEC = 60;
  const FISH_TICK_MS = 40;
  const FISH_SLEEP_Z_OFFSET_PX = 24;
  const FISH_BUBBLE_OFFSET_PX = 18;
  const FISH_BUBBLE_JITTER_PX = 10;
  const AUTONOMY_ACTION_INTERVAL_MS = 16e3;
  const AUTONOMY_MODE_DURATION_MS = 7e3;
  const SWIM_SPEED_MULTIPLIER = 1.45;
  const SEEK_FOOD_SPEED_MULTIPLIER = 1.2;
  const ACTION_TOKENS = ["sleep", "wake", "swim", "food", "idle"];
  const AUTONOMY_IDLE_PROMPTS = [
    "what are you thinking right now",
    "what are you doing right now",
    "say one short fish thought"
  ];
  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }
  function getFishBounds(tankWidth) {
    if (!tankWidth) return { min: 0, max: 0 };
    return {
      min: tankWidth * FISH_MIN_X_RATIO,
      max: tankWidth * FISH_MAX_X_RATIO
    };
  }
  function pickPrompt(list) {
    return list[Math.floor(Math.random() * list.length)];
  }
  function buildNeedsCue(needs, context = {}) {
    if (!needs) return "";
    const cues = [];
    if (context.sleeping) {
      cues.push("sleeping");
    } else if (context.behaviorMode === "swim") {
      cues.push("active");
    } else if (context.behaviorMode === "food") {
      cues.push("looking for food");
    }
    if (context.lightsOff) {
      cues.push("dark");
    }
    if (needs.hunger < 25) {
      cues.push("hungry", "food");
    } else if (needs.hunger < 45) {
      cues.push("hungry");
    }
    if (needs.happiness < 25) {
      cues.push("lonely");
    } else if (needs.happiness > 80) {
      cues.push("happy");
    }
    if (needs.energy < 20) {
      cues.push("tired", "rest");
    } else if (needs.energy > 80) {
      cues.push("swim");
    }
    return [...new Set(cues)].join(". ");
  }
  function buildNeedsAwarePrompt(userText, needs, context = {}) {
    const cue = buildNeedsCue(needs, context);
    const prompt = String(userText || "").trim();
    if (!cue) return prompt;
    if (!prompt) return `${cue}.`;
    return `${cue}. ${prompt}`;
  }
  function buildBehaviorPrompt(needs, context = {}) {
    const cue = buildNeedsCue(needs, context);
    const parts = [
      "choose one next fish action",
      `actions only. ${ACTION_TOKENS.join(". ")}`,
      context.sleeping ? "you are sleeping now" : "you are awake now"
    ];
    if (cue) {
      parts.push(`state. ${cue}`);
    }
    parts.push(`answer with one word only. ${ACTION_TOKENS.join(" or ")}`);
    return parts.join(". ");
  }
  function parseBehaviorAction(text, context = {}) {
    const normalized = String(text || "").toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
    if (!normalized) return null;
    const tokens = normalized.split(" ").filter(Boolean);
    const matches = tokens.filter((token) => ACTION_TOKENS.includes(token));
    const uniqueMatches = [...new Set(matches)];
    if (uniqueMatches.length === 1) return uniqueMatches[0];
    if (tokens.length === 1) {
      if (tokens[0] === "rest") return "sleep";
      if (tokens[0] === "eat" || tokens[0] === "hungry") return "food";
      if (tokens[0] === "move" || tokens[0] === "explore") return "swim";
      if (tokens[0] === "wait" || tokens[0] === "still") return "idle";
    }
    return null;
  }
  function fallbackBehaviorAction(needs, context = {}) {
    if (context.sleeping) {
      return needs.energy > 72 ? "wake" : "sleep";
    }
    if (needs.energy < 18) return "sleep";
    if (needs.hunger < 30) return "food";
    if (needs.happiness < 35 || needs.energy > 80) return "swim";
    return "idle";
  }
  function buildActionThoughtPrompt(action) {
    if (action === "sleep") return "you decide to sleep now";
    if (action === "wake") return "you wake up again";
    if (action === "swim") return "you swim around the tank";
    if (action === "food") return "you look for food near the surface";
    return "";
  }
  async function guppyReply(userText, needs, context = {}) {
    const engine = window.guppyEngine;
    const prompt = buildNeedsAwarePrompt(userText, needs, context);
    if (engine && engine.ready) {
      try {
        const result = await engine.generate([{ role: "user", content: prompt }], {
          maxTokens: 32,
          temperature: 0.7,
          topK: 50
        });
        if (result) return result;
      } catch (err) {
        console.error("[GuppyUI] reply generation failed:", err);
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
          [{ role: "user", content: prompt }],
          { maxTokens: 6, temperature: 0.1, topK: 5 }
        );
        return parseBehaviorAction(result, context) || fallbackBehaviorAction(needs, context);
      } catch (err) {
        console.error("[GuppyUI] autonomy planning failed:", err);
      }
    }
    return fallbackBehaviorAction(needs, context);
  }
  async function guppyAutoThought(needs, context = {}, seedPrompt = "") {
    const engine = window.guppyEngine;
    const prompt = seedPrompt || pickPrompt(AUTONOMY_IDLE_PROMPTS);
    const promptWithNeeds = buildNeedsAwarePrompt(prompt, needs, context);
    if (engine && engine.ready) {
      try {
        const result = await engine.generate(
          [{ role: "user", content: promptWithNeeds }],
          { maxTokens: 32, temperature: 0.7, topK: 50 }
        );
        if (result) return result;
      } catch (err) {
        console.error("[GuppyUI] auto-thought generation failed:", err);
      }
    }
    return window.templateResponse(promptWithNeeds, needs);
  }
  function BinaryRain({ color, enabled }) {
    const [cols, setCols] = useState(
      () => Array.from({ length: 14 }, (_, i) => ({
        id: i,
        x: 3 + i * 6.8,
        y: Math.random() * 100,
        str: Array.from({ length: 7 }, () => Math.random() > 0.5 ? "1" : "0").join("\n"),
        speed: 0.08 + Math.random() * 0.14,
        opacity: 0.025 + Math.random() * 0.06
      }))
    );
    useEffect(() => {
      if (!enabled) return;
      const id = setInterval(() => {
        setCols((c) => c.map((col) => ({
          ...col,
          y: col.y > 100 ? -15 : col.y + col.speed,
          str: Math.random() < 0.06 ? Array.from({ length: 7 }, () => Math.random() > 0.5 ? "1" : "0").join("\n") : col.str
        })));
      }, 120);
      return () => clearInterval(id);
    }, [enabled]);
    if (!enabled) return null;
    return /* @__PURE__ */ React.createElement(React.Fragment, null, cols.map((col) => /* @__PURE__ */ React.createElement("pre", { key: col.id, style: {
      position: "absolute",
      left: `${col.x}%`,
      top: `${col.y}%`,
      color,
      opacity: col.opacity,
      fontSize: 10,
      lineHeight: 1.6,
      pointerEvents: "none",
      zIndex: 1
    } }, col.str)));
  }
  function Tank({ tw, fishX, tankWidth, fishY, fishAscii, bubbles, weedPhase, sleeping, lightsOff, guppySpeech, bgColor }) {
    const ph = tw.phosphorColor;
    const hexToDimRgba = (hex, alpha) => {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      return `rgba(${r},${g},${b},${alpha})`;
    };
    const dimPh = (a) => hexToDimRgba(ph, a);
    const weedPositions = [8, 18, 28, 72, 83, 91];
    const weedHeights = [4, 3, 5, 4, 5, 3];
    const weedChar = (p, wi, hi) => {
      const s = Math.sin(p + wi * 1.1 + hi * 0.25);
      return s > 0.6 ? "(" : s < -0.6 ? ")" : "|";
    };
    const safeFishX = Number.isFinite(fishX) ? fishX : 0;
    const speechLeft = tankWidth ? clamp(safeFishX, tankWidth * 0.18, tankWidth * 0.72) : safeFishX;
    return /* @__PURE__ */ React.createElement("div", { style: { width: "100%", height: "100%", position: "relative", background: bgColor, overflow: "hidden" } }, tw.scanlines && /* @__PURE__ */ React.createElement("div", { style: {
      position: "absolute",
      inset: 0,
      pointerEvents: "none",
      zIndex: 30,
      backgroundImage: `repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,0,0,0.06) 3px, rgba(0,0,0,0.06) 4px)`
    } }), /* @__PURE__ */ React.createElement(BinaryRain, { color: ph, enabled: tw.binaryRain }), lightsOff && /* @__PURE__ */ React.createElement("div", { style: {
      position: "absolute",
      inset: 0,
      background: "rgba(0,0,0,0.36)",
      boxShadow: "inset 0 0 42px rgba(0,0,0,0.48)",
      pointerEvents: "none",
      zIndex: 5
    } }), /* @__PURE__ */ React.createElement("div", { style: {
      position: "absolute",
      top: "5%",
      left: "2%",
      right: "2%",
      color: dimPh(0.25),
      fontSize: 13,
      letterSpacing: 2,
      fontFamily: "monospace",
      overflow: "hidden",
      whiteSpace: "nowrap",
      pointerEvents: "none"
    } }, Array.from({ length: 60 }, (_, i) => ["~", "\u2248", "~", "~", "-", "\u2248", "~"][(i + Math.floor(weedPhase * 1.5)) % 7]).join("")), bubbles.map((b) => /* @__PURE__ */ React.createElement("div", { key: b.id, style: {
      position: "absolute",
      left: `${b.x}px`,
      top: `${b.y}%`,
      color: dimPh(0.15 + (1 - b.y / 60) * 0.25),
      fontSize: 12,
      fontFamily: "monospace",
      transform: `translateX(${Math.sin(b.y * 0.25 + b.id) * 10}px)`,
      pointerEvents: "none",
      zIndex: 4
    } }, b.char)), (() => {
      const COLS = 88, ROWS = 8;
      const grid = Array.from({ length: ROWS }, () => new Array(COLS).fill(" "));
      weedPositions.forEach((wx, wi) => {
        const baseCol = Math.round(wx * COLS / 100);
        for (let hi = 0; hi < weedHeights[wi]; hi++) {
          const row = ROWS - 1 - hi;
          const sway = Math.round(Math.sin(weedPhase + wi * 1.3 + hi * 0.25) * 1.5);
          const col = Math.max(0, Math.min(COLS - 1, baseCol + sway));
          if (row >= 0) grid[row][col] = weedChar(weedPhase, wi, hi);
        }
      });
      const gridStr = grid.map((r) => r.join("")).join("\n");
      return /* @__PURE__ */ React.createElement("pre", { style: {
        position: "absolute",
        bottom: "8%",
        left: 0,
        right: 0,
        fontFamily: "monospace",
        fontSize: 13,
        lineHeight: "13px",
        color: dimPh(0.3),
        pointerEvents: "none",
        zIndex: 3,
        margin: 0,
        padding: "0 4px",
        whiteSpace: "pre",
        overflow: "visible"
      } }, gridStr);
    })(), /* @__PURE__ */ React.createElement("div", { style: {
      position: "absolute",
      bottom: 0,
      left: 0,
      right: 0,
      height: "8%",
      background: dimPh(0.06),
      fontFamily: "monospace",
      fontSize: 12,
      color: dimPh(0.22),
      overflow: "hidden",
      display: "flex",
      alignItems: "center",
      paddingLeft: 6,
      letterSpacing: 1
    } }, "._,_._.,_.~_,._._,__._.~_,._._,.___._,__,_._,._._,._._,_.,_.,_.,.__._,_._._._._._._._._._._._._._._._._."), /* @__PURE__ */ React.createElement("div", { style: {
      position: "absolute",
      left: `${safeFishX}px`,
      top: `${fishY}%`,
      transform: "translate(-50%, -50%)",
      fontFamily: "monospace",
      fontSize: tw.fishSize,
      color: sleeping ? dimPh(0.35) : ph,
      whiteSpace: "pre",
      lineHeight: 1.15,
      textShadow: sleeping ? "none" : `0 0 12px ${dimPh(0.5)}`,
      transition: "color 1.5s",
      zIndex: 6,
      pointerEvents: "none"
    } }, fishAscii), sleeping && /* @__PURE__ */ React.createElement("div", { style: {
      position: "absolute",
      left: `${safeFishX + FISH_SLEEP_Z_OFFSET_PX}px`,
      top: `${fishY - 10}%`,
      fontFamily: "monospace",
      fontSize: 12,
      color: dimPh(0.5),
      animation: "zzzFloat 2s ease-out infinite",
      pointerEvents: "none",
      zIndex: 7
    } }, "z z z"), guppySpeech && /* @__PURE__ */ React.createElement("div", { style: {
      position: "absolute",
      left: `${speechLeft}px`,
      top: `${Math.max(fishY - 24, 8)}%`,
      transform: "translateX(-50%)",
      background: bgColor,
      border: `1px solid ${ph}`,
      color: ph,
      padding: "6px 12px",
      fontSize: 12,
      fontFamily: "monospace",
      maxWidth: 240,
      lineHeight: 1.5,
      zIndex: 20,
      boxShadow: `0 0 16px ${dimPh(0.3)}`,
      animation: "fadeInUp 0.25s ease",
      whiteSpace: "normal"
    } }, /* @__PURE__ */ React.createElement("div", { style: {
      position: "absolute",
      bottom: -8,
      left: "50%",
      transform: "translateX(-50%)",
      color: ph,
      fontSize: 10,
      lineHeight: 1
    } }, "\u25BC"), guppySpeech), /* @__PURE__ */ React.createElement("div", { style: { position: "absolute", top: 8, left: 8, color: dimPh(0.18), fontSize: 10, fontFamily: "monospace", pointerEvents: "none" } }, "\u250C\u2500"), /* @__PURE__ */ React.createElement("div", { style: { position: "absolute", top: 8, right: 8, color: dimPh(0.18), fontSize: 10, fontFamily: "monospace", pointerEvents: "none" } }, "\u2500\u2510"), /* @__PURE__ */ React.createElement("div", { style: { position: "absolute", bottom: "9%", left: 8, color: dimPh(0.18), fontSize: 10, fontFamily: "monospace", pointerEvents: "none" } }, "\u2514\u2500"), /* @__PURE__ */ React.createElement("div", { style: { position: "absolute", bottom: "9%", right: 8, color: dimPh(0.18), fontSize: 10, fontFamily: "monospace", pointerEvents: "none" } }, "\u2500\u2518"));
  }
  function StatBar({ label, value, ph }) {
    const filled = Math.round(value / 10);
    const col = value > 60 ? ph : value > 30 ? "#ffc947" : "#ff4d4d";
    return /* @__PURE__ */ React.createElement("div", { style: { marginBottom: 8 } }, /* @__PURE__ */ React.createElement("div", { style: { color: `rgba(${hexR(ph)},${hexG(ph)},${hexB(ph)},0.4)`, fontSize: 10, marginBottom: 2 } }, label), /* @__PURE__ */ React.createElement("div", { style: { color: col, fontSize: 12, fontFamily: "monospace", letterSpacing: 0.5 } }, "[", `\u2588`.repeat(filled), `\u2591`.repeat(10 - filled), "] ", Math.round(value), "%"));
  }
  const hexR = (h) => parseInt(h.slice(1, 3), 16);
  const hexG = (h) => parseInt(h.slice(3, 5), 16);
  const hexB = (h) => parseInt(h.slice(5, 7), 16);
  const rgba = (h, a) => `rgba(${hexR(h)},${hexG(h)},${hexB(h)},${a})`;
  function TweaksPanel({ tw, setTw, visible }) {
    if (!visible) return null;
    const update = (k, v) => {
      setTw((prev) => {
        var _a;
        const n = { ...prev, [k]: v };
        (_a = window.parent) == null ? void 0 : _a.postMessage({ type: "__edit_mode_set_keys", edits: n }, "*");
        return n;
      });
    };
    const presets = [
      { label: "phosphor", color: "#39ff14" },
      { label: "amber", color: "#ffb000" },
      { label: "cyan", color: "#00fff5" },
      { label: "sakura", color: "#ff7eb3" }
    ];
    return /* @__PURE__ */ React.createElement("div", { style: {
      position: "fixed",
      bottom: 60,
      right: 12,
      width: 200,
      background: tw.bgColor,
      border: `1px solid ${rgba(tw.phosphorColor, 0.4)}`,
      padding: 14,
      fontSize: 12,
      fontFamily: "monospace",
      color: tw.phosphorColor,
      zIndex: 100,
      boxShadow: `0 0 20px ${rgba(tw.phosphorColor, 0.15)}`
    } }, /* @__PURE__ */ React.createElement("div", { style: { marginBottom: 10, opacity: 0.6 } }, "[ TWEAKS ]"), /* @__PURE__ */ React.createElement("div", { style: { marginBottom: 8, fontSize: 11, opacity: 0.5 } }, "PHOSPHOR COLOR"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" } }, presets.map((p) => /* @__PURE__ */ React.createElement("div", { key: p.label, onClick: () => update("phosphorColor", p.color), style: {
      width: 24,
      height: 24,
      background: p.color,
      cursor: "pointer",
      borderRadius: 2,
      border: tw.phosphorColor === p.color ? "2px solid white" : "2px solid transparent"
    } }))), /* @__PURE__ */ React.createElement("div", { style: { marginBottom: 8, fontSize: 11, opacity: 0.5 } }, "FISH SIZE"), /* @__PURE__ */ React.createElement("input", { type: "range", min: 11, max: 20, value: tw.fishSize, onChange: (e) => update("fishSize", Number(e.target.value)), style: { width: "100%", marginBottom: 10, accentColor: tw.phosphorColor } }), [
      { key: "scanlines", label: "CRT SCANLINES" },
      { key: "binaryRain", label: "BINARY RAIN" }
    ].map(({ key, label }) => /* @__PURE__ */ React.createElement("div", { key, onClick: () => update(key, !tw[key]), style: { cursor: "pointer", display: "flex", justifyContent: "space-between", marginBottom: 6 } }, /* @__PURE__ */ React.createElement("span", { style: { opacity: 0.7 } }, label), /* @__PURE__ */ React.createElement("span", { style: { color: tw[key] ? tw.phosphorColor : rgba(tw.phosphorColor, 0.3) } }, tw[key] ? "[ON]" : "[OFF]"))));
  }
  function App() {
    const [tw, setTw] = useState(TWEAK_DEFAULTS);
    const [tweaksVisible, setTweaksVisible] = useState(false);
    const [modelStatus, setModelStatus] = useState({ pct: 0, msg: "initializing\u2026", done: false, err: false });
    useEffect(() => {
      var _a;
      const handler = (e) => {
        var _a2, _b;
        if (((_a2 = e.data) == null ? void 0 : _a2.type) === "__activate_edit_mode") setTweaksVisible(true);
        if (((_b = e.data) == null ? void 0 : _b.type) === "__deactivate_edit_mode") setTweaksVisible(false);
      };
      window.addEventListener("message", handler);
      (_a = window.parent) == null ? void 0 : _a.postMessage({ type: "__edit_mode_available" }, "*");
      return () => window.removeEventListener("message", handler);
    }, []);
    const [fishX, setFishX] = useState(0);
    const [fishDir, setFishDir] = useState(1);
    const [frame, setFrame] = useState(0);
    const fishDirRef = useRef(1);
    const fishXRef = useRef(0);
    const fishDRef = useRef(1);
    const tankRef = useRef(null);
    const [tankWidth, setTankWidth] = useState(0);
    const tankWidthRef = useRef(0);
    const [sleeping, setSleeping] = useState(false);
    const [eating, setEating] = useState(false);
    const sleepingRef = useRef(false);
    const [lightsOff, setLightsOff] = useState(false);
    const lightsOffRef = useRef(false);
    const [behaviorMode, setBehaviorMode] = useState("idle");
    const behaviorModeRef = useRef("idle");
    const behaviorTimerRef = useRef(null);
    const [bubbles, setBubbles] = useState([]);
    const bubbleId = useRef(0);
    const [hunger, setHunger] = useState(72);
    const [happiness, setHappiness] = useState(85);
    const [energy, setEnergy] = useState(90);
    const needsRef = useRef({ hunger: 72, happiness: 85, energy: 90 });
    useEffect(() => {
      needsRef.current = { hunger, happiness, energy };
    }, [hunger, happiness, energy]);
    useEffect(() => {
      lightsOffRef.current = lightsOff;
    }, [lightsOff]);
    useEffect(() => {
      behaviorModeRef.current = behaviorMode;
    }, [behaviorMode]);
    const [weedPhase, setWeedPhase] = useState(0);
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState("");
    const [thinking, setThinking] = useState(false);
    const [speech, setSpeech] = useState("");
    const [busy, setBusy] = useState(false);
    const speechTimerRef = useRef(null);
    const busyRef = useRef(false);
    const chatEndRef = useRef(null);
    const messagesRef = useRef([]);
    useEffect(() => {
      var _a;
      (_a = chatEndRef.current) == null ? void 0 : _a.scrollIntoView({ block: "nearest" });
    }, [messages, thinking]);
    useEffect(() => () => {
      if (speechTimerRef.current) clearTimeout(speechTimerRef.current);
      if (behaviorTimerRef.current) clearTimeout(behaviorTimerRef.current);
    }, []);
    useEffect(() => {
      const node = tankRef.current;
      if (!node) return;
      const updateWidth = (nextWidth) => {
        if (!Number.isFinite(nextWidth) || nextWidth <= 0) return;
        setTankWidth((width) => width === nextWidth ? width : nextWidth);
      };
      updateWidth(node.getBoundingClientRect().width);
      if (typeof ResizeObserver === "undefined") {
        const handleResize = () => updateWidth(node.getBoundingClientRect().width);
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
      }
      const observer = new ResizeObserver((entries) => {
        var _a, _b;
        const entry = entries[0];
        const nextWidth = (_b = (_a = entry == null ? void 0 : entry.contentRect) == null ? void 0 : _a.width) != null ? _b : node.getBoundingClientRect().width;
        updateWidth(nextWidth);
      });
      observer.observe(node);
      return () => observer.disconnect();
    }, []);
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
      setFishX((current) => {
        const next = previousWidth > 0 ? clamp(current * (tankWidth / previousWidth), bounds.min, bounds.max) : clamp(tankWidth * FISH_INITIAL_X_RATIO, bounds.min, bounds.max);
        fishXRef.current = next;
        return next;
      });
      tankWidthRef.current = tankWidth;
    }, [tankWidth]);
    useEffect(() => {
      (async () => {
        const greeting = await guppyAutoThought(
          { hunger: 72, happiness: 85, energy: 90 },
          { sleeping: false, lightsOff: false, behaviorMode: "idle" }
        );
        showSpeech(greeting);
        const initialMessages = greeting ? [{ from: "guppy", text: greeting, channel: "ambient" }] : [];
        messagesRef.current = initialMessages;
        setMessages(initialMessages);
      })();
    }, []);
    useEffect(() => {
      if (!tankWidth) return;
      let lastTick = performance.now();
      const id = setInterval(() => {
        if (sleepingRef.current) return;
        const now = performance.now();
        const deltaSeconds = Math.min((now - lastTick) / 1e3, 0.08);
        lastTick = now;
        setFishX((x) => {
          const bounds = getFishBounds(tankWidthRef.current);
          const speedMultiplier = behaviorModeRef.current === "swim" ? SWIM_SPEED_MULTIPLIER : behaviorModeRef.current === "food" ? SEEK_FOOD_SPEED_MULTIPLIER : 1;
          let nx = x + fishDirRef.current * FISH_SPEED_PX_PER_SEC * speedMultiplier * deltaSeconds;
          if (nx > bounds.max) {
            fishDirRef.current = -1;
            fishDRef.current = -1;
            setFishDir(-1);
            nx = bounds.max;
          }
          if (nx < bounds.min) {
            fishDirRef.current = 1;
            fishDRef.current = 1;
            setFishDir(1);
            nx = bounds.min;
          }
          fishXRef.current = nx;
          return nx;
        });
      }, FISH_TICK_MS);
      return () => clearInterval(id);
    }, [tankWidth]);
    useEffect(() => {
      const id = setInterval(() => setFrame((f) => (f + 1) % 4), 200);
      return () => clearInterval(id);
    }, []);
    useEffect(() => {
      const id = setInterval(() => setWeedPhase((p) => p + 0.07), 70);
      return () => clearInterval(id);
    }, []);
    useEffect(() => {
      const id = setInterval(() => {
        if (sleepingRef.current) return;
        const bid = bubbleId.current++;
        setBubbles((b) => [...b.slice(-25), {
          id: bid,
          x: fishXRef.current + (fishDRef.current > 0 ? FISH_BUBBLE_OFFSET_PX : -FISH_BUBBLE_OFFSET_PX) + (Math.random() * FISH_BUBBLE_JITTER_PX - FISH_BUBBLE_JITTER_PX / 2),
          y: 55,
          char: ["o", "\xB0", "\xB7", "O", "."][Math.floor(Math.random() * 5)],
          speed: 0.25 + Math.random() * 0.35
        }]);
      }, 1600);
      return () => clearInterval(id);
    }, []);
    useEffect(() => {
      const id = setInterval(() => {
        setBubbles((b) => b.map((bb) => ({ ...bb, y: bb.y - bb.speed })).filter((bb) => bb.y > 4));
      }, 55);
      return () => clearInterval(id);
    }, []);
    useEffect(() => {
      const id = setInterval(() => {
        if (sleepingRef.current) {
          setEnergy((e) => Math.min(100, e + 1.2));
        } else {
          setHunger((h) => Math.max(0, h - 0.45));
          setHappiness((hp) => Math.max(0, hp - 0.28));
          setEnergy((e) => Math.max(0, e - 0.18));
        }
      }, 1e3);
      return () => clearInterval(id);
    }, []);
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
      speechTimerRef.current = setTimeout(() => setSpeech(""), 7e3);
    }
    function setBusyState(nextBusy) {
      busyRef.current = nextBusy;
      setBusy(nextBusy);
    }
    function getPromptContext(overrides = {}) {
      var _a, _b, _c;
      return {
        sleeping: (_a = overrides.sleeping) != null ? _a : sleepingRef.current,
        lightsOff: (_b = overrides.lightsOff) != null ? _b : lightsOffRef.current,
        behaviorMode: (_c = overrides.behaviorMode) != null ? _c : behaviorModeRef.current
      };
    }
    function updateNeeds(updater) {
      const nextNeeds = typeof updater === "function" ? updater(needsRef.current) : updater;
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
        behaviorModeRef.current = "idle";
        setBehaviorMode((current) => current === nextMode ? "idle" : current);
      }, durationMs);
    }
    function setSleepingState(nextSleeping) {
      sleepingRef.current = nextSleeping;
      setSleeping(nextSleeping);
      if (nextSleeping) {
        setTimedBehaviorMode("idle");
      }
    }
    function setLightsOffState(nextLightsOff) {
      lightsOffRef.current = nextLightsOff;
      setLightsOff(nextLightsOff);
    }
    async function executeBehaviorAction(action) {
      let plannedAction = action;
      if (sleepingRef.current && action === "sleep") {
        plannedAction = "idle";
      } else if (!sleepingRef.current && action === "wake") {
        plannedAction = "idle";
      }
      if (sleepingRef.current && plannedAction === "idle") {
        return;
      }
      let eventText = "";
      let channel = "ambient";
      if (plannedAction === "sleep") {
        setSleepingState(true);
        eventText = "guppy decided to sleep";
        channel = "event";
      } else if (plannedAction === "wake") {
        setSleepingState(false);
        eventText = "guppy woke up";
        channel = "event";
      } else if (plannedAction === "swim") {
        if (sleepingRef.current) setSleepingState(false);
        setTimedBehaviorMode("swim", AUTONOMY_MODE_DURATION_MS);
        updateNeeds((current) => ({
          ...current,
          happiness: clamp(current.happiness + 4, 0, 100),
          energy: clamp(current.energy - 3, 0, 100)
        }));
        eventText = "guppy started swimming laps";
        channel = "event";
      } else if (plannedAction === "food") {
        if (sleepingRef.current) setSleepingState(false);
        setTimedBehaviorMode("food", AUTONOMY_MODE_DURATION_MS);
        updateNeeds((current) => ({
          ...current,
          happiness: clamp(current.happiness + 2, 0, 100)
        }));
        eventText = "guppy looked for food near the surface";
        channel = "event";
      }
      if (eventText) {
        pushMessage({ from: "tank", text: eventText, channel: "event" });
      }
      const thoughtPrompt = buildActionThoughtPrompt(plannedAction);
      if (!thoughtPrompt) {
        return;
      }
      const thought = await guppyAutoThought(
        needsRef.current,
        getPromptContext(),
        thoughtPrompt
      );
      if (thought) {
        showSpeech(thought);
        pushMessage({ from: "guppy", text: thought, channel });
      }
    }
    async function feed() {
      if (busyRef.current) return;
      setBusyState(true);
      try {
        setSleepingState(false);
        setTimedBehaviorMode("food", 3600);
        const newNeeds = updateNeeds((current) => ({
          ...current,
          hunger: clamp(current.hunger + 38, 0, 100)
        }));
        setEating(true);
        setTimeout(() => setEating(false), 2200);
        const trigger = "you dropped food in the water";
        pushMessage({ from: "tank", text: trigger, channel: "event" });
        const msg = await guppyReply(trigger, newNeeds, getPromptContext({ behaviorMode: "food" }));
        showSpeech(msg);
        pushMessage({ from: "guppy", text: msg, channel: "event" });
      } finally {
        setBusyState(false);
      }
    }
    async function tap() {
      if (busyRef.current) return;
      setBusyState(true);
      try {
        setSleepingState(false);
        const newNeeds = updateNeeds((current) => ({
          ...current,
          happiness: clamp(current.happiness + 28, 0, 100)
        }));
        const trigger = "you tapped on the glass";
        pushMessage({ from: "tank", text: trigger, channel: "event" });
        const msg = await guppyReply(trigger, newNeeds, getPromptContext());
        showSpeech(msg);
        pushMessage({ from: "guppy", text: msg, channel: "event" });
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
        if (!nextLightsOff && sleepingRef.current) {
          setSleepingState(false);
        }
        const trigger = nextLightsOff ? "the light just turned off" : "the light just came back on";
        const eventText = nextLightsOff ? "lights off" : "lights on";
        pushMessage({ from: "tank", text: eventText, channel: "event" });
        const msg = await guppyReply(trigger, needsRef.current, getPromptContext({ lightsOff: nextLightsOff }));
        showSpeech(msg);
        pushMessage({ from: "guppy", text: msg, channel: "event" });
      } finally {
        setBusyState(false);
      }
    }
    async function send() {
      const text = input.trim();
      if (!text || thinking || busyRef.current) return;
      setInput("");
      pushMessage({ from: "human", text, channel: "chat" });
      setThinking(true);
      setBusyState(true);
      try {
        const reply = await guppyReply(text, needsRef.current, getPromptContext());
        showSpeech(reply);
        pushMessage({ from: "guppy", text: reply, channel: "chat" });
        updateNeeds((current) => ({
          ...current,
          happiness: clamp(current.happiness + 4, 0, 100)
        }));
      } finally {
        setThinking(false);
        setBusyState(false);
      }
    }
    const fishAscii = sleeping ? fishDir > 0 ? FISH_SLEEP_R : FISH_SLEEP_L : eating ? fishDir > 0 ? FISH_EAT_R : FISH_EAT_L : fishDir > 0 ? FR[frame] : FL[frame];
    const fishY = sleeping ? 60 : behaviorMode === "food" ? 28 : 42;
    const ph = tw.phosphorColor;
    const bg = tw.bgColor;
    const dim = (a) => rgba(ph, a);
    const needsLow = hunger < 30 || happiness < 30 || energy < 25;
    const messageStyle = (message) => {
      if (message.channel === "ambient") {
        return {
          label: "drift> ",
          labelColor: dim(0.38),
          textColor: dim(0.8)
        };
      }
      if (message.from === "tank") {
        return {
          label: "tank>  ",
          labelColor: rgba("#ffb000", 0.55),
          textColor: "#ffb000"
        };
      }
      if (message.from === "guppy") {
        return {
          label: "guppy> ",
          labelColor: dim(0.4),
          textColor: ph
        };
      }
      return {
        label: "you>   ",
        labelColor: rgba("#6ec6ff", 0.5),
        textColor: "#6ec6ff"
      };
    };
    return /* @__PURE__ */ React.createElement("div", { style: {
      width: "100%",
      height: "100%",
      display: "flex",
      flexDirection: "column",
      fontFamily: "'Share Tech Mono', 'Courier New', monospace",
      background: bg,
      color: ph
    } }, /* @__PURE__ */ React.createElement("div", { style: {
      padding: "5px 14px",
      borderBottom: `1px solid ${dim(0.18)}`,
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      flexShrink: 0
    } }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 15, letterSpacing: 2 } }, "GUPPY.EXE"), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 10, color: dim(0.4), marginLeft: 10 } }, "// guppylm-9m \xB7 onnx \xB7", " ", /* @__PURE__ */ React.createElement("span", { style: { color: modelStatus.err ? "#ff5555" : modelStatus.done ? ph : rgba(ph, 0.5) } }, modelStatus.done ? "local inference \u2713" : modelStatus.err ? "templates (offline)" : "loading\u2026"))), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: dim(0.35), display: "flex", gap: 16 } }, needsLow && /* @__PURE__ */ React.createElement("span", { style: { color: "#ff4d4d", animation: "blink 1s infinite" } }, "\u26A0 needs attention"), /* @__PURE__ */ React.createElement("span", { style: { cursor: "pointer" }, onClick: () => setTweaksVisible((v) => !v) }, "[tweaks]"), /* @__PURE__ */ React.createElement("span", { id: "clock" }, (/* @__PURE__ */ new Date()).toLocaleTimeString()))), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, display: "flex", overflow: "hidden", minHeight: 0 } }, /* @__PURE__ */ React.createElement("div", { ref: tankRef, style: { flex: 1, position: "relative", overflow: "hidden", borderRight: `1px solid ${dim(0.15)}` } }, /* @__PURE__ */ React.createElement(
      Tank,
      {
        tw,
        fishX,
        tankWidth,
        fishY,
        fishAscii,
        bubbles,
        weedPhase,
        sleeping,
        lightsOff,
        guppySpeech: speech,
        bgColor: bg
      }
    ), !modelStatus.done && /* @__PURE__ */ React.createElement("div", { style: {
      position: "absolute",
      bottom: 16,
      left: "50%",
      transform: "translateX(-50%)",
      background: rgba(bg === "#050c07" ? "#060d0a" : bg, 0.95),
      border: `1px solid ${rgba(ph, 0.3)}`,
      padding: "10px 18px",
      minWidth: 260,
      fontFamily: "monospace",
      fontSize: 11,
      color: modelStatus.err ? "#ff5555" : ph,
      zIndex: 50,
      textAlign: "center"
    } }, /* @__PURE__ */ React.createElement("div", { style: { marginBottom: 6, opacity: 0.7 } }, modelStatus.err ? "\u26A0 " : "", "guppylm-9m \xB7 onnx \xB7 wasm"), /* @__PURE__ */ React.createElement("div", { style: { marginBottom: 6 } }, modelStatus.msg), !modelStatus.err && /* @__PURE__ */ React.createElement("div", { style: {
      height: 4,
      background: rgba(ph, 0.15),
      borderRadius: 2,
      overflow: "hidden"
    } }, /* @__PURE__ */ React.createElement("div", { style: {
      height: "100%",
      width: `${modelStatus.pct}%`,
      background: ph,
      borderRadius: 2,
      transition: "width 0.3s ease"
    } })), modelStatus.err && /* @__PURE__ */ React.createElement("div", { style: { marginTop: 6, opacity: 0.6, fontSize: 10 } }, "using offline templates \u2193"))), /* @__PURE__ */ React.createElement("div", { style: {
      width: 210,
      flexShrink: 0,
      display: "flex",
      flexDirection: "column",
      padding: "10px 12px",
      gap: 0,
      overflowY: "auto"
    } }, /* @__PURE__ */ React.createElement("div", { style: { marginBottom: 14 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: dim(0.5), borderBottom: `1px solid ${dim(0.15)}`, paddingBottom: 4, marginBottom: 8, letterSpacing: 1 } }, "[ STATUS ]"), /* @__PURE__ */ React.createElement(StatBar, { label: "HUNGER", value: hunger, ph }), /* @__PURE__ */ React.createElement(StatBar, { label: "HAPPINESS", value: happiness, ph }), /* @__PURE__ */ React.createElement(StatBar, { label: "ENERGY", value: energy, ph })), /* @__PURE__ */ React.createElement("div", { style: { marginBottom: 14 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: dim(0.5), borderBottom: `1px solid ${dim(0.15)}`, paddingBottom: 4, marginBottom: 8, letterSpacing: 1 } }, "[ ACTIONS ]"), [
      { label: "feed guppy", action: feed, hot: hunger < 35 },
      { label: "tap the glass", action: tap, hot: happiness < 35 },
      { label: lightsOff ? "lights on" : "lights off", action: toggleLight, hot: energy < 25 }
    ].map(({ label, action, hot }) => /* @__PURE__ */ React.createElement(
      "div",
      {
        key: label,
        onClick: busy ? void 0 : action,
        className: "action-btn",
        style: {
          cursor: busy ? "default" : "pointer",
          padding: "5px 8px",
          marginBottom: 5,
          color: busy ? dim(0.28) : hot ? "#ff9944" : ph,
          border: `1px solid ${hot ? "rgba(255,153,68,0.5)" : dim(0.18)}`,
          fontSize: 12,
          borderRadius: 2,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          opacity: busy ? 0.6 : 1
        }
      },
      /* @__PURE__ */ React.createElement("span", null, "> ", label),
      hot && /* @__PURE__ */ React.createElement("span", { style: { fontSize: 10, color: "#ff9944", animation: "blink 0.8s infinite" } }, "LOW")
    ))), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, display: "flex", flexDirection: "column", minHeight: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: dim(0.5), borderBottom: `1px solid ${dim(0.15)}`, paddingBottom: 4, marginBottom: 8, letterSpacing: 1, flexShrink: 0 } }, "[ LOG ]"), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 5 } }, messages.slice(-30).map((m, i) => /* @__PURE__ */ React.createElement("div", { key: i, style: { fontSize: 11, lineHeight: 1.4, wordBreak: "break-word" } }, /* @__PURE__ */ React.createElement("span", { style: { color: messageStyle(m).labelColor } }, messageStyle(m).label), /* @__PURE__ */ React.createElement("span", { style: { color: messageStyle(m).textColor } }, m.text))), thinking && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: dim(0.4) } }, "guppy> ", /* @__PURE__ */ React.createElement("span", { style: { animation: "blink 0.7s infinite" } }, "...")), /* @__PURE__ */ React.createElement("div", { ref: chatEndRef }))))), /* @__PURE__ */ React.createElement("div", { style: {
      borderTop: `1px solid ${dim(0.18)}`,
      padding: "7px 12px",
      display: "flex",
      gap: 10,
      alignItems: "center",
      flexShrink: 0
    } }, /* @__PURE__ */ React.createElement("span", { style: { color: dim(0.45), fontSize: 13 } }, "you>"), /* @__PURE__ */ React.createElement(
      "input",
      {
        value: input,
        onChange: (e) => setInput(e.target.value),
        onKeyDown: (e) => e.key === "Enter" && send(),
        placeholder: "say something to guppy...",
        style: {
          flex: 1,
          background: "transparent",
          border: "none",
          outline: "none",
          color: "#6ec6ff",
          fontFamily: "inherit",
          fontSize: 13,
          caretColor: ph
        }
      }
    ), /* @__PURE__ */ React.createElement("button", { onClick: send, disabled: thinking || busy, style: {
      background: "transparent",
      border: `1px solid ${dim(0.25)}`,
      color: thinking || busy ? dim(0.3) : ph,
      fontFamily: "inherit",
      fontSize: 12,
      padding: "3px 12px",
      cursor: thinking || busy ? "default" : "pointer",
      borderRadius: 2
    } }, thinking || busy ? "\xB7\xB7\xB7" : "SEND")), /* @__PURE__ */ React.createElement(TweaksPanel, { tw, setTw, visible: tweaksVisible }));
  }
  setInterval(() => {
    const el = document.getElementById("clock");
    if (el) el.textContent = (/* @__PURE__ */ new Date()).toLocaleTimeString();
  }, 1e3);
  ReactDOM.createRoot(document.getElementById("root")).render(/* @__PURE__ */ React.createElement(App, null));
})();
