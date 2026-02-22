const DIRECTIONS = ["N", "E", "S", "W"];
const VISION_RADIUS = 5;

function rotateDirection(direction, rotation) {
  if (rotation === "NONE") {
    return direction;
  }

  const idx = DIRECTIONS.indexOf(direction);
  if (idx === -1) {
    throw new Error(`invalid direction: ${direction}`);
  }

  if (rotation === "LEFT") {
    return DIRECTIONS[(idx + 3) % 4];
  }

  if (rotation === "RIGHT") {
    return DIRECTIONS[(idx + 1) % 4];
  }

  throw new Error(`unsupported rotation: ${rotation}`);
}

function deltaByDirection(direction) {
  switch (direction) {
    case "N":
      return { dx: 0, dy: -1 };
    case "E":
      return { dx: 1, dy: 0 };
    case "S":
      return { dx: 0, dy: 1 };
    case "W":
      return { dx: -1, dy: 0 };
    default:
      throw new Error(`invalid direction: ${direction}`);
  }
}

function isInsideArena(position, arenaSize) {
  return position.x >= 0 && position.y >= 0 && position.x < arenaSize && position.y < arenaSize;
}

function hasLineOfSight(attacker, defender) {
  if (attacker.direction === "N") {
    return attacker.x === defender.x && defender.y < attacker.y;
  }

  if (attacker.direction === "S") {
    return attacker.x === defender.x && defender.y > attacker.y;
  }

  if (attacker.direction === "E") {
    return attacker.y === defender.y && defender.x > attacker.x;
  }

  if (attacker.direction === "W") {
    return attacker.y === defender.y && defender.x < attacker.x;
  }

  return false;
}

function getProjectileEndpoint(attacker, arenaSize, maxRange) {
  const { dx, dy } = deltaByDirection(attacker.direction);
  let x = attacker.x;
  let y = attacker.y;

  for (let step = 0; step < maxRange; step += 1) {
    const next = { x: x + dx, y: y + dy };
    if (!isInsideArena(next, arenaSize)) {
      break;
    }

    x = next.x;
    y = next.y;
  }

  return { x, y };
}

function toLocalCoordinates(direction, dx, dy) {
  if (direction === "N") {
    return { forward: -dy, lateral: dx };
  }

  if (direction === "S") {
    return { forward: dy, lateral: -dx };
  }

  if (direction === "E") {
    return { forward: dx, lateral: dy };
  }

  return { forward: -dx, lateral: -dy };
}

function distanceBand(distance) {
  if (distance <= 2) {
    return "near";
  }

  if (distance <= 4) {
    return "mid";
  }

  return "far";
}

function bearingByLateral(lateral) {
  if (Math.abs(lateral) <= 0.75) {
    return "FRONT";
  }

  return lateral > 0 ? "FRONT_RIGHT" : "FRONT_LEFT";
}

function buildPerception(actor, opponent) {
  const base = {
    range: VISION_RADIUS,
    enemyVisible: false,
    enemy: null,
  };

  if (!opponent.alive) {
    return base;
  }

  const dx = opponent.x - actor.x;
  const dy = opponent.y - actor.y;
  const distance = Math.sqrt(dx * dx + dy * dy);

  if (distance > VISION_RADIUS) {
    return base;
  }

  const { forward, lateral } = toLocalCoordinates(actor.direction, dx, dy);
  const inForwardHemisphere = forward >= 0;

  if (!inForwardHemisphere) {
    return base;
  }

  return {
    range: VISION_RADIUS,
    enemyVisible: true,
    enemy: {
      id: opponent.id,
      robotName: opponent.robotName,
      dx,
      dy,
      distance: Number(distance.toFixed(2)),
      distanceBand: distanceBand(distance),
      bearing: bearingByLateral(lateral),
      absolutePosition: {
        x: opponent.x,
        y: opponent.y,
      },
    },
  };
}

function snapshotRobot(robot) {
  return {
    id: robot.id,
    robotName: robot.robotName,
    x: robot.x,
    y: robot.y,
    direction: robot.direction,
    alive: robot.alive,
  };
}

