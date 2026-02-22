"use client";

import { useEffect, useMemo, useState } from "react";
import { createBattle, fetchRobots, uploadRobot } from "../lib/api";
import ReplayArena from "../components/ArenaReplay";

const DEFAULT_SCRIPT = `# parser.js DSL
IF_SEEN SHOOT
MOVE 1
IF_NOT_SEEN ROTATE RIGHT
IF_SEEN SHOOT
WAIT`;

const INITIAL_UPLOAD_FORM = {
  creatorNickname: "",
  collaboratorAgents: "codex,gpt-5",
  robotName: "Arena-Rover",
  movementRules: "한 턴에 1~2칸 전진 후 회전",
  rotationRules: "적 미발견 시 우회전으로 시야 탐색",
  attackRules: "전방 5칸 시야에 적이 보이면 SHOOT",
  script: DEFAULT_SCRIPT,
};

const INITIAL_BATTLE_FORM = {
  robotAId: "",
  robotBId: "",
  arenaSize: 10,
  maxTurns: 50,
};

function parseCollaborators(rawInput) {
  if (!rawInput.trim()) {
    return [];
  }

  return rawInput
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function exampleMcpRequest() {
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
        movementRules: "전진 후 우회전",
        rotationRules: "RIGHT 우선",
        attackRules: "정면에 적 발견 시 SHOOT",
        script: "IF_SEEN SHOOT\nMOVE 1\nIF_NOT_SEEN ROTATE RIGHT\nIF_SEEN SHOOT",
        userApprovalConfirmed: true,
      },
    },
  };
}

export default function HomePage() {
  const [robots, setRobots] = useState([]);
  const [uploadForm, setUploadForm] = useState(INITIAL_UPLOAD_FORM);
  const [battleForm, setBattleForm] = useState(INITIAL_BATTLE_FORM);
  const [lastBattle, setLastBattle] = useState(null);
  const [error, setError] = useState("");
  const [isLoadingRobots, setIsLoadingRobots] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
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
      setError(requestError.message);
    } finally {
      setIsLoadingRobots(false);
    }
  }

  useEffect(() => {
    refreshRobots();
  }, []);

  async function handleUpload(event) {
    event.preventDefault();
    setIsUploading(true);
    setError("");

    try {
      await uploadRobot({
        creatorNickname: uploadForm.creatorNickname,
        collaboratorAgents: parseCollaborators(uploadForm.collaboratorAgents),
        robotName: uploadForm.robotName,
        movementRules: uploadForm.movementRules,
        rotationRules: uploadForm.rotationRules,
        attackRules: uploadForm.attackRules,
        script: uploadForm.script,
      });

      await refreshRobots();

      setUploadForm((prev) => ({
        ...prev,
        creatorNickname: "",
        robotName: "",
      }));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setIsUploading(false);
    }
  }

  async function handleBattle(event) {
    event.preventDefault();
    setIsRunningBattle(true);
    setError("");

    try {
      const battle = await createBattle({
        robotAId: battleForm.robotAId,
        robotBId: battleForm.robotBId,
        arenaSize: Number(battleForm.arenaSize),
        maxTurns: Number(battleForm.maxTurns),
      });

      setLastBattle(battle);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setIsRunningBattle(false);
    }
  }

  return (
    <main className="container">
      <header className="hero">
        <h1>MCP Arena Prototype</h1>
        <p>Firebase Functions 기반 MCP 로봇 업로드 + 2대 전투 시뮬레이션(1회 피격 사망)</p>
      </header>

      {error ? <div className="error-box">{error}</div> : null}

      <section className="card">
        <h2>1) 로봇 스크립트 업로드</h2>
        <form className="grid-form" onSubmit={handleUpload}>
          <label>
            만든 사람(닉네임)
            <input
              value={uploadForm.creatorNickname}
              onChange={(event) =>
                setUploadForm((prev) => ({
                  ...prev,
                  creatorNickname: event.target.value,
                }))
              }
              required
            />
          </label>

          <label>
            협업한 Agent(쉼표 구분)
            <input
              value={uploadForm.collaboratorAgents}
              onChange={(event) =>
                setUploadForm((prev) => ({
                  ...prev,
                  collaboratorAgents: event.target.value,
                }))
              }
            />
          </label>

          <label>
            로봇 이름(모델명)
            <input
              value={uploadForm.robotName}
              onChange={(event) =>
                setUploadForm((prev) => ({
                  ...prev,
                  robotName: event.target.value,
                }))
              }
              required
            />
          </label>

          <label>
            이동 규칙
            <input
              value={uploadForm.movementRules}
              onChange={(event) =>
                setUploadForm((prev) => ({
                  ...prev,
                  movementRules: event.target.value,
                }))
              }
              required
            />
          </label>

          <label>
            회전 규칙
            <input
              value={uploadForm.rotationRules}
              onChange={(event) =>
                setUploadForm((prev) => ({
                  ...prev,
                  rotationRules: event.target.value,
                }))
              }
            />
          </label>

          <label>
            공격 규칙
            <input
              value={uploadForm.attackRules}
              onChange={(event) =>
                setUploadForm((prev) => ({
                  ...prev,
                  attackRules: event.target.value,
                }))
              }
              required
            />
          </label>

          <label className="full-width">
            parser.js 스크립트
            <textarea
              rows={8}
              value={uploadForm.script}
              onChange={(event) =>
                setUploadForm((prev) => ({
                  ...prev,
                  script: event.target.value,
                }))
              }
              required
            />
          </label>

          <button type="submit" disabled={isUploading}>
            {isUploading ? "업로드 중..." : "로봇 업로드"}
          </button>
        </form>
      </section>

      <section className="card">
        <div className="section-header">
          <h2>2) 등록된 로봇</h2>
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
                <span>commands: {robot.commandCount}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p>아직 업로드된 로봇이 없습니다.</p>
        )}
      </section>

      <section className="card">
        <h2>3) 배틀 실행</h2>
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
                  arenaSize: event.target.value,
                }))
              }
            />
          </label>

          <label>
            최대 턴
            <input
              type="number"
              min={1}
              max={300}
              value={battleForm.maxTurns}
              onChange={(event) =>
                setBattleForm((prev) => ({
                  ...prev,
                  maxTurns: event.target.value,
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
            <p>turns: {lastBattle.turns?.length || 0}</p>

            <ReplayArena battle={lastBattle} />

            <details>
              <summary>턴 로그 보기</summary>
              <pre>{JSON.stringify(lastBattle.turns, null, 2)}</pre>
            </details>
          </div>
        ) : null}
      </section>

      <section className="card">
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
