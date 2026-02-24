"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  Battle,
  BattleActionLog,
  BattleBoostEffect,
  BattleReplayFrame,
  BattleSnapshot,
  BattleTickLog,
  RobotStateSnapshot,
} from "../lib/api";

type BattleState = BattleSnapshot;
type RobotKey = "robotA" | "robotB";
type BattleProjectile = NonNullable<BattleActionLog["result"]["projectile"]>;
const SENSOR_HALF_ARC_RAD = Math.PI / 3;

interface ReplayFrameView {
  index: number;
  label: string;
  state: BattleState;
  projectiles: BattleProjectile[];
  boostEffects: BattleBoostEffect[];
  actionSummary: string;
}

function cloneState(state: BattleState): BattleState {
  return {
    robotA: { ...state.robotA },
    robotB: { ...state.robotB },
  };
}

function fallbackInitialState(battle: Battle): BattleState {
  const arenaSize = Number(battle?.arenaSize) || 10;

  return {
    robotA: {
      id: battle?.robotAId || "A",
      robotName: "Robot A",
      x: 0,
      y: 0,
      direction: "E",
      angleDeg: 0,
      alive: true,
      energy: 100,
      boostCooldownTicks: 0,
    },
    robotB: {
      id: battle?.robotBId || "B",
      robotName: "Robot B",
      x: arenaSize - 1,
      y: arenaSize - 1,
      direction: "W",
      angleDeg: 180,
      alive: true,
      energy: 100,
      boostCooldownTicks: 0,
    },
  };
}

function getInitialState(battle: Battle): BattleState {
  if (battle?.initialState?.robotA && battle?.initialState?.robotB) {
    return cloneState(battle.initialState);
  }

  return fallbackInitialState(battle);
}

function actionType(entry: Pick<BattleActionLog, "resolvedAction" | "action">): string {
  return entry?.resolvedAction?.type || entry?.action?.type || "?";
}

function flattenTimelineFromTurns(turns: Battle["turns"]): BattleActionLog[] {
  if (!Array.isArray(turns)) {
    return [];
  }

  return turns.flatMap((turn) =>
    (turn.actions || []).map((action) => ({
      ...action,
      turn: turn.turn,
    }))
  );
}

function applyLegacyAction(previousState: BattleState, actionEntry: BattleActionLog): BattleState {
  const next = cloneState(previousState);
  const actorKey: RobotKey = next.robotA.id === actionEntry.robotId ? "robotA" : "robotB";
  const opponentKey: RobotKey = actorKey === "robotA" ? "robotB" : "robotA";

  if (actionEntry?.position) {
    next[actorKey] = {
      ...next[actorKey],
      ...actionEntry.position,
    };
  }

  if (actionEntry?.result?.details?.includes("hit confirmed")) {
    next[opponentKey] = {
      ...next[opponentKey],
      alive: false,
    };
  }

  return next;
}

function projectileListFromActions(actions: BattleActionLog[]): BattleProjectile[] {
  return actions
    .map((action) => action.result?.projectile)
    .filter((projectile): projectile is BattleProjectile => Boolean(projectile));
}

function boostEffectsFromActions(actions: BattleActionLog[]): BattleBoostEffect[] {
  return actions.flatMap((action) => {
    const movement = action.result?.movement;
    if (!movement?.boostUsed || !movement.boostDirection) {
      return [];
    }

    const beforeActor = action.before.robotA.id === action.robotId ? action.before.robotA : action.before.robotB;
    const afterActor = action.after.robotA.id === action.robotId ? action.after.robotA : action.after.robotB;
    const from = movement.boostTrail?.from || { x: beforeActor.x, y: beforeActor.y };
    const to = movement.boostTrail?.to || { x: afterActor.x, y: afterActor.y };

    return [
      {
        robotId: action.robotId,
        robotName: action.robotName,
        direction: movement.boostDirection,
        from,
        to,
      },
    ];
  });
}

function buildFramesFromReplayFrames(replayFrames: BattleReplayFrame[]): ReplayFrameView[] {
  return replayFrames.map((frame, idx) => {
    const actionSummary = frame.actions.length
      ? frame.actions.map((action) => `${action.robotName}:${action.actionType}`).join(" | ")
      : "no action";

    return {
      index: idx,
      label: `T${frame.tick} · ${Math.round(frame.timestampMs)}ms`,
      state: cloneState(frame.state),
      projectiles: frame.projectiles || [],
      boostEffects: frame.boostEffects || [],
      actionSummary,
    };
  });
}

