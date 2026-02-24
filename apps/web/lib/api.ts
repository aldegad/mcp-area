const DEFAULT_BASE_URL = "/api";

export interface Robot {
  id: string;
  creatorNickname: string;
  collaboratorAgents: Array<string | { name: string; role?: string; version?: string }>;
  robotName: string;
  movementRules: string;
  rotationRules: string;
  attackRules: string;
  scriptPath: string;
  robotImagePath: string | null;
  commandCount: number;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface BattleRequestPayload {
  robotAId: string;
  robotBId: string;
  arenaSize: number;
  maxTicks: number;
}

export interface UploadRobotPayload {
  creatorNickname: string;
  collaboratorAgents: Array<string | { name: string; role?: string; version?: string }>;
  robotName: string;
  movementRules: string;
  rotationRules: string;
  attackRules: string;
  script: string;
  robotImageSvg?: string;
}

export interface RobotStateSnapshot {
  id: string;
  robotName: string;
  x: number;
  y: number;
  direction: "N" | "E" | "S" | "W";
  angleDeg?: number;
  alive: boolean;
  energy?: number;
  boostCooldownTicks?: number;
}

export interface BattleSnapshot {
  robotA: RobotStateSnapshot;
  robotB: RobotStateSnapshot;
}

export interface BattlePerception {
  range: number;
  enemyVisible: boolean;
  enemy:
    | {
        id: string;
        robotName: string;
        dx: number;
        dy: number;
        distance: number;
        distanceBand: "near" | "mid" | "far";
        bearing: "FRONT" | "FRONT_LEFT" | "FRONT_RIGHT";
        headingDeg: number;
        headingDirection: "N" | "E" | "S" | "W";
        absolutePosition: { x: number; y: number };
      }
    | null;
  wall: {
    arenaSize: number;
    aheadDistance: number;
    leftDistance: number;
    rightDistance: number;
    backDistance: number;
    nearestDistance: number;
    nearestDirection: "AHEAD" | "LEFT" | "RIGHT" | "BACK";
    sightArc: {
      center: {
        point: { x: number; y: number };
        side: "NORTH" | "EAST" | "SOUTH" | "WEST";
        distance: number;
      };
      leftEdge: {
        point: { x: number; y: number };
        side: "NORTH" | "EAST" | "SOUTH" | "WEST";
        distance: number;
      };
      rightEdge: {
        point: { x: number; y: number };
        side: "NORTH" | "EAST" | "SOUTH" | "WEST";
        distance: number;
      };
    };
  };
}

export interface BattleActionLog {
  tick: number;
  turn: number;
  step: number;
  robotId: string;
  robotName: string;
  action: { type: string; [key: string]: unknown };
  resolvedAction: { type: string; [key: string]: unknown };
  result: {
    event: string;
    details: string;
    phase?: "in_progress" | "completed";
    projectile?: {
      from: { x: number; y: number };
      to: { x: number; y: number };
      direction: "N" | "E" | "S" | "W";
      range: number;
      hit: boolean;
      targetRobotId: string | null;
    } | null;
    movement?: {
      boostRequested?: boolean;
      boostUsed?: boolean;
      boostDirection?: "LEFT" | "RIGHT" | null;
      boostDistance?: number;
      boostForceLevel?: number;
      boostBurstTicksRemaining?: number;
      boostTrail?: {
        from: { x: number; y: number };
        to: { x: number; y: number };
      } | null;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  actionState: {
    totalTicks: number;
    elapsedTicks: number;
    remainingTicks: number;
  };
  perceptionBefore: BattlePerception;
  perceptionAfter: BattlePerception;
  position: RobotStateSnapshot;
  before: BattleSnapshot;
  after: BattleSnapshot;
}

export interface BattleTickLog {
  tick: number;
  turn: number;
  startState: BattleSnapshot;
  startPerception: Record<string, BattlePerception>;
  actions: BattleActionLog[];
  projectiles?: Array<NonNullable<BattleActionLog["result"]["projectile"]>>;
  endState: BattleSnapshot;
  endPerception: Record<string, BattlePerception>;
}

export interface BattleReplayActionHint {
  robotId: string;
  robotName: string;
  actionType: string;
  event: string;
  boostUsed: boolean;
  boostDirection: "LEFT" | "RIGHT" | null;
}

export interface BattleBoostEffect {
  robotId: string;
  robotName: string;
  direction: "LEFT" | "RIGHT";
  from: { x: number; y: number };
  to: { x: number; y: number };
}

export interface BattleReplayFrame {
  index: number;
  timestampMs: number;
  tick: number;
  state: BattleSnapshot;
  projectiles: Array<NonNullable<BattleActionLog["result"]["projectile"]>>;
  boostEffects: BattleBoostEffect[];
  actions: BattleReplayActionHint[];
}

export interface Battle {
  id: string;
  robotAId: string;
  robotBId: string;
  arenaSize: number;
  maxTicks: number;
  maxTurns?: number;
  status: "finished" | "draw";
  winnerRobotId: string | null;
  visionRadius: number;
  shotRange?: number;
  tickDurationMs: number;
  projectileTiming?: {
    ticksPerTile: number;
    speedTilesPerSecond: number;
    speedTilesPerTick: number;
  };
  replayFrameRate: number;
  movementTiming: {
    forwardTicksPerTile: number;
    strafeTicksPerTile: number;
    backwardTicksPerTile: number;
  };
  initialState: BattleSnapshot;
  initialPerception: Record<string, BattlePerception>;
  timeline: BattleActionLog[];
  ticks: BattleTickLog[];
  turns?: BattleTickLog[];
  replayFrames: BattleReplayFrame[];
  finalState: BattleSnapshot;
  finalPerception: Record<string, BattlePerception>;
  createdAt: string | null;
}

interface ErrorPayload {
  error?: string;
  details?: unknown;
}

function resolveBaseUrl(): string {
  const env = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (env && env.trim()) {
    return env.replace(/\/$/, "");
  }

  return DEFAULT_BASE_URL;
}

export function buildRobotAvatarUrl(robotId: string): string {
  return `${resolveBaseUrl()}/robots/${encodeURIComponent(robotId)}/avatar`;
}

export async function apiRequest<TResponse>(path: string, options: RequestInit = {}): Promise<TResponse> {
  const url = `${resolveBaseUrl()}${path}`;
  const headers = new Headers(options.headers ?? undefined);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  const data = (await response.json().catch(() => ({}))) as TResponse & ErrorPayload;
  if (!response.ok) {
    const error = new Error(data.error || "API request failed") as Error & {
      details?: unknown;
    };
    error.details = data.details;
    throw error;
  }

  return data;
}

export async function fetchRobots(): Promise<Robot[]> {
  const data = await apiRequest<{ robots?: Robot[] }>("/robots", { method: "GET" });
  return data.robots || [];
}

export async function uploadRobot(payload: UploadRobotPayload): Promise<Robot> {
  const data = await apiRequest<{ robot: Robot }>("/robots", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  return data.robot;
}

export async function createBattle(payload: BattleRequestPayload): Promise<Battle> {
  const data = await apiRequest<{ battle: Battle }>("/battles", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  return data.battle;
}
