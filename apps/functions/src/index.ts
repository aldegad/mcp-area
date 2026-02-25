import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import type { DocumentData, DocumentSnapshot } from "firebase-admin/firestore";
import cors from "cors";
import { z } from "zod";
import { parseRobotScript, type ScriptAction } from "./parser";
import {
  simulateBattle,
  type BattleSimulation,
  type BattleSnapshot,
  type Perception,
  type ReplayFrame,
  type SimulationActionLog,
  type TickLog,
} from "./battleEngine";
import {
  MCP_COACH_SCHEMA,
  MCP_PREVIEW_SCHEMA,
  MCP_SERVER_INSTRUCTIONS,
  MCP_TOOLS,
  MCP_VALIDATE_SCHEMA,
  arenaRulesGuide,
  coachRobotDesign,
  defaultFlowGuide,
  previewRobotDuel,
  validateRobotScriptDraft,
} from "./mcpTools";
import {
  errorMessage,
  errorResponse,
  normalizePath,
  safeJsonBody,
  type JsonObject,
} from "./httpUtils";
import { rpcError, rpcSuccess, toolResult, type JsonRpcId, type JsonRpcResponse } from "./jsonRpc";
import { resolveMaxTicks } from "./simulationConfig";
import { getStorageBucket } from "./storage";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const enableCors = cors({ origin: true });
const MAX_ROBOT_IMAGE_SVG_CHARS = 50_000;
const MAX_ROBOT_IMAGE_SVG_BYTES = 50 * 1024;
const ROBOT_IMAGE_CONTENT_TYPE = "image/svg+xml; charset=utf-8";

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
  robotImageSvg: z.string().min(1).max(MAX_ROBOT_IMAGE_SVG_CHARS),
});

const MCP_UPLOAD_COLLABORATOR_SCHEMA = z.object({
  name: z.string().min(1).max(120),
  version: z.string().min(1).max(120),
  role: z.string().max(120).optional(),
});

const MCP_ROBOT_UPLOAD_SCHEMA = ROBOT_UPLOAD_SCHEMA.extend({
  collaboratorAgents: z.array(MCP_UPLOAD_COLLABORATOR_SCHEMA).min(1).max(20),
});

const CREATE_BATTLE_SCHEMA = z
  .object({
    robotAId: z.string().min(1),
    robotBId: z.string().min(1),
    arenaSize: z.number().int().min(6).max(40).default(10),
    maxTicks: z.number().int().min(20).max(5000).optional(),
    maxTurns: z.number().int().min(1).max(1000).optional(),
  })
  .refine((data) => data.robotAId !== data.robotBId, {
    message: "robotAId and robotBId must be different",
    path: ["robotBId"],
  });

interface CollaboratorAgentInfo {
  name: string;
  role?: string;
  version?: string;
}

type CollaboratorAgent = string | CollaboratorAgentInfo;

interface RobotResponseData {
  id: string;
  creatorNickname: string;
  collaboratorAgents: CollaboratorAgent[];
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

interface UploadRobotToolResult {
  ok: true;
  robotId: string;
  robotName: string;
  commandCount: number;
  message: string;
}

interface BattleResponseData {
  id: string;
  robotAId: string;
  robotBId: string;
  arenaSize: number;
  maxTicks: number;
  maxTurns: number;
  status: BattleSimulation["status"];
  winnerRobotId: string | null;
  visionRadius: number;
  shotRange?: number;
  tickDurationMs: number;
  projectileTiming?: BattleSimulation["projectileTiming"];
  movementTiming: BattleSimulation["movementTiming"];
  replayFrameRate: number;
  initialState: BattleSnapshot;
  initialPerception: Record<string, Perception>;
  timeline: SimulationActionLog[];
  ticks: TickLog[];
  turns: TickLog[];
  replayFrames: ReplayFrame[];
  finalState: BattleSnapshot;
  finalPerception: Record<string, Perception>;
  createdAt: string | null;
}

interface BattleReplayData {
  timeline: SimulationActionLog[];
  ticks: TickLog[];
  turns: TickLog[];
  replayFrames: ReplayFrame[];
}

function requireDocumentData(snapshot: DocumentSnapshot, entityLabel: string): DocumentData {
  const data = snapshot.data();
  if (!data) {
    throw new Error(`${entityLabel} data is missing`);
  }

  return data;
}

function serializeTimestamp(value: unknown): string | null {
  if (!value) {
    return null;
  }

  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate: () => Date }).toDate === "function"
  ) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }

  if (typeof value === "string") {
    return value;
  }

  return null;
}

