const MAX_SCRIPT_LINES = 200;

function parseMove(tokens, lineNumber) {
  if (tokens.length !== 2) {
    throw new Error(`line ${lineNumber}: MOVE must be written as \"MOVE <1-3>\"`);
  }

  const steps = Number.parseInt(tokens[1], 10);
  if (Number.isNaN(steps) || steps < 1 || steps > 3) {
    throw new Error(`line ${lineNumber}: MOVE steps must be an integer between 1 and 3`);
  }

  return { type: "MOVE", steps };
}

function parseRotate(tokens, lineNumber) {
  if (tokens.length !== 2) {
    throw new Error(`line ${lineNumber}: ROTATE must be written as \"ROTATE LEFT|RIGHT|NONE\"`);
  }

  const direction = tokens[1].toUpperCase();
  if (!["LEFT", "RIGHT", "NONE", "0"].includes(direction)) {
    throw new Error(`line ${lineNumber}: ROTATE direction must be LEFT, RIGHT, NONE, or 0`);
  }

  return {
    type: "ROTATE",
    direction: direction === "0" ? "NONE" : direction,
  };
}

function parsePrimitive(tokens, lineNumber) {
  const command = tokens[0].toUpperCase();

  switch (command) {
    case "MOVE":
      return parseMove(tokens, lineNumber);
    case "ROTATE":
      return parseRotate(tokens, lineNumber);
    case "SHOOT":
      if (tokens.length !== 1) {
        throw new Error(`line ${lineNumber}: SHOOT does not take arguments`);
      }
      return { type: "SHOOT" };
    case "WAIT":
      if (tokens.length !== 1) {
        throw new Error(`line ${lineNumber}: WAIT does not take arguments`);
      }
      return { type: "WAIT" };
    default:
      throw new Error(`line ${lineNumber}: unsupported command \"${tokens[0]}\"`);
  }
}

function parseConditional(tokens, lineNumber) {
  if (tokens.length < 2) {
    throw new Error(
      `line ${lineNumber}: ${tokens[0]} must be written as \"${tokens[0]} <MOVE|ROTATE|SHOOT|WAIT ...>\"`
    );
  }

  const condition = tokens[0].toUpperCase() === "IF_SEEN" ? "SEEN" : "NOT_SEEN";
  const nestedTokens = tokens.slice(1);
  const nestedCommand = nestedTokens[0].toUpperCase();

  if (["IF_SEEN", "IF_NOT_SEEN"].includes(nestedCommand)) {
    throw new Error(`line ${lineNumber}: nested IF statements are not supported`);
  }

  const thenAction = parsePrimitive(nestedTokens, lineNumber);

  return {
    type: "IF",
    condition,
    then: thenAction,
  };
}

function parseSingleLine(rawLine, lineNumber) {
  const trimmed = rawLine.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }

  const tokens = trimmed.split(/\s+/);
  const command = tokens[0].toUpperCase();

  if (command === "IF_SEEN" || command === "IF_NOT_SEEN") {
    return parseConditional(tokens, lineNumber);
  }

  return parsePrimitive(tokens, lineNumber);
}

function parseRobotScript(scriptText) {
  if (typeof scriptText !== "string" || !scriptText.trim()) {
    throw new Error("script is empty");
  }

  const lines = scriptText.split(/\r?\n/);
  if (lines.length > MAX_SCRIPT_LINES) {
    throw new Error(`script is too long; maximum ${MAX_SCRIPT_LINES} lines`);
  }

  const actions = [];
  lines.forEach((line, index) => {
    const parsed = parseSingleLine(line, index + 1);
    if (parsed) {
      actions.push(parsed);
    }
  });

  if (!actions.length) {
    throw new Error("script has no executable commands");
  }

  return actions;
}

module.exports = {
  parseRobotScript,
};
