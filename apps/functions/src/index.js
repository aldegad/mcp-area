const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const { FieldValue } = require("firebase-admin/firestore");
const cors = require("cors");
const { z } = require("zod");
const { parseRobotScript } = require("./parser");
const { simulateBattle } = require("./battleEngine");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const enableCors = cors({ origin: true });

const PLAY_STYLE_VALUES = ["aggressive", "balanced", "defensive", "trickster"];
const RISK_VALUES = ["low", "medium", "high"];
const TRAIT_VALUES = ["fast", "accurate", "simple", "unpredictable"];

const STYLE_ENUM = z.enum(PLAY_STYLE_VALUES);
const RISK_ENUM = z.enum(RISK_VALUES);
const TRAIT_ENUM = z.enum(TRAIT_VALUES);

const COLLABORATOR_SCHEMA = z.union([
  z.string().min(1).max(120),
  z.object({
    name: z.string().min(1).max(120),
    role: z.string().max(120).optional(),
    version: z.string().max(120).optional(),
  }),
]);

const ROBOT_UPLOAD_SCHEMA = z.object({
  creatorNickname: z.string().min(1).max(50),
  collaboratorAgents: z.array(COLLABORATOR_SCHEMA).max(20).default([]),
  robotName: z.string().min(1).max(80),
  movementRules: z.string().min(1).max(1000),
  rotationRules: z.string().max(1000).default(""),
  attackRules: z.string().min(1).max(1000),
  script: z.string().min(1).max(10000),
});

const CREATE_BATTLE_SCHEMA = z
  .object({
    robotAId: z.string().min(1),
    robotBId: z.string().min(1),
    arenaSize: z.number().int().min(6).max(40).default(10),
    maxTurns: z.number().int().min(1).max(300).default(50),
  })
  .refine((data) => data.robotAId !== data.robotBId, {
    message: "robotAId and robotBId must be different",
    path: ["robotBId"],
  });

const MCP_COACH_SCHEMA = z.object({
  objective: z.string().max(400).optional(),
  playStyle: STYLE_ENUM.optional(),
  riskTolerance: RISK_ENUM.optional(),
  preferredTraits: z.array(TRAIT_ENUM).max(4).optional(),
  weaknessesToAvoid: z.array(z.string().max(120)).max(8).optional(),
  arenaSize: z.number().int().min(6).max(40).optional(),
  notes: z.string().max(1000).optional(),
});

const MCP_VALIDATE_SCHEMA = z.object({
  script: z.string().min(1).max(10000),
  movementRules: z.string().max(1000).optional(),
  rotationRules: z.string().max(1000).optional(),
  attackRules: z.string().max(1000).optional(),
});

const MCP_PREVIEW_SCHEMA = z.object({
  candidateScript: z.string().min(1).max(10000),
  opponentPreset: STYLE_ENUM.optional(),
  opponentScript: z.string().max(10000).optional(),
  arenaSize: z.number().int().min(6).max(40).default(10),
  maxTurns: z.number().int().min(1).max(300).default(60),
});

