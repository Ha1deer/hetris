import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import haiderIntro from "@/assets/haider-intro.png.asset.json";
import soundtrack from "@/assets/soundtrack.mp3.asset.json";
import {
  Bag,
  Board,
  COLS,
  Piece,
  PIECE_COLORS,
  PieceKey,
  ROWS,
  clearLines,
  collides,
  emptyBoard,
  gravityMs,
  hardDropDistance,
  levelFromLines,
  lineScore,
  merge,
  pieceCells,
  spawn,
  tryMove,
  tryRotate,
} from "@/lib/tetris";

type ControlMode = "buttons" | "swipe" | "both";
type Phase = "intro" | "pickControls" | "menu" | "playing" | "paused" | "over" | "about";

interface Settings {
  ghost: boolean;
  sound: boolean;
  music: boolean;
  control: ControlMode;
  swipeSensitivity: number; // px per cell
  handed: "right" | "left";
}

const DEFAULT_SETTINGS: Settings = {
  ghost: true,
  sound: true,
  music: true,
  control: "both",
  swipeSensitivity: 24,
  handed: "right",
};

const HS_KEY = "neonstack:highscore";
const STATS_KEY = "neonstack:stats";
const SET_KEY = "neonstack:settings";
const TIPS_KEY = "neonstack:tipsSeen";
const CTRL_PICKED_KEY = "neonstack:ctrlPicked";

interface Stats {
  bestScore: number;
  bestLines: number;
  bestTimeSec: number;
  gamesPlayed: number;
}