function buildFramesFromTicks(battle: Battle): ReplayFrameView[] {
  const initialState = getInitialState(battle);
  const tickLogs: BattleTickLog[] = Array.isArray(battle.ticks)
    ? battle.ticks
    : Array.isArray(battle.turns)
      ? battle.turns
      : [];

  const frames: ReplayFrameView[] = [
    {
      index: 0,
      label: "Start",
      state: initialState,
      projectiles: [],
      boostEffects: [],
      actionSummary: "initial state",
    },
  ];

  tickLogs.forEach((tickLog, idx) => {
    const actions = tickLog.actions || [];
    const summary = actions.length
      ? actions.map((action) => `${action.robotName}:${actionType(action)}`).join(" | ")
      : "no action";

    frames.push({
      index: idx + 1,
      label: `T${tickLog.tick} · tick`,
      state: cloneState(tickLog.endState || initialState),
      projectiles: tickLog.projectiles?.length ? [...tickLog.projectiles] : projectileListFromActions(actions),
      boostEffects: boostEffectsFromActions(actions),
      actionSummary: summary,
    });
  });

  return frames;
}

function buildFramesFromLegacyTimeline(battle: Battle): ReplayFrameView[] {
  const initialState = getInitialState(battle);
  const timeline =
    Array.isArray(battle.timeline) && battle.timeline.length
      ? battle.timeline
      : flattenTimelineFromTurns(battle.turns);

  const frames: ReplayFrameView[] = [
    {
      index: 0,
      label: "Start",
      state: initialState,
      projectiles: [],
      boostEffects: [],
      actionSummary: "initial state",
    },
  ];

  let previousState = initialState;

  timeline.forEach((entry, idx) => {
    const nextState =
      entry?.after?.robotA && entry?.after?.robotB ? cloneState(entry.after) : applyLegacyAction(previousState, entry);

    frames.push({
      index: idx + 1,
      label: `T${entry.tick || entry.turn || "?"} · ${entry.robotName || entry.robotId} · ${actionType(entry)}`,
      state: nextState,
      projectiles: entry.result?.projectile ? [entry.result.projectile] : [],
      boostEffects: boostEffectsFromActions([entry]),
      actionSummary: `${entry.robotName || entry.robotId}:${actionType(entry)}`,
    });

    previousState = nextState;
  });

  return frames;
}

function buildFrames(battle: Battle | null): ReplayFrameView[] {
  if (!battle) {
    return [];
  }

  if (Array.isArray(battle.replayFrames) && battle.replayFrames.length) {
    return buildFramesFromReplayFrames(battle.replayFrames);
  }

  if (Array.isArray(battle.ticks) && battle.ticks.length) {
    return buildFramesFromTicks(battle);
  }

  return buildFramesFromLegacyTimeline(battle);
}

function directionAngleRad(robot: RobotStateSnapshot): number {
  if (typeof robot.angleDeg === "number" && Number.isFinite(robot.angleDeg)) {
    return (robot.angleDeg * Math.PI) / 180;
  }

  if (robot.direction === "N") return -Math.PI / 2;
  if (robot.direction === "S") return Math.PI / 2;
  if (robot.direction === "E") return 0;
  return Math.PI;
}

