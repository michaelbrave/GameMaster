/**
 * Bounded dice expressions: `d6`, `2d6`, `2d6+1`, `1d20-2`.
 * Bounds are enforced so content cannot request unbounded rolls.
 */
export interface DiceExpr {
  count: number;
  sides: number;
  modifier: number;
}

const DICE_RE = /^(\d*)d(\d+)([+-]\d+)?$/;

export const MAX_DICE_COUNT = 10;
export const MAX_DICE_SIDES = 1000;
export const MAX_DICE_MODIFIER = 100;

export function parseDice(expr: string): DiceExpr | null {
  const match = DICE_RE.exec(expr.trim());
  if (!match) return null;
  const count =
    match[1] === "" || match[1] === undefined
      ? 1
      : Number.parseInt(match[1], 10);
  const sides = Number.parseInt(match[2], 10);
  const modifier = match[3] ? Number.parseInt(match[3], 10) : 0;
  if (!Number.isInteger(count) || count < 1 || count > MAX_DICE_COUNT)
    return null;
  if (!Number.isInteger(sides) || sides < 2 || sides > MAX_DICE_SIDES)
    return null;
  if (!Number.isInteger(modifier) || Math.abs(modifier) > MAX_DICE_MODIFIER)
    return null;
  return { count, sides, modifier };
}

export function minRoll(expr: DiceExpr): number {
  return expr.count + expr.modifier;
}

export function maxRoll(expr: DiceExpr): number {
  return expr.count * expr.sides + expr.modifier;
}

export interface DiceRollResult {
  total: number;
  rolls: number[];
}

export function rollDice(
  expr: DiceExpr,
  rng: { nextInt(boundInclusive: number): number },
): DiceRollResult {
  const rolls: number[] = [];
  for (let i = 0; i < expr.count; i += 1) {
    rolls.push(rng.nextInt(expr.sides));
  }
  const total = rolls.reduce((sum, die) => sum + die, 0) + expr.modifier;
  return { total, rolls };
}

export function formatDice(expr: DiceExpr): string {
  const mod =
    expr.modifier === 0
      ? ""
      : expr.modifier > 0
        ? `+${expr.modifier}`
        : `${expr.modifier}`;
  return `${expr.count}d${expr.sides}${mod}`;
}