function loadStats(): Stats {
  if (typeof window === "undefined") return { bestScore: 0, bestLines: 0, bestTimeSec: 0, gamesPlayed: 0 };
  try {
    const raw = localStorage.getItem(STATS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { bestScore: 0, bestLines: 0, bestTimeSec: 0, gamesPlayed: 0 };
}
function loadSettings(): Settings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(SET_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {}
  return DEFAULT_SETTINGS;
}

// Resolve a CSS color variable to an actual rgb string at runtime.
function cssVar(name: string): string {
  if (typeof window === "undefined") return "#fff";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#fff";
}

// Tiny WebAudio click/clear sounds.
let audioCtx: AudioContext | null = null;
function beep(freq: number, dur = 0.05, type: OscillatorType = "square", vol = 0.05) {
  if (typeof window === "undefined") return;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const ctx = audioCtx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.value = vol;
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start();
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    osc.stop(ctx.currentTime + dur);
  } catch {}
}

export default function NeonStack() {
  const [phase, setPhase] = useState<Phase>("intro");
  // Use defaults on server to avoid hydration mismatch; hydrate from
  // localStorage after mount.
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [stats, setStats] = useState<Stats>({ bestScore: 0, bestLines: 0, bestTimeSec: 0, gamesPlayed: 0 });
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setSettings(loadSettings());
    setStats(loadStats());
    setMounted(true);
  }, []);
  const [showSettings, setShowSettings] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [showTips, setShowTips] = useState(false);
  const musicRef = useRef<HTMLAudioElement | null>(null);

  // Auto-dismiss intro after 3.2s
  useEffect(() => {
    if (phase !== "intro") return;
    const t = setTimeout(() => {
      // First-launch control picker
      let picked = false;
      try { picked = !!localStorage.getItem(CTRL_PICKED_KEY); } catch {}
      setPhase(picked ? "menu" : "pickControls");
    }, 3200);
    return () => clearTimeout(t);
  }, [phase]);

  // Background music — always on unless disabled in settings.
  // Browsers block autoplay until first user gesture; we attempt play on any
  // pointer/keydown and also whenever the music setting flips on.
  useEffect(() => {
    const audio = musicRef.current;
    if (!audio) return;
    audio.volume = 0.45;
    audio.loop = true;
    if (settings.music) {
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  }, [settings.music]);

  useEffect(() => {
    const tryPlay = () => {
      const a = musicRef.current;
      if (a && settingsRef.current.music && a.paused) a.play().catch(() => {});
    };
    window.addEventListener("pointerdown", tryPlay);
    window.addEventListener("keydown", tryPlay);
    return () => {
      window.removeEventListener("pointerdown", tryPlay);
      window.removeEventListener("keydown", tryPlay);
    };
  }, []);

  // Live HUD state
  const [score, setScore] = useState(0);
  const [lines, setLines] = useState(0);
  const [level, setLevel] = useState(1);
  const [combo, setCombo] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  // Mutable game refs (avoid re-render per frame)
  const boardRef = useRef<Board>(emptyBoard());
  const pieceRef = useRef<Piece | null>(null);
  const bagRef = useRef<Bag>(new Bag());
  const nextRef = useRef<PieceKey[]>([]);
  const holdRef = useRef<PieceKey | null>(null);
  const holdLockRef = useRef(false);
  const dropAccRef = useRef(0);
  const lastTsRef = useRef(0);
  const softDropRef = useRef(false);
  const comboRef = useRef(-1);
  const startTsRef = useRef(0);
  const phaseRef = useRef<Phase>("menu");
  const flashRef = useRef<{ rows: number[]; t: number } | null>(null);
  const settingsRef = useRef(settings);
  const particlesRef = useRef<{ x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number }[]>([]);
  const popupRef = useRef<{ text: string; t: number } | null>(null);
  const [, forcePopupRender] = useState(0);

  useEffect(() => {
    settingsRef.current = settings;
    try { localStorage.setItem(SET_KEY, JSON.stringify(settings)); } catch {}
  }, [settings]);

  useEffect(() => { phaseRef.current = phase; }, [phase]);

  // Canvas
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const startGame = useCallback(() => {
    boardRef.current = emptyBoard();
    bagRef.current = new Bag();
    nextRef.current = bagRef.current.peek(5).slice();
    holdRef.current = null;
    holdLockRef.current = false;
    dropAccRef.current = 0;
    lastTsRef.current = 0;
    softDropRef.current = false;
    comboRef.current = -1;
    startTsRef.current = performance.now();
    flashRef.current = null;
    setScore(0); setLines(0); setLevel(1); setCombo(0); setElapsed(0);
    spawnNext();
    setPhase("playing");
    // First-time touch tips
    try {
      if (!localStorage.getItem(TIPS_KEY)) {
        setShowTips(true);
        localStorage.setItem(TIPS_KEY, "1");
      }
    } catch {}
  }, []);

  const spawnNext = useCallback(() => {
    const key = bagRef.current.next();
    nextRef.current = bagRef.current.peek(5).slice();
    const p = spawn(key);
    if (collides(boardRef.current, p)) {
      // game over
      const finalScore = scoreRef.current;
      const finalLines = linesRef.current;
      const finalTime = Math.floor((performance.now() - startTsRef.current) / 1000);
      setStats((s) => {
        const next: Stats = {
          bestScore: Math.max(s.bestScore, finalScore),
          bestLines: Math.max(s.bestLines, finalLines),
          bestTimeSec: Math.max(s.bestTimeSec, finalTime),
          gamesPlayed: s.gamesPlayed + 1,
        };
        try { localStorage.setItem(STATS_KEY, JSON.stringify(next)); } catch {}
        try { localStorage.setItem(HS_KEY, String(next.bestScore)); } catch {}
        return next;
      });
      setPhase("over");
      return;
    }
    pieceRef.current = p;
    holdLockRef.current = false;
  }, []);

  // Refs mirroring score/lines for use inside callbacks without stale closures
  const scoreRef = useRef(0);
  const linesRef = useRef(0);
  useEffect(() => { scoreRef.current = score; }, [score]);
  useEffect(() => { linesRef.current = lines; }, [lines]);

  const lockPiece = useCallback(() => {
    const p = pieceRef.current;
    if (!p) return;
    boardRef.current = merge(boardRef.current, p);
    const { board: nb, cleared, rows } = clearLines(boardRef.current);
    boardRef.current = nb;
    if (cleared > 0) {
      comboRef.current += 1;
      const lvl = levelFromLines(linesRef.current + cleared);
      const gained = lineScore(cleared, lvl, comboRef.current + 1);
      setScore((s) => s + gained);
      setLines((l) => l + cleared);
      setLevel(lvl);
      setCombo(comboRef.current);
      flashRef.current = { rows, t: performance.now() };
      // Burst particles per cleared row
      spawnLineParticles(rows);
      // Popup text for tetris / combos
      const label =
        cleared === 4 ? "TETRIS!" :
        cleared === 3 ? "TRIPLE" :
        cleared === 2 ? "DOUBLE" :
        comboRef.current >= 1 ? `COMBO x${comboRef.current + 1}` : "";
      if (label) {
        popupRef.current = { text: label, t: performance.now() };
        forcePopupRender((n) => n + 1);
      }
      if (settingsRef.current.sound) beep(cleared >= 4 ? 880 : 660, 0.12, "triangle", 0.08);
    } else {
      comboRef.current = -1;
      setCombo(0);
    }
    spawnNext();
  }, [spawnNext]);

  const spawnLineParticles = (rows: number[]) => {
    const c = canvasRef.current;
    if (!c) return;
    const W = parseFloat(c.style.width);
    const H = parseFloat(c.style.height);
    const cell = Math.floor(Math.min(W / COLS, H / ROWS));
    const boardW = cell * COLS;
    const boardH = cell * ROWS;
    const ox = Math.floor((W - boardW) / 2);
    const oy = Math.floor((H - boardH) / 2);
    const palette = ["#ffd60a", "#ffc300", "#fff3a0", "#ffffff", "#7ee0ff"];
    for (const r of rows) {
      for (let i = 0; i < 24; i++) {
        const px = ox + Math.random() * boardW;
        const py = oy + (r + 0.5) * cell;
        const ang = Math.random() * Math.PI * 2;
        const sp = 80 + Math.random() * 220;
        particlesRef.current.push({
          x: px, y: py,
          vx: Math.cos(ang) * sp,
          vy: Math.sin(ang) * sp - 60,
          life: 0, max: 600 + Math.random() * 400,
          color: palette[Math.floor(Math.random() * palette.length)],
          size: 2 + Math.random() * 3,
        });
      }
    }
  };

  const hardDropFlashRef = useRef<{ t: number; col: number; from: number; to: number; key: PieceKey } | null>(null);

  const move = useCallback((dx: number) => {
    if (phaseRef.current !== "playing" || !pieceRef.current) return;
    const np = tryMove(boardRef.current, pieceRef.current, dx, 0);
    if (np) {
      pieceRef.current = np;
      if (settingsRef.current.sound) beep(400, 0.02, "square", 0.03);
    }
  }, []);

  const rotate = useCallback((dir: 1 | -1 = 1) => {
    if (phaseRef.current !== "playing" || !pieceRef.current) return;
    const np = tryRotate(boardRef.current, pieceRef.current, dir);
    if (np) {
      pieceRef.current = np;
      if (settingsRef.current.sound) beep(520, 0.025, "square", 0.04);
    }
  }, []);

  const softDrop = useCallback(() => {
    if (phaseRef.current !== "playing" || !pieceRef.current) return;
    const np = tryMove(boardRef.current, pieceRef.current, 0, 1);
    if (np) {
      pieceRef.current = np;
      setScore((s) => s + 1);
    } else {
      lockPiece();
    }
  }, [lockPiece]);

  const hardDrop = useCallback(() => {
    if (phaseRef.current !== "playing" || !pieceRef.current) return;
    const d = hardDropDistance(boardRef.current, pieceRef.current);
    hardDropFlashRef.current = {
      t: performance.now(),
      col: pieceRef.current.x,
      from: pieceRef.current.y,
      to: pieceRef.current.y + d,
      key: pieceRef.current.key,
    };
    pieceRef.current = { ...pieceRef.current, y: pieceRef.current.y + d };
    setScore((s) => s + d * 2);
    if (settingsRef.current.sound) beep(220, 0.06, "sawtooth", 0.06);
    lockPiece();
  }, [lockPiece]);

  const hold = useCallback(() => {
    if (phaseRef.current !== "playing" || !pieceRef.current || holdLockRef.current) return;
    const cur = pieceRef.current.key;
    const prev = holdRef.current;
    holdRef.current = cur;
    holdLockRef.current = true;
    if (prev) {
      const p = spawn(prev);
      if (!collides(boardRef.current, p)) pieceRef.current = p;
    } else {
      spawnNext();
    }
  }, [spawnNext]);

  // Keyboard support (desktop)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (phaseRef.current !== "playing") {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (phase === "menu" || phase === "over") startGame();
          else if (phase === "paused") setPhase("playing");
        }
        return;
      }
      switch (e.key) {
        case "ArrowLeft": move(-1); break;
        case "ArrowRight": move(1); break;
        case "ArrowUp": case "x": rotate(1); break;
        case "z": rotate(-1); break;
        case "ArrowDown": softDropRef.current = true; break;
        case " ": e.preventDefault(); hardDrop(); break;
        case "Shift": case "c": hold(); break;
        case "Escape": case "p": setPhase("paused"); break;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") softDropRef.current = false;
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [move, rotate, hardDrop, hold, startGame, phase]);

  // Game loop
  useEffect(() => {
    let raf = 0;
    const tick = (ts: number) => {
      raf = requestAnimationFrame(tick);
      if (!canvasRef.current) return;
      if (lastTsRef.current === 0) lastTsRef.current = ts;
      const dt = ts - lastTsRef.current;
      lastTsRef.current = ts;

      if (phaseRef.current === "playing" && pieceRef.current) {
        const ms = gravityMs(levelFromLines(linesRef.current));
        dropAccRef.current += dt * (softDropRef.current ? 8 : 1);
        while (dropAccRef.current >= ms) {
          dropAccRef.current -= ms;
          const np = tryMove(boardRef.current, pieceRef.current, 0, 1);
          if (np) {
            pieceRef.current = np;
            if (softDropRef.current) setScore((s) => s + 1);
          } else {
            lockPiece();
            break;
          }
        }
        setElapsed(Math.floor((ts - startTsRef.current) / 1000));
      }
      // Update particles
      if (particlesRef.current.length) {
        const sec = dt / 1000;
        for (const p of particlesRef.current) {
          p.life += dt;
          p.x += p.vx * sec;
          p.y += p.vy * sec;
          p.vy += 600 * sec;
        }
        particlesRef.current = particlesRef.current.filter((p) => p.life < p.max);
      }
      draw();
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockPiece]);

  // Resize canvas to container with DPR
  useEffect(() => {
    const resize = () => {
      const c = canvasRef.current;
      const w = wrapRef.current;
      if (!c || !w) return;
      const rect = w.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      c.width = Math.floor(rect.width * dpr);
      c.height = Math.floor(rect.height * dpr);
      c.style.width = rect.width + "px";
      c.style.height = rect.height + "px";
      const ctx = c.getContext("2d");
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);
    const ro = wrapRef.current ? new ResizeObserver(resize) : null;
    if (ro && wrapRef.current) ro.observe(wrapRef.current);
    return () => {
      window.removeEventListener("resize", resize);
      ro?.disconnect();
    };
  }, []);

  const colors = useMemo(() => {
    if (typeof window === "undefined") return null;
    return {
      I: cssVar("--piece-i"),
      O: cssVar("--piece-o"),
      T: cssVar("--piece-t"),
      S: cssVar("--piece-s"),
      Z: cssVar("--piece-z"),
      J: cssVar("--piece-j"),
      L: cssVar("--piece-l"),
      bg: cssVar("--background"),
      grid: cssVar("--border"),
      panel: cssVar("--card"),
    } as Record<string, string>;
  }, []);

  const drawCell = (ctx: CanvasRenderingContext2D, x: number, y: number, size: number, key: PieceKey, opts: { ghost?: boolean } = {}) => {
    const col = colors?.[key] || "#fff";
    ctx.save();
    if (opts.ghost) {
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = col;
      ctx.fillRect(x + 1, y + 1, size - 2, size - 2);
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 2, y + 2, size - 4, size - 4);
    } else {
      ctx.shadowColor = col;
      ctx.shadowBlur = 12;
      ctx.fillStyle = col;
      ctx.fillRect(x + 1, y + 1, size - 2, size - 2);
      ctx.shadowBlur = 0;
      // inner highlight
      ctx.fillStyle = "rgba(255,255,255,0.18)";
      ctx.fillRect(x + 2, y + 2, size - 4, 3);
    }
    ctx.restore();
  };

  const draw = () => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const W = parseFloat(c.style.width);
    const H = parseFloat(c.style.height);
    ctx.clearRect(0, 0, W, H);

    const cell = Math.floor(Math.min(W / COLS, H / ROWS));
    const boardW = cell * COLS;
    const boardH = cell * ROWS;
    const ox = Math.floor((W - boardW) / 2);
    const oy = Math.floor((H - boardH) / 2);

    // subtle vertical lane gradient — gives depth without a hard frame
    const grad = ctx.createLinearGradient(0, oy, 0, oy + boardH);
    grad.addColorStop(0, "rgba(120, 200, 255, 0.04)");
    grad.addColorStop(1, "rgba(180, 80, 220, 0.06)");
    ctx.fillStyle = grad;
    ctx.fillRect(ox, oy, boardW, boardH);

    // grid
    ctx.strokeStyle = "rgba(255,255,255,0.045)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= COLS; x++) {
      ctx.beginPath();
      ctx.moveTo(ox + x * cell + 0.5, oy);
      ctx.lineTo(ox + x * cell + 0.5, oy + boardH);
      ctx.stroke();
    }
    for (let y = 0; y <= ROWS; y++) {
      ctx.beginPath();
      ctx.moveTo(ox, oy + y * cell + 0.5);
      ctx.lineTo(ox + boardW, oy + y * cell + 0.5);
      ctx.stroke();
    }

    // board cells
    const b = boardRef.current;
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const v = b[y][x];
        if (v) drawCell(ctx, ox + x * cell, oy + y * cell, cell, v);
      }
    }

    // line flash
    if (flashRef.current) {
      const age = performance.now() - flashRef.current.t;
      if (age < 220) {
        ctx.fillStyle = `rgba(255,255,255,${0.5 * (1 - age / 220)})`;
        for (const r of flashRef.current.rows) {
          ctx.fillRect(ox, oy + r * cell, boardW, cell);
        }
      } else {
        flashRef.current = null;
      }
    }

    // hard-drop streak trail
    if (hardDropFlashRef.current) {
      const age = performance.now() - hardDropFlashRef.current.t;
      if (age < 260) {
        const a = 1 - age / 260;
        const { col, from, to } = hardDropFlashRef.current;
        const grad2 = ctx.createLinearGradient(0, oy + from * cell, 0, oy + (to + 1) * cell);
        grad2.addColorStop(0, `rgba(255,214,10,0)`);
        grad2.addColorStop(1, `rgba(255,214,10,${0.55 * a})`);
        ctx.fillStyle = grad2;
        ctx.fillRect(ox + col * cell, oy + from * cell, cell * 4, (to - from + 1) * cell);
      } else {
        hardDropFlashRef.current = null;
      }
    }

    // ghost + piece (with smooth sub-cell fall offset)
    const p = pieceRef.current;
    if (p && phaseRef.current === "playing") {
      if (settingsRef.current.ghost) {
        const d = hardDropDistance(boardRef.current, p);
        for (const [x, y] of pieceCells({ ...p, y: p.y + d })) {
          if (y >= 0) drawCell(ctx, ox + x * cell, oy + y * cell, cell, p.key, { ghost: true });
        }
      }
      const ms = gravityMs(levelFromLines(linesRef.current));
      const frac = Math.min(0.95, dropAccRef.current / ms);
      const subY = frac * cell;
      for (const [x, y] of pieceCells(p)) {
        if (y >= -1) drawCell(ctx, ox + x * cell, oy + y * cell + subY, cell, p.key);
      }
    }

    // Particles
    if (particlesRef.current.length) {
      for (const part of particlesRef.current) {
        const a = 1 - part.life / part.max;
        ctx.globalAlpha = Math.max(0, a);
        ctx.fillStyle = part.color;
        ctx.shadowColor = part.color;
        ctx.shadowBlur = 10;
        ctx.fillRect(part.x, part.y, part.size, part.size);
      }
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
    }
  };

  // Touch / swipe controls
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let startX = 0, startY = 0, startT = 0;
    let dragX = 0, dragY = 0;
    let moved = false;
    let lastMoveX = 0, lastMoveY = 0;

    const onStart = (e: TouchEvent) => {
      if (phaseRef.current !== "playing") return;
      const t = e.touches[0];
      startX = lastMoveX = t.clientX;
      startY = lastMoveY = t.clientY;
      startT = performance.now();
      dragX = 0; dragY = 0;
      moved = false;
    };
    const onMove = (e: TouchEvent) => {
      if (phaseRef.current !== "playing") return;
      const mode = settingsRef.current.control;
      if (mode === "buttons") return;
      const t = e.touches[0];
      const dx = t.clientX - lastMoveX;
      const dy = t.clientY - lastMoveY;
      const step = settingsRef.current.swipeSensitivity;
      dragX += dx; dragY += dy;
      while (Math.abs(dragX) >= step) {
        const dir = dragX > 0 ? 1 : -1;
        move(dir);
        dragX -= dir * step;
        moved = true;
      }
      if (dragY >= step) {
        softDrop();
        dragY -= step;
        moved = true;
      }
      lastMoveX = t.clientX;
      lastMoveY = t.clientY;
    };
    const onEnd = (e: TouchEvent) => {
      if (phaseRef.current !== "playing") return;
      const mode = settingsRef.current.control;
      if (mode === "buttons") return;
      const t = e.changedTouches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      const dt = performance.now() - startT;
      const absX = Math.abs(dx), absY = Math.abs(dy);
      // hard drop on fast downward swipe
      if (!moved && dy > 60 && dt < 250 && absY > absX) { hardDrop(); return; }
      // tap → rotate
      if (!moved && absX < 10 && absY < 10 && dt < 250) { rotate(1); return; }
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: true });
    el.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
    };
  }, [move, rotate, softDrop, hardDrop]);

  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  return (
    <div className="flex flex-col h-[100dvh] w-full bg-background text-foreground overflow-hidden">
      {/* Background soundtrack — always on unless disabled in settings */}
      <audio ref={musicRef} src={soundtrack.url} preload="auto" loop />

      {/* Intro splash — Developed by Haider */}
      {phase === "intro" && (
        <div
          onClick={() => {
            let picked = false;
            try { picked = !!localStorage.getItem(CTRL_PICKED_KEY); } catch {}
            setPhase(picked ? "menu" : "pickControls");
          }}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black cursor-pointer animate-in fade-in"
        >
          <img
            src={haiderIntro.url}
            alt="Developed by Haider"
            className="w-full h-full object-contain"
            draggable={false}
          />
        </div>
      )}

      {/* First-launch control picker */}
      {phase === "pickControls" && (
        <ControlPicker
          onPick={(mode) => {
            setSettings({ ...settings, control: mode });
            try { localStorage.setItem(CTRL_PICKED_KEY, "1"); } catch {}
            setPhase("menu");
          }}
        />
      )}

      {/* Top HUD — only visible during active gameplay states */}
      {phase !== "menu" && phase !== "intro" && phase !== "pickControls" && (
        <div className="relative z-10 flex items-center justify-between px-3 pt-[max(0.6rem,env(safe-area-inset-top))] pb-2 text-xs">
          <div className="flex gap-3">
            <Stat label="SCORE" value={score.toString()} />
            <Stat label="LINES" value={lines.toString()} />
            <Stat label="LVL" value={level.toString()} />
            <Stat label="TIME" value={mmss(elapsed)} />
          </div>
          <div className="flex gap-1.5 items-center">
            <IconBtn onClick={() => setPhase("menu")} label="Home"><HomeIcon /></IconBtn>
            <IconBtn onClick={() => setShowSettings(true)} label="Settings"><GearIcon /></IconBtn>
            {phase === "playing" && (
              <IconBtn onClick={() => setPhase("paused")} label="Pause"><PauseIcon /></IconBtn>
            )}
          </div>
        </div>
      )}

      {/* Board — fills the full available area, edge to edge */}
      <div ref={wrapRef} className="relative flex-1 min-h-0 overflow-hidden">
        <canvas ref={canvasRef} className="absolute inset-0" />

        {/* Floating Next overlay (only during play / pause) */}
        {phase !== "menu" && phase !== "intro" && phase !== "pickControls" && phase !== "over" && (
          <div className="absolute top-2 right-2 z-10 pointer-events-none flex flex-col items-end gap-1">
            <span className="text-[9px] tracking-[0.25em] text-foreground/60">NEXT</span>
            <div className="flex flex-col gap-1">
              {nextRef.current.slice(0, 4).map((p, i) => (
                <FloatingBox key={i} piece={p} small />
              ))}
            </div>
          </div>
        )}

        {/* Line clear popup */}
        {popupRef.current && performance.now() - popupRef.current.t < 900 && phase === "playing" && (
          <div
            className="absolute left-1/2 top-1/2 z-20 pointer-events-none text-3xl font-black tracking-[0.3em]"
            style={{
              transform: "translate(-50%, -50%)",
              color: "var(--accent)",
              textShadow: "0 0 24px var(--accent), 0 0 8px #fff",
              animation: "hetris-popup 900ms ease-out forwards",
            }}
          >
            {popupRef.current.text}
          </div>
        )}

        {phase !== "playing" && phase !== "pickControls" && phase !== "intro" && (
          <Overlay
            phase={phase}
            stats={stats}
            score={score}
            lines={lines}
            time={elapsed}
            onStart={startGame}
            onResume={() => setPhase("playing")}
            onAbout={() => setShowAbout(true)}
            onSettings={() => setShowSettings(true)}
            onHome={() => setPhase("menu")}
          />
        )}

        {/* First-time touch tips */}
        {showTips && phase === "playing" && (
          <TipsOverlay onClose={() => setShowTips(false)} />
        )}
      </div>

      {/* Control buttons — hidden in menu */}
      {phase !== "menu" && phase !== "intro" && phase !== "pickControls" &&
        (settings.control === "buttons" || settings.control === "both") && (
        <div className="relative z-10 px-3 pb-[max(0.6rem,env(safe-area-inset-bottom))] pt-2 shrink-0">
          <div className="grid grid-cols-2 gap-3 items-center">
            {/* D-pad cluster */}
            <div className="grid grid-cols-3 grid-rows-2 gap-1.5">
              <div />
              <CtrlBtn
                onPressStart={() => { softDropRef.current = true; }}
                onPressEnd={() => { softDropRef.current = false; }}
              >
                <SoftDropIcon size={22} />
              </CtrlBtn>
              <div />
              <CtrlBtn onPress={() => move(-1)}><ChevronIcon dir="left" /></CtrlBtn>
              <CtrlBtn onPress={hardDrop} accent><DropIcon /></CtrlBtn>
              <CtrlBtn onPress={() => move(1)}><ChevronIcon dir="right" /></CtrlBtn>
            </div>
            {/* Action cluster */}
            <div className="flex items-center justify-end pr-1">
              <CtrlBtn onPress={() => rotate(1)} big accent>
                <RotateIcon size={30} />
              </CtrlBtn>
            </div>
          </div>
        </div>
      )}

      {showSettings && <SettingsPanel settings={settings} setSettings={setSettings} onClose={() => setShowSettings(false)} stats={stats} />}
      {showAbout && <AboutPanel onClose={() => setShowAbout(false)} />}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col leading-tight">
      <span className="text-[9px] uppercase tracking-widest text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold tabular-nums" style={{ textShadow: "0 0 8px rgba(120,200,255,0.4)" }}>{value}</span>
    </div>
  );
}