const STRATEGY_LIBRARY = {
  aggressive: {
    label: "Aggressive",
    robotNamePrefix: "Blitz",
    movementRules: "사선을 빠르게 만들기 위해 전진 비중을 높인다.",
    rotationRules: "적을 찾을 때 우회전을 우선한다.",
    attackRules: "전방 5칸 시야에서 적이 보이면 즉시 SHOOT.",
    script: "IF_SEEN SHOOT\nMOVE 2\nIF_NOT_SEEN ROTATE RIGHT\nIF_SEEN SHOOT\nMOVE 1",
    lowRiskScript: "IF_SEEN SHOOT\nMOVE 1\nIF_NOT_SEEN ROTATE RIGHT\nWAIT\nIF_SEEN SHOOT",
    highRiskScript: "IF_SEEN SHOOT\nMOVE 3\nIF_NOT_SEEN ROTATE RIGHT\nMOVE 2\nIF_SEEN SHOOT",
    simpleScript: "IF_SEEN SHOOT\nMOVE 2\nIF_NOT_SEEN ROTATE RIGHT\nIF_SEEN SHOOT",
  },
  balanced: {
    label: "Balanced",
    robotNamePrefix: "Vector",
    movementRules: "전진과 시야 전환을 균형 있게 수행한다.",
    rotationRules: "좌우 회전을 번갈아 사각지대를 줄인다.",
    attackRules: "시야 내 적 발견 시 사격, 미발견 시 순찰 회전.",
    script: "IF_SEEN SHOOT\nMOVE 1\nIF_NOT_SEEN ROTATE RIGHT\nIF_SEEN SHOOT\nIF_NOT_SEEN ROTATE LEFT\nWAIT",
    lowRiskScript: "IF_SEEN SHOOT\nWAIT\nMOVE 1\nIF_NOT_SEEN ROTATE RIGHT\nWAIT\nIF_SEEN SHOOT",
    highRiskScript: "IF_SEEN SHOOT\nMOVE 2\nIF_NOT_SEEN ROTATE RIGHT\nMOVE 2\nIF_SEEN SHOOT",
    simpleScript: "IF_SEEN SHOOT\nMOVE 1\nIF_NOT_SEEN ROTATE RIGHT\nWAIT",
  },
  defensive: {
    label: "Defensive",
    robotNamePrefix: "Sentinel",
    movementRules: "위치 유지와 제한적 전진으로 안정성을 높인다.",
    rotationRules: "정기적으로 회전해 접근 경로를 스캔한다.",
    attackRules: "시야 내 적이 확인되면 우선 사격 후 방어 자세 유지.",
    script: "IF_SEEN SHOOT\nWAIT\nIF_NOT_SEEN ROTATE RIGHT\nWAIT\nIF_SEEN SHOOT\nIF_NOT_SEEN ROTATE LEFT",
    lowRiskScript: "IF_SEEN SHOOT\nWAIT\nWAIT\nIF_NOT_SEEN ROTATE RIGHT\nWAIT\nIF_SEEN SHOOT",
    highRiskScript: "IF_SEEN SHOOT\nMOVE 1\nWAIT\nIF_NOT_SEEN ROTATE RIGHT\nMOVE 1\nIF_SEEN SHOOT",
    simpleScript: "IF_SEEN SHOOT\nWAIT\nIF_NOT_SEEN ROTATE RIGHT\nIF_SEEN SHOOT",
  },
  trickster: {
    label: "Trickster",
    robotNamePrefix: "Mirage",
    movementRules: "짧은 이동과 빈번한 회전으로 예측을 어렵게 한다.",
    rotationRules: "좌우 회전을 교차해 시야 노출 패턴을 분산한다.",
    attackRules: "교차 회전으로 탐색하며 시야에 포착되면 즉시 사격.",
    script: "IF_NOT_SEEN ROTATE RIGHT\nMOVE 1\nIF_SEEN SHOOT\nIF_NOT_SEEN ROTATE LEFT\nMOVE 2\nIF_SEEN SHOOT",
    lowRiskScript: "IF_NOT_SEEN ROTATE RIGHT\nWAIT\nIF_SEEN SHOOT\nIF_NOT_SEEN ROTATE LEFT\nWAIT\nIF_SEEN SHOOT",
    highRiskScript: "MOVE 2\nIF_NOT_SEEN ROTATE RIGHT\nMOVE 2\nIF_SEEN SHOOT\nIF_NOT_SEEN ROTATE LEFT\nIF_SEEN SHOOT",
    simpleScript: "IF_NOT_SEEN ROTATE RIGHT\nMOVE 1\nIF_SEEN SHOOT\nIF_NOT_SEEN ROTATE LEFT",
  },
};

const MCP_FLOW_TOOL = {
  name: "get_build_flow",
  description:
    "Return a recommended human-facing consultation flow so the agent can ask questions before final upload.",
  inputSchema: {
    type: "object",
    properties: {},
  },
};

const MCP_COACH_TOOL = {
  name: "coach_robot_design",
  description:
    "Create a robot design draft from high-level intent. Use this repeatedly as user answers come in.",
  inputSchema: {
    type: "object",
    properties: {
      objective: { type: "string" },
      playStyle: { type: "string", enum: PLAY_STYLE_VALUES },
      riskTolerance: { type: "string", enum: RISK_VALUES },
      preferredTraits: {
        type: "array",
        items: { type: "string", enum: TRAIT_VALUES },
      },
      weaknessesToAvoid: {
        type: "array",
        items: { type: "string" },
      },
      arenaSize: { type: "number" },
      notes: { type: "string" },
    },
  },
};

