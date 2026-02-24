import type {
  BoostDirection,
  ComparisonOperator,
  NumericExpression,
  RuleCommand,
  RuleCondition,
  ScriptAction,
  SensorVariable,
} from "./parser";

const DIRECTIONS = ["N", "E", "S", "W"] as const;
export const TARGET_FPS = 60;
export const VISION_RADIUS = 8;
export const SHOT_RANGE = 5;
export const VISION_HALF_ANGLE_DEG = 60;
const VISION_HALF_ANGLE_RAD = Math.PI / 3;
export const ROBOT_COLLISION_RADIUS = 0.34;
export const SHOT_HIT_RADIUS = 0.36;
export const TICK_DURATION_MS = 1000 / TARGET_FPS;
const REPLAY_FRAMES_PER_TICK = 1;
export const FIRE_MOVEMENT_MULTIPLIER = 0.5;
export const FIRE_TURN_MULTIPLIER = 0.5;
export const FIRE_COOLDOWN_TICKS = 1;
export const FIRE_ENERGY_COST = 6;
export const PROJECTILE_TICKS_PER_TILE = 2;
export const SIDE_BOOST_FORCE_SEQUENCE = [5, 4, 3, 2, 1] as const;
export const SIDE_BOOST_BURST_TICKS = SIDE_BOOST_FORCE_SEQUENCE.length;
export const SIDE_BOOST_TOTAL_EQUIVALENT_STRAFE_TICKS = 15;
export const SIDE_BOOST_ENERGY_MAX = 100;
export const SIDE_BOOST_ENERGY_COST = 35;
export const SIDE_BOOST_ENERGY_REGEN_PER_SECOND = 15;
export const SIDE_BOOST_COOLDOWN_TICKS = 10;
const EPSILON = 0.000001;
const MEMORY_UNSEEN_TICKS_INITIAL = 9999;

export const TICKS_PER_TILE = {
  FORWARD: 8,
  STRAFE: 12,
  BACKWARD: 16,
} as const;

const SPEED_PER_SECOND = {
  FORWARD: 1 / ((TICKS_PER_TILE.FORWARD * TICK_DURATION_MS) / 1000),
  STRAFE: 1 / ((TICKS_PER_TILE.STRAFE * TICK_DURATION_MS) / 1000),
  BACKWARD: 1 / ((TICKS_PER_TILE.BACKWARD * TICK_DURATION_MS) / 1000),
} as const;
export const PROJECTILE_SPEED_TILES_PER_SECOND = 1 / ((PROJECTILE_TICKS_PER_TILE * TICK_DURATION_MS) / 1000);

export const TURN_RATE_DEG_PER_SECOND = 360;
const TURN_RATE_RAD_PER_SECOND = (TURN_RATE_DEG_PER_SECOND * Math.PI) / 180;

type Direction = (typeof DIRECTIONS)[number];
type ActionEvent = "CONTROL_TICK" | "FIRE" | "SKIPPED";
type DistanceBand = "near" | "mid" | "far";
type Bearing = "FRONT" | "FRONT_LEFT" | "FRONT_RIGHT";
type ArenaWallSide = "NORTH" | "EAST" | "SOUTH" | "WEST";
type RelativeWallDirection = "AHEAD" | "LEFT" | "RIGHT" | "BACK";

export interface Position {
  x: number;
  y: number;
}

interface LocalCoordinates {
  forward: number;
  lateral: number;
}

export interface Projectile {
  from: Position;
  to: Position;
  direction: Direction;
  range: number;
  hit: boolean;
  targetRobotId: string | null;
}

export interface BoostEffect {
  robotId: string;
  robotName: string;
  direction: BoostDirection;
  from: Position;
  to: Position;
}

export interface EnemyPerception {
  id: string;
  robotName: string;
  dx: number;
  dy: number;
  distance: number;
  distanceBand: DistanceBand;
  bearing: Bearing;
  headingDeg: number;
  headingDirection: Direction;
  absolutePosition: Position;
}

interface WallRayHit {
  point: Position;
  side: ArenaWallSide;
  distance: number;
}

export interface WallPerception {
  arenaSize: number;
  aheadDistance: number;
  leftDistance: number;
  rightDistance: number;
  backDistance: number;
  nearestDistance: number;
  nearestDirection: RelativeWallDirection;
  sightArc: {
    center: WallRayHit;
    leftEdge: WallRayHit;
    rightEdge: WallRayHit;
  };
}

export interface Perception {
  range: number;
  enemyVisible: boolean;
  enemy: EnemyPerception | null;
  wall: WallPerception;
}

export interface RobotSnapshot {
  id: string;
  robotName: string;
  x: number;
  y: number;
  direction: Direction;
  angleDeg?: number;
  alive: boolean;
  energy?: number;
  boostCooldownTicks?: number;
}

export interface BattleSnapshot {
  robotA: RobotSnapshot;
  robotB: RobotSnapshot;
}

export interface ReplayRobotSnapshot extends RobotSnapshot {
  angleDeg: number;
}

export interface ReplayBattleSnapshot {
  robotA: ReplayRobotSnapshot;
  robotB: ReplayRobotSnapshot;
}

export interface BattleRobotInput {
  id: string;
  robotName: string;
  parsedProgram: ScriptAction[];
}

interface ControlState {
  throttle: number;
  strafe: number;
  turn: number;
  fire: boolean;
  boost: BoostDirection | null;
}

interface ControlDecision {
  totalRules: number;
  controls: ControlState;
  matchedRuleLines: number[];
}

interface SensorContext {
  enemyVisible: boolean;
  values: Record<SensorVariable, number | null>;
}

interface EnemyMemoryState {
  prevEnemyX: number | null;
  prevEnemyY: number | null;
  prevEnemyHeading: number | null;
  prevEnemyDx: number | null;
  prevEnemyDy: number | null;
  prevEnemyDistance: number | null;
  ticksSinceEnemySeen: number;
}

interface RobotState extends RobotSnapshot {
  headingRad: number;
  fireCooldownTicks: number;
  energy: number;
  boostCooldownTicks: number;
  boostBurstTicksRemaining: number;
  boostDirectionLocked: BoostDirection | null;
  enemyMemory: EnemyMemoryState;
  program: ScriptAction[];
}

interface MovementOutcome {
  attempted: boolean;
  dx: number;
  dy: number;
  distance: number;
  blockedByRobot: boolean;
  hitBoundary: boolean;
  speedMultiplier: number;
  boostRequested: boolean;
  boostUsed: boolean;
  boostDirection: BoostDirection | null;
  boostDistance: number;
  boostForceLevel: number;
  boostBurstTicksRemaining: number;
  energyBefore: number;
  energyAfter: number;
  boostCooldownRemaining: number;
  boostTrail: { from: Position; to: Position } | null;
}

interface RotationOutcome {
  deltaDeg: number;
}

interface FireOutcome {
  triggerHeld: boolean;
  shotFired: boolean;
  cooldownRemaining: number;
  blockedByEnergy: boolean;
  energyBefore: number;
  energyAfter: number;
  hit: boolean;
  projectile: Projectile | null;
}

interface InFlightProjectile {
  shooterRobotId: string;
  targetRobotId: string;
  position: Position;
  direction: { dx: number; dy: number };
  directionCardinal: Direction;
  traveledDistance: number;
  maxRange: number;
}

interface ProjectileAdvanceResult {
  traces: Projectile[];
  traceByShooter: Record<string, Projectile>;
  hitByShooter: Record<string, boolean>;
  pendingKills: Set<string>;
  nextProjectiles: InFlightProjectile[];
}

interface TickActionResult {
  event: ActionEvent;
  details: string;
  phase: "completed";
  projectile?: Projectile | null;
  controls: ControlState;
  movement: MovementOutcome;
  rotation: RotationOutcome;
  firing: {
    triggerHeld: boolean;
    shotFired: boolean;
    cooldownRemaining: number;
    blockedByEnergy: boolean;
    energyBefore: number;
    energyAfter: number;
    hit: boolean;
  };
}