function snapshotBattle(robotA, robotB) {
  return {
    robotA: snapshotRobot(robotA),
    robotB: snapshotRobot(robotB),
  };
}

function cloneAction(action) {
  return JSON.parse(JSON.stringify(action));
}

function resolveScriptAction(robot, perception) {
  const scriptAction = robot.program[robot.programPointer % robot.program.length];
  robot.programPointer += 1;

  if (scriptAction.type !== "IF") {
    return {
      scriptAction,
      resolvedAction: scriptAction,
      condition: null,
    };
  }

  const conditionMatched =
    scriptAction.condition === "SEEN" ? perception.enemyVisible : !perception.enemyVisible;

  return {
    scriptAction,
    resolvedAction: conditionMatched ? scriptAction.then : { type: "WAIT" },
    condition: {
      type: scriptAction.condition,
      matched: conditionMatched,
      fallbackToWait: !conditionMatched,
    },
  };
}

function withCondition(result, conditionInfo) {
  if (!conditionInfo) {
    return result;
  }

  return {
    ...result,
    condition: { ...conditionInfo },
  };
}

function takeAction(actor, opponent, action, arenaSize, perception, conditionInfo) {
  if (!actor.alive) {
    return withCondition(
      {
        event: "SKIPPED",
        details: "actor is already dead",
      },
      conditionInfo
    );
  }

  switch (action.type) {
    case "MOVE": {
      const { dx, dy } = deltaByDirection(actor.direction);
      let moved = 0;
      let stopReason = "max_steps_reached";
      const path = [];

      for (let i = 0; i < action.steps; i += 1) {
        const next = { x: actor.x + dx, y: actor.y + dy };
        if (!isInsideArena(next, arenaSize)) {
          stopReason = "arena_boundary";
          break;
        }

        if (opponent.alive && next.x === opponent.x && next.y === opponent.y) {
          stopReason = "opponent_blocked";
          break;
        }

        actor.x = next.x;
        actor.y = next.y;
        path.push({ x: actor.x, y: actor.y });
        moved += 1;
      }

      return withCondition(
        {
          event: "MOVE",
          details: `moved ${moved} tile(s)`,
          moved,
          stopReason,
          path,
        },
        conditionInfo
      );
    }

    case "ROTATE": {
      actor.direction = rotateDirection(actor.direction, action.direction);
      return withCondition(
        {
          event: "ROTATE",
          details: `rotated to ${actor.direction}`,
        },
        conditionInfo
      );
    }

    case "SHOOT": {
      const projectile = {
        from: { x: actor.x, y: actor.y },
        to: getProjectileEndpoint(actor, arenaSize, VISION_RADIUS),
        direction: actor.direction,
        range: VISION_RADIUS,
        hit: false,
        targetRobotId: null,
      };

      if (opponent.alive && perception.enemyVisible && hasLineOfSight(actor, opponent)) {
        opponent.alive = false;
        projectile.to = { x: opponent.x, y: opponent.y };
        projectile.hit = true;
        projectile.targetRobotId = opponent.id;

        return withCondition(
          {
            event: "SHOOT",
            details: "hit confirmed (one shot kill)",
            projectile,
          },
          conditionInfo
        );
      }

      return withCondition(
        {
          event: "SHOOT",
          details: "missed",
          projectile,
        },
        conditionInfo
      );
    }

    case "WAIT":
      if (conditionInfo && !conditionInfo.matched) {
        return {
          event: "CONDITION_SKIP",
          details: `condition ${conditionInfo.type} not met; fallback WAIT`,
          condition: { ...conditionInfo },
        };
      }

      return {
        event: "WAIT",
        details: "held position",
      };

    default:
      return withCondition(
        {
          event: "UNKNOWN",
          details: `unsupported action ${action.type}`,
        },
        conditionInfo
      );
  }
}

function cloneProgram(program) {
  return program.map((entry) => cloneAction(entry));
}

function buildRobotState(robotDoc, startX, startY, startDirection) {
  return {
    id: robotDoc.id,
    robotName: robotDoc.robotName,
    x: startX,
    y: startY,
    direction: startDirection,
    alive: true,
    programPointer: 0,
    program: cloneProgram(robotDoc.parsedProgram),
  };
}