const MCP_VALIDATE_TOOL = {
  name: "validate_robot_script",
  description:
    "Validate parser.js DSL syntax and return tactical quality checks before upload.",
  inputSchema: {
    type: "object",
    properties: {
      script: { type: "string" },
      movementRules: { type: "string" },
      rotationRules: { type: "string" },
      attackRules: { type: "string" },
    },
    required: ["script"],
  },
};

const MCP_PREVIEW_TOOL = {
  name: "preview_robot_duel",
  description:
    "Run a quick simulated duel for a candidate script against a preset or custom opponent script.",
  inputSchema: {
    type: "object",
    properties: {
      candidateScript: { type: "string" },
      opponentPreset: { type: "string", enum: PLAY_STYLE_VALUES },
      opponentScript: { type: "string" },
      arenaSize: { type: "number" },
      maxTurns: { type: "number" },
    },
    required: ["candidateScript"],
  },
};

const MCP_UPLOAD_TOOL = {
  name: "upload_robot_script",
  description:
    "Finalize and upload a robot script to mcp-arena with metadata.",
  inputSchema: {
    type: "object",
    properties: {
      creatorNickname: {
        type: "string",
        description: "Nickname of the robot creator",
      },
      collaboratorAgents: {
        type: "array",
        description: "List of collaborating AI agents",
        items: {
          oneOf: [
            { type: "string" },
            {
              type: "object",
              properties: {
                name: { type: "string" },
                role: { type: "string" },
                version: { type: "string" },
              },
              required: ["name"],
            },
          ],
        },
      },
      robotName: {
        type: "string",
        description: "Robot model name",
      },
      movementRules: {
        type: "string",
        description: "Human readable movement rules",
      },
      rotationRules: {
        type: "string",
        description: "Human readable rotation rules",
      },
      attackRules: {
        type: "string",
        description: "Human readable attack rules",
      },
      script: {
        type: "string",
        description: "Robot script in parser.js DSL (MOVE/ROTATE/SHOOT/WAIT)",
      },
      userApprovalConfirmed: {
        type: "boolean",
        description:
          "Must be true only after the human user explicitly approves final upload.",
      },
    },
    required: [
      "creatorNickname",
      "robotName",
      "movementRules",
      "attackRules",
      "script",
      "userApprovalConfirmed",
    ],
  },
};

const MCP_TOOLS = [
  MCP_FLOW_TOOL,
  MCP_COACH_TOOL,
  MCP_VALIDATE_TOOL,
  MCP_PREVIEW_TOOL,
  MCP_UPLOAD_TOOL,
];

function serializeTimestamp(value) {
  if (!value) {
    return null;
  }

  if (typeof value.toDate === "function") {
    return value.toDate().toISOString();
  }

  return value;
}

function serializeRobotDoc(doc) {
  const data = doc.data();
  return {
    id: doc.id,
    creatorNickname: data.creatorNickname,
    collaboratorAgents: data.collaboratorAgents || [],
    robotName: data.robotName,
    movementRules: data.movementRules,
    rotationRules: data.rotationRules,
    attackRules: data.attackRules,
    scriptPath: data.scriptPath,
    commandCount: Array.isArray(data.parsedProgram) ? data.parsedProgram.length : 0,
    createdAt: serializeTimestamp(data.createdAt),
    updatedAt: serializeTimestamp(data.updatedAt),
  };
}

function normalizePath(req) {
  const pathWithQuery = req.path || req.url || "/";
  const pathOnly = pathWithQuery.split("?")[0] || "/";

  if (pathOnly === "/api") {
    return "/";
  }

  if (pathOnly.startsWith("/api/")) {
    return pathOnly.slice(4);
  }

  return pathOnly;
}

function safeJsonBody(req) {
  if (!req.body) {
    return {};
  }

  if (typeof req.body === "object") {
    return req.body;
  }

  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch (error) {
      throw new Error("invalid JSON body");
    }
  }

  return {};
}