function drawArenaBackground(ctx: CanvasRenderingContext2D, boardPx: number): void {
  const gradient = ctx.createLinearGradient(0, 0, boardPx, boardPx);
  gradient.addColorStop(0, "#faf4e6");
  gradient.addColorStop(1, "#efe3c8");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, boardPx, boardPx);

  ctx.strokeStyle = "rgba(47, 37, 22, 0.22)";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, boardPx - 2, boardPx - 2);

  ctx.strokeStyle = "rgba(84, 66, 34, 0.1)";
  ctx.lineWidth = 1;
  for (let ring = 1; ring <= 5; ring += 1) {
    const radius = (boardPx / 12) * ring;
    ctx.beginPath();
    ctx.arc(boardPx / 2, boardPx / 2, radius, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawVisionCone(
  ctx: CanvasRenderingContext2D,
  robot: RobotStateSnapshot,
  color: string,
  cellSize: number,
  visionRadius: number
): void {
  if (!robot?.alive) {
    return;
  }

  const cx = robot.x * cellSize + cellSize / 2;
  const cy = robot.y * cellSize + cellSize / 2;
  const radius = visionRadius * cellSize;
  const angle = directionAngleRad(robot);

  const halfArc = SENSOR_HALF_ARC_RAD;
  const start = angle - halfArc;
  const end = angle + halfArc;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, radius, start, end);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

function drawShotRangeCone(
  ctx: CanvasRenderingContext2D,
  robot: RobotStateSnapshot,
  color: string,
  cellSize: number,
  shotRange: number
): void {
  if (!robot?.alive) {
    return;
  }

  const cx = robot.x * cellSize + cellSize / 2;
  const cy = robot.y * cellSize + cellSize / 2;
  const radius = shotRange * cellSize;
  const angle = directionAngleRad(robot);

  const start = angle - SENSOR_HALF_ARC_RAD;
  const end = angle + SENSOR_HALF_ARC_RAD;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, radius, start, end);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.22;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.lineWidth = Math.max(1, Math.floor(cellSize * 0.05));
  ctx.strokeStyle = color;
  ctx.setLineDash([4, 4]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function drawRobot(
  ctx: CanvasRenderingContext2D,
  robot: RobotStateSnapshot,
  color: string,
  cellSize: number,
  boardPx: number
): void {
  const cx = robot.x * cellSize + cellSize / 2;
  const cy = robot.y * cellSize + cellSize / 2;
  const radius = cellSize * 0.3;

  ctx.beginPath();
  ctx.fillStyle = robot.alive ? color : "#999";
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();

  const angle = directionAngleRad(robot);
  const dx = Math.cos(angle) * radius * 0.95;
  const dy = Math.sin(angle) * radius * 0.95;

  ctx.beginPath();
  ctx.strokeStyle = "#111";
  ctx.lineWidth = Math.max(2, Math.floor(cellSize * 0.08));
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + dx, cy + dy);
  ctx.stroke();

  if (!robot.alive) {
    ctx.beginPath();
    ctx.strokeStyle = "#4c4c4c";
    ctx.lineWidth = Math.max(2, Math.floor(cellSize * 0.07));
    ctx.moveTo(cx - radius * 0.7, cy - radius * 0.7);
    ctx.lineTo(cx + radius * 0.7, cy + radius * 0.7);
    ctx.moveTo(cx + radius * 0.7, cy - radius * 0.7);
    ctx.lineTo(cx - radius * 0.7, cy + radius * 0.7);
    ctx.stroke();
  }

  const labelY = Math.min(boardPx - 8, cy + radius + Math.max(12, Math.floor(cellSize * 0.22)));

  ctx.fillStyle = "#111";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `${Math.max(10, Math.floor(cellSize * 0.18))}px IBM Plex Sans, sans-serif`;
  ctx.fillText(robot.robotName || robot.id, cx, labelY);
  if (typeof robot.energy === "number") {
    ctx.font = `${Math.max(8, Math.floor(cellSize * 0.15))}px IBM Plex Sans, sans-serif`;
    ctx.fillText(`E:${robot.energy.toFixed(0)}`, cx, Math.min(boardPx - 4, labelY + Math.max(10, Math.floor(cellSize * 0.18))));
  }
  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";
}

function drawProjectile(ctx: CanvasRenderingContext2D, projectile: BattleProjectile, cellSize: number): void {
  const fromX = projectile.from.x * cellSize + cellSize / 2;
  const fromY = projectile.from.y * cellSize + cellSize / 2;
  const toX = projectile.to.x * cellSize + cellSize / 2;
  const toY = projectile.to.y * cellSize + cellSize / 2;

  ctx.beginPath();
  ctx.strokeStyle = projectile.hit ? "#c62828" : "#d17f18";
  ctx.lineWidth = Math.max(2, Math.floor(cellSize * 0.08));
  if (!projectile.hit) {
    ctx.setLineDash([6, 4]);
  }
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(toX, toY);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawBoostEffect(ctx: CanvasRenderingContext2D, effect: BattleBoostEffect, cellSize: number): void {
  const fromX = effect.from.x * cellSize + cellSize / 2;
  const fromY = effect.from.y * cellSize + cellSize / 2;
  const toX = effect.to.x * cellSize + cellSize / 2;
  const toY = effect.to.y * cellSize + cellSize / 2;
  const color = effect.direction === "LEFT" ? "rgba(68, 186, 255, 0.9)" : "rgba(255, 164, 56, 0.9)";

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, Math.floor(cellSize * 0.12));
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(toX, toY);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.beginPath();
  ctx.fillStyle = color;
  ctx.arc(toX, toY, Math.max(2, cellSize * 0.1), 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#222";
  ctx.font = `${Math.max(9, Math.floor(cellSize * 0.16))}px IBM Plex Sans, sans-serif`;
  ctx.fillText("칙!", toX + 4, toY - 4);
  ctx.restore();
}

function ReplayArena({ battle }: { battle: Battle | null }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const frames = useMemo(() => buildFrames(battle), [battle]);
  const arenaSize = Number(battle?.arenaSize) || 10;
  const visionRadius = Number(battle?.visionRadius) || 5;
  const shotRange = Number(battle?.shotRange) || 5;
  const frameIntervalMs = useMemo(() => {
    if (battle?.replayFrameRate && Number.isFinite(battle.replayFrameRate)) {
      return Math.max(16, 1000 / battle.replayFrameRate);
    }

    return Math.max(16, Number(battle?.tickDurationMs) || 200);
  }, [battle?.replayFrameRate, battle?.tickDurationMs]);
  const cellSize = Math.max(22, Math.floor(560 / arenaSize));
  const boardPx = cellSize * arenaSize;

  useEffect(() => {
    setFrameIndex(0);
    setIsPlaying(false);
  }, [battle?.id]);

  useEffect(() => {
    if (!isPlaying || frames.length <= 1) {
      return undefined;
    }

    const timer = setInterval(() => {
      setFrameIndex((prev) => {
        if (prev >= frames.length - 1) {
          setIsPlaying(false);
          return prev;
        }

        return prev + 1;
      });
    }, frameIntervalMs);

    return () => clearInterval(timer);
  }, [isPlaying, frames.length, frameIntervalMs]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const frame = frames[frameIndex];

    if (!canvas || !frame) {
      return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    drawArenaBackground(ctx, boardPx);
    drawVisionCone(ctx, frame.state.robotA, "rgba(46, 125, 91, 0.14)", cellSize, visionRadius);
    drawVisionCone(ctx, frame.state.robotB, "rgba(175, 42, 42, 0.12)", cellSize, visionRadius);
    drawShotRangeCone(ctx, frame.state.robotA, "#2e7d5b", cellSize, shotRange);
    drawShotRangeCone(ctx, frame.state.robotB, "#af2a2a", cellSize, shotRange);
    drawRobot(ctx, frame.state.robotA, "#2e7d5b", cellSize, boardPx);
    drawRobot(ctx, frame.state.robotB, "#af2a2a", cellSize, boardPx);

    frame.boostEffects.forEach((effect) => drawBoostEffect(ctx, effect, cellSize));
    frame.projectiles.forEach((projectile) => drawProjectile(ctx, projectile, cellSize));
  }, [frames, frameIndex, boardPx, cellSize, visionRadius, shotRange]);

  if (!battle || !frames.length) {
    return null;
  }

  const current = frames[frameIndex];

  return (
    <div className="replay-wrap">
      <div className="replay-topbar">
        <strong>Replay</strong>
        <span>
          Frame {frameIndex}/{Math.max(0, frames.length - 1)} · {frameIntervalMs.toFixed(2)}ms
        </span>
      </div>

      <canvas
        ref={canvasRef}
        width={boardPx}
        height={boardPx}
        className="arena-canvas"
        aria-label="arena replay"
      />

      <div className="replay-controls">
        <button type="button" onClick={() => setFrameIndex(0)} disabled={frameIndex === 0}>
          처음
        </button>
        <button
          type="button"
          onClick={() => setFrameIndex((prev) => Math.max(0, prev - 1))}
          disabled={frameIndex === 0}
        >
          이전
        </button>
        <button type="button" onClick={() => setIsPlaying((prev) => !prev)} disabled={frames.length <= 1}>
          {isPlaying ? "일시정지" : "재생"}
        </button>
        <button
          type="button"
          onClick={() => setFrameIndex((prev) => Math.min(frames.length - 1, prev + 1))}
          disabled={frameIndex >= frames.length - 1}
        >
          다음
        </button>
        <button
          type="button"
          onClick={() => setFrameIndex(frames.length - 1)}
          disabled={frameIndex >= frames.length - 1}
        >
          마지막
        </button>
      </div>

      <div className="replay-caption">{current.label}</div>
      <div className="replay-caption">Vision {visionRadius} / Shot {shotRange}</div>
      <div className="replay-caption">Actions: {current.actionSummary}</div>
    </div>
  );
}

export default ReplayArena;
