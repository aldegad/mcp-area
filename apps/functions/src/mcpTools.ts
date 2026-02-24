import { z } from "zod";
import { parseRobotScript, type ScriptAction } from "./parser";
import {
  simulateBattle,
  type BattleSimulation,
  type BattleSnapshot,
  type SimulationActionLog,
  TARGET_FPS,
  VISION_RADIUS,
  SHOT_RANGE,
  VISION_HALF_ANGLE_DEG,
  ROBOT_COLLISION_RADIUS,
  SHOT_HIT_RADIUS,
  TICK_DURATION_MS,
  FIRE_MOVEMENT_MULTIPLIER,
  FIRE_TURN_MULTIPLIER,
  FIRE_COOLDOWN_TICKS,
  FIRE_ENERGY_COST,
  PROJECTILE_TICKS_PER_TILE,
  PROJECTILE_SPEED_TILES_PER_SECOND,
  SIDE_BOOST_FORCE_SEQUENCE,
  SIDE_BOOST_BURST_TICKS,
  SIDE_BOOST_TOTAL_EQUIVALENT_STRAFE_TICKS,
  SIDE_BOOST_ENERGY_MAX,
  SIDE_BOOST_ENERGY_COST,
  SIDE_BOOST_ENERGY_REGEN_PER_SECOND,
  SIDE_BOOST_COOLDOWN_TICKS,
  TICKS_PER_TILE,
  TURN_RATE_DEG_PER_SECOND,
} from "./battleEngine";
import { resolveMaxTicks } from "./simulationConfig";

export const PLAY_STYLE_VALUES = ["aggressive", "balanced", "defensive", "trickster"] as const;
const RISK_VALUES = ["low", "medium", "high"] as const;
const TRAIT_VALUES = ["fast", "accurate", "simple", "unpredictable"] as const;
const PRESET_OPPONENTS_ENABLED =
  process.env.FUNCTIONS_EMULATOR === "true" || process.env.MCP_ARENA_ENABLE_PRESETS === "1";

type PlayStyle = (typeof PLAY_STYLE_VALUES)[number];
type RiskTolerance = (typeof RISK_VALUES)[number];
type PreferredTrait = (typeof TRAIT_VALUES)[number];

const STYLE_ENUM = z.enum(PLAY_STYLE_VALUES);
const RISK_ENUM = z.enum(RISK_VALUES);
const TRAIT_ENUM = z.enum(TRAIT_VALUES);

export const MCP_COACH_SCHEMA = z.object({
  objective: z.string().max(400).optional(),
  playStyle: z.string().max(40).optional(),
  riskTolerance: RISK_ENUM.optional(),
  preferredTraits: z.array(TRAIT_ENUM).max(4).optional(),
  weaknessesToAvoid: z.array(z.string().max(120)).max(8).optional(),
  arenaSize: z.number().int().min(6).max(40).optional(),
  notes: z.string().max(1000).optional(),
});

export const MCP_VALIDATE_SCHEMA = z.object({
  script: z.string().min(1).max(10000),
  movementRules: z.string().max(1000).optional(),
  rotationRules: z.string().max(1000).optional(),
  attackRules: z.string().max(1000).optional(),
});

const MCP_PREVIEW_BASE_SCHEMA = z.object({
  candidateScript: z.string().min(1).max(10000),
  opponentScript: z.string().max(10000).optional(),
  arenaSize: z.number().int().min(6).max(40).default(10),
  maxTicks: z.number().int().min(20).max(5000).optional(),
  maxTurns: z.number().int().min(1).max(1000).optional(),
});
export const MCP_PREVIEW_SCHEMA = PRESET_OPPONENTS_ENABLED
  ? MCP_PREVIEW_BASE_SCHEMA.extend({
      opponentPreset: STYLE_ENUM.optional(),
    })
  : MCP_PREVIEW_BASE_SCHEMA;

interface StrategyTemplate {
  label: string;
  robotNamePrefix: string;
  movementRules: string;
  rotationRules: string;
  attackRules: string;
  script: string;
  lowRiskScript: string;
  highRiskScript: string;
  simpleScript: string;
}

export interface CommandDistribution {
  RULES: number;
  CONDITIONAL: number;
  SET_THROTTLE: number;
  SET_STRAFE: number;
  SET_TURN: number;
  FIRE_ON: number;
  FIRE_OFF: number;
  BOOST: number;
}

interface RobotDraft {
  robotNameSuggestion: string;
  movementRules: string;
  rotationRules: string;
  attackRules: string;
  script: string;
  collaboratorAgentsHint: string[];
}

export interface BuildFlowResult {
  title: string;
  intent: string;
  steps: string[];
  recommendedQuestions: string[];
  outputContract: {
    finalUploadFields: string[];
  };
}

export interface CoachRobotDesignResult {
  readyForUpload: boolean;
  missingFields: string[];
  followUpQuestions: string[];
  designIntentSummary: string;
  recommendedRobotDraft: RobotDraft;
  nextAction: string;
}

export interface ValidateRobotScriptResult {
  valid: true;
  commandCount: number;
  commandDistribution: CommandDistribution;
  warnings: string[];
  recommendations: string[];
}