interface ActionSummary {
  type: "CONTROL_RULESET";
  totalRules: number;
  matchedRuleCount: number;
  matchedRuleLines: number[];
}

interface ResolvedControlAction {
  type: "CONTROL";
  throttle: number;
  strafe: number;
  turn: number;
  fire: boolean;
  boost: BoostDirection | null;
}

export interface SimulationActionLog {
  tick: number;
  turn: number;
  step: number;
  robotId: string;
  robotName: string;
  action: ActionSummary;
  resolvedAction: ResolvedControlAction;
  result: TickActionResult;
  actionState: {
    totalTicks: number;
    elapsedTicks: number;
    remainingTicks: number;
  };
  perceptionBefore: Perception;
  perceptionAfter: Perception;
  position: RobotSnapshot;
  before: BattleSnapshot;
  after: BattleSnapshot;
}

export interface TickLog {
  tick: number;
  turn: number;
  startState: BattleSnapshot;
  startPerception: Record<string, Perception>;
  actions: SimulationActionLog[];
  projectiles: Projectile[];
  endState: BattleSnapshot;
  endPerception: Record<string, Perception>;
}

export interface ReplayActionHint {
  robotId: string;
  robotName: string;
  actionType: string;
  event: string;
  boostUsed: boolean;
  boostDirection: BoostDirection | null;
}

export interface ReplayFrame {
  index: number;
  timestampMs: number;
  tick: number;
  state: ReplayBattleSnapshot;
  projectiles: Projectile[];
  boostEffects: BoostEffect[];
  actions: ReplayActionHint[];
}

interface MovementTiming {
  forwardTicksPerTile: number;
  strafeTicksPerTile: number;
  backwardTicksPerTile: number;
}

export interface BattleSimulation {
  status: "finished" | "draw";
  winnerRobotId: string | null;
  visionRadius: number;
  shotRange: number;
  tickDurationMs: number;
  projectileTiming: {
    ticksPerTile: number;
    speedTilesPerSecond: number;
    speedTilesPerTick: number;
  };
  movementTiming: MovementTiming;
  maxTicks: number;
  initialState: BattleSnapshot;
  initialPerception: Record<string, Perception>;
  timeline: SimulationActionLog[];
  ticks: TickLog[];
  turns: TickLog[];
  replayFrameRate: number;
  replayFrames: ReplayFrame[];
  finalState: BattleSnapshot;
  finalPerception: Record<string, Perception>;
}

interface SimulateBattleInput {
  robotA: BattleRobotInput;
  robotB: BattleRobotInput;
  arenaSize: number;
  maxTicks?: number;
  maxTurns?: number;
}

const DIRECTION_ANGLE_DEG: Record<Direction, number> = {
  E: 0,
  S: 90,
  W: 180,
  N: 270,
};

function normalizeAngleRad(angle: number): number {
  const twoPi = Math.PI * 2;
  let normalized = angle % twoPi;
  if (normalized < 0) {
    normalized += twoPi;
  }

  return normalized;
}

