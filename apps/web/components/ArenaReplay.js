"use client";

import { useEffect, useMemo, useRef, useState } from "react";

function cloneState(state) {
  return {
    robotA: { ...state.robotA },
    robotB: { ...state.robotB },
  };
}

function fallbackInitialState(battle) {
  const arenaSize = Number(battle?.arenaSize) || 10;

  return {
    robotA: {
      id: battle?.robotAId || "A",
      robotName: "Robot A",
      x: 0,
      y: 0,
      direction: "E",
      alive: true,
    },
    robotB: {
      id: battle?.robotBId || "B",
      robotName: "Robot B",
      x: arenaSize - 1,
      y: arenaSize - 1,
      direction: "W",
      alive: true,
    },
  };
}

function getInitialState(battle) {
  if (battle?.initialState?.robotA && battle?.initialState?.robotB) {
    return cloneState(battle.initialState);
  }

  return fallbackInitialState(battle);
}

function flattenTimelineFromTurns(turns) {
  if (!Array.isArray(turns)) {
    return [];
  }

  const flat = [];
  turns.forEach((turn) => {
    (turn.actions || []).forEach((action) => {
      flat.push({
        ...action,
        turn: turn.turn,
      });
    });
  });

  return flat;
}

function applyLegacyAction(previousState, actionEntry) {
  const next = cloneState(previousState);
  const actorKey = next.robotA.id === actionEntry.robotId ? "robotA" : "robotB";
  const opponentKey = actorKey === "robotA" ? "robotB" : "robotA";

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

function buildFrames(battle) {
  if (!battle) {
    return [];
  }

  const initialState = getInitialState(battle);
  const timeline = Array.isArray(battle.timeline) && battle.timeline.length
    ? battle.timeline
    : flattenTimelineFromTurns(battle.turns);

  const frames = [
    {
      index: 0,
      label: "Start",
      state: initialState,
      action: null,
    },
  ];

  let previousState = initialState;

  timeline.forEach((entry, idx) => {
    const displayedActionType = entry?.resolvedAction?.type || entry?.action?.type || "?";
    const nextState = entry?.after?.robotA && entry?.after?.robotB
      ? cloneState(entry.after)
      : applyLegacyAction(previousState, entry);

    frames.push({
      index: idx + 1,
      label: `T${entry.turn || "?"} · ${entry.robotName || entry.robotId} · ${displayedActionType}`,
      state: nextState,
      action: entry,
    });

    previousState = nextState;
  });

  return frames;
}

function directionVector(direction) {
  if (direction === "N") return { x: 0, y: -1 };
  if (direction === "S") return { x: 0, y: 1 };
  if (direction === "E") return { x: 1, y: 0 };
  return { x: -1, y: 0 };
}

function drawGrid(ctx, arenaSize, cellSize, boardPx) {
  ctx.fillStyle = "#fffdf8";
  ctx.fillRect(0, 0, boardPx, boardPx);

  ctx.strokeStyle = "#d9d2c4";
  ctx.lineWidth = 1;
  for (let i = 0; i <= arenaSize; i += 1) {
    const p = i * cellSize;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, boardPx);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, p);
    ctx.lineTo(boardPx, p);
    ctx.stroke();
  }
}

function drawVisionCone(ctx, robot, color, cellSize, visionRadius) {
  if (!robot?.alive) {
    return;
  }

  const cx = robot.x * cellSize + cellSize / 2;
  const cy = robot.y * cellSize + cellSize / 2;
  const radius = visionRadius * cellSize;

  let start = 0;
  let end = 0;

  if (robot.direction === "N") {
    start = -Math.PI;
    end = 0;
  } else if (robot.direction === "E") {
    start = -Math.PI / 2;
    end = Math.PI / 2;
  } else if (robot.direction === "S") {
    start = 0;
    end = Math.PI;
  } else {
    start = Math.PI / 2;
    end = (Math.PI * 3) / 2;
  }

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, radius, start, end);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

function drawRobot(ctx, robot, color, cellSize) {
  const cx = robot.x * cellSize + cellSize / 2;
  const cy = robot.y * cellSize + cellSize / 2;
  const radius = cellSize * 0.3;

  ctx.beginPath();
  ctx.fillStyle = robot.alive ? color : "#999";
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();

  const vec = directionVector(robot.direction);
  ctx.beginPath();
  ctx.strokeStyle = "#111";
  ctx.lineWidth = Math.max(2, Math.floor(cellSize * 0.08));
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + vec.x * radius * 0.95, cy + vec.y * radius * 0.95);
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

  ctx.fillStyle = "#111";
  ctx.font = `${Math.max(10, Math.floor(cellSize * 0.18))}px IBM Plex Sans, sans-serif`;
  ctx.fillText(robot.robotName || robot.id, robot.x * cellSize + 4, robot.y * cellSize + cellSize - 6);
}

function drawProjectile(ctx, projectile, cellSize) {
  if (!projectile?.from || !projectile?.to) {
    return;
  }

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

function ReplayArena({ battle }) {
  const canvasRef = useRef(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const frames = useMemo(() => buildFrames(battle), [battle]);
  const arenaSize = Number(battle?.arenaSize) || 10;
  const visionRadius = Number(battle?.visionRadius) || 5;
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
    }, 650);

    return () => clearInterval(timer);
  }, [isPlaying, frames.length]);

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

    drawGrid(ctx, arenaSize, cellSize, boardPx);
    drawVisionCone(ctx, frame.state.robotA, "rgba(46, 125, 91, 0.14)", cellSize, visionRadius);
    drawVisionCone(ctx, frame.state.robotB, "rgba(175, 42, 42, 0.12)", cellSize, visionRadius);
    drawRobot(ctx, frame.state.robotA, "#2e7d5b", cellSize);
    drawRobot(ctx, frame.state.robotB, "#af2a2a", cellSize);

    const projectile = frame.action?.result?.projectile;
    if (projectile) {
      drawProjectile(ctx, projectile, cellSize);
    }
  }, [frames, frameIndex, arenaSize, boardPx, cellSize, visionRadius]);

  if (!battle || !frames.length) {
    return null;
  }

  const current = frames[frameIndex];
  const currentAction = current.action;
  const actorPerception = currentAction?.perceptionBefore;
  const enemyVisible = actorPerception?.enemyVisible;
  const actionType = currentAction?.resolvedAction?.type || currentAction?.action?.type || "START";

  return (
    <div className="replay-wrap">
      <div className="replay-topbar">
        <strong>Replay</strong>
        <span>
          Frame {frameIndex}/{Math.max(0, frames.length - 1)}
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
        <button
          type="button"
          onClick={() => setIsPlaying((prev) => !prev)}
          disabled={frames.length <= 1}
        >
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
      <div className="replay-caption">
        Vision radius: {visionRadius} | Action: {actionType} | Enemy visible:{" "}
        {typeof enemyVisible === "boolean" ? String(enemyVisible) : "n/a"}
      </div>
    </div>
  );
}

export default ReplayArena;