export interface PreviewRobotDuelResult {
  candidateWon: boolean;
  status: BattleSimulation["status"];
  winnerRobotId: string | null;
  opponentSource: string;
  visionRadius: number;
  maxTicks: number;
  ticksPlayed: number;
  turnsPlayed: number;
  firstHitStep: number | null;
  summary: string;
  recommendations: string[];
  replaySnippet: SimulationActionLog[];
  finalState: BattleSnapshot;
}

const STRATEGY_LIBRARY: Record<PlayStyle, StrategyTemplate> = {
  aggressive: {
    label: "Aggressive",
    robotNamePrefix: "Blitz",
    movementRules: "전진 비중을 높이고 교전 거리에서 후진으로 반동을 만든다.",
    rotationRules: "enemy.dy 기준으로 빠르게 좌/우 회전 보정한다.",
    attackRules: "적이 보이면 FIRE ON, 비가시 상태에서는 FIRE OFF.",
    script:
      "SET THROTTLE 0.9\nSET STRAFE 0\nSET TURN 0.2\nFIRE OFF\nIF ENEMY_DY > 0.12 THEN SET TURN 1\nIF ENEMY_DY < -0.12 THEN SET TURN -1\nIF ENEMY_DISTANCE < 1.8 THEN SET THROTTLE -0.6\nIF ENEMY_VISIBLE THEN FIRE ON",
    lowRiskScript:
      "SET THROTTLE 0.55\nSET STRAFE 0\nSET TURN 0.15\nFIRE OFF\nIF ENEMY_DY > 0.16 THEN SET TURN 0.8\nIF ENEMY_DY < -0.16 THEN SET TURN -0.8\nIF ENEMY_DISTANCE < 2.2 THEN SET THROTTLE -0.7\nIF ENEMY_VISIBLE THEN FIRE ON",
    highRiskScript:
      "SET THROTTLE 1\nSET STRAFE 0.35\nSET TURN 0.3\nFIRE OFF\nIF ENEMY_DY > 0.1 THEN SET TURN 1\nIF ENEMY_DY < -0.1 THEN SET TURN -1\nIF ENEMY_VISIBLE THEN SET STRAFE 0\nIF ENEMY_VISIBLE THEN FIRE ON",
    simpleScript:
      "SET THROTTLE 0.8\nSET TURN 0.2\nFIRE OFF\nIF ENEMY_DY > 0.15 THEN SET TURN 1\nIF ENEMY_DY < -0.15 THEN SET TURN -1\nIF ENEMY_VISIBLE THEN FIRE ON",
  },
  balanced: {
    label: "Balanced",
    robotNamePrefix: "Vector",
    movementRules: "전진+횡이동을 기본으로 두고 근거리에서 짧게 후진한다.",
    rotationRules: "enemy.dy 부호에 맞춰 회전 강도를 조절한다.",
    attackRules: "적 가시 시 FIRE ON, 비가시 시 FIRE OFF로 탄속도 페널티를 줄인다.",
    script:
      "SET THROTTLE 0.65\nSET STRAFE 0.2\nSET TURN 0.15\nFIRE OFF\nIF ENEMY_DY > 0.14 THEN SET TURN 0.8\nIF ENEMY_DY < -0.14 THEN SET TURN -0.8\nIF ENEMY_DISTANCE < 1.6 THEN SET THROTTLE -0.5\nIF ENEMY_VISIBLE THEN FIRE ON",
    lowRiskScript:
      "SET THROTTLE 0.45\nSET STRAFE 0.1\nSET TURN 0.12\nFIRE OFF\nIF ENEMY_DY > 0.18 THEN SET TURN 0.7\nIF ENEMY_DY < -0.18 THEN SET TURN -0.7\nIF ENEMY_DISTANCE < 2.4 THEN SET THROTTLE -0.8\nIF ENEMY_VISIBLE THEN FIRE ON",
    highRiskScript:
      "SET THROTTLE 0.95\nSET STRAFE 0.35\nSET TURN 0.25\nFIRE OFF\nIF ENEMY_DY > 0.1 THEN SET TURN 1\nIF ENEMY_DY < -0.1 THEN SET TURN -1\nIF ENEMY_VISIBLE THEN SET THROTTLE 1\nIF ENEMY_VISIBLE THEN FIRE ON",
    simpleScript:
      "SET THROTTLE 0.6\nSET TURN 0.15\nFIRE OFF\nIF ENEMY_DY > 0.15 THEN SET TURN 0.9\nIF ENEMY_DY < -0.15 THEN SET TURN -0.9\nIF ENEMY_VISIBLE THEN FIRE ON",
  },
  defensive: {
    label: "Defensive",
    robotNamePrefix: "Sentinel",
    movementRules: "횡이동과 후진으로 거리 유지, 과도한 돌격을 억제한다.",
    rotationRules: "적의 상대좌표를 따라 회전하되 과회전은 억제한다.",
    attackRules: "적이 보이면 사격하고 후진으로 이탈 거리를 확보한다.",
    script:
      "SET THROTTLE 0.25\nSET STRAFE -0.35\nSET TURN 0.2\nFIRE OFF\nIF ENEMY_VISIBLE THEN SET THROTTLE -0.65\nIF ENEMY_DY > 0.1 THEN SET TURN 1\nIF ENEMY_DY < -0.1 THEN SET TURN -1\nIF ENEMY_VISIBLE THEN FIRE ON",
    lowRiskScript:
      "SET THROTTLE 0.1\nSET STRAFE -0.45\nSET TURN 0.15\nFIRE OFF\nIF ENEMY_VISIBLE THEN SET THROTTLE -0.8\nIF ENEMY_DY > 0.12 THEN SET TURN 0.7\nIF ENEMY_DY < -0.12 THEN SET TURN -0.7\nIF ENEMY_VISIBLE THEN FIRE ON",
    highRiskScript:
      "SET THROTTLE 0.55\nSET STRAFE -0.2\nSET TURN 0.25\nFIRE OFF\nIF ENEMY_DY > 0.1 THEN SET TURN 1\nIF ENEMY_DY < -0.1 THEN SET TURN -1\nIF ENEMY_DISTANCE < 1.5 THEN SET THROTTLE -0.9\nIF ENEMY_VISIBLE THEN FIRE ON",
    simpleScript:
      "SET THROTTLE 0.2\nSET TURN 0.2\nFIRE OFF\nIF ENEMY_DY > 0.12 THEN SET TURN 0.8\nIF ENEMY_DY < -0.12 THEN SET TURN -0.8\nIF ENEMY_VISIBLE THEN FIRE ON",
  },
  trickster: {
    label: "Trickster",
    robotNamePrefix: "Mirage",
    movementRules: "좌우 횡이동 패턴을 섞어 조준 예측을 어렵게 한다.",
    rotationRules: "적 감지 전에는 느린 순찰 회전, 감지 후에는 급회전 보정.",
    attackRules: "적이 가시되면 즉시 FIRE ON, 비가시면 OFF로 전환한다.",
    script:
      "SET THROTTLE 0.55\nSET STRAFE 0.55\nSET TURN -0.25\nFIRE OFF\nIF SELF_X > 5 THEN SET STRAFE -0.55\nIF ENEMY_DY > 0.12 THEN SET TURN 1\nIF ENEMY_DY < -0.12 THEN SET TURN -1\nIF ENEMY_VISIBLE THEN FIRE ON",
    lowRiskScript:
      "SET THROTTLE 0.35\nSET STRAFE 0.45\nSET TURN -0.15\nFIRE OFF\nIF SELF_Y > 5 THEN SET STRAFE -0.45\nIF ENEMY_DY > 0.15 THEN SET TURN 0.8\nIF ENEMY_DY < -0.15 THEN SET TURN -0.8\nIF ENEMY_VISIBLE THEN FIRE ON",
    highRiskScript:
      "SET THROTTLE 0.95\nSET STRAFE 0.7\nSET TURN -0.35\nFIRE OFF\nIF SELF_X > 5 THEN SET STRAFE -0.7\nIF ENEMY_DY > 0.1 THEN SET TURN 1\nIF ENEMY_DY < -0.1 THEN SET TURN -1\nIF ENEMY_VISIBLE THEN FIRE ON",
    simpleScript:
      "SET THROTTLE 0.5\nSET STRAFE 0.4\nSET TURN -0.2\nFIRE OFF\nIF ENEMY_DY > 0.14 THEN SET TURN 0.9\nIF ENEMY_DY < -0.14 THEN SET TURN -0.9\nIF ENEMY_VISIBLE THEN FIRE ON",
  },
};