function MiniBox({ label, piece, small }: { label?: string; piece: PieceKey | null; small?: boolean }) {
  const size = small ? 8 : 12;
  return (
    <div className="flex items-center gap-1">
      {label && <span className="self-center">{label}</span>}
      <div className="rounded-md border border-border bg-card/60 p-1" style={{ width: size * 5, height: size * 3 }}>
        {piece && <MiniPiece p={piece} size={size} />}
      </div>
    </div>
  );
}

function MiniPiece({ p, size }: { p: PieceKey; size: number }) {
  // Use shape rotation 0 to render small preview
  const shapes: Record<PieceKey, [number, number][]> = {
    I: [[0, 1], [1, 1], [2, 1], [3, 1]],
    O: [[1, 0], [2, 0], [1, 1], [2, 1]],
    T: [[1, 0], [0, 1], [1, 1], [2, 1]],
    S: [[1, 0], [2, 0], [0, 1], [1, 1]],
    Z: [[0, 0], [1, 0], [1, 1], [2, 1]],
    J: [[0, 0], [0, 1], [1, 1], [2, 1]],
    L: [[2, 0], [0, 1], [1, 1], [2, 1]],
  };
  const color = PIECE_COLORS[p];
  return (
    <div className="relative w-full h-full">
      {shapes[p].map(([x, y], i) => (
        <div key={i} style={{
          position: "absolute",
          left: x * size, top: y * size,
          width: size - 1, height: size - 1,
          background: color,
          boxShadow: `0 0 6px ${color}`,
          borderRadius: 2,
        }} />
      ))}
    </div>
  );
}