function resolveBucketName() {
  const directValue =
    process.env.STORAGE_BUCKET ||
    process.env.FIREBASE_STORAGE_BUCKET ||
    process.env.GCLOUD_STORAGE_BUCKET;

  if (directValue) {
    return directValue;
  }

  if (process.env.FIREBASE_CONFIG) {
    try {
      const parsed = JSON.parse(process.env.FIREBASE_CONFIG);
      if (parsed.storageBucket) {
        return parsed.storageBucket;
      }
    } catch (error) {
      return null;
    }
  }

  return null;
}

function getStorageBucket() {
  const bucketName = resolveBucketName();
  if (bucketName) {
    return admin.storage().bucket(bucketName);
  }

  return admin.storage().bucket();
}

function rpcSuccess(id, result) {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    result,
  };
}

function rpcError(id, code, message, data) {
  const payload = {
    jsonrpc: "2.0",
    id: id ?? null,
    error: {
      code,
      message,
    },
  };

  if (data !== undefined) {
    payload.error.data = data;
  }

  return payload;
}

function errorResponse(res, status, message, details) {
  const payload = { error: message };
  if (details !== undefined) {
    payload.details = details;
  }

  return res.status(status).json(payload);
}

function errorMessage(error) {
  if (error && typeof error.message === "string") {
    return error.message;
  }

  return String(error);
}

function toolResult(payload) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2),
      },
    ],
    structuredContent: payload,
  };
}

function commandCount(parsedProgram) {
  const counts = {
    MOVE: 0,
    ROTATE: 0,
    SHOOT: 0,
    WAIT: 0,
    IF: 0,
  };

  parsedProgram.forEach((command) => {
    if (command.type === "IF") {
      counts.IF += 1;
      if (command.then && counts[command.then.type] !== undefined) {
        counts[command.then.type] += 1;
      }
      return;
    }

    if (counts[command.type] !== undefined) {
      counts[command.type] += 1;
    }
  });

  return counts;
}

function scriptForRisk(template, riskTolerance, preferredTraits) {
  if (preferredTraits && preferredTraits.includes("simple")) {
    return template.simpleScript;
  }

  if (riskTolerance === "low") {
    return template.lowRiskScript;
  }

  if (riskTolerance === "high") {
    return template.highRiskScript;
  }

  return template.script;
}

function applyTraitAdjustment(script, preferredTraits) {
  if (!Array.isArray(preferredTraits) || !preferredTraits.length) {
    return script;
  }

  let updated = script;

  if (preferredTraits.includes("unpredictable")) {
    updated += "\nROTATE LEFT\nSHOOT";
  }

  if (preferredTraits.includes("fast")) {
    updated = updated.replace(/MOVE 1/g, "MOVE 2");
  }

  return updated;
}

