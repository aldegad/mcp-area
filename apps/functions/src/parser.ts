const MAX_SCRIPT_LINES = 200;

export type ControlField = "THROTTLE" | "STRAFE" | "TURN";
export type ComparisonOperator = ">" | ">=" | "<" | "<=" | "==" | "!=";
export type BoostDirection = "LEFT" | "RIGHT";

export type SensorVariable =
  | "ARENA_SIZE"
  | "SHOT_RANGE"
  | "SHOT_HIT_RADIUS"
  | "SELF_X"
  | "SELF_Y"
  | "SELF_HEADING"
  | "SELF_ENERGY"
  | "BOOST_COOLDOWN"
  | "TICKS_SINCE_ENEMY_SEEN"
  | "ENEMY_X"
  | "ENEMY_Y"
  | "ENEMY_HEADING"
  | "ENEMY_DX"
  | "ENEMY_DY"
  | "ENEMY_DISTANCE"
  | "ENEMY_FORWARD_DISTANCE"
  | "ENEMY_LATERAL_OFFSET"
  | "PREV_ENEMY_X"
  | "PREV_ENEMY_Y"
  | "PREV_ENEMY_HEADING"
  | "PREV_ENEMY_DX"
  | "PREV_ENEMY_DY"
  | "PREV_ENEMY_DISTANCE"
  | "ENEMY_DX_DELTA"
  | "ENEMY_DY_DELTA"
  | "ENEMY_DISTANCE_DELTA"
  | "WALL_AHEAD_DISTANCE"
  | "WALL_LEFT_DISTANCE"
  | "WALL_RIGHT_DISTANCE"
  | "WALL_BACK_DISTANCE"
  | "WALL_NEAREST_DISTANCE";

export interface SetControlCommand {
  type: "SET_CONTROL";
  field: ControlField;
  value: number;
}

export interface FireCommand {
  type: "FIRE";
  enabled: boolean;
}

export interface BoostCommand {
  type: "BOOST";
  direction: BoostDirection;
}

export type RuleCommand = SetControlCommand | FireCommand | BoostCommand;
export type PrimitiveAction = RuleCommand;

export interface VisibilityCondition {
  type: "VISIBILITY";
  visible: boolean;
}

export const EXPRESSION_FUNCTIONS = {
  ABS: 1,
  MIN: 2,
  MAX: 2,
  CLAMP: 3,
  ATAN2: 2,
  ANGLE_DIFF: 2,
  NORMALIZE_ANGLE: 1,
} as const;

export type ExpressionFunctionName = keyof typeof EXPRESSION_FUNCTIONS;
export type ExpressionBinaryOperator = "+" | "-" | "*" | "/";
export type ExpressionUnaryOperator = "+" | "-";

export interface NumberLiteralExpression {
  type: "NUMBER_LITERAL";
  value: number;
}

export interface SensorExpression {
  type: "SENSOR";
  variable: SensorVariable;
}

export interface UnaryExpression {
  type: "UNARY";
  operator: ExpressionUnaryOperator;
  operand: NumericExpression;
}

export interface BinaryExpression {
  type: "BINARY";
  operator: ExpressionBinaryOperator;
  left: NumericExpression;
  right: NumericExpression;
}

export interface FunctionExpression {
  type: "FUNCTION";
  name: ExpressionFunctionName;
  args: NumericExpression[];
}

export type NumericExpression =
  | NumberLiteralExpression
  | SensorExpression
  | UnaryExpression
  | BinaryExpression
  | FunctionExpression;

export interface CompareCondition {
  type: "COMPARE";
  left: NumericExpression;
  operator: ComparisonOperator;
  right: NumericExpression;
}

export interface LogicalCondition {
  type: "LOGICAL";
  operator: "AND" | "OR";
  left: RuleCondition;
  right: RuleCondition;
}

export interface NotCondition {
  type: "NOT";
  operand: RuleCondition;
}

export type RuleCondition = VisibilityCondition | CompareCondition | LogicalCondition | NotCondition;