function normalizeHeadingDeg(value: number): number {
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function directionFromHeading(headingRad: number): Direction {
  const deg = (normalizeAngleRad(headingRad) * 180) / Math.PI;

  if (deg >= 315 || deg < 45) {
    return "E";
  }

  if (deg >= 45 && deg < 135) {
    return "S";
  }

  if (deg >= 135 && deg < 225) {
    return "W";
  }

  return "N";
}

function headingByDirection(direction: Direction): number {
  return (DIRECTION_ANGLE_DEG[direction] * Math.PI) / 180;
}

function headingVector(headingRad: number): { dx: number; dy: number } {
  return {
    dx: Math.cos(headingRad),
    dy: Math.sin(headingRad),
  };
}

function toLocalCoordinates(headingRad: number, dx: number, dy: number): LocalCoordinates {
  const forward = headingVector(headingRad);
  const right = { dx: -forward.dy, dy: forward.dx };

  return {
    forward: dx * forward.dx + dy * forward.dy,
    lateral: dx * right.dx + dy * right.dy,
  };
}

function distanceBand(distance: number): DistanceBand {
  if (distance <= 2) {
    return "near";
  }

  if (distance <= 4) {
    return "mid";
  }

  return "far";
}

function bearingByLateral(lateral: number): Bearing {
  if (Math.abs(lateral) <= 0.75) {
    return "FRONT";
  }

  return lateral > 0 ? "FRONT_RIGHT" : "FRONT_LEFT";
}

function clampToArena(position: Position, arenaSize: number): { clamped: Position; hitBoundary: boolean } {
  const clampedX = Math.max(0, Math.min(arenaSize - 1, position.x));
  const clampedY = Math.max(0, Math.min(arenaSize - 1, position.y));

  return {
    clamped: {
      x: Number(clampedX.toFixed(4)),
      y: Number(clampedY.toFixed(4)),
    },
    hitBoundary: Math.abs(clampedX - position.x) > EPSILON || Math.abs(clampedY - position.y) > EPSILON,
  };
}

function buildWallRayHit(
  origin: Position,
  direction: { dx: number; dy: number },
  arenaSize: number
): WallRayHit {
  const maxCoord = arenaSize - 1;
  const candidates: WallRayHit[] = [];

  if (Math.abs(direction.dx) > EPSILON) {
    const tWest = (0 - origin.x) / direction.dx;
    if (tWest > EPSILON) {
      const y = origin.y + tWest * direction.dy;
      if (y >= -EPSILON && y <= maxCoord + EPSILON) {
        candidates.push({
          point: { x: 0, y: Number(Math.max(0, Math.min(maxCoord, y)).toFixed(4)) },
          side: "WEST",
          distance: tWest,
        });
      }
    }

    const tEast = (maxCoord - origin.x) / direction.dx;
    if (tEast > EPSILON) {
      const y = origin.y + tEast * direction.dy;
      if (y >= -EPSILON && y <= maxCoord + EPSILON) {
        candidates.push({
          point: { x: maxCoord, y: Number(Math.max(0, Math.min(maxCoord, y)).toFixed(4)) },
          side: "EAST",
          distance: tEast,
        });
      }
    }
  }

  if (Math.abs(direction.dy) > EPSILON) {
    const tNorth = (0 - origin.y) / direction.dy;
    if (tNorth > EPSILON) {
      const x = origin.x + tNorth * direction.dx;
      if (x >= -EPSILON && x <= maxCoord + EPSILON) {
        candidates.push({
          point: { x: Number(Math.max(0, Math.min(maxCoord, x)).toFixed(4)), y: 0 },
          side: "NORTH",
          distance: tNorth,
        });
      }
    }

    const tSouth = (maxCoord - origin.y) / direction.dy;
    if (tSouth > EPSILON) {
      const x = origin.x + tSouth * direction.dx;
      if (x >= -EPSILON && x <= maxCoord + EPSILON) {
        candidates.push({
          point: { x: Number(Math.max(0, Math.min(maxCoord, x)).toFixed(4)), y: maxCoord },
          side: "SOUTH",
          distance: tSouth,
        });
      }
    }
  }

  if (!candidates.length) {
    return {
      point: { x: Number(origin.x.toFixed(4)), y: Number(origin.y.toFixed(4)) },
      side: "NORTH",
      distance: 0,
    };
  }

  candidates.sort((left, right) => left.distance - right.distance);
  const nearest = candidates[0];

  return {
    point: nearest.point,
    side: nearest.side,
    distance: Number(nearest.distance.toFixed(4)),
  };
}

function buildWallPerception(actor: RobotState, arenaSize: number): WallPerception {
  const origin = { x: actor.x, y: actor.y };
  const forward = headingVector(actor.headingRad);
  const right = { dx: -forward.dy, dy: forward.dx };
  const left = { dx: -right.dx, dy: -right.dy };
  const back = { dx: -forward.dx, dy: -forward.dy };

  const aheadHit = buildWallRayHit(origin, forward, arenaSize);
  const leftHit = buildWallRayHit(origin, left, arenaSize);
  const rightHit = buildWallRayHit(origin, right, arenaSize);
  const backHit = buildWallRayHit(origin, back, arenaSize);

  const leftEdgeDir = headingVector(actor.headingRad - VISION_HALF_ANGLE_RAD);
  const rightEdgeDir = headingVector(actor.headingRad + VISION_HALF_ANGLE_RAD);

  const leftEdgeHit = buildWallRayHit(origin, leftEdgeDir, arenaSize);
  const rightEdgeHit = buildWallRayHit(origin, rightEdgeDir, arenaSize);

  const wallDistances: Array<{ direction: RelativeWallDirection; distance: number }> = [
    { direction: "AHEAD", distance: aheadHit.distance },
    { direction: "LEFT", distance: leftHit.distance },
    { direction: "RIGHT", distance: rightHit.distance },
    { direction: "BACK", distance: backHit.distance },
  ];
  wallDistances.sort((leftEntry, rightEntry) => leftEntry.distance - rightEntry.distance);
  const nearestEntry = wallDistances[0];

  return {
    arenaSize,
    aheadDistance: aheadHit.distance,
    leftDistance: leftHit.distance,
    rightDistance: rightHit.distance,
    backDistance: backHit.distance,
    nearestDistance: Number(nearestEntry.distance.toFixed(4)),
    nearestDirection: nearestEntry.direction,
    sightArc: {
      center: aheadHit,
      leftEdge: leftEdgeHit,
      rightEdge: rightEdgeHit,
    },
  };
}

function buildPerception(actor: RobotState, opponent: RobotState, arenaSize: number): Perception {
  const base: Perception = {
    range: VISION_RADIUS,
    enemyVisible: false,
    enemy: null,
    wall: buildWallPerception(actor, arenaSize),
  };

  if (!actor.alive) {
    return base;
  }

  if (!opponent.alive) {
    return base;
  }

  const dx = opponent.x - actor.x;
  const dy = opponent.y - actor.y;
  const distance = Math.sqrt(dx * dx + dy * dy);

  if (distance > VISION_RADIUS) {
    return base;
  }

  const { forward, lateral } = toLocalCoordinates(actor.headingRad, dx, dy);
  if (forward <= 0) {
    return base;
  }

  const viewAngle = Math.atan2(Math.abs(lateral), Math.max(0.0001, forward));
  if (viewAngle > VISION_HALF_ANGLE_RAD) {
    return base;
  }

  const opponentHeadingDeg = normalizeHeadingDeg((opponent.headingRad * 180) / Math.PI);

  return {
    range: VISION_RADIUS,
    enemyVisible: true,
    wall: base.wall,
    enemy: {
      id: opponent.id,
      robotName: opponent.robotName,
      dx: Number(dx.toFixed(4)),
      dy: Number(dy.toFixed(4)),
      distance: Number(distance.toFixed(2)),
      distanceBand: distanceBand(distance),
      bearing: bearingByLateral(lateral),
      headingDeg: Number(opponentHeadingDeg.toFixed(2)),
      headingDirection: directionFromHeading(opponent.headingRad),
      absolutePosition: {
        x: Number(opponent.x.toFixed(4)),
        y: Number(opponent.y.toFixed(4)),
      },
    },
  };
}

function snapshotRobot(robot: RobotState): RobotSnapshot {
  const headingDeg = (normalizeAngleRad(robot.headingRad) * 180) / Math.PI;
  return {
    id: robot.id,
    robotName: robot.robotName,
    x: Number(robot.x.toFixed(4)),
    y: Number(robot.y.toFixed(4)),
    direction: directionFromHeading(robot.headingRad),
    angleDeg: Number(headingDeg.toFixed(2)),
    alive: robot.alive,
    energy: Number(robot.energy.toFixed(2)),
    boostCooldownTicks: robot.boostCooldownTicks,
  };
}

function snapshotBattle(robotA: RobotState, robotB: RobotState): BattleSnapshot {
  return {
    robotA: snapshotRobot(robotA),
    robotB: snapshotRobot(robotB),
  };
}

function compareNumbers(left: number, operator: ComparisonOperator, right: number): boolean {
  if (operator === ">") {
    return left > right;
  }

  if (operator === ">=") {
    return left >= right;
  }

  if (operator === "<") {
    return left < right;
  }

  if (operator === "<=") {
    return left <= right;
  }

  if (operator === "!=") {
    return Math.abs(left - right) > EPSILON;
  }

  return Math.abs(left - right) <= EPSILON;
}

function buildSensorContext(
  actor: RobotState,
  opponent: RobotState,
  perception: Perception,
  arenaSize: number
): SensorContext {
  const selfHeadingDeg = normalizeHeadingDeg((actor.headingRad * 180) / Math.PI);
  const memory = actor.enemyMemory;
  const currentEnemy = perception.enemyVisible && perception.enemy ? perception.enemy : null;

  const enemyDxDelta =
    currentEnemy && memory.prevEnemyDx !== null ? Number((currentEnemy.dx - memory.prevEnemyDx).toFixed(4)) : null;
  const enemyDyDelta =
    currentEnemy && memory.prevEnemyDy !== null ? Number((currentEnemy.dy - memory.prevEnemyDy).toFixed(4)) : null;
  const enemyDistanceDelta =
    currentEnemy && memory.prevEnemyDistance !== null
      ? Number((currentEnemy.distance - memory.prevEnemyDistance).toFixed(4))
      : null;

  const values: Record<SensorVariable, number | null> = {
    ARENA_SIZE: arenaSize,
    SELF_X: Number(actor.x.toFixed(4)),
    SELF_Y: Number(actor.y.toFixed(4)),
    SELF_HEADING: Number(selfHeadingDeg.toFixed(2)),
    SELF_ENERGY: Number(actor.energy.toFixed(2)),
    BOOST_COOLDOWN: actor.boostCooldownTicks,
    TICKS_SINCE_ENEMY_SEEN: currentEnemy ? 0 : memory.ticksSinceEnemySeen,
    ENEMY_X: null,
    ENEMY_Y: null,
    ENEMY_HEADING: null,
    ENEMY_DX: null,
    ENEMY_DY: null,
    ENEMY_DISTANCE: null,
    PREV_ENEMY_X: memory.prevEnemyX,
    PREV_ENEMY_Y: memory.prevEnemyY,
    PREV_ENEMY_HEADING: memory.prevEnemyHeading,
    PREV_ENEMY_DX: memory.prevEnemyDx,
    PREV_ENEMY_DY: memory.prevEnemyDy,
    PREV_ENEMY_DISTANCE: memory.prevEnemyDistance,
    ENEMY_DX_DELTA: enemyDxDelta,
    ENEMY_DY_DELTA: enemyDyDelta,
    ENEMY_DISTANCE_DELTA: enemyDistanceDelta,
    WALL_AHEAD_DISTANCE: perception.wall.aheadDistance,
    WALL_LEFT_DISTANCE: perception.wall.leftDistance,
    WALL_RIGHT_DISTANCE: perception.wall.rightDistance,
    WALL_BACK_DISTANCE: perception.wall.backDistance,
    WALL_NEAREST_DISTANCE: perception.wall.nearestDistance,
  };

  if (currentEnemy) {
    values.ENEMY_X = Number(opponent.x.toFixed(4));
    values.ENEMY_Y = Number(opponent.y.toFixed(4));
    values.ENEMY_HEADING = currentEnemy.headingDeg;
    values.ENEMY_DX = currentEnemy.dx;
    values.ENEMY_DY = currentEnemy.dy;
    values.ENEMY_DISTANCE = currentEnemy.distance;
  }

  return {
    enemyVisible: perception.enemyVisible,
    values,
  };
}

function updateEnemyMemory(actor: RobotState, opponent: RobotState, perception: Perception): void {
  const enemy = perception.enemyVisible && perception.enemy ? perception.enemy : null;
  if (!enemy) {
    actor.enemyMemory.ticksSinceEnemySeen = Math.min(
      MEMORY_UNSEEN_TICKS_INITIAL,
      actor.enemyMemory.ticksSinceEnemySeen + 1
    );
    return;
  }

  actor.enemyMemory.prevEnemyX = Number(opponent.x.toFixed(4));
  actor.enemyMemory.prevEnemyY = Number(opponent.y.toFixed(4));
  actor.enemyMemory.prevEnemyHeading = enemy.headingDeg;
  actor.enemyMemory.prevEnemyDx = enemy.dx;
  actor.enemyMemory.prevEnemyDy = enemy.dy;
  actor.enemyMemory.prevEnemyDistance = enemy.distance;
  actor.enemyMemory.ticksSinceEnemySeen = 0;
}

function shortestAngleDiffDeg(targetDeg: number, currentDeg: number): number {
  let diff = normalizeHeadingDeg(targetDeg) - normalizeHeadingDeg(currentDeg);
  if (diff > 180) {
    diff -= 360;
  } else if (diff <= -180) {
    diff += 360;
  }

  return diff;
}

function evaluateNumericExpression(expression: NumericExpression, sensors: SensorContext): number | null {
  if (expression.type === "NUMBER_LITERAL") {
    return expression.value;
  }

  if (expression.type === "SENSOR") {
    return sensors.values[expression.variable];
  }

  if (expression.type === "UNARY") {
    const operand = evaluateNumericExpression(expression.operand, sensors);
    if (operand === null) {
      return null;
    }

    const unaryValue = expression.operator === "-" ? -operand : operand;
    return Number.isFinite(unaryValue) ? unaryValue : null;
  }

  if (expression.type === "BINARY") {
    const left = evaluateNumericExpression(expression.left, sensors);
    if (left === null) {
      return null;
    }

    const right = evaluateNumericExpression(expression.right, sensors);
    if (right === null) {
      return null;
    }

    if (expression.operator === "+") {
      const sum = left + right;
      return Number.isFinite(sum) ? sum : null;
    }

    if (expression.operator === "-") {
      const difference = left - right;
      return Number.isFinite(difference) ? difference : null;
    }

    if (expression.operator === "*") {
      const product = left * right;
      return Number.isFinite(product) ? product : null;
    }

    if (Math.abs(right) <= EPSILON) {
      return null;
    }

    const quotient = left / right;
    return Number.isFinite(quotient) ? quotient : null;
  }

  const resolvedArgs: number[] = [];
  for (const arg of expression.args) {
    const value = evaluateNumericExpression(arg, sensors);
    if (value === null) {
      return null;
    }
    resolvedArgs.push(value);
  }

  let result = 0;

  if (expression.name === "ABS") {
    result = Math.abs(resolvedArgs[0]);
  } else if (expression.name === "MIN") {
    result = Math.min(resolvedArgs[0], resolvedArgs[1]);
  } else if (expression.name === "MAX") {
    result = Math.max(resolvedArgs[0], resolvedArgs[1]);
  } else if (expression.name === "CLAMP") {
    result = Math.min(Math.max(resolvedArgs[0], resolvedArgs[1]), resolvedArgs[2]);
  } else if (expression.name === "ATAN2") {
    result = normalizeHeadingDeg((Math.atan2(resolvedArgs[0], resolvedArgs[1]) * 180) / Math.PI);
  } else if (expression.name === "ANGLE_DIFF") {
    result = shortestAngleDiffDeg(resolvedArgs[0], resolvedArgs[1]);
  } else {
    result = normalizeHeadingDeg(resolvedArgs[0]);
  }

  return Number.isFinite(result) ? result : null;
}

function conditionMatched(condition: RuleCondition | null, sensors: SensorContext): boolean {
  if (!condition) {
    return true;
  }

  if (condition.type === "VISIBILITY") {
    return condition.visible ? sensors.enemyVisible : !sensors.enemyVisible;
  }

  if (condition.type === "NOT") {
    return !conditionMatched(condition.operand, sensors);
  }

  if (condition.type === "LOGICAL") {
    if (condition.operator === "AND") {
      return conditionMatched(condition.left, sensors) && conditionMatched(condition.right, sensors);
    }

    return conditionMatched(condition.left, sensors) || conditionMatched(condition.right, sensors);
  }

  const leftValue = evaluateNumericExpression(condition.left, sensors);
  if (leftValue === null) {
    return false;
  }

  const rightValue = evaluateNumericExpression(condition.right, sensors);
  if (rightValue === null) {
    return false;
  }

  return compareNumbers(leftValue, condition.operator, rightValue);
}

function neutralControls(): ControlState {
  return {
    throttle: 0,
    strafe: 0,
    turn: 0,
    fire: false,
    boost: null,
  };
}

function applyRuleCommand(controls: ControlState, command: RuleCommand): void {
  if (command.type === "SET_CONTROL") {
    if (command.field === "THROTTLE") {
      controls.throttle = command.value;
      return;
    }

    if (command.field === "STRAFE") {
      controls.strafe = command.value;
      return;
    }

    controls.turn = command.value;
    return;
  }

  if (command.type === "FIRE") {
    controls.fire = command.enabled;
    return;
  }

  controls.boost = command.direction;
}

function resolveControls(program: ScriptAction[], sensors: SensorContext): ControlDecision {
  const controls = neutralControls();
  const matchedRuleLines: number[] = [];

  program.forEach((rule) => {
    const matched = conditionMatched(rule.condition, sensors);
    if (!matched) {
      return;
    }

    matchedRuleLines.push(rule.line);
    applyRuleCommand(controls, rule.command);
  });

  return {
    totalRules: program.length,
    controls,
    matchedRuleLines,
  };
}

function computeRotation(actor: RobotState, controls: ControlState): RotationOutcome {
  const turnMultiplier = controls.fire ? FIRE_TURN_MULTIPLIER : 1;
  const deltaRad = controls.turn * TURN_RATE_RAD_PER_SECOND * turnMultiplier * (TICK_DURATION_MS / 1000);
  actor.headingRad = normalizeAngleRad(actor.headingRad + deltaRad);

  return {
    deltaDeg: Number(((deltaRad * 180) / Math.PI).toFixed(2)),
  };
}

function plannedDelta(actor: RobotState, controls: ControlState): {
  delta: Position;
  attempted: boolean;
  speedMultiplier: number;
} {
  if (!actor.alive) {
    return {
      delta: { x: 0, y: 0 },
      attempted: false,
      speedMultiplier: controls.fire ? FIRE_MOVEMENT_MULTIPLIER : 1,
    };
  }

  const speedMultiplier = controls.fire ? FIRE_MOVEMENT_MULTIPLIER : 1;
  const forwardSpeed = controls.throttle >= 0 ? SPEED_PER_SECOND.FORWARD : SPEED_PER_SECOND.BACKWARD;
  const localForwardVelocity = controls.throttle * forwardSpeed * speedMultiplier;
  const localStrafeVelocity = controls.strafe * SPEED_PER_SECOND.STRAFE * speedMultiplier;

  const dt = TICK_DURATION_MS / 1000;
  const forward = headingVector(actor.headingRad);
  const right = { dx: -forward.dy, dy: forward.dx };

  const deltaX = forward.dx * localForwardVelocity * dt + right.dx * localStrafeVelocity * dt;
  const deltaY = forward.dy * localForwardVelocity * dt + right.dy * localStrafeVelocity * dt;

  return {
    delta: {
      x: Number(deltaX.toFixed(4)),
      y: Number(deltaY.toFixed(4)),
    },
    attempted: Math.hypot(deltaX, deltaY) > EPSILON,
    speedMultiplier,
  };
}

function tickSideBoostState(actor: RobotState): void {
  if (!actor.alive) {
    return;
  }

  actor.boostCooldownTicks = Math.max(0, actor.boostCooldownTicks - 1);
  const regen = SIDE_BOOST_ENERGY_REGEN_PER_SECOND * (TICK_DURATION_MS / 1000);
  actor.energy = Math.min(SIDE_BOOST_ENERGY_MAX, Number((actor.energy + regen).toFixed(4)));
}

function resolveSideBoost(
  actor: RobotState,
  controls: ControlState,
  start: Position,
  arenaSize: number
): {
  requested: boolean;
  used: boolean;
  direction: BoostDirection | null;
  delta: Position;
  distance: number;
  forceLevel: number;
  burstTicksRemaining: number;
  energyBefore: number;
  energyAfter: number;
  cooldownRemaining: number;
  trail: { from: Position; to: Position } | null;
} {
  const requestedDirection = controls.boost;
  const requested = requestedDirection !== null;
  const energyBefore = Number(actor.energy.toFixed(2));

  if (!actor.alive) {
    return {
      requested,
      used: false,
      direction: requestedDirection,
      delta: { x: 0, y: 0 },
      distance: 0,
      forceLevel: 0,
      burstTicksRemaining: actor.boostBurstTicksRemaining,
      energyBefore,
      energyAfter: Number(actor.energy.toFixed(2)),
      cooldownRemaining: actor.boostCooldownTicks,
      trail: null,
    };
  }

  if (
    requested &&
    actor.boostBurstTicksRemaining <= 0 &&
    actor.boostCooldownTicks === 0 &&
    actor.energy >= SIDE_BOOST_ENERGY_COST
  ) {
    actor.energy = Math.max(0, Number((actor.energy - SIDE_BOOST_ENERGY_COST).toFixed(4)));
    actor.boostCooldownTicks = SIDE_BOOST_COOLDOWN_TICKS;
    actor.boostBurstTicksRemaining = SIDE_BOOST_BURST_TICKS;
    actor.boostDirectionLocked = requestedDirection;
  }

  if (actor.boostBurstTicksRemaining > 0 && !actor.boostDirectionLocked) {
    actor.boostBurstTicksRemaining = 0;
  }

  const activeDirection = actor.boostBurstTicksRemaining > 0 ? actor.boostDirectionLocked : null;
  if (!activeDirection) {
    return {
      requested,
      used: false,
      direction: requestedDirection,
      delta: { x: 0, y: 0 },
      distance: 0,
      forceLevel: 0,
      burstTicksRemaining: actor.boostBurstTicksRemaining,
      energyBefore,
      energyAfter: Number(actor.energy.toFixed(2)),
      cooldownRemaining: actor.boostCooldownTicks,
      trail: null,
    };
  }

  const sequenceIndex = SIDE_BOOST_BURST_TICKS - actor.boostBurstTicksRemaining;
  const forceLevel = SIDE_BOOST_FORCE_SEQUENCE[sequenceIndex] ?? actor.boostBurstTicksRemaining;
  const boostDistanceTiles = forceLevel / TICKS_PER_TILE.STRAFE;
  const forward = headingVector(actor.headingRad);
  const right = { dx: -forward.dy, dy: forward.dx };
  const sideSign = activeDirection === "RIGHT" ? 1 : -1;

  const deltaX = right.dx * sideSign * boostDistanceTiles;
  const deltaY = right.dy * sideSign * boostDistanceTiles;
  const boostDelta = {
    x: Number(deltaX.toFixed(4)),
    y: Number(deltaY.toFixed(4)),
  };

  actor.boostBurstTicksRemaining = Math.max(0, actor.boostBurstTicksRemaining - 1);
  if (actor.boostBurstTicksRemaining === 0) {
    actor.boostDirectionLocked = null;
  }

  const trailTo = clampToArena(
    {
      x: Number((start.x + boostDelta.x).toFixed(4)),
      y: Number((start.y + boostDelta.y).toFixed(4)),
    },
    arenaSize
  ).clamped;

  return {
    requested,
    used: true,
    direction: activeDirection,
    delta: boostDelta,
    distance: Number(Math.hypot(boostDelta.x, boostDelta.y).toFixed(4)),
    forceLevel,
    burstTicksRemaining: actor.boostBurstTicksRemaining,
    energyBefore,
    energyAfter: Number(actor.energy.toFixed(2)),
    cooldownRemaining: actor.boostCooldownTicks,
    trail: {
      from: start,
      to: trailTo,
    },
  };
}

function applyMovement(
  robotA: RobotState,
  robotB: RobotState,
  controlA: ControlState,
  controlB: ControlState,
  arenaSize: number
): Record<string, MovementOutcome> {
  const startA = { x: robotA.x, y: robotA.y };
  const startB = { x: robotB.x, y: robotB.y };

  const planA = plannedDelta(robotA, controlA);
  const planB = plannedDelta(robotB, controlB);
  const boostA = resolveSideBoost(robotA, controlA, startA, arenaSize);
  const boostB = resolveSideBoost(robotB, controlB, startB, arenaSize);

  const combinedDeltaA = {
    x: Number((planA.delta.x + boostA.delta.x).toFixed(4)),
    y: Number((planA.delta.y + boostA.delta.y).toFixed(4)),
  };
  const combinedDeltaB = {
    x: Number((planB.delta.x + boostB.delta.x).toFixed(4)),
    y: Number((planB.delta.y + boostB.delta.y).toFixed(4)),
  };
  const attemptedA = planA.attempted || boostA.used;
  const attemptedB = planB.attempted || boostB.used;

  const proposalA = clampToArena({ x: startA.x + combinedDeltaA.x, y: startA.y + combinedDeltaA.y }, arenaSize);
  const proposalB = clampToArena({ x: startB.x + combinedDeltaB.x, y: startB.y + combinedDeltaB.y }, arenaSize);

  let finalA = proposalA.clamped;
  let finalB = proposalB.clamped;
  let blockedA = false;
  let blockedB = false;

  if (robotA.alive && robotB.alive) {
    const separation = Math.hypot(finalA.x - finalB.x, finalA.y - finalB.y);
    if (separation <= ROBOT_COLLISION_RADIUS * 2) {
      if (attemptedA) {
        finalA = startA;
        blockedA = true;
      }
      if (attemptedB) {
        finalB = startB;
        blockedB = true;
      }
    }
  }

  robotA.x = Number(finalA.x.toFixed(4));
  robotA.y = Number(finalA.y.toFixed(4));
  robotB.x = Number(finalB.x.toFixed(4));
  robotB.y = Number(finalB.y.toFixed(4));

  return {
    [robotA.id]: {
      attempted: attemptedA,
      dx: Number((robotA.x - startA.x).toFixed(4)),
      dy: Number((robotA.y - startA.y).toFixed(4)),
      distance: Number(Math.hypot(robotA.x - startA.x, robotA.y - startA.y).toFixed(4)),
      blockedByRobot: blockedA,
      hitBoundary: proposalA.hitBoundary,
      speedMultiplier: planA.speedMultiplier,
      boostRequested: boostA.requested,
      boostUsed: boostA.used,
      boostDirection: boostA.direction,
      boostDistance: boostA.distance,
      boostForceLevel: boostA.forceLevel,
      boostBurstTicksRemaining: boostA.burstTicksRemaining,
      energyBefore: boostA.energyBefore,
      energyAfter: boostA.energyAfter,
      boostCooldownRemaining: boostA.cooldownRemaining,
      boostTrail: boostA.trail,
    },
    [robotB.id]: {
      attempted: attemptedB,
      dx: Number((robotB.x - startB.x).toFixed(4)),
      dy: Number((robotB.y - startB.y).toFixed(4)),
      distance: Number(Math.hypot(robotB.x - startB.x, robotB.y - startB.y).toFixed(4)),
      blockedByRobot: blockedB,
      hitBoundary: proposalB.hitBoundary,
      speedMultiplier: planB.speedMultiplier,
      boostRequested: boostB.requested,
      boostUsed: boostB.used,
      boostDirection: boostB.direction,
      boostDistance: boostB.distance,
      boostForceLevel: boostB.forceLevel,
      boostBurstTicksRemaining: boostB.burstTicksRemaining,
      energyBefore: boostB.energyBefore,
      energyAfter: boostB.energyAfter,
      boostCooldownRemaining: boostB.cooldownRemaining,
      boostTrail: boostB.trail,
    },
  };
}

function tickCooldown(actor: RobotState): void {
  actor.fireCooldownTicks = Math.max(0, actor.fireCooldownTicks - 1);
}

interface FireResolution {
  outcomes: Record<string, FireOutcome>;
  spawnedProjectiles: InFlightProjectile[];
}

function resolveFiring(
  robotA: RobotState,
  robotB: RobotState,
  controlA: ControlState,
  controlB: ControlState
): FireResolution {
  if (robotA.alive) {
    tickCooldown(robotA);
  }
  if (robotB.alive) {
    tickCooldown(robotB);
  }

  const outcomes: Record<string, FireOutcome> = {
    [robotA.id]: {
      triggerHeld: controlA.fire,
      shotFired: false,
      cooldownRemaining: robotA.fireCooldownTicks,
      blockedByEnergy: false,
      energyBefore: Number(robotA.energy.toFixed(2)),
      energyAfter: Number(robotA.energy.toFixed(2)),
      hit: false,
      projectile: null,
    },
    [robotB.id]: {
      triggerHeld: controlB.fire,
      shotFired: false,
      cooldownRemaining: robotB.fireCooldownTicks,
      blockedByEnergy: false,
      energyBefore: Number(robotB.energy.toFixed(2)),
      energyAfter: Number(robotB.energy.toFixed(2)),
      hit: false,
      projectile: null,
    },
  };
  const spawnedProjectiles: InFlightProjectile[] = [];

  const attempts: Array<{ shooter: RobotState; target: RobotState; control: ControlState }> = [
    { shooter: robotA, target: robotB, control: controlA },
    { shooter: robotB, target: robotA, control: controlB },
  ];

  attempts.forEach(({ shooter, target, control }) => {
    const outcome = outcomes[shooter.id];
    if (!shooter.alive || !control.fire) {
      return;
    }

    if (shooter.fireCooldownTicks > 0) {
      outcome.cooldownRemaining = shooter.fireCooldownTicks;
      return;
    }

    const energyBeforeShot = Number(shooter.energy.toFixed(2));
    if (shooter.energy < FIRE_ENERGY_COST) {
      outcome.blockedByEnergy = true;
      outcome.energyBefore = energyBeforeShot;
      outcome.energyAfter = energyBeforeShot;
      return;
    }

    shooter.energy = Math.max(0, Number((shooter.energy - FIRE_ENERGY_COST).toFixed(4)));
    shooter.fireCooldownTicks = FIRE_COOLDOWN_TICKS;
    outcome.shotFired = true;
    outcome.cooldownRemaining = shooter.fireCooldownTicks;
    outcome.energyBefore = energyBeforeShot;
    outcome.energyAfter = Number(shooter.energy.toFixed(2));
    const heading = headingVector(shooter.headingRad);
    spawnedProjectiles.push({
      shooterRobotId: shooter.id,
      targetRobotId: target.id,
      position: {
        x: Number(shooter.x.toFixed(4)),
        y: Number(shooter.y.toFixed(4)),
      },
      direction: heading,
      directionCardinal: directionFromHeading(shooter.headingRad),
      traveledDistance: 0,
      maxRange: SHOT_RANGE,
    });
  });

  return {
    outcomes,
    spawnedProjectiles,
  };
}

function pointToSegmentDistance(point: Position, start: Position, end: Position): number {
  const segmentDx = end.x - start.x;
  const segmentDy = end.y - start.y;
  const lengthSquared = segmentDx * segmentDx + segmentDy * segmentDy;

  if (lengthSquared <= EPSILON) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }

  const projection =
    ((point.x - start.x) * segmentDx + (point.y - start.y) * segmentDy) / Math.max(EPSILON, lengthSquared);
  const clamped = Math.max(0, Math.min(1, projection));
  const closest = {
    x: start.x + segmentDx * clamped,
    y: start.y + segmentDy * clamped,
  };

  return Math.hypot(point.x - closest.x, point.y - closest.y);
}