function normalizeScript(script) {
  return script
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function buildFollowUpQuestions(missingFields) {
  const questions = [];

  if (missingFields.includes("objective")) {
    questions.push("이 로봇이 노릴 승리 방식(선제타격/생존전/교란전)은 무엇인가요?");
  }

  if (missingFields.includes("playStyle")) {
    questions.push("플레이 스타일은 aggressive, balanced, defensive, trickster 중 무엇을 원하나요?");
  }

  if (missingFields.includes("riskTolerance")) {
    questions.push("위험 선호도는 low, medium, high 중 무엇인가요?");
  }

  return questions;
}

function summarizeDesignIntent(input) {
  const objective = input.objective?.trim() || "승률이 높은 범용 로봇";
  const style = input.playStyle || "balanced";
  const risk = input.riskTolerance || "medium";
  const traits = (input.preferredTraits || []).join(", ");

  let summary = `목표: ${objective}. 스타일: ${style}. 위험도: ${risk}.`;
  if (traits) {
    summary += ` 선호 특성: ${traits}.`;
  }

  if (input.weaknessesToAvoid?.length) {
    summary += ` 회피하고 싶은 약점: ${input.weaknessesToAvoid.join(", ")}.`;
  }

  if (input.notes?.trim()) {
    summary += ` 추가 메모: ${input.notes.trim()}.`;
  }

  return summary;
}

function recommendRobotDraft(input) {
  const style = input.playStyle || "balanced";
  const risk = input.riskTolerance || "medium";
  const template = STRATEGY_LIBRARY[style];

  let script = scriptForRisk(template, risk, input.preferredTraits);
  script = applyTraitAdjustment(script, input.preferredTraits);
  script = normalizeScript(script);

  try {
    parseRobotScript(script);
  } catch (error) {
    script = template.script;
  }

  const suffix = style.slice(0, 3).toUpperCase();

  return {
    robotNameSuggestion: `${template.robotNamePrefix}-${suffix}-MK1`,
    movementRules: template.movementRules,
    rotationRules: template.rotationRules,
    attackRules: template.attackRules,
    script,
    collaboratorAgentsHint: ["codex", "claude-code"],
  };
}

function coachRobotDesign(input) {
  const missingFields = [];

  if (!input.objective || !input.objective.trim()) {
    missingFields.push("objective");
  }

  if (!input.playStyle) {
    missingFields.push("playStyle");
  }

  if (!input.riskTolerance) {
    missingFields.push("riskTolerance");
  }

  const designIntentSummary = summarizeDesignIntent(input);
  const recommendedRobotDraft = recommendRobotDraft(input);

  return {
    readyForUpload: missingFields.length === 0,
    missingFields,
    followUpQuestions: buildFollowUpQuestions(missingFields),
    designIntentSummary,
    recommendedRobotDraft,
    nextAction:
      missingFields.length === 0
        ? "Call validate_robot_script, optionally preview_robot_duel, then upload_robot_script"
        : "Ask followUpQuestions to the user, then call coach_robot_design again with updated answers",
  };
}

function validateRobotScriptDraft(input) {
  const parsedProgram = parseRobotScript(input.script);
  const counts = commandCount(parsedProgram);
  const warnings = [];
  const recommendations = [];

  if (!counts.SHOOT) {
    warnings.push("SHOOT 명령이 없어 처치가 불가능합니다.");
    recommendations.push("적어도 루프당 1회 SHOOT를 넣으세요.");
  }

  if (!counts.ROTATE) {
    warnings.push("ROTATE 명령이 없어 시야 확보가 제한됩니다.");
    recommendations.push("주기적인 ROTATE LEFT/RIGHT를 추가하세요.");
  }

  if (counts.WAIT > counts.MOVE + counts.ROTATE) {
    warnings.push("WAIT 비중이 높아 전투 템포가 느립니다.");
    recommendations.push("WAIT을 줄이고 MOVE/ROTATE를 늘려 탐지율을 높이세요.");
  }

  if (parsedProgram.length > 80) {
    warnings.push("스크립트가 길어 예측이 어려울 수 있습니다.");
    recommendations.push("핵심 루프를 8~20명령 수준으로 단순화해 보세요.");
  }

  if (input.attackRules && !/shoot|발사|사격/i.test(input.attackRules)) {
    warnings.push("attackRules 설명에 사격 트리거가 명확히 드러나지 않습니다.");
  }

  if (!recommendations.length) {
    recommendations.push("구성 균형이 좋아 바로 프리뷰 시뮬레이션으로 넘어가도 됩니다.");
  }

  return {
    valid: true,
    commandCount: parsedProgram.length,
    commandDistribution: counts,
    warnings,
    recommendations,
  };
}

function defaultFlowGuide() {
  return {
    title: "mcp-arena 상담형 업로드 플로우",
    intent: "에이전트가 사람과 전략 상담 후 최종 로봇 업로드까지 진행",
    steps: [
      "1) get_build_flow로 전체 절차 확인",
      "2) coach_robot_design으로 초기 설계안 생성",
      "3) 부족 정보는 followUpQuestions를 사용자에게 질문",
      "4) validate_robot_script로 문법/전술 리스크 점검",
      "5) preview_robot_duel로 프리뷰 대전 확인",
      "6) 사용자 승인 후 upload_robot_script 실행",
    ],
    recommendedQuestions: [
      "공격적으로 빨리 끝내는 스타일 vs 안정적인 생존형 중 어떤 쪽을 원하시나요?",
      "리스크는 low/medium/high 중 어디까지 허용하시나요?",
      "자동 시야(전방 5칸) 기준으로 탐색 우선인지, 발견 즉시 사격 우선인지 정해볼까요?",
      "회피하고 싶은 약점(벽충돌, 회전과다, 사격빈도 부족)이 있나요?",
    ],
    outputContract: {
      finalUploadFields: [
        "creatorNickname",
        "collaboratorAgents",
        "robotName",
        "movementRules",
        "rotationRules",
        "attackRules",
        "script",
      ],
    },
  };
}

function resolveOpponent(input) {
  if (input.opponentScript && input.opponentScript.trim()) {
    const parsed = parseRobotScript(input.opponentScript);
    return {
      robotName: "CustomOpponent",
      parsedProgram: parsed,
      source: "custom_script",
    };
  }

  const preset = input.opponentPreset || "balanced";
  const template = STRATEGY_LIBRARY[preset];

  return {
    robotName: `Preset-${template.label}`,
    parsedProgram: parseRobotScript(template.script),
    source: `preset:${preset}`,
  };
}

function previewRobotDuel(input) {
  const candidateProgram = parseRobotScript(input.candidateScript);
  const opponent = resolveOpponent(input);

  const simulation = simulateBattle({
    robotA: {
      id: "candidate",
      robotName: "Candidate",
      parsedProgram: candidateProgram,
    },
    robotB: {
      id: "opponent",
      robotName: opponent.robotName,
      parsedProgram: opponent.parsedProgram,
    },
    arenaSize: input.arenaSize,
    maxTurns: input.maxTurns,
  });

  const candidateWon = simulation.winnerRobotId === "candidate";
  const firstHit = simulation.timeline.find((entry) => entry.result?.projectile?.hit);
  const candidateShootCount = simulation.timeline.filter(
    (entry) =>
      entry.robotId === "candidate" &&
      (entry.resolvedAction?.type === "SHOOT" || entry.action?.type === "SHOOT")
  ).length;
  const candidateRotateCount = simulation.timeline.filter(
    (entry) =>
      entry.robotId === "candidate" &&
      (entry.resolvedAction?.type === "ROTATE" || entry.action?.type === "ROTATE")
  ).length;

  const recommendations = [];

  if (!candidateShootCount) {
    recommendations.push("사격 타이밍이 부족합니다. 루프 내 SHOOT 비중을 늘리세요.");
  }

  if (!candidateRotateCount) {
    recommendations.push("회전이 없어 시야 확보가 어렵습니다. ROTATE를 추가하세요.");
  }

  if (!candidateWon) {
    recommendations.push("초반 사선 확보를 위해 MOVE/ROTATE 순서를 조정해 보세요.");
  }

  if (!recommendations.length) {
    recommendations.push("프리뷰 결과 양호합니다. validate 후 업로드 진행하세요.");
  }

  return {
    candidateWon,
    status: simulation.status,
    winnerRobotId: simulation.winnerRobotId,
    opponentSource: opponent.source,
    visionRadius: simulation.visionRadius,
    turnsPlayed: simulation.turns.length,
    firstHitStep: firstHit ? firstHit.step : null,
    summary:
      candidateWon
        ? "Candidate가 프리뷰에서 승리했습니다."
        : "Candidate가 프리뷰에서 승리하지 못했습니다.",
    recommendations,
    replaySnippet: simulation.timeline.slice(0, 20),
    finalState: simulation.finalState,
  };
}

async function createRobot(robotPayload) {
  const parsedInput = ROBOT_UPLOAD_SCHEMA.parse(robotPayload);
  const parsedProgram = parseRobotScript(parsedInput.script);

  const robotRef = db.collection("robots").doc();
  const scriptPath = `robots/${robotRef.id}/script.txt`;

  const storageBucket = getStorageBucket();
  await storageBucket.file(scriptPath).save(parsedInput.script, {
    contentType: "text/plain; charset=utf-8",
    resumable: false,
    metadata: {
      cacheControl: "no-cache",
    },
  });

  const timestamp = FieldValue.serverTimestamp();

  await robotRef.set({
    creatorNickname: parsedInput.creatorNickname,
    collaboratorAgents: parsedInput.collaboratorAgents,
    robotName: parsedInput.robotName,
    movementRules: parsedInput.movementRules,
    rotationRules: parsedInput.rotationRules,
    attackRules: parsedInput.attackRules,
    scriptPath,
    parsedProgram,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  const createdDoc = await robotRef.get();
  return serializeRobotDoc(createdDoc);
}

async function runBattle(payload) {
  const parsedInput = CREATE_BATTLE_SCHEMA.parse(payload);

  const [robotASnapshot, robotBSnapshot] = await Promise.all([
    db.collection("robots").doc(parsedInput.robotAId).get(),
    db.collection("robots").doc(parsedInput.robotBId).get(),
  ]);

  if (!robotASnapshot.exists || !robotBSnapshot.exists) {
    throw new Error("One or both robots were not found");
  }

  const robotAData = robotASnapshot.data();
  const robotBData = robotBSnapshot.data();

  if (!Array.isArray(robotAData.parsedProgram) || !robotAData.parsedProgram.length) {
    throw new Error(`Robot ${parsedInput.robotAId} has no parsed program`);
  }

  if (!Array.isArray(robotBData.parsedProgram) || !robotBData.parsedProgram.length) {
    throw new Error(`Robot ${parsedInput.robotBId} has no parsed program`);
  }

  const simulation = simulateBattle({
    robotA: {
      id: robotASnapshot.id,
      robotName: robotAData.robotName,
      parsedProgram: robotAData.parsedProgram,
    },
    robotB: {
      id: robotBSnapshot.id,
      robotName: robotBData.robotName,
      parsedProgram: robotBData.parsedProgram,
    },
    arenaSize: parsedInput.arenaSize,
    maxTurns: parsedInput.maxTurns,
  });

  const battleRef = db.collection("battles").doc();
  const timestamp = FieldValue.serverTimestamp();

  await battleRef.set({
    robotAId: parsedInput.robotAId,
    robotBId: parsedInput.robotBId,
    arenaSize: parsedInput.arenaSize,
    maxTurns: parsedInput.maxTurns,
    status: simulation.status,
    winnerRobotId: simulation.winnerRobotId,
    visionRadius: simulation.visionRadius,
    initialState: simulation.initialState,
    initialPerception: simulation.initialPerception,
    timeline: simulation.timeline,
    turns: simulation.turns,
    finalState: simulation.finalState,
    finalPerception: simulation.finalPerception,
    createdAt: timestamp,
  });

  const battleSnapshot = await battleRef.get();
  const battleData = battleSnapshot.data();

  return {
    id: battleSnapshot.id,
    robotAId: battleData.robotAId,
    robotBId: battleData.robotBId,
    arenaSize: battleData.arenaSize,
    maxTurns: battleData.maxTurns,
    status: battleData.status,
    winnerRobotId: battleData.winnerRobotId,
    visionRadius: battleData.visionRadius,
    initialState: battleData.initialState,
    initialPerception: battleData.initialPerception,
    timeline: battleData.timeline || [],
    turns: battleData.turns,
    finalState: battleData.finalState,
    finalPerception: battleData.finalPerception,
    createdAt: serializeTimestamp(battleData.createdAt),
  };
}

async function handleMcpRequest(body) {
  const id = body?.id ?? null;
  const method = body?.method;

  if (!method || typeof method !== "string") {
    return rpcError(id, -32600, "Invalid Request", "method is required");
  }

  if (method === "initialize") {
    return rpcSuccess(id, {
      protocolVersion: "2024-11-05",
      capabilities: {
        tools: {},
      },
      serverInfo: {
        name: "mcp-arena",
        version: "0.2.0",
      },
      instructions:
        "Robots have auto-updated forward vision (radius 5). Recommended flow: get_build_flow -> coach_robot_design (iterate with user Q&A) -> validate_robot_script -> preview_robot_duel -> upload_robot_script.",
    });
  }

  if (method === "tools/list") {
    return rpcSuccess(id, {
      tools: MCP_TOOLS,
    });
  }

  if (method === "tools/call") {
    const toolName = body?.params?.name;
    const args = body?.params?.arguments ?? {};

    try {
      if (toolName === "get_build_flow") {
        return rpcSuccess(id, toolResult(defaultFlowGuide()));
      }

      if (toolName === "coach_robot_design") {
        const parsedInput = MCP_COACH_SCHEMA.parse(args);
        return rpcSuccess(id, toolResult(coachRobotDesign(parsedInput)));
      }

      if (toolName === "validate_robot_script") {
        const parsedInput = MCP_VALIDATE_SCHEMA.parse(args);
        return rpcSuccess(id, toolResult(validateRobotScriptDraft(parsedInput)));
      }

      if (toolName === "preview_robot_duel") {
        const parsedInput = MCP_PREVIEW_SCHEMA.parse(args);
        return rpcSuccess(id, toolResult(previewRobotDuel(parsedInput)));
      }

      if (toolName === "upload_robot_script") {
        if (args.userApprovalConfirmed !== true) {
          return rpcError(
            id,
            -32602,
            "Upload blocked: ask user for final approval first, then set userApprovalConfirmed=true"
          );
        }

        const uploadPayload = {
          ...args,
        };
        delete uploadPayload.userApprovalConfirmed;

        const createdRobot = await createRobot(uploadPayload);
        return rpcSuccess(
          id,
          toolResult({
            ok: true,
            robotId: createdRobot.id,
            robotName: createdRobot.robotName,
            commandCount: createdRobot.commandCount,
            message: "Robot uploaded to mcp-arena.",
          })
        );
      }

      return rpcError(id, -32602, `Unknown tool: ${toolName || "(empty)"}`);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return rpcError(id, -32602, "Invalid tool arguments", error.flatten());
      }

      return rpcError(id, -32000, "Tool execution failed", errorMessage(error));
    }
  }

  return rpcError(id, -32601, `Method not found: ${method}`);
}

exports.api = onRequest({ region: "us-central1" }, async (req, res) => {
  enableCors(req, res, async () => {
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    const path = normalizePath(req);

    try {
      if (req.method === "GET" && path === "/") {
        res.json({
          name: "mcp-arena API",
          version: "0.2.0",
          endpoints: [
            "GET /health",
            "GET /robots",
            "POST /robots",
            "POST /battles",
            "GET /battles/:battleId",
            "POST /mcp",
          ],
        });
        return;
      }

      if (req.method === "GET" && path === "/health") {
        res.json({ status: "ok", time: new Date().toISOString() });
        return;
      }

      if (req.method === "GET" && path === "/robots") {
        const snapshot = await db
          .collection("robots")
          .orderBy("createdAt", "desc")
          .limit(100)
          .get();

        const robots = snapshot.docs.map((doc) => serializeRobotDoc(doc));
        res.json({ robots });
        return;
      }

      if (req.method === "POST" && path === "/robots") {
        const body = safeJsonBody(req);

        try {
          const robot = await createRobot(body);
          res.status(201).json({ robot });
        } catch (error) {
          if (error instanceof z.ZodError) {
            errorResponse(res, 400, "Invalid robot payload", error.flatten());
            return;
          }

          errorResponse(res, 400, errorMessage(error));
        }
        return;
      }

      if (req.method === "POST" && path === "/battles") {
        const body = safeJsonBody(req);

        try {
          const battle = await runBattle(body);
          res.status(201).json({ battle });
        } catch (error) {
          if (error instanceof z.ZodError) {
            errorResponse(res, 400, "Invalid battle payload", error.flatten());
            return;
          }

          if (errorMessage(error).includes("not found")) {
            errorResponse(res, 404, errorMessage(error));
            return;
          }

          errorResponse(res, 400, errorMessage(error));
        }

        return;
      }

      if (req.method === "GET" && /^\/battles\/[^/]+$/.test(path)) {
        const battleId = path.split("/")[2];
        const battleSnapshot = await db.collection("battles").doc(battleId).get();

        if (!battleSnapshot.exists) {
          errorResponse(res, 404, `Battle ${battleId} not found`);
          return;
        }

        const data = battleSnapshot.data();
        res.json({
          battle: {
            id: battleSnapshot.id,
            robotAId: data.robotAId,
            robotBId: data.robotBId,
            arenaSize: data.arenaSize,
            maxTurns: data.maxTurns,
            status: data.status,
            winnerRobotId: data.winnerRobotId,
            visionRadius: data.visionRadius,
            initialState: data.initialState,
            initialPerception: data.initialPerception,
            timeline: data.timeline || [],
            turns: data.turns,
            finalState: data.finalState,
            finalPerception: data.finalPerception,
            createdAt: serializeTimestamp(data.createdAt),
          },
        });
        return;
      }

      if (req.method === "POST" && path === "/mcp") {
        const body = safeJsonBody(req);
        const responseBody = await handleMcpRequest(body);
        const isError = Boolean(responseBody.error);
        res.status(isError ? 400 : 200).json(responseBody);
        return;
      }

      errorResponse(res, 404, `Route not found: ${req.method} ${path}`);
    } catch (error) {
      console.error(error);
      errorResponse(res, 500, "Internal error", errorMessage(error));
    }
  });
});