export interface ScriptAction {
  type: "RULE";
  line: number;
  condition: RuleCondition | null;
  command: RuleCommand;
}

const SENSOR_VARIABLES: SensorVariable[] = [
  "ARENA_SIZE",
  "SHOT_RANGE",
  "SHOT_HIT_RADIUS",
  "SELF_X",
  "SELF_Y",
  "SELF_HEADING",
  "SELF_ENERGY",
  "BOOST_COOLDOWN",
  "TICKS_SINCE_ENEMY_SEEN",
  "ENEMY_X",
  "ENEMY_Y",
  "ENEMY_HEADING",
  "ENEMY_DX",
  "ENEMY_DY",
  "ENEMY_DISTANCE",
  "ENEMY_FORWARD_DISTANCE",
  "ENEMY_LATERAL_OFFSET",
  "PREV_ENEMY_X",
  "PREV_ENEMY_Y",
  "PREV_ENEMY_HEADING",
  "PREV_ENEMY_DX",
  "PREV_ENEMY_DY",
  "PREV_ENEMY_DISTANCE",
  "ENEMY_DX_DELTA",
  "ENEMY_DY_DELTA",
  "ENEMY_DISTANCE_DELTA",
  "WALL_AHEAD_DISTANCE",
  "WALL_LEFT_DISTANCE",
  "WALL_RIGHT_DISTANCE",
  "WALL_BACK_DISTANCE",
  "WALL_NEAREST_DISTANCE",
];

function isSensorVariable(value: string): value is SensorVariable {
  return SENSOR_VARIABLES.includes(value as SensorVariable);
}

function parseNormalizedNumber(token: string, lineNumber: number, label: string): number {
  const value = Number.parseFloat(token);
  if (!Number.isFinite(value)) {
    throw new Error(`line ${lineNumber}: ${label} must be a finite number`);
  }

  return value;
}

function parseControlValue(token: string, lineNumber: number, field: ControlField): number {
  const value = parseNormalizedNumber(token, lineNumber, `${field} value`);
  if (value < -1 || value > 1) {
    throw new Error(`line ${lineNumber}: ${field} value must be between -1 and 1`);
  }

  return Number(value.toFixed(4));
}

function parseSetControl(tokens: string[], lineNumber: number): SetControlCommand {
  if (tokens.length !== 3) {
    throw new Error(`line ${lineNumber}: SET must be written as "SET THROTTLE|STRAFE|TURN <-1..1>"`);
  }

  const field = tokens[1].toUpperCase();
  if (field !== "THROTTLE" && field !== "STRAFE" && field !== "TURN") {
    throw new Error(`line ${lineNumber}: SET field must be THROTTLE, STRAFE, or TURN`);
  }

  return {
    type: "SET_CONTROL",
    field,
    value: parseControlValue(tokens[2], lineNumber, field),
  };
}

function parseFire(tokens: string[], lineNumber: number): FireCommand {
  if (tokens.length === 1) {
    return { type: "FIRE", enabled: true };
  }

  if (tokens.length !== 2) {
    throw new Error(`line ${lineNumber}: FIRE must be "FIRE" or "FIRE ON|OFF"`);
  }

  const mode = tokens[1].toUpperCase();
  if (["ON", "1", "TRUE"].includes(mode)) {
    return { type: "FIRE", enabled: true };
  }

  if (["OFF", "0", "FALSE"].includes(mode)) {
    return { type: "FIRE", enabled: false };
  }

  throw new Error(`line ${lineNumber}: FIRE mode must be ON or OFF`);
}

function parseBoost(tokens: string[], lineNumber: number): BoostCommand {
  if (tokens.length !== 2) {
    throw new Error(`line ${lineNumber}: BOOST must be written as "BOOST LEFT|RIGHT"`);
  }

  const direction = tokens[1].toUpperCase();
  if (direction !== "LEFT" && direction !== "RIGHT") {
    throw new Error(`line ${lineNumber}: BOOST direction must be LEFT or RIGHT`);
  }

  return {
    type: "BOOST",
    direction,
  };
}