function findRobotById(robotA: RobotState, robotB: RobotState, robotId: string): RobotState | null {
  if (robotA.id === robotId) {
    return robotA;
  }

  if (robotB.id === robotId) {
    return robotB;
  }

  return null;
}

function advanceProjectiles(
  projectiles: InFlightProjectile[],
  robotA: RobotState,
  robotB: RobotState,
  arenaSize: number
): ProjectileAdvanceResult {
  const traces: Projectile[] = [];
  const traceByShooter: Record<string, Projectile> = {};
  const hitByShooter: Record<string, boolean> = {};
  const pendingKills = new Set<string>();
  const nextProjectiles: InFlightProjectile[] = [];
  const maxStepDistance = PROJECTILE_SPEED_TILES_PER_SECOND * (TICK_DURATION_MS / 1000);

  projectiles.forEach((projectile) => {
    const remainingRange = projectile.maxRange - projectile.traveledDistance;
    if (remainingRange <= EPSILON) {
      return;
    }

    const start = projectile.position;
    const wallHit = buildWallRayHit(start, projectile.direction, arenaSize);
    const stepDistance = Math.min(maxStepDistance, remainingRange, Math.max(0, wallHit.distance));

    if (stepDistance <= EPSILON) {
      return;
    }

    const rawEnd = {
      x: start.x + projectile.direction.dx * stepDistance,
      y: start.y + projectile.direction.dy * stepDistance,
    };
    const end = {
      x: Number(rawEnd.x.toFixed(4)),
      y: Number(rawEnd.y.toFixed(4)),
    };

    let hit = false;
    let hitTargetRobotId: string | null = null;
    let traceTo = end;

    const target = findRobotById(robotA, robotB, projectile.targetRobotId);
    if (target && target.alive && !pendingKills.has(target.id)) {
      const distanceToRay = pointToSegmentDistance(
        { x: Number(target.x.toFixed(4)), y: Number(target.y.toFixed(4)) },
        start,
        end
      );
      if (distanceToRay <= SHOT_HIT_RADIUS) {
        hit = true;
        hitTargetRobotId = target.id;
        pendingKills.add(target.id);
        traceTo = {
          x: Number(target.x.toFixed(4)),
          y: Number(target.y.toFixed(4)),
        };
      }
    }

    const trace: Projectile = {
      from: {
        x: Number(start.x.toFixed(4)),
        y: Number(start.y.toFixed(4)),
      },
      to: traceTo,
      direction: projectile.directionCardinal,
      range: projectile.maxRange,
      hit,
      targetRobotId: hitTargetRobotId,
    };
    traces.push(trace);

    if (!traceByShooter[projectile.shooterRobotId]) {
      traceByShooter[projectile.shooterRobotId] = trace;
    }
    if (hit) {
      hitByShooter[projectile.shooterRobotId] = true;
    }

    if (hit) {
      return;
    }

    const traveledDistance = projectile.traveledDistance + stepDistance;
    const exhaustedByRange = traveledDistance >= projectile.maxRange - EPSILON;
    const exhaustedByWall = wallHit.distance <= stepDistance + EPSILON;

    if (exhaustedByRange || exhaustedByWall) {
      return;
    }

    nextProjectiles.push({
      ...projectile,
      position: end,
      traveledDistance: Number(traveledDistance.toFixed(4)),
    });
  });

  return {
    traces,
    traceByShooter,
    hitByShooter,
    pendingKills,
    nextProjectiles,
  };
}

