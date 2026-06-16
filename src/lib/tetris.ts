// Neon Stack — pure game logic (no React).

export const COLS = 10;
export const ROWS = 20;

export type PieceKey = "I" | "O" | "T" | "S" | "Z" | "J" | "L";

// Each piece is a list of rotation states; each state is an array of [x,y] cells
// within a local bounding box. We use SRS-ish layouts with simple wall kicks.
const SHAPES: Record<PieceKey, number[][][]> = {
  I: [
    [[0, 1], [1, 1], [2, 1], [3, 1]],
    [[2, 0], [2, 1], [2, 2], [2, 3]],
    [[0, 2], [1, 2], [2, 2], [3, 2]],
    [[1, 0], [1, 1], [1, 2], [1, 3]],
  ],
  O: [
    [[1, 0], [2, 0], [1, 1], [2, 1]],
    [[1, 0], [2, 0], [1, 1], [2, 1]],
    [[1, 0], [2, 0], [1, 1], [2, 1]],
    [[1, 0], [2, 0], [1, 1], [2, 1]],
  ],
  T: [
    [[1, 0], [0, 1], [1, 1], [2, 1]],
    [[1, 0], [1, 1], [2, 1], [1, 2]],
    [[0, 1], [1, 1], [2, 1], [1, 2]],
    [[1, 0], [0, 1], [1, 1], [1, 2]],
  ],
  S: [
    [[1, 0], [2, 0], [0, 1], [1, 1]],
    [[1, 0], [1, 1], [2, 1], [2, 2]],
    [[1, 1], [2, 1], [0, 2], [1, 2]],
    [[0, 0], [0, 1], [1, 1], [1, 2]],
  ],
  Z: [
    [[0, 0], [1, 0], [1, 1], [2, 1]],
    [[2, 0], [1, 1], [2, 1], [1, 2]],
    [[0, 1], [1, 1], [1, 2], [2, 2]],
    [[1, 0], [0, 1], [1, 1], [0, 2]],
  ],
  J: [
    [[0, 0], [0, 1], [1, 1], [2, 1]],
    [[1, 0], [2, 0], [1, 1], [1, 2]],
    [[0, 1], [1, 1], [2, 1], [2, 2]],
    [[1, 0], [1, 1], [0, 2], [1, 2]],
  ],
  L: [
    [[2, 0], [0, 1], [1, 1], [2, 1]],
    [[1, 0], [1, 1], [1, 2], [2, 2]],
    [[0, 1], [1, 1], [2, 1], [0, 2]],
    [[0, 0], [1, 0], [1, 1], [1, 2]],
  ],
};

export const PIECE_COLORS: Record<PieceKey, string> = {
  I: "var(--piece-i)",
  O: "var(--piece-o)",
  T: "var(--piece-t)",
  S: "var(--piece-s)",
  Z: "var(--piece-z)",
  J: "var(--piece-j)",
  L: "var(--piece-l)",
};

export type Cell = PieceKey | null;
export type Board = Cell[][]; // [row][col]

export interface Piece {
  key: PieceKey;
  rot: number; // 0..3
  x: number; // top-left of bounding box
  y: number;
}

export function emptyBoard(): Board {
  return Array.from({ length: ROWS }, () => Array<Cell>(COLS).fill(null));
}

export function pieceCells(p: Piece): [number, number][] {
  return SHAPES[p.key][p.rot].map(([dx, dy]) => [p.x + dx, p.y + dy]);
}

export function collides(board: Board, p: Piece): boolean {
  for (const [x, y] of pieceCells(p)) {
    if (x < 0 || x >= COLS || y >= ROWS) return true;
    if (y >= 0 && board[y][x]) return true;
  }
  return false;
}

export function merge(board: Board, p: Piece): Board {
  const b = board.map((r) => r.slice());
  for (const [x, y] of pieceCells(p)) {
    if (y >= 0 && y < ROWS && x >= 0 && x < COLS) b[y][x] = p.key;
  }
  return b;
}

export function clearLines(board: Board): { board: Board; cleared: number; rows: number[] } {
  const rows: number[] = [];
  for (let y = 0; y < ROWS; y++) {
    if (board[y].every((c) => c !== null)) rows.push(y);
  }
  if (rows.length === 0) return { board, cleared: 0, rows };
  const kept = board.filter((_, y) => !rows.includes(y));
  while (kept.length < ROWS) kept.unshift(Array<Cell>(COLS).fill(null));
  return { board: kept, cleared: rows.length, rows };
}

// 7-bag randomizer
export class Bag {
  private queue: PieceKey[] = [];
  next(): PieceKey {
    if (this.queue.length === 0) this.refill();
    return this.queue.shift()!;
  }
  peek(n: number): PieceKey[] {
    while (this.queue.length < n) this.refill();
    return this.queue.slice(0, n);
  }
  private refill() {
    const set: PieceKey[] = ["I", "O", "T", "S", "Z", "J", "L"];
    for (let i = set.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [set[i], set[j]] = [set[j], set[i]];
    }
    this.queue.push(...set);
  }
}

export function spawn(key: PieceKey): Piece {
  // bounding box width 4; center it (col 3 for most)
  return { key, rot: 0, x: key === "O" ? 3 : 3, y: -1 };
}

// Wall kicks: try offsets if rotated state collides.
const KICKS = [
  [0, 0],
  [-1, 0],
  [1, 0],
  [-2, 0],
  [2, 0],
  [0, -1],
  [-1, -1],
  [1, -1],
];

export function tryRotate(board: Board, p: Piece, dir: 1 | -1): Piece | null {
  const rot = (p.rot + (dir === 1 ? 1 : 3)) % 4;
  for (const [dx, dy] of KICKS) {
    const cand: Piece = { ...p, rot, x: p.x + dx, y: p.y + dy };
    if (!collides(board, cand)) return cand;
  }
  return null;
}

export function tryMove(board: Board, p: Piece, dx: number, dy: number): Piece | null {
  const cand: Piece = { ...p, x: p.x + dx, y: p.y + dy };
  if (collides(board, cand)) return null;
  return cand;
}

export function hardDropDistance(board: Board, p: Piece): number {
  let d = 0;
  while (!collides(board, { ...p, y: p.y + d + 1 })) d++;
  return d;
}

// Speed curve: ms per gravity step. Level 1 ~ 800ms, level 20 ~ 50ms.
export function gravityMs(level: number): number {
  const base = 800;
  const ms = base * Math.pow(0.82, level - 1);
  return Math.max(50, ms);
}

export function levelFromLines(lines: number): number {
  return Math.floor(lines / 10) + 1;
}

export function lineScore(cleared: number, level: number, combo: number): number {
  const base = [0, 100, 300, 500, 800][cleared] ?? 0;
  const comboBonus = combo > 1 ? 50 * (combo - 1) : 0;
  return base * level + comboBonus;
}