function parseCommand(tokens: string[], lineNumber: number): RuleCommand {
  if (!tokens.length) {
    throw new Error(`line ${lineNumber}: command is missing`);
  }

  const command = tokens[0].toUpperCase();

  if (command === "SET") {
    return parseSetControl(tokens, lineNumber);
  }

  if (command === "FIRE" || command === "SHOOT") {
    return parseFire(tokens, lineNumber);
  }

  if (command === "BOOST") {
    return parseBoost(tokens, lineNumber);
  }

  throw new Error(`line ${lineNumber}: unsupported command "${tokens[0]}"`);
}

type ExpressionTokenType = "NUMBER" | "IDENTIFIER" | "SYMBOL" | "EOF";

interface ExpressionToken {
  type: ExpressionTokenType;
  value: string;
  index: number;
}

function tokenizeExpression(expressionText: string, lineNumber: number): ExpressionToken[] {
  const tokens: ExpressionToken[] = [];
  let index = 0;

  while (index < expressionText.length) {
    const char = expressionText[index];

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    const remaining = expressionText.slice(index);
    const numberMatch = remaining.match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/);
    if (numberMatch) {
      tokens.push({
        type: "NUMBER",
        value: numberMatch[0],
        index,
      });
      index += numberMatch[0].length;
      continue;
    }

    const identifierMatch = remaining.match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (identifierMatch) {
      tokens.push({
        type: "IDENTIFIER",
        value: identifierMatch[0],
        index,
      });
      index += identifierMatch[0].length;
      continue;
    }

    if ("()+-*/,".includes(char)) {
      tokens.push({
        type: "SYMBOL",
        value: char,
        index,
      });
      index += 1;
      continue;
    }

    throw new Error(`line ${lineNumber}: invalid character "${char}" in expression`);
  }

  tokens.push({
    type: "EOF",
    value: "",
    index: expressionText.length,
  });

  return tokens;
}

class ExpressionParser {
  private cursor = 0;

  constructor(
    private readonly tokens: ExpressionToken[],
    private readonly expressionText: string,
    private readonly lineNumber: number
  ) {}

  parse(): NumericExpression {
    const expression = this.parseAdditive();
    this.expectToken("EOF");
    return expression;
  }

  private currentToken(): ExpressionToken {
    return this.tokens[this.cursor];
  }

  private consumeToken(): ExpressionToken {
    const token = this.tokens[this.cursor];
    this.cursor += 1;
    return token;
  }

  private expectToken(type: ExpressionTokenType): ExpressionToken {
    const token = this.currentToken();
    if (token.type !== type) {
      throw new Error(`line ${this.lineNumber}: expression parse error near "${this.expressionText}"`);
    }

    return this.consumeToken();
  }

  private consumeSymbol(symbol: string): boolean {
    const token = this.currentToken();
    if (token.type !== "SYMBOL" || token.value !== symbol) {
      return false;
    }

    this.cursor += 1;
    return true;
  }

  private peekSymbol(symbol: string): boolean {
    const token = this.currentToken();
    return token.type === "SYMBOL" && token.value === symbol;
  }

  private expectSymbol(symbol: string): void {
    if (!this.consumeSymbol(symbol)) {
      throw new Error(`line ${this.lineNumber}: missing "${symbol}" in expression "${this.expressionText}"`);
    }
  }

  private parseAdditive(): NumericExpression {
    let left = this.parseMultiplicative();

    while (true) {
      if (this.consumeSymbol("+")) {
        left = {
          type: "BINARY",
          operator: "+",
          left,
          right: this.parseMultiplicative(),
        };
        continue;
      }

      if (this.consumeSymbol("-")) {
        left = {
          type: "BINARY",
          operator: "-",
          left,
          right: this.parseMultiplicative(),
        };
        continue;
      }

      return left;
    }
  }