function cloneProgram(program: ScriptAction[]): ScriptAction[] {
  return program.map((rule) => ({
    type: "RULE",
    line: rule.line,
    condition: rule.condition ? JSON.parse(JSON.stringify(rule.condition)) : null,
    command: JSON.parse(JSON.stringify(rule.command)),
  }));
}

function buildRobotState(
  robotDoc: BattleRobotInput,
  startX: number,
  startY: number,
  startDirection: Direction
): RobotState {
  const headingRad = headingByDirection(startDirection);
  return {
    id: robotDoc.id,
    robotName: robotDoc.robotName,
    x: startX,
    y: startY,
    direction: startDirection,
    headingRad,
    angleDeg: Number(((headingRad * 180) / Math.PI).toFixed(2)),
    alive: true,
    fireCooldownTicks: 0,
    energy: SIDE_BOOST_ENERGY_MAX,
    boostCooldownTicks: 0,
    boostBurstTicksRemaining: 0,
    boostDirectionLocked: null,
    enemyMemory: {
      prevEnemyX: null,
      prevEnemyY: null,
      prevEnemyHeading: null,
      prevEnemyDx: null,
      prevEnemyDy: null,
      prevEnemyDistance: null,
      ticksSinceEnemySeen: MEMORY_UNSEEN_TICKS_INITIAL,
    },
    program: cloneProgram(robotDoc.parsedProgram),
  };
}