const MCP_RULES_TOOL = {
  name: "get_arena_rules",
  description:
    "Return full game mechanics, DSL reference, sensor list, physics constants, and strategy tips. Call this first so you can explain the arena rules to the user before designing a robot.",
  inputSchema: {
    type: "object",
    properties: {},
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
      playStyle: {
        type: "string",
        description: "전투 성향 텍스트(예: 공격형, 균형형, 방어형, 교란형)",
      },
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

const previewInputSchemaProperties: Record<string, unknown> = {
  candidateScript: { type: "string" },
  opponentScript: { type: "string" },
  arenaSize: { type: "number" },
  maxTicks: { type: "number" },
  maxTurns: { type: "number", description: "Deprecated alias of maxTicks" },
};

if (PRESET_OPPONENTS_ENABLED) {
  previewInputSchemaProperties.opponentPreset = {
    type: "string",
    enum: PLAY_STYLE_VALUES,
    description: "Local emulator only",
  };
}

const MCP_PREVIEW_TOOL = {
  name: "preview_robot_duel",
  description:
    PRESET_OPPONENTS_ENABLED
      ? "Run a quick simulated duel for a candidate script against a local preset or custom opponent script."
      : "Run a quick simulated duel for a candidate script against a custom opponent script.",
  inputSchema: {
    type: "object",
    properties: previewInputSchemaProperties,
    required: PRESET_OPPONENTS_ENABLED ? ["candidateScript"] : ["candidateScript", "opponentScript"],
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
        description:
          "Robot script in parser.js DSL (SET THROTTLE|STRAFE|TURN, FIRE ON|OFF, BOOST LEFT|RIGHT, IF <expr> <op> <expr> THEN ...)",
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

export const MCP_TOOLS = [
  MCP_RULES_TOOL,
  MCP_FLOW_TOOL,
  MCP_COACH_TOOL,
  MCP_VALIDATE_TOOL,
  MCP_PREVIEW_TOOL,
  MCP_UPLOAD_TOOL,
];

type McpCoachInput = z.infer<typeof MCP_COACH_SCHEMA>;
type McpValidateInput = z.infer<typeof MCP_VALIDATE_SCHEMA>;
type McpPreviewInput = z.infer<typeof MCP_PREVIEW_BASE_SCHEMA> & {
  opponentPreset?: PlayStyle;
};

function commandCount(parsedProgram: ScriptAction[]): CommandDistribution {
  const counts: CommandDistribution = {
    RULES: parsedProgram.length,
    CONDITIONAL: 0,
    SET_THROTTLE: 0,
    SET_STRAFE: 0,
    SET_TURN: 0,
    FIRE_ON: 0,
    FIRE_OFF: 0,
    BOOST: 0,
  };

  parsedProgram.forEach((rule) => {
    if (rule.condition) {
      counts.CONDITIONAL += 1;
    }

    if (rule.command.type === "SET_CONTROL") {
      if (rule.command.field === "THROTTLE") {
        counts.SET_THROTTLE += 1;
      } else if (rule.command.field === "STRAFE") {
        counts.SET_STRAFE += 1;
      } else {
        counts.SET_TURN += 1;
      }
      return;
    }

    if (rule.command.type === "FIRE") {
      if (rule.command.enabled) {
        counts.FIRE_ON += 1;
      } else {
        counts.FIRE_OFF += 1;
      }
      return;
    }

    counts.BOOST += 1;
  });

  return counts;
}

function scriptForRisk(
  template: StrategyTemplate,
  riskTolerance?: RiskTolerance,
  preferredTraits?: PreferredTrait[]
): string {
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

function applyTraitAdjustment(script: string, preferredTraits?: PreferredTrait[]): string {
  if (!Array.isArray(preferredTraits) || !preferredTraits.length) {
    return script;
  }

  let updated = script;

  if (preferredTraits.includes("unpredictable")) {
    updated += "\nIF SELF_X > 5 THEN SET STRAFE 0.7\nIF SELF_X <= 5 THEN SET STRAFE -0.7";
  }

  if (preferredTraits.includes("fast")) {
    updated += "\nSET THROTTLE 1";
  }

  if (preferredTraits.includes("accurate")) {
    updated += "\nIF ENEMY_DY > 0.08 THEN SET TURN 0.9\nIF ENEMY_DY < -0.08 THEN SET TURN -0.9";
  }

  return updated;
}

function normalizeScript(script: string): string {
  return script
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function inferPlayStyle(playStyle?: string): PlayStyle {
  const value = (playStyle || "").trim().toLowerCase();
  if (!value) {
    return "balanced";
  }

  if (/(aggress|attack|rush|공격|돌격)/.test(value)) {
    return "aggressive";
  }

  if (/(defen|surviv|tank|수비|방어|안정|생존)/.test(value)) {
    return "defensive";
  }

  if (/(trick|unpredict|juke|bait|교란|트릭|변칙|기만)/.test(value)) {
    return "trickster";
  }

  return "balanced";
}

function playStyleLabel(style: PlayStyle): string {
  if (style === "aggressive") {
    return "공격형";
  }

  if (style === "defensive") {
    return "방어형";
  }

  if (style === "trickster") {
    return "교란형";
  }

  return "균형형";
}

function buildFollowUpQuestions(missingFields: string[]): string[] {
  const questions: string[] = [];

  if (missingFields.includes("objective")) {
    questions.push("이 로봇이 노릴 승리 방식(선제타격/생존전/교란전)은 무엇인가요?");
  }

  if (missingFields.includes("playStyle")) {
    questions.push("원하는 전투 성향을 알려주세요. 예: 공격형/균형형/방어형/교란형");
  }

  if (missingFields.includes("riskTolerance")) {
    questions.push("위험 선호도는 low, medium, high 중 무엇인가요?");
  }

  return questions;
}

function summarizeDesignIntent(input: McpCoachInput): string {
  const objective = input.objective?.trim() || "승률이 높은 범용 로봇";
  const style = inferPlayStyle(input.playStyle);
  const risk = input.riskTolerance || "medium";
  const traits = (input.preferredTraits || []).join(", ");

  let summary = `목표: ${objective}. 스타일: ${playStyleLabel(style)}. 위험도: ${risk}.`;
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

function recommendRobotDraft(input: McpCoachInput): RobotDraft {
  const style = inferPlayStyle(input.playStyle);
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

export function coachRobotDesign(input: McpCoachInput): CoachRobotDesignResult {
  const missingFields: string[] = [];

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

export function validateRobotScriptDraft(input: McpValidateInput): ValidateRobotScriptResult {
  const parsedProgram = parseRobotScript(input.script);
  const counts = commandCount(parsedProgram);
  const warnings: string[] = [];
  const recommendations: string[] = [];

  if (!counts.FIRE_ON) {
    warnings.push("FIRE ON 규칙이 없어 처치가 불가능합니다.");
    recommendations.push("적이 보일 때 FIRE ON 되도록 규칙을 추가하세요.");
  }

  if (!counts.SET_TURN) {
    warnings.push("TURN 제어가 없어 조준/추적이 제한됩니다.");
    recommendations.push("ENEMY_DY 기준으로 SET TURN 규칙을 넣어보세요.");
  }

  if (!counts.SET_THROTTLE && !counts.SET_STRAFE) {
    warnings.push("이동 제어가 없어 위치 선점/회피가 어렵습니다.");
    recommendations.push("SET THROTTLE 또는 SET STRAFE 규칙을 추가하세요.");
  }

  if (!counts.CONDITIONAL) {
    warnings.push("조건 분기가 없어 환경 적응이 어렵습니다.");
    recommendations.push("IF ENEMY_VISIBLE 또는 수식 조건(IF <expr> <op> <expr>)을 추가하세요.");
  }

  if (!counts.FIRE_OFF) {
    recommendations.push("FIRE OFF 규칙을 넣으면 비전투 시 이동속도 손실을 줄일 수 있습니다.");
  }

  if (parsedProgram.length > 80) {
    warnings.push("스크립트가 길어 예측이 어려울 수 있습니다.");
    recommendations.push("핵심 규칙을 8~20줄 수준으로 단순화해 보세요.");
  }

  if (input.attackRules && !/shoot|발사|사격/i.test(input.attackRules)) {
    warnings.push("attackRules 설명에 FIRE 트리거가 명확히 드러나지 않습니다.");
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

export interface ArenaRulesResult {
  arena: {
    shape: string;
    defaultSize: number;
    startPositions: string;
  };
  physics: {
    tickRate: number;
    tickDurationMs: number;
    maxTicks: number;
    speed: {
      forwardTicksPerTile: number;
      strafeTicksPerTile: number;
      backwardTicksPerTile: number;
      note: string;
    };
    turnRateDegreesPerSecond: number;
    fireMovementPenalty: string;
    fireTurnPenalty: string;
    sideBoost: {
      burstTicks: number;
      burstProfile: number[];
      totalEquivalentStrafeTicks: number;
      energyMax: number;
      energyCost: number;
      energyRegenPerSecond: number;
      cooldownTicks: number;
    };
    fireCooldownTicks: number;
    fireEnergyCost: number;
    projectile: {
      ticksPerTile: number;
      speedTilesPerSecond: number;
      note: string;
    };
    collisionRadius: number;
  };
  vision: {
    radius: number;
    halfAngleDeg: number;
    shape: string;
    autoUpdated: boolean;
  };
  combat: {
    shotRange: number;
    shotHitRadius: number;
    hitCondition: string;
    killRule: string;
  };
  dsl: {
    evaluationRule: string;
    commands: Array<{ syntax: string; description: string }>;
    conditions: Array<{ syntax: string; description: string }>;
    expressionFunctions: Array<{ syntax: string; description: string }>;
  };
  sensors: Array<{ name: string; description: string; available: string }>;
  strategyTips: string[];
}

export function arenaRulesGuide(): ArenaRulesResult {
  return {
    arena: {
      shape: "정사각형 (NxN)",
      defaultSize: 10,
      startPositions: "로봇A=(0,0) heading=East, 로봇B=(N-1,N-1) heading=West",
    },
    physics: {
      tickRate: TARGET_FPS,
      tickDurationMs: Number(TICK_DURATION_MS.toFixed(4)),
      maxTicks: 500,
      speed: {
        forwardTicksPerTile: TICKS_PER_TILE.FORWARD,
        strafeTicksPerTile: TICKS_PER_TILE.STRAFE,
        backwardTicksPerTile: TICKS_PER_TILE.BACKWARD,
        note: "전진이 가장 빠르고, 횡이동은 중간, 후진이 가장 느림",
      },
      turnRateDegreesPerSecond: TURN_RATE_DEG_PER_SECOND,
      fireMovementPenalty: `FIRE ON 상태에서 이동속도 ${FIRE_MOVEMENT_MULTIPLIER * 100}% 감소`,
      fireTurnPenalty: `FIRE ON 상태에서 회전속도 ${FIRE_TURN_MULTIPLIER * 100}% 감소`,
      sideBoost: {
        burstTicks: SIDE_BOOST_BURST_TICKS,
        burstProfile: [...SIDE_BOOST_FORCE_SEQUENCE],
        totalEquivalentStrafeTicks: SIDE_BOOST_TOTAL_EQUIVALENT_STRAFE_TICKS,
        energyMax: SIDE_BOOST_ENERGY_MAX,
        energyCost: SIDE_BOOST_ENERGY_COST,
        energyRegenPerSecond: SIDE_BOOST_ENERGY_REGEN_PER_SECOND,
        cooldownTicks: SIDE_BOOST_COOLDOWN_TICKS,
      },
      fireCooldownTicks: FIRE_COOLDOWN_TICKS,
      fireEnergyCost: FIRE_ENERGY_COST,
      projectile: {
        ticksPerTile: PROJECTILE_TICKS_PER_TILE,
        speedTilesPerSecond: Number(PROJECTILE_SPEED_TILES_PER_SECOND.toFixed(4)),
        note: "발사체는 즉시 명중하지 않고 틱마다 비행. 이동으로 회피 가능",
      },
      collisionRadius: ROBOT_COLLISION_RADIUS,
    },
    vision: {
      radius: VISION_RADIUS,
      halfAngleDeg: VISION_HALF_ANGLE_DEG,
      shape: `전방 반원 (heading 기준 좌우 60도, 반경 ${VISION_RADIUS}칸)`,
      autoUpdated: true,
    },
    combat: {
      shotRange: SHOT_RANGE,
      shotHitRadius: SHOT_HIT_RADIUS,
      hitCondition: `적이 사거리 ${SHOT_RANGE}칸 내에 있고, 로컬 좌표 기준 lateral 거리가 ${SHOT_HIT_RADIUS} 이내일 때 적중`,
      killRule: "적중 시 즉시 사망 (원샷킬)",
    },
    dsl: {
      evaluationRule: "매 틱마다 전체 규칙을 위에서 아래로 순서대로 평가. 같은 필드는 마지막 매치가 최종값",
      commands: [
        { syntax: "SET THROTTLE <-1..1>", description: "전/후진 입력 (+전진, -후진)" },
        { syntax: "SET STRAFE <-1..1>", description: "좌/우 횡이동 입력 (+우, -좌)" },
        { syntax: "SET TURN <-1..1>", description: "좌/우 회전 입력 (+우회전, -좌회전)" },
        {
          syntax: "FIRE ON|OFF",
          description: `사격 트리거. ON 상태에서 자동 발사(에너지 소모, 쿨다운 ${FIRE_COOLDOWN_TICKS}틱 개념)`,
        },
        {
          syntax: "BOOST LEFT|RIGHT",
          description: `횡부스터. 발동 후 ${SIDE_BOOST_BURST_TICKS}틱 동안 강제 횡이동(프로파일 ${SIDE_BOOST_FORCE_SEQUENCE.join("→")})`,
        },
      ],
      conditions: [
        { syntax: "IF ENEMY_VISIBLE THEN <CMD>", description: "시야 내 적 발견시 실행" },
        { syntax: "IF NOT ENEMY_VISIBLE THEN <CMD>", description: "적 미발견시 실행" },
        {
          syntax: "IF <EXPR> <OP> <EXPR> THEN <CMD>",
          description:
            "수식 비교 조건. 연산자: >, >=, <, <=, ==, !=. 수식은 +, -, *, /, (), 센서 변수, 상수 PI/TAU 지원",
        },
        {
          syntax: "IF (<COND>) AND (<COND>) THEN <CMD>",
          description: "복합 조건(AND). 괄호로 우선순위 제어 가능",
        },
        {
          syntax: "IF (<COND>) OR (<COND>) THEN <CMD>",
          description: "복합 조건(OR). 괄호로 우선순위 제어 가능",
        },
        {
          syntax: "IF NOT (<COND>) THEN <CMD>",
          description: "조건 반전(NOT). ENEMY_VISIBLE/비교식/복합조건 모두 대상 가능",
        },
      ],
      expressionFunctions: [
        { syntax: "ATAN2(y, x)", description: "월드 좌표 기준 각도(도, 0~360) 반환" },
        { syntax: "ANGLE_DIFF(targetDeg, currentDeg)", description: "최단 회전 오차각 반환(-180~180)" },
        { syntax: "NORMALIZE_ANGLE(angleDeg)", description: "각도를 0~360으로 정규화" },
        { syntax: "ABS(x)", description: "절대값" },
        { syntax: "MIN(a, b) / MAX(a, b)", description: "두 값 중 최소/최대" },
        { syntax: "CLAMP(x, min, max)", description: "범위 제한" },
      ],
    },
    sensors: [
      { name: "SELF_X", description: "자신의 X 좌표 (0~N-1)", available: "항상" },
      { name: "SELF_Y", description: "자신의 Y 좌표 (0~N-1)", available: "항상" },
      { name: "SELF_HEADING", description: "자신의 heading (도, E=0 S=90 W=180 N=270)", available: "항상" },
      { name: "SELF_ENERGY", description: "자신의 공용 에너지 (사격/부스터, 0~100)", available: "항상" },
      { name: "BOOST_COOLDOWN", description: "사이드 부스터 재사용까지 남은 틱", available: "항상" },
      { name: "TICKS_SINCE_ENEMY_SEEN", description: "적을 마지막으로 본 뒤 경과 틱 수", available: "항상" },
      { name: "ARENA_SIZE", description: "아레나 크기 N", available: "항상" },
      { name: "ENEMY_VISIBLE", description: "적이 시야 내에 있는지 (boolean, IF 전용)", available: "항상" },
      { name: "ENEMY_X", description: "적의 X 좌표", available: "적 가시시만" },
      { name: "ENEMY_Y", description: "적의 Y 좌표", available: "적 가시시만" },
      { name: "ENEMY_HEADING", description: "적의 heading (도)", available: "적 가시시만" },
      { name: "ENEMY_DX", description: "적과의 X 좌표 차이 (월드 좌표: opponent.x - self.x)", available: "적 가시시만" },
      { name: "ENEMY_DY", description: "적과의 Y 좌표 차이 (월드 좌표: opponent.y - self.y)", available: "적 가시시만" },
      { name: "ENEMY_DISTANCE", description: "적과의 유클리드 거리", available: "적 가시시만" },
      { name: "PREV_ENEMY_X", description: "직전 마지막 가시 시점의 적 X 좌표", available: "한 번이라도 적을 본 이후" },
      { name: "PREV_ENEMY_Y", description: "직전 마지막 가시 시점의 적 Y 좌표", available: "한 번이라도 적을 본 이후" },
      {
        name: "PREV_ENEMY_HEADING",
        description: "직전 마지막 가시 시점의 적 heading(도)",
        available: "한 번이라도 적을 본 이후",
      },
      {
        name: "PREV_ENEMY_DX",
        description: "직전 마지막 가시 시점의 상대 DX(opponent.x - self.x)",
        available: "한 번이라도 적을 본 이후",
      },
      {
        name: "PREV_ENEMY_DY",
        description: "직전 마지막 가시 시점의 상대 DY(opponent.y - self.y)",
        available: "한 번이라도 적을 본 이후",
      },
      {
        name: "PREV_ENEMY_DISTANCE",
        description: "직전 마지막 가시 시점의 적 거리",
        available: "한 번이라도 적을 본 이후",
      },
      {
        name: "ENEMY_DX_DELTA",
        description: "현재 가시값 ENEMY_DX - PREV_ENEMY_DX",
        available: "현재 적 가시 + 이전 가시 기록이 있을 때",
      },
      {
        name: "ENEMY_DY_DELTA",
        description: "현재 가시값 ENEMY_DY - PREV_ENEMY_DY",
        available: "현재 적 가시 + 이전 가시 기록이 있을 때",
      },
      {
        name: "ENEMY_DISTANCE_DELTA",
        description: "현재 가시값 ENEMY_DISTANCE - PREV_ENEMY_DISTANCE",
        available: "현재 적 가시 + 이전 가시 기록이 있을 때",
      },
      { name: "WALL_AHEAD_DISTANCE", description: "정면(heading) 방향 벽까지 거리", available: "항상" },
      { name: "WALL_LEFT_DISTANCE", description: "좌측(heading 기준) 벽까지 거리", available: "항상" },
      { name: "WALL_RIGHT_DISTANCE", description: "우측(heading 기준) 벽까지 거리", available: "항상" },
      { name: "WALL_BACK_DISTANCE", description: "후방(heading 기준) 벽까지 거리", available: "항상" },
      { name: "WALL_NEAREST_DISTANCE", description: "가장 가까운 벽 거리", available: "항상" },
    ],
    strategyTips: [
      "규칙 순서가 중요: 기본값은 위에, 조건부 오버라이드는 아래에 배치 (마지막 매치가 최종값)",
      "FIRE ON은 이동속도와 회전속도를 각각 50% 감소시킴. 비전투시 FIRE OFF를 유지하면 기동력 확보",
      `BOOST LEFT/RIGHT는 ${SIDE_BOOST_BURST_TICKS}틱 강제 횡이동(${SIDE_BOOST_FORCE_SEQUENCE.join(
        "→"
      )}, 총 ${SIDE_BOOST_TOTAL_EQUIVALENT_STRAFE_TICKS}틱 분량)이며 에너지와 쿨다운을 소모`,
      "조건식은 AND/OR/NOT + 괄호를 지원하므로, 감지/거리/벽 조건을 조합해 회피 우선순위를 만들 수 있음",
      "PREV_ENEMY_*와 ENEMY_*_DELTA를 활용하면 적의 직전 관측 기반 패턴 추적(예: 좌우 편향, 접근/이탈)을 구현 가능",
      "조준 오차각은 ANGLE_DIFF(ATAN2(ENEMY_DY, ENEMY_DX), SELF_HEADING)로 계산 가능",
      "벽 회피에 WALL_AHEAD_DISTANCE보다 SELF_X/SELF_Y가 효율적 (heading 무관하게 가장자리 감지)",
      "시작 위치가 (0,0) vs (N-1,N-1) 대각선이라 직선 전진만으로는 조우 불가. 대각선 접근 또는 회전 탐색 필요",
      `시야는 ${VISION_RADIUS}칸이지만 사격은 ${SHOT_RANGE}칸. 먼저 보고(탐지) 접근한 뒤 발사 각을 맞추는 운영이 중요`,
      `SHOT_HIT_RADIUS=${SHOT_HIT_RADIUS}이므로 정면 정렬이 매우 중요. SET TURN으로 미세 조준 필수`,
      `FIRE는 ${FIRE_COOLDOWN_TICKS}틱 쿨다운 개념이지만 실질적으로는 매틱 발사가 가능. 대신 사격 에너지 관리가 핵심`,
      `발사체 속도는 ${PROJECTILE_TICKS_PER_TILE}틱/칸(${PROJECTILE_SPEED_TILES_PER_SECOND.toFixed(
        2
      )}칸/초). 발사 후 도달 전까지 회피 기회가 존재`,
    ],
  };
}

export function defaultFlowGuide(): BuildFlowResult {
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
      `자동 시야(전방 ${VISION_RADIUS}칸) 기준으로 적 발견 시 FIRE ON 우선인지, 기동 우선인지 정해볼까요?`,
      "SET THROTTLE/STRAFE/TURN 기본값을 공격형/균형형/회피형 중 어디로 둘까요?",
      "회피하고 싶은 약점(벽충돌, 과회전, 사격 시 감속)이 있나요?",
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

function resolveOpponent(input: McpPreviewInput): { robotName: string; parsedProgram: ScriptAction[]; source: string } {
  if (input.opponentScript && input.opponentScript.trim()) {
    const parsed = parseRobotScript(input.opponentScript);
    return {
      robotName: "CustomOpponent",
      parsedProgram: parsed,
      source: "custom_script",
    };
  }

  if (!PRESET_OPPONENTS_ENABLED) {
    throw new Error("opponentScript is required on server. Preset opponents are only available in local emulator mode.");
  }

  const preset = input.opponentPreset || "balanced";
  const template = STRATEGY_LIBRARY[preset];

  return {
    robotName: `Preset-${template.label}`,
    parsedProgram: parseRobotScript(template.script),
    source: `preset:${preset}`,
  };
}

export function previewRobotDuel(input: McpPreviewInput): PreviewRobotDuelResult {
  const candidateProgram = parseRobotScript(input.candidateScript);
  const opponent = resolveOpponent(input);
  const maxTicks = resolveMaxTicks(input, 500);

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
    maxTicks,
  });

  const candidateWon = simulation.winnerRobotId === "candidate";
  const firstHitTick = simulation.ticks.find((tickLog) => tickLog.projectiles.some((projectile) => projectile.hit));
  const firstHit = simulation.timeline.find((entry) => entry.result?.projectile?.hit);
  const candidateShootCount = simulation.timeline.filter(
    (entry) => entry.robotId === "candidate" && entry.result?.firing?.shotFired
  ).length;
  const candidateTurnActivityCount = simulation.timeline.filter(
    (entry) => entry.robotId === "candidate" && Math.abs(Number(entry.result?.controls?.turn || 0)) > 0.05
  ).length;
  const candidateMobilityCount = simulation.timeline.filter(
    (entry) => entry.robotId === "candidate" && Number(entry.result?.movement?.distance || 0) > 0.01
  ).length;
  const candidateFireSlowdownTicks = simulation.timeline.filter(
    (entry) => entry.robotId === "candidate" && entry.result?.firing?.triggerHeld
  ).length;

  const recommendations: string[] = [];

  if (!candidateShootCount) {
    recommendations.push("사격 타이밍이 부족합니다. ENEMY_VISIBLE 조건에서 FIRE ON 규칙을 넣으세요.");
  }

  if (!candidateTurnActivityCount) {
    recommendations.push("회전 입력이 없어 조준이 어렵습니다. ENEMY_DY 기반 SET TURN 규칙을 추가하세요.");
  }

  if (!candidateMobilityCount) {
    recommendations.push("이동 입력이 부족합니다. SET THROTTLE 또는 SET STRAFE로 위치 변화를 주세요.");
  }

  if (candidateFireSlowdownTicks > simulation.ticks.length * 0.8) {
    recommendations.push("FIRE ON 유지 시간이 길어 감속 손실이 큽니다. 비가시 상태에서는 FIRE OFF를 고려하세요.");
  }

  if (!candidateWon) {
    recommendations.push("초반 각 확보를 위해 기본 TURN 값을 조정하고 ENEMY_DY 임계치를 낮춰보세요.");
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
    maxTicks,
    ticksPlayed: simulation.ticks.length,
    turnsPlayed: simulation.turns.length,
    firstHitStep: firstHit ? firstHit.step : firstHitTick ? firstHitTick.tick : null,
    summary:
      candidateWon
        ? "Candidate가 프리뷰에서 승리했습니다."
        : "Candidate가 프리뷰에서 승리하지 못했습니다.",
    recommendations,
    replaySnippet: simulation.timeline.slice(0, 20),
    finalState: simulation.finalState,
  };
}

export const MCP_SERVER_INSTRUCTIONS =
  `Robots fight in real-time ticks with auto-updated forward vision (radius ${VISION_RADIUS}) and shot range ${SHOT_RANGE}. Script controls are SET THROTTLE/STRAFE/TURN, FIRE ON|OFF, and BOOST LEFT|RIGHT with IF ... THEN conditions. IF supports comparisons (<EXPR> <OP> <EXPR>), logical operators (AND/OR/NOT), and parentheses. Expressions support +,-,*,/,(), sensors, and functions ATAN2/ANGLE_DIFF/NORMALIZE_ANGLE/ABS/MIN/MAX/CLAMP. Memory sensors are available: TICKS_SINCE_ENEMY_SEEN, PREV_ENEMY_X/Y/HEADING/DX/DY/DISTANCE, ENEMY_DX_DELTA, ENEMY_DY_DELTA, ENEMY_DISTANCE_DELTA. Movement and turning while firing are each reduced to half speed. FIRE has a ${FIRE_COOLDOWN_TICKS}-tick conceptual cooldown (effectively can fire every tick) but consumes shared energy. Fired projectiles travel over time (${PROJECTILE_TICKS_PER_TILE} ticks per tile), so dodging before impact is possible. Side boost uses shared energy and ${SIDE_BOOST_COOLDOWN_TICKS}-tick cooldown, then forces lateral movement for ${SIDE_BOOST_BURST_TICKS} ticks with profile ${SIDE_BOOST_FORCE_SEQUENCE.join(
    "->"
  )}. Server mode does not provide preset opponents; duels use explicitly provided scripts. Recommended flow: get_build_flow -> coach_robot_design (iterate with user Q&A) -> validate_robot_script -> preview_robot_duel -> upload_robot_script.`;