  private parseMultiplicative(): NumericExpression {
    let left = this.parseUnary();

    while (true) {
      if (this.consumeSymbol("*")) {
        left = {
          type: "BINARY",
          operator: "*",
          left,
          right: this.parseUnary(),
        };
        continue;
      }

      if (this.consumeSymbol("/")) {
        left = {
          type: "BINARY",
          operator: "/",
          left,
          right: this.parseUnary(),
        };
        continue;
      }

      return left;
    }
  }

  private parseUnary(): NumericExpression {
    if (this.consumeSymbol("+")) {
      return {
        type: "UNARY",
        operator: "+",
        operand: this.parseUnary(),
      };
    }

    if (this.consumeSymbol("-")) {
      return {
        type: "UNARY",
        operator: "-",
        operand: this.parseUnary(),
      };
    }

    return this.parsePrimary();
  }

  private parseFunctionCall(functionName: string): FunctionExpression {
    if (!(functionName in EXPRESSION_FUNCTIONS)) {
      throw new Error(
        `line ${this.lineNumber}: unknown function "${functionName}". Allowed: ${Object.keys(EXPRESSION_FUNCTIONS).join(
          ", "
        )}`
      );
    }

    const args: NumericExpression[] = [];
    if (!this.peekSymbol(")")) {
      while (true) {
        args.push(this.parseAdditive());
        if (!this.consumeSymbol(",")) {
          break;
        }
      }
    }

    this.expectSymbol(")");

    const expectedArity = EXPRESSION_FUNCTIONS[functionName as ExpressionFunctionName];
    if (args.length !== expectedArity) {
      throw new Error(
        `line ${this.lineNumber}: ${functionName} expects ${expectedArity} argument(s), got ${args.length}`
      );
    }

    return {
      type: "FUNCTION",
      name: functionName as ExpressionFunctionName,
      args,
    };
  }

  private parsePrimary(): NumericExpression {
    const token = this.currentToken();

    if (token.type === "NUMBER") {
      this.consumeToken();
      return {
        type: "NUMBER_LITERAL",
        value: parseNormalizedNumber(token.value, this.lineNumber, "expression number"),
      };
    }

    if (token.type === "IDENTIFIER") {
      this.consumeToken();
      const normalized = token.value.toUpperCase();

      if (this.consumeSymbol("(")) {
        return this.parseFunctionCall(normalized);
      }

      if (isSensorVariable(normalized)) {
        return {
          type: "SENSOR",
          variable: normalized,
        };
      }

      if (normalized === "PI") {
        return {
          type: "NUMBER_LITERAL",
          value: Math.PI,
        };
      }

      if (normalized === "TAU") {
        return {
          type: "NUMBER_LITERAL",
          value: Math.PI * 2,
        };
      }

      throw new Error(
        `line ${this.lineNumber}: unknown identifier "${token.value}". Allowed sensors: ${SENSOR_VARIABLES.join(", ")}`
      );
    }

    if (this.consumeSymbol("(")) {
      const nested = this.parseAdditive();
      this.expectSymbol(")");
      return nested;
    }

    throw new Error(`line ${this.lineNumber}: invalid expression near "${this.expressionText}"`);
  }
}

function parseNumericExpression(expressionText: string, lineNumber: number): NumericExpression {
  const trimmed = expressionText.trim();
  if (!trimmed) {
    throw new Error(`line ${lineNumber}: expression is empty`);
  }

  const tokens = tokenizeExpression(trimmed, lineNumber);
  return new ExpressionParser(tokens, trimmed, lineNumber).parse();
}