function resolveMaxTicks(input: { maxTicks?: number; maxTurns?: number }): number {
  if (Number.isInteger(input.maxTicks)) {
    return input.maxTicks as number;
  }

  if (Number.isInteger(input.maxTurns)) {
    return input.maxTurns as number;
  }

  return 500;
}

function computeWinner(robotA: RobotState, robotB: RobotState): string | null {
  if (robotA.alive && !robotB.alive) {
    return robotA.id;
  }

  if (!robotA.alive && robotB.alive) {
    return robotB.id;
  }

  return null;
}

function lerp(start: number, end: number, progress: number): number {
  return start + (end - start) * progress;
}

function smoothStep(progress: number): number {
  if (progress <= 0) {
    return 0;
  }

  if (progress >= 1) {
    return 1;
  }

  return progress * progress * (3 - 2 * progress);
}

function interpolateAngleDeg(startDeg: number, endDeg: number, progress: number): number {
  const normalizedDelta = ((endDeg - startDeg + 540) % 360) - 180;
  const value = startDeg + normalizedDelta * progress;
  return ((value % 360) + 360) % 360;
}

function directionAtProgress(start: Direction, end: Direction, progress: number): Direction {
  if (start === end) {
    return start;
  }

  return progress < 0.5 ? start : end;
}