function CtrlBtn({
  onPress, onPressStart, onPressEnd, label, big, wide, accent, children,
}: {
  onPress?: () => void;
  onPressStart?: () => void;
  onPressEnd?: () => void;
  label?: string;
  big?: boolean;
  wide?: boolean;
  accent?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <button
      onPointerDown={(e) => {
        e.preventDefault();
        onPress?.();
        onPressStart?.();
      }}
      onPointerUp={() => onPressEnd?.()}
      onPointerLeave={() => onPressEnd?.()}
      onPointerCancel={() => onPressEnd?.()}
      className={`select-none flex flex-col items-center justify-center gap-0.5 active:scale-90 transition-transform rounded-2xl border border-white/10 backdrop-blur-md ${
        accent ? "text-primary-foreground" : "text-foreground/90"
      } ${wide ? "h-11 w-full flex-row gap-2" : big ? "h-20 w-20" : "h-14"}`}
      style={{
        touchAction: "none",
        background: accent
          ? "linear-gradient(140deg, var(--accent), var(--primary))"
          : "linear-gradient(160deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))",
        boxShadow: accent
          ? "0 10px 28px -8px var(--accent), inset 0 1px 0 rgba(255,255,255,0.45)"
          : "inset 0 1px 0 rgba(255,255,255,0.08), inset 0 0 0 1px rgba(255,214,10,0.06), 0 6px 18px -10px rgba(0,0,0,0.6)",
      }}
    >
      {children}
      {label && (
        <span className="text-[9px] tracking-[0.2em] text-foreground/70 font-semibold">
          {label}
        </span>
      )}
    </button>
  );
}

