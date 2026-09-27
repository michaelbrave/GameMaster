import { key, same, type Axial } from "./axial";
import {
  adjacent,
  gridSpaces,
  withinGrid,
  isDiamond,
  type GridType,
} from "./grid";

export interface BattleToken {
  id: string;
  label: string;
  kind: "character" | "enemy" | "object";
  position: Axial;
  allowance: number;
  spent: number;
}

export interface Battlefield {
  version: number;
  location: Axial;
  gridType: GridType;
  radius: number;
  feetPerStep: number;
  terrain: string;
  color: string;
  tokens: BattleToken[];
  obstacles: Axial[];
}

export interface Route {
  to: Axial;
  cost: number;
  path: Axial[];
}

export type BattleAction =
  | {
      type: "add";
      label: string;
      kind: BattleToken["kind"];
      at: Axial;
      allowance: number;
    }
  | { type: "remove"; tokenId: string }
  | { type: "move"; tokenId: string; to: Axial }
  | { type: "obstacle"; at: Axial }
  | { type: "reset" }
  | { type: "settings"; radius: number; feetPerStep: number };

export function occupied(board: Battlefield, at: Axial): boolean {
  return (
    board.obstacles.some((p) => same(p, at)) ||
    board.tokens.some((t) => same(t.position, at))
  );
}

/** Unweighted BFS: every edge costs one full step, including entering/leaving a diamond. */
export function routesFor(board: Battlefield, token: BattleToken): Route[] {
  if (token.kind === "object") return [];
  const spaces = gridSpaces(board.radius, board.gridType);
  // Prefer a corner stop when equal-cost diagonal routes exist.
  if (board.gridType === "square-diamond")
    spaces.sort((a, b) => Number(isDiamond(b)) - Number(isDiamond(a)));
  const blocked = new Set([
    ...board.obstacles.map(key),
    ...board.tokens
      .filter((t) => t.id !== token.id)
      .map((t) => key(t.position)),
  ]);
  const seen = new Set([key(token.position)]);
  const queue: Route[] = [
    { to: token.position, cost: 0, path: [token.position] },
  ];
  const budget = token.allowance - token.spent;
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i];
    if (current.cost >= budget) continue;
    for (const to of spaces) {
      if (
        seen.has(key(to)) ||
        blocked.has(key(to)) ||
        !adjacent(current.to, to, board.gridType)
      )
        continue;
      seen.add(key(to));
      queue.push({ to, cost: current.cost + 1, path: [...current.path, to] });
    }
  }
  return queue.slice(1);
}

function integer(value: unknown, min: number, max: number): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
  );
}

function requireSpace(board: Battlefield, at: Axial): void {
  if (!at || !withinGrid(at, board.radius, board.gridType))
    throw new Error("Choose a valid space inside the battlefield.");
}

/** Validate before changing anything; returns a new snapshot for atomic persistence. */
export function applyBattleAction(
  board: Battlefield,
  action: BattleAction,
  tokenId: string,
): Battlefield {
  if (!action || typeof action !== "object")
    throw new Error("A battlefield action is required.");
  const next = structuredClone(board);
  switch (action.type) {
    case "add":
      requireSpace(board, action.at);
      if (occupied(board, action.at))
        throw new Error("That space is occupied.");
      if (
        typeof action.label !== "string" ||
        !action.label.trim() ||
        action.label.trim().length > 40
      )
        throw new Error("Use a token label of 1–40 characters.");
      if (!["character", "enemy", "object"].includes(action.kind))
        throw new Error("Unknown token kind.");
      if (!integer(action.allowance, 1, 30))
        throw new Error("Movement allowance must be 1–30 steps.");
      if (board.tokens.length >= 50)
        throw new Error("This sandbox supports up to 50 tokens.");
      next.tokens.push({
        id: tokenId,
        label: action.label.trim(),
        kind: action.kind,
        position: action.at,
        allowance: action.allowance,
        spent: 0,
      });
      break;
    case "remove":
      if (!board.tokens.some((t) => t.id === action.tokenId))
        throw new Error("Select an existing token.");
      next.tokens = next.tokens.filter((t) => t.id !== action.tokenId);
      break;
    case "move": {
      requireSpace(board, action.to);
      const token = next.tokens.find((t) => t.id === action.tokenId);
      if (!token) throw new Error("Select an existing token.");
      const route = routesFor(board, token).find((r) => same(r.to, action.to));
      if (!route)
        throw new Error(
          "Destination is blocked or exceeds the remaining movement allowance.",
        );
      token.position = action.to;
      token.spent += route.cost;
      break;
    }
    case "obstacle":
      requireSpace(board, action.at);
      if (board.tokens.some((t) => same(t.position, action.at)))
        throw new Error("Remove the token before placing an obstacle.");
      next.obstacles = board.obstacles.some((p) => same(p, action.at))
        ? board.obstacles.filter((p) => !same(p, action.at))
        : [...board.obstacles, action.at];
      break;
    case "reset":
      next.tokens.forEach((t) => {
        t.spent = 0;
      });
      break;
    case "settings":
      if (!integer(action.radius, 2, 8) || !integer(action.feetPerStep, 1, 100))
        throw new Error(
          "Radius must be 2–8; step distance must be 1–100 feet.",
        );
      if (
        [...board.obstacles, ...board.tokens.map((t) => t.position)].some(
          (p) => !withinGrid(p, action.radius, board.gridType),
        )
      )
        throw new Error(
          "The smaller area would exclude tokens or obstacles. Move or remove them first.",
        );
      next.radius = action.radius;
      next.feetPerStep = action.feetPerStep;
      break;
    default:
      throw new Error("Unknown battlefield action.");
  }
  next.version++;
  return next;
}

export function battlefieldResponse(board: Battlefield) {
  return {
    ...board,
    routes: board.tokens.map((token) => ({
      tokenId: token.id,
      destinations: routesFor(board, token),
    })),
  };
}