function interpolateRobotSnapshot(
  start: RobotSnapshot,
  end: RobotSnapshot,
  progress: number
): ReplayRobotSnapshot {
  const eased = smoothStep(progress);
  const startAngle =
    typeof start.angleDeg === "number" && Number.isFinite(start.angleDeg)
      ? start.angleDeg
      : DIRECTION_ANGLE_DEG[start.direction];
  const endAngle =
    typeof end.angleDeg === "number" && Number.isFinite(end.angleDeg)
      ? end.angleDeg
      : DIRECTION_ANGLE_DEG[end.direction];

  return {
    id: start.id,
    robotName: start.robotName,
    x: Number(lerp(start.x, end.x, eased).toFixed(4)),
    y: Number(lerp(start.y, end.y, eased).toFixed(4)),
    direction: directionAtProgress(start.direction, end.direction, eased),
    angleDeg: Number(interpolateAngleDeg(startAngle, endAngle, eased).toFixed(2)),
    alive: eased < 1 ? start.alive : end.alive,
    energy: Number(lerp(start.energy || 0, end.energy || 0, eased).toFixed(2)),
    boostCooldownTicks: Math.round(lerp(start.boostCooldownTicks || 0, end.boostCooldownTicks || 0, eased)),
  };
}

function interpolateBattleSnapshot(
  start: BattleSnapshot,
  end: BattleSnapshot,
  progress: number
): ReplayBattleSnapshot {
  return {
    robotA: interpolateRobotSnapshot(start.robotA, end.robotA, progress),
    robotB: interpolateRobotSnapshot(start.robotB, end.robotB, progress),
  };
}

function extractTickProjectiles(tickLog: TickLog): Projectile[] {
  return [...(tickLog.projectiles || [])];
}

function extractTickBoostEffects(actions: SimulationActionLog[]): BoostEffect[] {
  return actions
    .filter((entry) => entry.result.movement.boostUsed && entry.result.movement.boostDirection)
    .map((entry) => {
      const startActor = entry.before.robotA.id === entry.robotId ? entry.before.robotA : entry.before.robotB;
      const endActor = entry.after.robotA.id === entry.robotId ? entry.after.robotA : entry.after.robotB;
      const trail = entry.result.movement.boostTrail;

      return {
        robotId: entry.robotId,
        robotName: entry.robotName,
        direction: entry.result.movement.boostDirection as BoostDirection,
        from: trail ? trail.from : { x: startActor.x, y: startActor.y },
        to: trail ? trail.to : { x: endActor.x, y: endActor.y },
      };
    })
    .map((effect) => ({
      ...effect,
      from: { x: Number(effect.from.x.toFixed(4)), y: Number(effect.from.y.toFixed(4)) },
      to: { x: Number(effect.to.x.toFixed(4)), y: Number(effect.to.y.toFixed(4)) },
    }));
}

function buildReplayFrames(initialState: BattleSnapshot, ticks: TickLog[]): ReplayFrame[] {
  const frames: ReplayFrame[] = [
    {
      index: 0,
      timestampMs: 0,
      tick: 0,
      state: interpolateBattleSnapshot(initialState, initialState, 1),
      projectiles: [],
      boostEffects: [],
      actions: [],
    },
  ];

  let index = 1;

  ticks.forEach((tickLog) => {
    for (let sub = 1; sub <= REPLAY_FRAMES_PER_TICK; sub += 1) {
      const progress = sub / REPLAY_FRAMES_PER_TICK;
      const timestampMs = Math.round((tickLog.tick - 1) * TICK_DURATION_MS + progress * TICK_DURATION_MS);

      frames.push({
        index,
        timestampMs,
        tick: tickLog.tick,
        state: interpolateBattleSnapshot(tickLog.startState, tickLog.endState, progress),
        projectiles: sub === REPLAY_FRAMES_PER_TICK ? extractTickProjectiles(tickLog) : [],
        boostEffects: sub === REPLAY_FRAMES_PER_TICK ? extractTickBoostEffects(tickLog.actions) : [],
        actions:
          sub === REPLAY_FRAMES_PER_TICK
            ? tickLog.actions.map((action) => ({
                robotId: action.robotId,
                robotName: action.robotName,
                actionType: action.resolvedAction?.type || action.action?.type || "UNKNOWN",
                event: action.result.event,
                boostUsed: action.result.movement.boostUsed,
                boostDirection: action.result.movement.boostDirection,
              }))
            : [],
      });

      index += 1;
    }
  });

  return frames;
}

function formatControl(value: number): string {
  return value.toFixed(2);
}

function buildResultDetails(
  controls: ControlState,
  movement: MovementOutcome,
  rotation: RotationOutcome,
  fire: FireOutcome
): string {
  const parts = [
    `thr=${formatControl(controls.throttle)}`,
    `stf=${formatControl(controls.strafe)}`,
    `trn=${formatControl(controls.turn)}`,
    `rot=${rotation.deltaDeg.toFixed(1)}deg`,
    `move=${movement.distance.toFixed(3)}`,
  ];

  if (movement.blockedByRobot) {
    parts.push("blocked:robot");
  }

  if (movement.hitBoundary) {
    parts.push("clamped:boundary");
  }

  if (movement.boostUsed) {
    const direction = movement.boostDirection || "UNKNOWN";
    parts.push(
      `boost:${direction.toLowerCase()}(${movement.boostDistance.toFixed(3)},lvl=${movement.boostForceLevel},left=${movement.boostBurstTicksRemaining})`
    );
  } else if (movement.boostRequested) {
    parts.push(`boost:failed(energy=${movement.energyAfter.toFixed(1)},cd=${movement.boostCooldownRemaining})`);
  }

  if (fire.shotFired) {
    parts.push(fire.hit ? "fire:launched+hit" : "fire:launched");
  } else if (fire.hit) {
    parts.push("projectile:hit");
  } else if (fire.triggerHeld) {
    if (fire.blockedByEnergy) {
      parts.push(`fire:no-energy(${fire.energyAfter.toFixed(1)})`);
    } else {
      parts.push(`fire:cooldown(${fire.cooldownRemaining})`);
    }
  }

  return parts.join(" | ");
}

