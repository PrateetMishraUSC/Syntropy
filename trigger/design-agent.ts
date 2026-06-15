import { task } from "@trigger.dev/sdk";
import { generateText } from "ai";
import { google } from "@ai-sdk/google";
import { getLiveblocksClient } from "@/lib/liveblocks";
import { canvasTools, CANVAS_CONVENTIONS } from "@/trigger/lib/canvas-tools";
import { applyCanvasMutations, readExistingCanvas } from "@/trigger/lib/apply-canvas-mutations";
import { setStatus, broadcastStatus, setAiThinking } from "@/trigger/lib/task-status";
import type { CanvasNode, CanvasEdge } from "@/types/canvas";

const SYSTEM_PROMPT = `You are an AI that designs system architecture diagrams on a collaborative canvas.

## Your process (follow this exact order)

STEP 0 — PLAN. Before any tool call, write out your plan as plain text:
  Nodes: list every node id.
  Edges: list every edge as "source -> target : label".
A diagram with N nodes needs AT LEAST N-1 edges, and usually more. Do not under-connect.

STEP 1 — Call addNode once for EVERY node in your plan. Skip none.
STEP 2 — Call addEdge once for EVERY edge in your plan. Work straight down the
  edge list you wrote in STEP 0. Do not stop until every edge is placed.
STEP 3 — Call finishDesign. ONLY after the last edge is placed. Calling it before
  all planned edges exist is an error.

You must emit all tool calls in a single response — nodes first, then edges, then finishDesign.

${CANVAS_CONVENTIONS}

## WORKED EXAMPLE — match this structure exactly

Plan:
  Nodes: user, load-balancer, api-servers, redis-cache, nosql-db, analytics-service
  Edges:
    user -> load-balancer : HTTPS
    load-balancer -> api-servers : route
    api-servers -> redis-cache : cache lookup
    api-servers -> nosql-db : read/write
    api-servers -> analytics-service : log click

Then the calls:
addNode({ id: "user", label: "User", shape: "circle", colorBg: "#1F1F1F", x: 100, y: 150, width: 160, height: 60 })
addNode({ id: "load-balancer", label: "Load Balancer", shape: "diamond", colorBg: "#331B00", x: 380, y: 150, width: 160, height: 60 })
addNode({ id: "api-servers", label: "API Servers", shape: "rectangle", colorBg: "#10233D", x: 660, y: 150, width: 160, height: 60 })
addNode({ id: "redis-cache", label: "Redis Cache", shape: "cylinder", colorBg: "#062822", x: 940, y: 30, width: 160, height: 60 })
addNode({ id: "nosql-db", label: "NoSQL Database", shape: "cylinder", colorBg: "#0F2E18", x: 940, y: 250, width: 160, height: 60 })
addNode({ id: "analytics-service", label: "Analytics Service", shape: "rectangle", colorBg: "#3A1726", x: 660, y: 480, width: 180, height: 60 })
addEdge({ id: "edge-user-lb", source: "user", target: "load-balancer", arrowType: "source-to-target", label: "HTTPS" })
addEdge({ id: "edge-lb-api", source: "load-balancer", target: "api-servers", arrowType: "source-to-target", label: "route" })
addEdge({ id: "edge-api-redis", source: "api-servers", target: "redis-cache", arrowType: "bidirectional", label: "cache lookup" })
addEdge({ id: "edge-api-db", source: "api-servers", target: "nosql-db", arrowType: "bidirectional", label: "read/write" })
addEdge({ id: "edge-api-analytics", source: "api-servers", target: "analytics-service", arrowType: "source-to-target", label: "log click" })
finishDesign({ summary: "URL shortener with load balancer, API servers, Redis cache, NoSQL store, and analytics." })`;

export const designAgent = task({
  id: "design-agent",
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 10_000,
    maxTimeoutInMs: 60_000,
    factor: 2,
    randomize: true,
  },
  run: async (payload: { prompt: string; roomId: string; userId?: string }, { ctx }) => {
    const { prompt, roomId } = payload;
    const runId = ctx.run.id;
    const liveblocks = getLiveblocksClient();

    setStatus("thinking", "Analyzing your request…");
    await setAiThinking(liveblocks, roomId, true);
    await broadcastStatus(liveblocks, roomId, runId, "thinking", "Analyzing your request…");

    try {
      const existing = await readExistingCanvas(liveblocks, roomId);

      setStatus("processing", "Designing your architecture…");
      await broadcastStatus(liveblocks, roomId, runId, "processing", "Designing your architecture…");

      const contextLine =
        existing.nodes.length > 0
          ? `Existing canvas has ${existing.nodes.length} nodes: ${JSON.stringify(existing.nodes)} and ${existing.edges.length} edges: ${JSON.stringify(existing.edges)}. Extend this design without duplicating existing IDs.`
          : "The canvas is currently empty. Generate a complete initial architecture.";

      const result = await generateText({
        model: google("gemini-2.5-flash"),
        tools: canvasTools,
        system: SYSTEM_PROMPT,
        prompt: `${contextLine}\n\nUser request: ${prompt}`,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toolCalls = result.toolCalls as Array<{ toolName: string; input: any }>;

      const finishCall = toolCalls.find((tc) => tc.toolName === "finishDesign");
      const summary = finishCall ? ((finishCall.input as { summary: string }).summary) : "Design complete.";

      const addedNodes = toolCalls.filter((tc) => tc.toolName === "addNode").length;
      const addedEdges = toolCalls.filter((tc) => tc.toolName === "addEdge").length;
      const applyingMsg = `Placing ${addedNodes} nodes and ${addedEdges} connections…`;

      setStatus("applying", applyingMsg);
      await broadcastStatus(liveblocks, roomId, runId, "applying", applyingMsg);

      try {
        await applyCanvasMutations(liveblocks, roomId, toolCalls);
      } catch (mutateError: unknown) {
        const msg = mutateError instanceof Error ? mutateError.message : String(mutateError);
        console.error("[design-agent] mutateStorage failed:", msg, mutateError);
        throw new Error(`Canvas update failed: ${msg}`);
      }

      setStatus("done", summary);
      await setAiThinking(liveblocks, roomId, false, 3_000);
      await broadcastStatus(liveblocks, roomId, runId, "done", summary);

      const actionsCount = toolCalls.filter((tc) => tc.toolName !== "finishDesign").length;
      return { success: true, summary, actionsCount, nodes: addedNodes, edges: addedEdges };
    } catch (error) {
      setStatus("error", "Something went wrong. Please try again.");
      await setAiThinking(liveblocks, roomId, false, 1_000);
      await broadcastStatus(liveblocks, roomId, runId, "error", "Something went wrong. Please try again.");
      throw error;
    }
  },
});

export type { CanvasNode, CanvasEdge };
