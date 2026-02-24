export interface MaxTicksInput {
  maxTicks?: number;
  maxTurns?: number;
}

export function resolveMaxTicks(input: MaxTicksInput, fallback = 500): number {
  const maxTicks = input.maxTicks;
  if (typeof maxTicks === "number" && Number.isInteger(maxTicks)) {
    return maxTicks;
  }

  const maxTurns = input.maxTurns;
  if (typeof maxTurns === "number" && Number.isInteger(maxTurns)) {
    return maxTurns;
  }

  return fallback;
}