export function simulateBattle({
  robotA,
  robotB,
  arenaSize,
  maxTicks,
  maxTurns,
}: SimulateBattleInput): BattleSimulation {
  const tickLimit = resolveMaxTicks({ maxTicks, maxTurns });
  const a = buildRobotState(robotA, 0, 0, "E");
  const b = buildRobotState(robotB, arenaSize - 1, arenaSize - 1, "W");

  const ticks: TickLog[] = [];
  const timeline: SimulationActionLog[] = [];
  let activeProjectiles: InFlightProjectile[] = [];
  let step = 0;

  const initialState = snapshotBattle(a, b);
  const initialPerception: Record<string, Perception> = {
    [a.id]: buildPerception(a, b, arenaSize),
    [b.id]: buildPerception(b, a, arenaSize),
  };
  updateEnemyMemory(a, b, initialPerception[a.id]);
  updateEnemyMemory(b, a, initialPerception[b.id]);

  for (let tick = 1; tick <= tickLimit; tick += 1) {
    tickSideBoostState(a);
    tickSideBoostState(b);

    const startState = snapshotBattle(a, b);
    const startPerception: Record<string, Perception> = {
      [a.id]: buildPerception(a, b, arenaSize),
      [b.id]: buildPerception(b, a, arenaSize),
    };

    const aliveAtStart: Record<string, boolean> = {
      [a.id]: a.alive,
      [b.id]: b.alive,
    };

    const sensorA = buildSensorContext(a, b, startPerception[a.id], arenaSize);
    const sensorB = buildSensorContext(b, a, startPerception[b.id], arenaSize);

    const decisionA = resolveControls(a.program, sensorA);
    const decisionB = resolveControls(b.program, sensorB);

    const controlA = aliveAtStart[a.id] ? decisionA.controls : neutralControls();
    const controlB = aliveAtStart[b.id] ? decisionB.controls : neutralControls();

    const rotationOutcomes: Record<string, RotationOutcome> = {
      [a.id]: aliveAtStart[a.id] ? computeRotation(a, controlA) : { deltaDeg: 0 },
      [b.id]: aliveAtStart[b.id] ? computeRotation(b, controlB) : { deltaDeg: 0 },
    };

    const movementOutcomes = applyMovement(a, b, controlA, controlB, arenaSize);
    const fireResolution = resolveFiring(a, b, controlA, controlB);
    activeProjectiles = [...activeProjectiles, ...fireResolution.spawnedProjectiles];
    const projectileAdvance = advanceProjectiles(activeProjectiles, a, b, arenaSize);
    activeProjectiles = projectileAdvance.nextProjectiles;

    if (projectileAdvance.pendingKills.has(a.id)) {
      a.alive = false;
    }
    if (projectileAdvance.pendingKills.has(b.id)) {
      b.alive = false;
    }

    const fireOutcomes = fireResolution.outcomes;
    [a.id, b.id].forEach((robotId) => {
      const trace = projectileAdvance.traceByShooter[robotId];
      if (trace) {
        fireOutcomes[robotId].projectile = trace;
      }
      if (projectileAdvance.hitByShooter[robotId]) {
        fireOutcomes[robotId].hit = true;
      }
    });

    a.direction = directionFromHeading(a.headingRad);
    b.direction = directionFromHeading(b.headingRad);

    const endState = snapshotBattle(a, b);
    const endPerception: Record<string, Perception> = {
      [a.id]: buildPerception(a, b, arenaSize),
      [b.id]: buildPerception(b, a, arenaSize),
    };
    updateEnemyMemory(a, b, endPerception[a.id]);
    updateEnemyMemory(b, a, endPerception[b.id]);

    const tickActions: SimulationActionLog[] = [];

    const actorPairs: Array<{
      actor: RobotState;
      opponent: RobotState;
      decision: ControlDecision;
      controls: ControlState;
    }> = [
      {
        actor: a,
        opponent: b,
        decision: decisionA,
        controls: controlA,
      },
      {
        actor: b,
        opponent: a,
        decision: decisionB,
        controls: controlB,
      },
    ];

    actorPairs.forEach(({ actor, decision, controls }) => {
      if (!aliveAtStart[actor.id]) {
        return;
      }

      step += 1;

      const movement = movementOutcomes[actor.id];
      const rotation = rotationOutcomes[actor.id];
      const fire = fireOutcomes[actor.id];
      const event: ActionEvent = fire.shotFired || fire.hit ? "FIRE" : "CONTROL_TICK";

      const result: TickActionResult = {
        event,
        details: buildResultDetails(controls, movement, rotation, fire),
        phase: "completed",
        projectile: fire.projectile,
        controls,
        movement,
        rotation,
        firing: {
          triggerHeld: fire.triggerHeld,
          shotFired: fire.shotFired,
          cooldownRemaining: fire.cooldownRemaining,
          blockedByEnergy: fire.blockedByEnergy,
          energyBefore: fire.energyBefore,
          energyAfter: fire.energyAfter,
          hit: fire.hit,
        },
      };

      tickActions.push({
        tick,
        turn: tick,
        step,
        robotId: actor.id,
        robotName: actor.robotName,
        action: {
          type: "CONTROL_RULESET",
          totalRules: decision.totalRules,
          matchedRuleCount: decision.matchedRuleLines.length,
          matchedRuleLines: [...decision.matchedRuleLines],
        },
        resolvedAction: {
          type: "CONTROL",
          throttle: controls.throttle,
          strafe: controls.strafe,
          turn: controls.turn,
          fire: controls.fire,
          boost: controls.boost,
        },
        result,
        actionState: {
          totalTicks: 1,
          elapsedTicks: 1,
          remainingTicks: 0,
        },
        perceptionBefore: startPerception[actor.id],
        perceptionAfter: endPerception[actor.id],
        position: snapshotRobot(actor),
        before: startState,
        after: endState,
      });
    });

    const tickLog: TickLog = {
      tick,
      turn: tick,
      startState,
      startPerception,
      actions: tickActions,
      projectiles: projectileAdvance.traces,
      endState,
      endPerception,
    };

    ticks.push(tickLog);
    timeline.push(...tickActions);

    if (!a.alive || !b.alive) {
      break;
    }
  }

  const winnerRobotId = computeWinner(a, b);
  const status: "finished" | "draw" = winnerRobotId ? "finished" : "draw";
  const finalState = snapshotBattle(a, b);
  const finalPerception: Record<string, Perception> = {
    [a.id]: buildPerception(a, b, arenaSize),
    [b.id]: buildPerception(b, a, arenaSize),
  };
  const replayFrames = buildReplayFrames(initialState, ticks);
  const replayFrameRate = Math.round(1000 / (TICK_DURATION_MS / REPLAY_FRAMES_PER_TICK));

  return {
    status,
    winnerRobotId,
    visionRadius: VISION_RADIUS,
    shotRange: SHOT_RANGE,
    tickDurationMs: TICK_DURATION_MS,
    projectileTiming: {
      ticksPerTile: PROJECTILE_TICKS_PER_TILE,
      speedTilesPerSecond: Number(PROJECTILE_SPEED_TILES_PER_SECOND.toFixed(4)),
      speedTilesPerTick: Number((PROJECTILE_SPEED_TILES_PER_SECOND * (TICK_DURATION_MS / 1000)).toFixed(4)),
    },
    movementTiming: {
      forwardTicksPerTile: TICKS_PER_TILE.FORWARD,
      strafeTicksPerTile: TICKS_PER_TILE.STRAFE,
      backwardTicksPerTile: TICKS_PER_TILE.BACKWARD,
    },
    maxTicks: tickLimit,
    initialState,
    initialPerception,
    timeline,
    ticks,
    turns: ticks,
    replayFrameRate,
    replayFrames,
    finalState,
    finalPerception,
  };
}