function splitConditionComparison(
  conditionText: string,
  lineNumber: number
): { left: string; operator: ComparisonOperator; right: string } {
  const operators = [">=", "<=", "==", "!=", ">", "<", "="] as const;
  let depth = 0;
  let found:
    | {
        index: number;
        sourceOperator: (typeof operators)[number];
        operator: ComparisonOperator;
      }
    | null = null;

  for (let index = 0; index < conditionText.length; index += 1) {
    const char = conditionText[index];

    if (char === "(") {
      depth += 1;
      continue;
    }

    if (char === ")") {
      depth -= 1;
      if (depth < 0) {
        throw new Error(`line ${lineNumber}: IF condition has mismatched parentheses`);
      }
      continue;
    }

    if (depth !== 0) {
      continue;
    }

    const sourceOperator = operators.find((candidate) => conditionText.startsWith(candidate, index));
    if (!sourceOperator) {
      continue;
    }

    if (found) {
      throw new Error(`line ${lineNumber}: IF condition supports only one top-level comparator`);
    }

    found = {
      index,
      sourceOperator,
      operator: sourceOperator === "=" ? "==" : sourceOperator,
    };
    index += sourceOperator.length - 1;
  }

  if (depth !== 0) {
    throw new Error(`line ${lineNumber}: IF condition has mismatched parentheses`);
  }

  if (!found) {
    throw new Error(
      `line ${lineNumber}: invalid IF condition. Use ENEMY_VISIBLE, <EXPR> <OP> <EXPR>, and combine with AND/OR/NOT`
    );
  }

  const left = conditionText.slice(0, found.index).trim();
  const right = conditionText.slice(found.index + found.sourceOperator.length).trim();

  if (!left || !right) {
    throw new Error(`line ${lineNumber}: IF condition comparator requires both left and right expressions`);
  }

  return {
    left,
    operator: found.operator,
    right,
  };
}

function isIdentifierCharacter(char: string | undefined): boolean {
  if (!char) {
    return false;
  }

  return /[A-Z0-9_]/.test(char);
}

function matchesKeywordAt(textUpper: string, index: number, keyword: "AND" | "OR" | "NOT"): boolean {
  if (!textUpper.startsWith(keyword, index)) {
    return false;
  }

  const before = textUpper[index - 1];
  const after = textUpper[index + keyword.length];
  if (isIdentifierCharacter(before) || isIdentifierCharacter(after)) {
    return false;
  }

  return true;
}

function splitTopLevelByKeyword(
  conditionText: string,
  keyword: "AND" | "OR",
  lineNumber: number
): string[] | null {
  const source = conditionText.trim();
  const upper = source.toUpperCase();
  let depth = 0;
  let lastIndex = 0;
  const parts: string[] = [];
  let matched = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === "(") {
      depth += 1;
      continue;
    }

    if (char === ")") {
      depth -= 1;
      if (depth < 0) {
        throw new Error(`line ${lineNumber}: IF condition has mismatched parentheses`);
      }
      continue;
    }

    if (depth !== 0) {
      continue;
    }

    if (!matchesKeywordAt(upper, index, keyword)) {
      continue;
    }

    const segment = source.slice(lastIndex, index).trim();
    if (!segment) {
      throw new Error(`line ${lineNumber}: ${keyword} condition operand is missing`);
    }
    parts.push(segment);
    matched = true;
    index += keyword.length - 1;
    lastIndex = index + 1;
  }

  if (depth !== 0) {
    throw new Error(`line ${lineNumber}: IF condition has mismatched parentheses`);
  }

  if (!matched) {
    return null;
  }

  const tail = source.slice(lastIndex).trim();
  if (!tail) {
    throw new Error(`line ${lineNumber}: ${keyword} condition operand is missing`);
  }
  parts.push(tail);
  return parts;
}

function isWrappedByOuterParentheses(conditionText: string): boolean {
  const source = conditionText.trim();
  if (!source.startsWith("(") || !source.endsWith(")")) {
    return false;
  }

  let depth = 0;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0 && index < source.length - 1) {
        return false;
      }
    }
  }

  return depth === 0;
}

function stripOuterParentheses(conditionText: string): string {
  let value = conditionText.trim();
  while (isWrappedByOuterParentheses(value)) {
    value = value.slice(1, -1).trim();
  }

  return value;
}