function computeWinner(robotA, robotB) {
  if (robotA.alive && !robotB.alive) {
    return robotA.id;
  }

  if (!robotA.alive && robotB.alive) {
    return robotB.id;
  }

  return null;
}

function simulateBattle({ robotA, robotB, arenaSize, maxTurns }) {
  const a = buildRobotState(robotA, 0, 0, "E");
  const b = buildRobotState(robotB, arenaSize - 1, arenaSize - 1, "W");

  const turns = [];
  const timeline = [];
  let step = 0;

  const initialState = snapshotBattle(a, b);
  const initialPerception = {
    [a.id]: buildPerception(a, b),
    [b.id]: buildPerception(b, a),
  };

  for (let turn = 1; turn <= maxTurns; turn += 1) {
    const turnLog = {
      turn,
      startState: snapshotBattle(a, b),
      startPerception: {
        [a.id]: buildPerception(a, b),
        [b.id]: buildPerception(b, a),
      },
      actions: [],
    };

    if (a.alive) {
      const perceptionBeforeA = buildPerception(a, b);
      const resolvedA = resolveScriptAction(a, perceptionBeforeA);
      const beforeA = snapshotBattle(a, b);
      const resultA = takeAction(
        a,
        b,
        resolvedA.resolvedAction,
        arenaSize,
        perceptionBeforeA,
        resolvedA.condition
      );
      const afterA = snapshotBattle(a, b);
      const perceptionAfterA = buildPerception(a, b);
      step += 1;

      const actionLogA = {
        step,
        robotId: a.id,
        robotName: a.robotName,
        action: cloneAction(resolvedA.scriptAction),
        resolvedAction: cloneAction(resolvedA.resolvedAction),
        result: resultA,
        perceptionBefore: perceptionBeforeA,
        perceptionAfter: perceptionAfterA,
        position: { x: a.x, y: a.y, direction: a.direction, alive: a.alive },
        before: beforeA,
        after: afterA,
      };

      turnLog.actions.push(actionLogA);
      timeline.push({ turn, ...actionLogA });
    }

    if (b.alive) {
      const perceptionBeforeB = buildPerception(b, a);
      const resolvedB = resolveScriptAction(b, perceptionBeforeB);
      const beforeB = snapshotBattle(a, b);
      const resultB = takeAction(
        b,
        a,
        resolvedB.resolvedAction,
        arenaSize,
        perceptionBeforeB,
        resolvedB.condition
      );
      const afterB = snapshotBattle(a, b);
      const perceptionAfterB = buildPerception(b, a);
      step += 1;

      const actionLogB = {
        step,
        robotId: b.id,
        robotName: b.robotName,
        action: cloneAction(resolvedB.scriptAction),
        resolvedAction: cloneAction(resolvedB.resolvedAction),
        result: resultB,
        perceptionBefore: perceptionBeforeB,
        perceptionAfter: perceptionAfterB,
        position: { x: b.x, y: b.y, direction: b.direction, alive: b.alive },
        before: beforeB,
        after: afterB,
      };

      turnLog.actions.push(actionLogB);
      timeline.push({ turn, ...actionLogB });
    }

    turnLog.endState = snapshotBattle(a, b);
    turnLog.endPerception = {
      [a.id]: buildPerception(a, b),
      [b.id]: buildPerception(b, a),
    };
    turns.push(turnLog);

    if (!a.alive || !b.alive) {
      break;
    }
  }

  const winnerRobotId = computeWinner(a, b);
  const status = winnerRobotId ? "finished" : "draw";
  const finalState = snapshotBattle(a, b);
  const finalPerception = {
    [a.id]: buildPerception(a, b),
    [b.id]: buildPerception(b, a),
  };

  return {
    status,
    winnerRobotId,
    visionRadius: VISION_RADIUS,
    initialState,
    initialPerception,
    timeline,
    turns,
    finalState,
    finalPerception,
  };
}

module.exports = {
  simulateBattle,
};