function Overlay({
  phase, stats, score, lines, time, onStart, onResume, onAbout, onSettings, onHome,
}: {
  phase: Phase;
  stats: Stats;
  score: number;
  lines: number;
  time: number;
  onStart: () => void;
  onResume: () => void;
  onAbout: () => void;
  onSettings: () => void;
  onHome: () => void;
}) {
  return (
    <div
      className={`absolute inset-0 flex flex-col items-center justify-center p-6 text-center ${phase === "menu" ? "hetris-starfield" : ""}`}
      style={
        phase === "menu"
          ? undefined
          : { backdropFilter: "blur(10px)", background: "rgba(3,6,15,0.82)" }
      }
    >
      {phase === "menu" && (
        <div className="flex flex-col items-center animate-in fade-in zoom-in-95 duration-700 w-full max-w-xs">
          <div className="mb-10 text-center">
            <h1
              className="text-6xl font-black tracking-[0.25em] leading-none"
              style={{
                background:
                  "linear-gradient(120deg, var(--piece-i), var(--accent), var(--piece-i))",
                backgroundSize: "200% 100%",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                animation: "hetris-shine 4s linear infinite",
                filter: "drop-shadow(0 0 24px rgba(120,200,255,0.45))",
              }}
            >
              HETRIS
            </h1>
            <p className="mt-3 text-[10px] tracking-[0.5em] text-foreground/60">
              BY HAIDER
            </p>
          </div>

          <button
            onClick={onStart}
            className="group relative w-full px-8 py-4 rounded-2xl font-bold tracking-[0.3em] text-primary-foreground overflow-hidden"
            style={{
              background:
                "linear-gradient(120deg, var(--piece-i), var(--accent))",
              boxShadow:
                "0 10px 40px -10px var(--piece-i), inset 0 1px 0 rgba(255,255,255,0.4)",
            }}
          >
            <span className="relative z-10 flex items-center justify-center gap-3">
              <PlayIcon /> PLAY
            </span>
          </button>

          <div className="mt-3 grid grid-cols-2 gap-2 w-full">
            <button
              onClick={onSettings}
              className="flex items-center justify-center gap-2 py-3 rounded-xl border border-white/10 bg-white/[0.04] text-foreground/80 text-xs tracking-[0.25em] backdrop-blur-md active:scale-95 transition"
            >
              <GearIcon /> SETTINGS
            </button>
            <button
              onClick={onAbout}
              className="flex items-center justify-center gap-2 py-3 rounded-xl border border-white/10 bg-white/[0.04] text-foreground/80 text-xs tracking-[0.25em] backdrop-blur-md active:scale-95 transition"
            >
              <InfoIcon /> ABOUT
            </button>
          </div>

          <div className="mt-10 w-full rounded-2xl border border-white/10 bg-black/30 backdrop-blur-md p-4">
            <p className="text-[9px] tracking-[0.4em] text-foreground/50 mb-3">
              PERSONAL BEST
            </p>
            <div className="grid grid-cols-3 gap-2 text-center">
              <BestStat label="SCORE" value={stats.bestScore} />
              <BestStat label="LINES" value={stats.bestLines} />
              <BestStat label="GAMES" value={stats.gamesPlayed} />
            </div>
          </div>
        </div>
      )}

      {phase === "paused" && (
        <div className="flex flex-col items-center animate-in fade-in zoom-in-95">
          <PauseIcon size={48} />
          <h2 className="mt-3 text-3xl font-black tracking-[0.3em]">PAUSED</h2>
          <div className="mt-8 flex flex-col gap-2 w-56">
            <button
              onClick={onResume}
              className="py-3 rounded-xl bg-primary text-primary-foreground font-bold tracking-[0.25em] flex items-center justify-center gap-2 active:scale-95 transition"
              style={{ boxShadow: "0 8px 30px -8px var(--piece-i)" }}
            >
              <PlayIcon /> RESUME
            </button>
            <button
              onClick={onStart}
              className="py-3 rounded-xl border border-white/10 bg-white/[0.04] text-foreground text-xs tracking-[0.3em] active:scale-95 transition"
            >
              RESTART
            </button>
            <button
              onClick={onHome}
              className="py-3 rounded-xl border border-white/10 bg-white/[0.04] text-foreground/80 text-xs tracking-[0.3em] flex items-center justify-center gap-2 active:scale-95 transition"
            >
              <HomeIcon /> MAIN MENU
            </button>
          </div>
        </div>
      )}

      {phase === "over" && (
        <div className="flex flex-col items-center animate-in fade-in zoom-in-95">
          <h2 className="text-3xl font-black tracking-[0.3em]">GAME OVER</h2>
          <p
            className="mt-2 text-[10px] tracking-[0.4em]"
            style={{ color: score >= stats.bestScore && score > 0 ? "var(--accent)" : "var(--muted-foreground)" }}
          >
            {score >= stats.bestScore && score > 0 ? "★ NEW PERSONAL BEST ★" : "RUN COMPLETE"}
          </p>
          <div className="grid grid-cols-3 gap-3 mt-6 mb-6 text-xs">
            <Result label="SCORE" value={score} />
            <Result label="LINES" value={lines} />
            <Result label="TIME" value={`${Math.floor(time / 60)}:${String(time % 60).padStart(2, "0")}`} />
          </div>
          <div className="flex flex-col gap-2 w-56">
            <button
              onClick={onStart}
              className="py-3 rounded-xl bg-primary text-primary-foreground font-bold tracking-[0.25em] flex items-center justify-center gap-2 active:scale-95 transition"
              style={{ boxShadow: "0 8px 30px -8px var(--piece-i)" }}
            >
              <RotateIcon /> PLAY AGAIN
            </button>
            <button
              onClick={onHome}
              className="py-3 rounded-xl border border-white/10 bg-white/[0.04] text-foreground/80 text-xs tracking-[0.3em] flex items-center justify-center gap-2 active:scale-95 transition"
            >
              <HomeIcon /> MAIN MENU
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Result({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex flex-col items-center px-3 py-2 rounded-lg border border-border bg-card/60">
      <span className="text-[9px] tracking-widest text-muted-foreground">{label}</span>
      <span className="text-base font-bold tabular-nums">{value}</span>
    </div>
  );
}

function SettingsPanel({
  settings, setSettings, onClose, stats,
}: {
  settings: Settings;
  setSettings: (s: Settings) => void;
  onClose: () => void;
  stats: Stats;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-background/80 backdrop-blur-sm p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-2xl border border-border bg-card p-5 space_y-4 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold tracking-wider">SETTINGS</h3>
          <button onClick={onClose} className="text-muted-foreground">✕</button>
        </div>

        <Row label="Ghost piece">
          <Toggle on={settings.ghost} onChange={(v) => setSettings({ ...settings, ghost: v })} />
        </Row>
        <Row label="Sound">
          <Toggle on={settings.sound} onChange={(v) => setSettings({ ...settings, sound: v })} />
        </Row>
        <Row label="Music">
          <Toggle on={settings.music} onChange={(v) => setSettings({ ...settings, music: v })} />
        </Row>
        <Row label="Controls">
          <div className="flex gap-1">
            {(["buttons", "swipe", "both"] as ControlMode[]).map((m) => (
              <button key={m} onClick={() => setSettings({ ...settings, control: m })}
                className={`px-2 py-1 text-xs rounded-md border ${settings.control === m ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground"}`}>
                {m}
              </button>
            ))}
          </div>
        </Row>
        <Row label={`Swipe sensitivity (${settings.swipeSensitivity}px)`}>
          <input type="range" min={12} max={48} step={2} value={settings.swipeSensitivity}
            onChange={(e) => setSettings({ ...settings, swipeSensitivity: Number(e.target.value) })}
            className="w-32 accent-primary" />
        </Row>

        <div className="pt-3 border-t border-border text-xs text-muted-foreground space-y-1">
          <div className="flex justify-between"><span>Best score</span><span className="text-foreground tabular-nums">{stats.bestScore}</span></div>
          <div className="flex justify-between"><span>Best lines</span><span className="text-foreground tabular-nums">{stats.bestLines}</span></div>
          <div className="flex justify-between"><span>Best time</span><span className="text-foreground tabular-nums">{Math.floor(stats.bestTimeSec / 60)}:{String(stats.bestTimeSec % 60).padStart(2, "0")}</span></div>
          <div className="flex justify-between"><span>Games played</span><span className="text-foreground tabular-nums">{stats.gamesPlayed}</span></div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm">{label}</span>
      {children}
    </div>
  );
}
function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!on)} className={`w-11 h-6 rounded-full transition ${on ? "bg-primary" : "bg-muted"} relative`}>
      <span className={`absolute top-0.5 ${on ? "left-5" : "left-0.5"} w-5 h-5 rounded-full bg-background transition-all`} />
    </button>
  );
}