function normalizeRobotImageSvg(svgInput: string): string {
  const svg = svgInput.trim();
  if (!svg) {
    throw new Error("robotImageSvg must not be empty");
  }

  const byteLength = Buffer.byteLength(svg, "utf8");
  if (byteLength > MAX_ROBOT_IMAGE_SVG_BYTES) {
    throw new Error(`robotImageSvg is too large (${byteLength} bytes). Max ${MAX_ROBOT_IMAGE_SVG_BYTES} bytes.`);
  }

  const hasSvgRoot =
    /^<svg[\s\S]*<\/svg>\s*$/i.test(svg) || /^<\?xml[\s\S]*\?>\s*<svg[\s\S]*<\/svg>\s*$/i.test(svg);
  if (!hasSvgRoot) {
    throw new Error("robotImageSvg must be a complete SVG document with <svg> root");
  }

  const blockedPatterns = [
    /<script[\s>]/i,
    /<foreignobject[\s>]/i,
    /<iframe[\s>]/i,
    /<object[\s>]/i,
    /<embed[\s>]/i,
    /<!entity/i,
    /\son[a-z0-9_-]+\s*=/i,
    /(xlink:href|href)\s*=\s*["']\s*javascript:/i,
  ];
  if (blockedPatterns.some((pattern) => pattern.test(svg))) {
    throw new Error("robotImageSvg contains unsupported or unsafe markup");
  }

  return svg;
}

function isStorageObjectMissingError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const value = error as { code?: unknown; message?: unknown };
  if (value.code === 404) {
    return true;
  }

  return typeof value.message === "string" && /no such object/i.test(value.message);
}

function serializeRobotDoc(doc: DocumentSnapshot): RobotResponseData {
  const data = requireDocumentData(doc, `Robot ${doc.id}`);
  const robotImagePath = typeof data.robotImagePath === "string" ? data.robotImagePath : null;
  return {
    id: doc.id,
    creatorNickname: data.creatorNickname,
    collaboratorAgents: data.collaboratorAgents || [],
    robotName: data.robotName,
    movementRules: data.movementRules,
    rotationRules: data.rotationRules,
    attackRules: data.attackRules,
    scriptPath: data.scriptPath,
    robotImagePath,
    commandCount: Array.isArray(data.parsedProgram) ? data.parsedProgram.length : 0,
    createdAt: serializeTimestamp(data.createdAt),
    updatedAt: serializeTimestamp(data.updatedAt),
  };
}

function extractBattleReplayData(source: unknown): BattleReplayData {
  if (typeof source !== "object" || source === null || Array.isArray(source)) {
    return {
      timeline: [],
      ticks: [],
      turns: [],
      replayFrames: [],
    };
  }

  const payload = source as {
    timeline?: unknown;
    ticks?: unknown;
    turns?: unknown;
    replayFrames?: unknown;
  };

  return {
    timeline: Array.isArray(payload.timeline) ? (payload.timeline as SimulationActionLog[]) : [],
    ticks: Array.isArray(payload.ticks) ? (payload.ticks as TickLog[]) : [],
    turns: Array.isArray(payload.turns) ? (payload.turns as TickLog[]) : [],
    replayFrames: Array.isArray(payload.replayFrames) ? (payload.replayFrames as ReplayFrame[]) : [],
  };
}

