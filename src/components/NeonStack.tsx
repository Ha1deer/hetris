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
type Phase = "intro" | "menu" | "playing" | "paused" | "over" | "about";

interface Settings {
  ghost: boolean;
  sound: boolean;
  music: boolean;
  control: ControlMode;
  swipeSensitivity: number; // px per cell
}

const DEFAULT_SETTINGS: Settings = {
  ghost: true,
  sound: true,
  music: true,
  control: "both",
  swipeSensitivity: 24,
};

const HS_KEY = "neonstack:highscore";
const STATS_KEY = "neonstack:stats";
const SET_KEY = "neonstack:settings";

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
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [stats, setStats] = useState<Stats>(loadStats);
  const [showSettings, setShowSettings] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const musicRef = useRef<HTMLAudioElement | null>(null);

  // Auto-dismiss intro after 3.2s
  useEffect(() => {
    if (phase !== "intro") return;
    const t = setTimeout(() => setPhase("menu"), 3200);
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
      if (settingsRef.current.sound) beep(cleared >= 4 ? 880 : 660, 0.12, "triangle", 0.08);
    } else {
      comboRef.current = -1;
      setCombo(0);
    }
    spawnNext();
  }, [spawnNext]);

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
    return () => window.removeEventListener("resize", resize);
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

    // background panel
    ctx.fillStyle = "rgba(255,255,255,0.02)";
    ctx.fillRect(ox, oy, boardW, boardH);

    // grid
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
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

    // border glow
    ctx.strokeStyle = "rgba(120, 200, 255, 0.35)";
    ctx.lineWidth = 2;
    ctx.strokeRect(ox - 1, oy - 1, boardW + 2, boardH + 2);

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

    // ghost + piece
    const p = pieceRef.current;
    if (p && phaseRef.current === "playing") {
      if (settingsRef.current.ghost) {
        const d = hardDropDistance(boardRef.current, p);
        for (const [x, y] of pieceCells({ ...p, y: p.y + d })) {
          if (y >= 0) drawCell(ctx, ox + x * cell, oy + y * cell, cell, p.key, { ghost: true });
        }
      }
      for (const [x, y] of pieceCells(p)) {
        if (y >= 0) drawCell(ctx, ox + x * cell, oy + y * cell, cell, p.key);
      }
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
          onClick={() => setPhase("menu")}
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

      {/* Top HUD */}
      <div className="flex items-center justify-between px-3 pt-3 pb-1 text-xs">
        <div className="flex gap-3">
          <Stat label="SCORE" value={score.toString()} />
          <Stat label="LINES" value={lines.toString()} />
          <Stat label="LVL" value={level.toString()} />
        </div>
        <div className="flex gap-3 items-center">
          <Stat label="TIME" value={mmss(elapsed)} />
          <button
            onClick={() => setShowSettings(true)}
            className="px-2 py-1 rounded-md border border-border text-muted-foreground hover:text-foreground"
            aria-label="Settings"
          >⚙</button>
          {phase === "playing" && (
            <button
              onClick={() => setPhase("paused")}
              className="px-2 py-1 rounded-md border border-border text-muted-foreground hover:text-foreground"
              aria-label="Pause"
            >⏸</button>
          )}
        </div>
      </div>

      {/* Side info: Hold + Next */}
      <div className="flex items-start justify-between px-3 py-1 gap-3 text-[10px] uppercase tracking-widest text-muted-foreground">
        <MiniBox label="Hold" piece={holdRef.current} />
        <div className="flex gap-1.5">
          <span className="text-muted-foreground self-center mr-1">Next</span>
          {nextRef.current.slice(0, 5).map((p, i) => (
            <MiniBox key={i} piece={p} small />
          ))}
        </div>
      </div>

      {/* Board */}
      <div ref={wrapRef} className="relative flex-1 mx-2 my-1 rounded-xl overflow-hidden">
        <canvas ref={canvasRef} className="absolute inset-0" />
        {phase !== "playing" && <Overlay phase={phase} stats={stats} score={score} lines={lines} time={elapsed}
          onStart={startGame} onResume={() => setPhase("playing")} onAbout={() => setShowAbout(true)} />}
      </div>

      {/* Control buttons */}
      {(settings.control === "buttons" || settings.control === "both") && (
        <div className="px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2">
          <div className="grid grid-cols-5 gap-2">
            <CtrlBtn onPress={hold} label="HOLD" />
            <CtrlBtn onPress={() => move(-1)} label="◀" big />
            <CtrlBtn onPress={() => rotate(1)} label="⟳" big />
            <CtrlBtn onPress={() => move(1)} label="▶" big />
            <CtrlBtn onPress={hardDrop} label="DROP" />
          </div>
          <div className="mt-2">
            <CtrlBtn
              onPressStart={() => { softDropRef.current = true; }}
              onPressEnd={() => { softDropRef.current = false; }}
              label="▼  SOFT DROP"
              wide
            />
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
  onPress, onPressStart, onPressEnd, label, big, wide,
}: {
  onPress?: () => void;
  onPressStart?: () => void;
  onPressEnd?: () => void;
  label: string;
  big?: boolean;
  wide?: boolean;
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
      className={`select-none active:scale-95 active:bg-secondary/80 transition rounded-xl border border-border bg-card/80 text-foreground font-semibold ${big ? "h-14 text-lg" : "h-12 text-sm"} ${wide ? "w-full" : ""}`}
      style={{ touchAction: "none", boxShadow: "inset 0 0 0 1px rgba(120,200,255,0.08), 0 0 12px rgba(120,200,255,0.05)" }}
    >
      {label}
    </button>
  );
}

function Overlay({
  phase, stats, score, lines, time, onStart, onResume, onAbout,
}: {
  phase: Phase;
  stats: Stats;
  score: number;
  lines: number;
  time: number;
  onStart: () => void;
  onResume: () => void;
  onAbout: () => void;
}) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center backdrop-blur-sm bg-background/70 p-4 text-center">
      {phase === "menu" && (
        <>
          <h1 className="text-5xl font-black tracking-[0.3em] mb-1" style={{
            background: "linear-gradient(90deg, var(--piece-i), var(--accent))",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
            textShadow: "0 0 24px rgba(120,200,255,0.3)",
          }}>HETRIS</h1>
          <p className="text-xs text-muted-foreground mb-1 tracking-widest">FALLING BLOCK PUZZLE</p>
          <p className="text-[10px] text-muted-foreground/70 mb-6 tracking-[0.25em]">BY HAIDER</p>
          <button onClick={onStart} className="px-8 py-3 rounded-xl bg-primary text-primary-foreground font-bold tracking-wider shadow-[0_0_24px_var(--piece-i)]">
            PLAY
          </button>
          <div className="mt-8 text-xs text-muted-foreground space-y-1">
            <div>Best: <span className="text-foreground tabular-nums">{stats.bestScore}</span></div>
            <div>Lines: <span className="text-foreground tabular-nums">{stats.bestLines}</span></div>
            <div>Games: <span className="text-foreground tabular-nums">{stats.gamesPlayed}</span></div>
          </div>
          <button
            onClick={onAbout}
            className="mt-6 text-[10px] tracking-[0.3em] text-muted-foreground/70 hover:text-foreground"
          >
            ABOUT
          </button>
        </>
      )}
      {phase === "paused" && (
        <>
          <h2 className="text-2xl font-bold tracking-widest mb-6">PAUSED</h2>
          <button onClick={onResume} className="px-6 py-3 rounded-xl bg-primary text-primary-foreground font-bold tracking-wider mb-2">RESUME</button>
          <button onClick={onStart} className="px-6 py-2 rounded-xl border border-border text-foreground text-sm">RESTART</button>
        </>
      )}
      {phase === "over" && (
        <>
          <h2 className="text-2xl font-bold tracking-widest mb-1">GAME OVER</h2>
          <p className="text-xs text-muted-foreground mb-4">
            {score >= stats.bestScore && score > 0 ? "NEW PERSONAL BEST" : "Run complete"}
          </p>
          <div className="grid grid-cols-3 gap-3 mb-6 text-xs">
            <Result label="SCORE" value={score} />
            <Result label="LINES" value={lines} />
            <Result label="TIME" value={`${Math.floor(time / 60)}:${String(time % 60).padStart(2, "0")}`} />
          </div>
          <button onClick={onStart} className="px-8 py-3 rounded-xl bg-primary text-primary-foreground font-bold tracking-wider shadow-[0_0_24px_var(--piece-i)]">
            PLAY AGAIN
          </button>
        </>
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