function AboutPanel({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm p-6"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border border-border bg-card p-6 text-center space-y-4"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold tracking-[0.3em]">ABOUT</h3>
          <button onClick={onClose} className="text-muted-foreground">✕</button>
        </div>
        <h1
          className="text-4xl font-black tracking-[0.3em]"
          style={{
            background: "linear-gradient(90deg, var(--piece-i), var(--accent))",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          HETRIS
        </h1>
        <p className="text-xs tracking-[0.25em] text-muted-foreground">
          A FALLING BLOCK PUZZLE
        </p>
        <div className="pt-4 border-t border-border">
          <p className="text-[10px] tracking-[0.4em] text-muted-foreground/70 mb-2">
            DEVELOPED BY
          </p>
          <p
            className="text-3xl font-bold tracking-[0.25em]"
            style={{ color: "#f5c518", textShadow: "0 0 18px rgba(245,197,24,0.35)" }}
          >
            HAIDER
          </p>
        </div>
        <p className="text-[10px] text-muted-foreground/60 pt-2">
          Offline · Ad-free · Pure skill
        </p>
      </div>
    </div>
  );
}

/* ---------- HUD pieces ---------- */

function IconBtn({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="w-9 h-9 grid place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-foreground/80 backdrop-blur-md active:scale-90 active:text-foreground transition"
    >
      {children}
    </button>
  );
}

function FloatingBox({
  label,
  piece,
  small,
}: {
  label?: string;
  piece: PieceKey | null;
  small?: boolean;
}) {
  const cell = small ? 7 : 10;
  return (
    <div className="flex flex-col items-start gap-1">
      {label && (
        <span className="text-[9px] tracking-[0.25em] text-foreground/60">
          {label}
        </span>
      )}
      <div
        className="rounded-lg border border-white/10 bg-black/40 backdrop-blur-md p-1.5"
        style={{ width: cell * 5, height: cell * 3 }}
      >
        {piece && <MiniPiece p={piece} size={cell} />}
      </div>
    </div>
  );
}

function BestStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col items-center">
      <span className="text-base font-bold tabular-nums">{value}</span>
      <span className="text-[8px] tracking-[0.2em] text-foreground/50">
        {label}
      </span>
    </div>
  );
}

function TipsOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      className="absolute inset-0 z-20 flex items-center justify-center bg-black/70 backdrop-blur-md p-6 animate-in fade-in"
    >
      <div className="w-full max-w-xs rounded-2xl border border-white/10 bg-card/80 p-5 text-center">
        <p className="text-[10px] tracking-[0.4em] text-foreground/60 mb-3">
          TOUCH CONTROLS
        </p>
        <h3 className="text-lg font-black tracking-[0.25em] mb-5">HOW TO PLAY</h3>
        <ul className="space-y-3 text-left text-xs">
          <Tip icon={<ChevronIcon dir="left" />}>
            <b>Swipe left / right</b> — move piece
          </Tip>
          <Tip icon={<RotateIcon />}>
            <b>Tap</b> — rotate piece
          </Tip>
          <Tip icon={<SoftDropIcon />}>
            <b>Swipe down</b> — soft drop
          </Tip>
          <Tip icon={<DropIcon />}>
            <b>Fast swipe down</b> — hard drop
          </Tip>
          <Tip icon={<SwapIcon />}>
            <b>HOLD</b> — stash a piece for later
          </Tip>
        </ul>
        <button className="mt-6 w-full py-2.5 rounded-xl bg-primary text-primary-foreground text-xs font-bold tracking-[0.3em] active:scale-95 transition">
          GOT IT
        </button>
      </div>
    </div>
  );
}