async function resolveBattleReplayData(doc: DocumentSnapshot): Promise<BattleReplayData> {
  const data = requireDocumentData(doc, `Battle ${doc.id}`);
  const fallbackReplay = extractBattleReplayData(data);
  const replayPath = typeof data.replayPath === "string" ? data.replayPath.trim() : "";

  if (!replayPath) {
    return fallbackReplay;
  }

  try {
    const storageBucket = getStorageBucket();
    const [buffer] = await storageBucket.file(replayPath).download();
    const parsed = JSON.parse(buffer.toString("utf8")) as unknown;
    const replayFromStorage = extractBattleReplayData(parsed);

    const hasReplay =
      replayFromStorage.timeline.length > 0 ||
      replayFromStorage.ticks.length > 0 ||
      replayFromStorage.turns.length > 0;

    return hasReplay ? replayFromStorage : fallbackReplay;
  } catch (error) {
    console.warn(`Failed to load replay for battle ${doc.id}:`, errorMessage(error));
    return fallbackReplay;
  }
}

function serializeBattleDoc(doc: DocumentSnapshot, replayData: BattleReplayData): BattleResponseData {
  const data = requireDocumentData(doc, `Battle ${doc.id}`);
  const replayFrameRate =
    typeof data.replayFrameRate === "number" && Number.isFinite(data.replayFrameRate)
      ? data.replayFrameRate
      : Math.max(1, Math.round(1000 / Math.max(1, Number(data.tickDurationMs) || 200)));
  return {
    id: doc.id,
    robotAId: data.robotAId,
    robotBId: data.robotBId,
    arenaSize: data.arenaSize,
    maxTicks: data.maxTicks,
    maxTurns: data.maxTurns,
    status: data.status,
    winnerRobotId: data.winnerRobotId,
    visionRadius: data.visionRadius,
    shotRange: data.shotRange,
    tickDurationMs: data.tickDurationMs,
    projectileTiming: data.projectileTiming,
    movementTiming: data.movementTiming,
    replayFrameRate,
    initialState: data.initialState,
    initialPerception: data.initialPerception,
    timeline: replayData.timeline,
    ticks: replayData.ticks,
    turns: replayData.turns,
    replayFrames: replayData.replayFrames,
    finalState: data.finalState,
    finalPerception: data.finalPerception,
    createdAt: serializeTimestamp(data.createdAt),
  };
}

function isRuleConditionShape(condition: unknown): boolean {
  if (typeof condition !== "object" || condition === null) {
    return false;
  }

  const value = condition as {
    type?: unknown;
    visible?: unknown;
    left?: unknown;
    right?: unknown;
    operator?: unknown;
    operand?: unknown;
  };

  if (value.type === "VISIBILITY") {
    return typeof value.visible === "boolean";
  }

  if (value.type === "COMPARE") {
    const operator = value.operator;
    const allowedOperator =
      operator === ">" ||
      operator === ">=" ||
      operator === "<" ||
      operator === "<=" ||
      operator === "==" ||
      operator === "!=";
    return allowedOperator && value.left !== undefined && value.right !== undefined;
  }

  if (value.type === "LOGICAL") {
    const logicalOperator = value.operator === "AND" || value.operator === "OR";
    if (!logicalOperator) {
      return false;
    }

    return isRuleConditionShape(value.left) && isRuleConditionShape(value.right);
  }

  if (value.type === "NOT") {
    return isRuleConditionShape(value.operand);
  }

  return false;
}

function isParsedProgramV2(program: unknown): program is ScriptAction[] {
  if (!Array.isArray(program) || !program.length) {
    return false;
  }

  return program.every((entry) => {
    if (typeof entry !== "object" || entry === null) {
      return false;
    }

    const rule = entry as {
      type?: unknown;
      line?: unknown;
      condition?: unknown;
      command?: unknown;
    };

    if (rule.type !== "RULE" || typeof rule.line !== "number") {
      return false;
    }

    if (rule.condition !== null && rule.condition !== undefined) {
      if (!isRuleConditionShape(rule.condition)) {
        return false;
      }
    }

    if (typeof rule.command !== "object" || rule.command === null) {
      return false;
    }

    const command = rule.command as { type?: unknown };
    return command.type === "SET_CONTROL" || command.type === "FIRE" || command.type === "BOOST";
  });
}