function parseConditionNode(conditionText: string, lineNumber: number): RuleCondition {
  const stripped = stripOuterParentheses(conditionText);
  if (!stripped) {
    throw new Error(`line ${lineNumber}: IF condition is missing`);
  }

  const orParts = splitTopLevelByKeyword(stripped, "OR", lineNumber);
  if (orParts) {
    return orParts.slice(1).reduce<RuleCondition>(
      (left, part) => ({
        type: "LOGICAL",
        operator: "OR",
        left,
        right: parseConditionNode(part, lineNumber),
      }),
      parseConditionNode(orParts[0], lineNumber)
    );
  }

  const andParts = splitTopLevelByKeyword(stripped, "AND", lineNumber);
  if (andParts) {
    return andParts.slice(1).reduce<RuleCondition>(
      (left, part) => ({
        type: "LOGICAL",
        operator: "AND",
        left,
        right: parseConditionNode(part, lineNumber),
      }),
      parseConditionNode(andParts[0], lineNumber)
    );
  }

  const upper = stripped.toUpperCase();
  if (matchesKeywordAt(upper, 0, "NOT")) {
    const operandText = stripped.slice(3).trim();
    if (!operandText) {
      throw new Error(`line ${lineNumber}: NOT condition operand is missing`);
    }

    return {
      type: "NOT",
      operand: parseConditionNode(operandText, lineNumber),
    };
  }

  if (upper === "ENEMY_VISIBLE") {
    return {
      type: "VISIBILITY",
      visible: true,
    };
  }

  const comparison = splitConditionComparison(stripped, lineNumber);
  return {
    type: "COMPARE",
    left: parseNumericExpression(comparison.left, lineNumber),
    operator: comparison.operator,
    right: parseNumericExpression(comparison.right, lineNumber),
  };
}

function parseCondition(conditionText: string, lineNumber: number): RuleCondition {
  if (!conditionText.trim()) {
    throw new Error(`line ${lineNumber}: IF condition is missing`);
  }

  return parseConditionNode(conditionText, lineNumber);
}

function parseSingleLine(rawLine: string, lineNumber: number): ScriptAction | null {
  const trimmed = rawLine.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }

  const ifPrefixMatch = trimmed.match(/^IF\b/i);
  if (ifPrefixMatch) {
    const afterIf = trimmed.slice(ifPrefixMatch[0].length).trim();
    const thenMatch = /\bTHEN\b/i.exec(afterIf);

    if (!thenMatch) {
      throw new Error(`line ${lineNumber}: IF statement must include THEN`);
    }

    const conditionText = afterIf.slice(0, thenMatch.index).trim();
    const commandText = afterIf.slice(thenMatch.index + thenMatch[0].length).trim();

    if (!conditionText) {
      throw new Error(`line ${lineNumber}: IF condition is missing`);
    }

    const commandTokens = commandText.split(/\s+/).filter(Boolean);

    if (!commandTokens.length) {
      throw new Error(`line ${lineNumber}: IF ... THEN command is missing`);
    }

    return {
      type: "RULE",
      line: lineNumber,
      condition: parseCondition(conditionText, lineNumber),
      command: parseCommand(commandTokens, lineNumber),
    };
  }

  const tokens = trimmed.split(/\s+/);

  return {
    type: "RULE",
    line: lineNumber,
    condition: null,
    command: parseCommand(tokens, lineNumber),
  };
}

export function parseRobotScript(scriptText: string): ScriptAction[] {
  if (typeof scriptText !== "string" || !scriptText.trim()) {
    throw new Error("script is empty");
  }

  const lines = scriptText.split(/\r?\n/);
  if (lines.length > MAX_SCRIPT_LINES) {
    throw new Error(`script is too long; maximum ${MAX_SCRIPT_LINES} lines`);
  }

  const rules: ScriptAction[] = [];
  lines.forEach((line, index) => {
    const parsed = parseSingleLine(line, index + 1);
    if (parsed) {
      rules.push(parsed);
    }
  });

  if (!rules.length) {
    throw new Error("script has no executable commands");
  }

  return rules;
}