function Tip({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-3">
      <span className="w-8 h-8 grid place-items-center rounded-lg border border-white/10 bg-white/[0.04] text-primary shrink-0">
        {icon}
      </span>
      <span className="text-foreground/85">{children}</span>
    </li>
  );
}

/* ---------- Inline SVG icons ---------- */

const Svg = ({
  size = 18,
  children,
}: {
  size?: number;
  children: React.ReactNode;
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {children}
  </svg>
);

const HomeIcon = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M3 11l9-8 9 8" />
    <path d="M5 10v10h14V10" />
    <path d="M10 20v-6h4v6" />
  </Svg>
);
const GearIcon = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </Svg>
);
const PauseIcon = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <rect x="6" y="5" width="4" height="14" rx="1" />
    <rect x="14" y="5" width="4" height="14" rx="1" />
  </Svg>
);
const PlayIcon = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M6 4l14 8-14 8V4z" fill="currentColor" stroke="none" />
  </Svg>
);
const InfoIcon = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 16v-5" />
    <circle cx="12" cy="8" r="0.6" fill="currentColor" />
  </Svg>
);
const ChevronIcon = ({ dir, size }: { dir: "left" | "right"; size?: number }) => (
  <Svg size={size ?? 22}>
    {dir === "left" ? (
      <path d="M15 6l-6 6 6 6" />
    ) : (
      <path d="M9 6l6 6-6 6" />
    )}
  </Svg>
);
const RotateIcon = ({ size }: { size?: number }) => (
  <Svg size={size ?? 22}>
    <path d="M21 12a9 9 0 1 1-3.2-6.9" />
    <path d="M21 4v5h-5" />
  </Svg>
);
const DropIcon = ({ size }: { size?: number }) => (
  <Svg size={size ?? 20}>
    <path d="M12 3v12" />
    <path d="M7 10l5 5 5-5" />
    <path d="M5 20h14" />
  </Svg>
);
const SoftDropIcon = ({ size }: { size?: number }) => (
  <Svg size={size ?? 18}>
    <path d="M12 4v14" />
    <path d="M7 13l5 5 5-5" />
  </Svg>
);
const SwapIcon = ({ size }: { size?: number }) => (
  <Svg size={size ?? 18}>
    <path d="M7 7h11l-3-3" />
    <path d="M17 17H6l3 3" />
  </Svg>
);

/* ---------- First-launch control picker ---------- */

function ControlPicker({ onPick }: { onPick: (mode: ControlMode) => void }) {
  const options: { mode: ControlMode; title: string; desc: string; icon: React.ReactNode }[] = [
    {
      mode: "swipe",
      title: "SWIPE",
      desc: "Swipe to move, tap to rotate, flick down to drop",
      icon: <SoftDropIcon size={28} />,
    },
    {
      mode: "buttons",
      title: "BUTTONS",
      desc: "Classic on-screen D-pad and action buttons",
      icon: <RotateIcon size={28} />,
    },
    {
      mode: "both",
      title: "HYBRID",
      desc: "Swipe gestures and on-screen buttons together",
      icon: <DropIcon size={28} />,
    },
  ];
  return (
    <div className="fixed inset-0 z-[55] flex flex-col items-center justify-center px-6 hetris-starfield">
      <div className="w-full max-w-sm text-center animate-in fade-in zoom-in-95 duration-500">
        <p className="text-[10px] tracking-[0.5em] text-foreground/60 mb-2">
          WELCOME TO
        </p>
        <h1
          className="text-5xl font-black tracking-[0.3em] mb-6"
          style={{
            background: "linear-gradient(120deg, #ffd60a, #ffc300, #ffea00)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            filter: "drop-shadow(0 0 28px rgba(255,214,10,0.45))",
          }}
        >
          HETRIS
        </h1>
        <p className="text-[11px] tracking-[0.3em] text-foreground/70 mb-6">
          CHOOSE YOUR CONTROLS
        </p>
        <div className="flex flex-col gap-3">
          {options.map((o) => (
            <button
              key={o.mode}
              onClick={() => onPick(o.mode)}
              className="w-full flex items-center gap-4 p-4 rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-md text-left active:scale-[0.98] transition"
              style={{
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08), 0 10px 30px -12px rgba(255,214,10,0.25)",
              }}
            >
              <span
                className="w-12 h-12 grid place-items-center rounded-xl shrink-0 text-primary-foreground"
                style={{ background: "linear-gradient(140deg, var(--accent), var(--primary))" }}
              >
                {o.icon}
              </span>
              <span className="flex flex-col">
                <span className="text-sm font-black tracking-[0.3em]">{o.title}</span>
                <span className="text-[11px] text-foreground/60 mt-0.5">{o.desc}</span>
              </span>
            </button>
          ))}
        </div>
        <p className="text-[10px] text-foreground/40 mt-6 tracking-[0.2em]">
          You can change this anytime in Settings.
        </p>
      </div>
    </div>
  );
}