async function createRobot(robotPayload: unknown): Promise<RobotResponseData> {
  const parsedInput = ROBOT_UPLOAD_SCHEMA.parse(robotPayload);
  const parsedProgram = parseRobotScript(parsedInput.script);
  const robotImageSvg = normalizeRobotImageSvg(parsedInput.robotImageSvg);

  const robotRef = db.collection("robots").doc();
  const scriptPath = `robots/${robotRef.id}/script.txt`;
  const robotImagePath = `robots/${robotRef.id}/avatar.svg`;

  const storageBucket = getStorageBucket();
  const saveTasks: Promise<unknown>[] = [
    storageBucket.file(scriptPath).save(parsedInput.script, {
      contentType: "text/plain; charset=utf-8",
      resumable: false,
      metadata: {
        cacheControl: "no-cache",
      },
    }),
    storageBucket.file(robotImagePath).save(robotImageSvg, {
      contentType: ROBOT_IMAGE_CONTENT_TYPE,
      resumable: false,
      metadata: {
        cacheControl: "public, max-age=300",
      },
    }),
  ];

  await Promise.all(saveTasks);

  const timestamp = FieldValue.serverTimestamp();

  await robotRef.set({
    creatorNickname: parsedInput.creatorNickname,
    collaboratorAgents: parsedInput.collaboratorAgents,
    robotName: parsedInput.robotName,
    movementRules: parsedInput.movementRules,
    rotationRules: parsedInput.rotationRules,
    attackRules: parsedInput.attackRules,
    scriptPath,
    robotImagePath,
    parsedProgram,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  const createdDoc = await robotRef.get();
  return serializeRobotDoc(createdDoc);
}

async function runBattle(payload: unknown): Promise<BattleResponseData> {
  const parsedInput = CREATE_BATTLE_SCHEMA.parse(payload);
  const maxTicks = resolveMaxTicks(parsedInput, 500);

  const [robotASnapshot, robotBSnapshot] = await Promise.all([
    db.collection("robots").doc(parsedInput.robotAId).get(),
    db.collection("robots").doc(parsedInput.robotBId).get(),
  ]);

  if (!robotASnapshot.exists || !robotBSnapshot.exists) {
    throw new Error("One or both robots were not found");
  }

  const robotAData = requireDocumentData(robotASnapshot, `Robot ${parsedInput.robotAId}`);
  const robotBData = requireDocumentData(robotBSnapshot, `Robot ${parsedInput.robotBId}`);

  if (!isParsedProgramV2(robotAData.parsedProgram)) {
    throw new Error(
      `Robot ${parsedInput.robotAId} uses a legacy script format. Re-upload this robot with the current control DSL.`
    );
  }

  if (!isParsedProgramV2(robotBData.parsedProgram)) {
    throw new Error(
      `Robot ${parsedInput.robotBId} uses a legacy script format. Re-upload this robot with the current control DSL.`
    );
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
    maxTicks,
  });

  const battleRef = db.collection("battles").doc();
  const replayPath = `battles/${battleRef.id}/replay.json`;
  const replayData: BattleReplayData = {
    timeline: simulation.timeline,
    ticks: simulation.ticks,
    turns: simulation.turns,
    replayFrames: simulation.replayFrames,
  };
  const replayJson = JSON.stringify(replayData);
  const replaySizeBytes = Buffer.byteLength(replayJson, "utf8");
  const timestamp = FieldValue.serverTimestamp();
  const storageBucket = getStorageBucket();

  await storageBucket.file(replayPath).save(replayJson, {
    contentType: "application/json; charset=utf-8",
    resumable: false,
    metadata: {
      cacheControl: "no-cache",
    },
  });

  await battleRef.set({
    robotAId: parsedInput.robotAId,
    robotBId: parsedInput.robotBId,
    arenaSize: parsedInput.arenaSize,
    maxTicks,
    maxTurns: maxTicks,
    status: simulation.status,
    winnerRobotId: simulation.winnerRobotId,
    visionRadius: simulation.visionRadius,
    shotRange: simulation.shotRange,
    tickDurationMs: simulation.tickDurationMs,
    projectileTiming: simulation.projectileTiming,
    movementTiming: simulation.movementTiming,
    replayFrameRate: simulation.replayFrameRate,
    replayPath,
    replaySizeBytes,
    timelineCount: replayData.timeline.length,
    tickCount: replayData.ticks.length,
    turnCount: replayData.turns.length,
    replayFrameCount: replayData.replayFrames.length,
    initialState: simulation.initialState,
    initialPerception: simulation.initialPerception,
    finalState: simulation.finalState,
    finalPerception: simulation.finalPerception,
    createdAt: timestamp,
  });

  const battleSnapshot = await battleRef.get();
  return serializeBattleDoc(battleSnapshot, replayData);
}

async function handleMcpRequest(body: JsonObject): Promise<JsonRpcResponse<unknown>> {
  const rawId = body?.id;
  const id: JsonRpcId = typeof rawId === "string" || typeof rawId === "number" ? rawId : null;
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
        version: "0.3.0",
      },
      instructions: MCP_SERVER_INSTRUCTIONS,
    });
  }

  if (method === "tools/list") {
    return rpcSuccess(id, {
      tools: MCP_TOOLS,
    });
  }

  if (method === "tools/call") {
    const params = (body?.params as JsonObject | undefined) ?? {};
    const toolName = params?.name;
    const args = (params?.arguments as JsonObject | undefined) ?? {};

    try {
      if (toolName === "get_arena_rules") {
        return rpcSuccess(id, toolResult(arenaRulesGuide()));
      }

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

        const normalizedUploadPayload = MCP_ROBOT_UPLOAD_SCHEMA.parse(uploadPayload);
        const createdRobot = await createRobot(normalizedUploadPayload);
        const uploadResult: UploadRobotToolResult = {
          ok: true,
          robotId: createdRobot.id,
          robotName: createdRobot.robotName,
          commandCount: createdRobot.commandCount,
          message: "Robot uploaded to mcp-arena.",
        };
        return rpcSuccess(
          id,
          toolResult(uploadResult)
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

export const api = onRequest({ region: "us-central1" }, async (req, res) => {
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
          version: "0.3.0",
          endpoints: [
            "GET /health",
            "GET /robots",
            "GET /robots/:robotId/avatar",
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

      if ((req.method === "GET" || req.method === "HEAD") && /^\/robots\/[^/]+\/avatar$/.test(path)) {
        const robotId = path.split("/")[2];
        const robotSnapshot = await db.collection("robots").doc(robotId).get();

        if (!robotSnapshot.exists) {
          errorResponse(res, 404, `Robot ${robotId} not found`);
          return;
        }

        const robotData = requireDocumentData(robotSnapshot, `Robot ${robotId}`);
        const robotImagePath = typeof robotData.robotImagePath === "string" ? robotData.robotImagePath.trim() : "";

        if (!robotImagePath) {
          errorResponse(res, 404, `Robot ${robotId} has no avatar`);
          return;
        }

        try {
          const storageBucket = getStorageBucket();
          const [buffer] = await storageBucket.file(robotImagePath).download();
          res.setHeader("Content-Type", ROBOT_IMAGE_CONTENT_TYPE);
          res.setHeader("Cache-Control", "public, max-age=120");
          if (req.method === "HEAD") {
            res.status(200).end();
            return;
          }

          res.status(200).send(buffer);
          return;
        } catch (error) {
          if (isStorageObjectMissingError(error)) {
            errorResponse(res, 404, `Robot ${robotId} avatar not found`);
            return;
          }
          throw error;
        }
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

        const replayData = await resolveBattleReplayData(battleSnapshot);
        res.json({
          battle: serializeBattleDoc(battleSnapshot, replayData),
        });
        return;
      }

      if (req.method === "POST" && path === "/mcp") {
        const body = safeJsonBody(req);
        const responseBody = await handleMcpRequest(body);
        const isError = "error" in responseBody;
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
