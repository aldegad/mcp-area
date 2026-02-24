"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import {
  createBattle,
  fetchRobots,
  type Battle,
  type BattleRequestPayload,
  type Robot,
} from "../lib/api";
import ReplayArena from "../components/ArenaReplay";

interface BattleFormState {
  robotAId: string;
  robotBId: string;
  arenaSize: number;
  maxTicks: number;
}

const INITIAL_BATTLE_FORM: BattleFormState = {
  robotAId: "",
  robotBId: "",
  arenaSize: 10,
  maxTicks: 500,
};

function formatCollaboratorAgent(agent: Robot["collaboratorAgents"][number]): string {
  if (typeof agent === "string") {
    return agent;
  }

  const model = agent.version ? ` (${agent.version})` : "";
  const role = agent.role ? ` - ${agent.role}` : "";
  return `${agent.name}${model}${role}`;
}

function formatCollaborators(agents: Robot["collaboratorAgents"]): string {
  if (!agents.length) {
    return "-";
  }

  return agents.map((agent) => formatCollaboratorAgent(agent)).join(", ");
}

function exampleMcpRequest(): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id: "upload-1",
    method: "tools/call",
    params: {
      name: "upload_robot_script",
      arguments: {
        creatorNickname: "soohong",
        collaboratorAgents: ["codex", "claude-code"],
        robotName: "MCP-Striker",
        movementRules: "THROTTLE 기반 전진 + 필요시 후진",
        rotationRules: "ENEMY_DY 부호에 맞춰 TURN 보정",
        attackRules: "적이 보일 때 FIRE ON",
        script:
          "SET THROTTLE 0.75\nSET STRAFE 0.2\nSET TURN 0.2\nFIRE OFF\nIF ENEMY_DY > 0.12 THEN SET TURN 1\nIF ENEMY_DY < -0.12 THEN SET TURN -1\nIF ENEMY_VISIBLE THEN FIRE ON",
        userApprovalConfirmed: true,
      },
    },
  };
}

export default function HomePage() {
  const [robots, setRobots] = useState<Robot[]>([]);
  const [battleForm, setBattleForm] = useState<BattleFormState>(INITIAL_BATTLE_FORM);
  const [lastBattle, setLastBattle] = useState<Battle | null>(null);
  const [error, setError] = useState("");
  const [isLoadingRobots, setIsLoadingRobots] = useState(false);
  const [isRunningBattle, setIsRunningBattle] = useState(false);

  const robotOptions = useMemo(
    () => robots.map((robot) => ({ value: robot.id, label: `${robot.robotName} (${robot.id})` })),
    [robots]
  );

  async function refreshRobots() {
    setIsLoadingRobots(true);
    setError("");

    try {
      const list = await fetchRobots();
      setRobots(list);

      if (list.length >= 2) {
        setBattleForm((prev) => ({
          ...prev,
          robotAId: prev.robotAId || list[0].id,
          robotBId: prev.robotBId || list[1].id,
        }));
      }
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : String(requestError);
      setError(message);
    } finally {
      setIsLoadingRobots(false);
    }
  }

  useEffect(() => {
    refreshRobots();
  }, []);

  async function handleBattle(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setIsRunningBattle(true);
    setError("");

    try {
      const payload: BattleRequestPayload = {
        robotAId: battleForm.robotAId,
        robotBId: battleForm.robotBId,
        arenaSize: Number(battleForm.arenaSize),
        maxTicks: Number(battleForm.maxTicks),
      };
      const battle = await createBattle(payload);

      setLastBattle(battle);
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : String(requestError);
      setError(message);
    } finally {
      setIsRunningBattle(false);
    }
  }

  return (
    <main className="container">
      <header className="hero">
        <h1>MCP Arena Prototype</h1>
        <p>Firebase Functions 기반 MCP 로봇 대전 시뮬레이션 (로봇 업로드는 MCP 툴 사용)</p>
      </header>

      {error ? <div className="error-box">{error}</div> : null}

      <section className="card robots-card">
        <div className="section-header">
          <h2>등록된 로봇</h2>
          <button type="button" onClick={refreshRobots} disabled={isLoadingRobots}>
            {isLoadingRobots ? "불러오는 중..." : "새로고침"}
          </button>
        </div>

        {robots.length ? (
          <ul className="robot-list">
            {robots.map((robot) => (
              <li key={robot.id}>
                <strong>{robot.robotName}</strong>
                <span>by {robot.creatorNickname}</span>
                <span>agents: {formatCollaborators(robot.collaboratorAgents)}</span>
                <span>commands: {robot.commandCount}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p>아직 등록된 로봇이 없습니다. MCP에서 upload_robot_script로 먼저 업로드하세요.</p>
        )}
      </section>

      <section className="card battle-card">
        <h2>배틀 실행</h2>
        <form className="grid-form" onSubmit={handleBattle}>
          <label>
            Robot A
            <select
              value={battleForm.robotAId}
              onChange={(event) =>
                setBattleForm((prev) => ({
                  ...prev,
                  robotAId: event.target.value,
                }))
              }
              required
            >
              <option value="">선택</option>
              {robotOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            Robot B
            <select
              value={battleForm.robotBId}
              onChange={(event) =>
                setBattleForm((prev) => ({
                  ...prev,
                  robotBId: event.target.value,
                }))
              }
              required
            >
              <option value="">선택</option>
              {robotOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            아레나 크기
            <input
              type="number"
              min={6}
              max={40}
              value={battleForm.arenaSize}
              onChange={(event) =>
                setBattleForm((prev) => ({
                  ...prev,
                  arenaSize: Number(event.target.value),
                }))
              }
            />
          </label>

          <label>
            최대 틱
            <input
              type="number"
              min={20}
              max={5000}
              value={battleForm.maxTicks}
              onChange={(event) =>
                setBattleForm((prev) => ({
                  ...prev,
                  maxTicks: Number(event.target.value),
                }))
              }
            />
          </label>

          <button type="submit" disabled={isRunningBattle || robots.length < 2}>
            {isRunningBattle ? "시뮬레이션 중..." : "배틀 시작"}
          </button>
        </form>

        {lastBattle ? (
          <div className="battle-result">
            <h3>최근 배틀 결과</h3>
            <p>battleId: {lastBattle.id}</p>
            <p>status: {lastBattle.status}</p>
            <p>winnerRobotId: {lastBattle.winnerRobotId || "draw"}</p>
            <p>ticks: {lastBattle.ticks?.length || lastBattle.turns?.length || 0}</p>

            <ReplayArena battle={lastBattle} />

            <details>
              <summary>틱 로그 보기</summary>
              <pre>{JSON.stringify(lastBattle.ticks || lastBattle.turns, null, 2)}</pre>
            </details>
          </div>
        ) : null}
      </section>

      <section className="card mcp-card">
        <h2>MCP JSON-RPC 예시</h2>
        <p>
          <code>POST /api/mcp</code>로 <code>initialize</code>, <code>tools/list</code>, <code>tools/call</code>
          을 호출할 수 있습니다.
        </p>
        <pre>{JSON.stringify(exampleMcpRequest(), null, 2)}</pre>
      </section>
    </main>
  );
}
