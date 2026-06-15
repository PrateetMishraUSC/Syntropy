# Repo Import Backend — Shared Refactor, Task, API Routes, Prisma (Phase 1)

This is the integration core. Order of work:

1. Extract shared canvas logic out of `design-agent.ts` into `trigger/lib/`.
2. Refactor `design-agent.ts` to use it (behavior unchanged).
3. Add the `RepoImport` Prisma model.
4. Build the `github-analyzer` task.
5. Build the two API routes.

---

## Step 1 — Extract shared canvas logic

Today `trigger/design-agent.ts` holds `canvasTools`, the `NODE_COLORS`/shape constants, the `mutateStorage` loop, and the status helpers inline. Move them into three files. **Copy the logic verbatim** — this step is a pure refactor with no behavior change.

### `trigger/lib/canvas-tools.ts`

```ts
import { tool } from "ai";
import { z } from "zod";

export const CANVAS_SHAPES = ["rectangle", "circle", "diamond", "pill", "cylinder", "hexagon"] as const;
export const ARROW_TYPES = ["source-to-target", "target-to-source", "bidirectional"] as const;

export const NODE_COLORS = [
  { bg: "#1F1F1F", text: "#EDEDED" },
  { bg: "#10233D", text: "#52A8FF" },
  { bg: "#2E1938", text: "#BF7AF0" },
  { bg: "#331B00", text: "#FF990A" },
  { bg: "#3C1618", text: "#FF6166" },
  { bg: "#3A1726", text: "#F75F8F" },
  { bg: "#0F2E18", text: "#62C073" },
  { bg: "#062822", text: "#0AC7B4" },
] as const;

export const colorByBg: Map<string, string> = new Map(NODE_COLORS.map((c) => [c.bg, c.text]));

// Shared canvas drawing conventions — used by BOTH design-agent and github-analyzer.
// Keep this identical to what canvas-flow.tsx renders.
export const CANVAS_CONVENTIONS = `## Node shapes
- rectangle: services, servers, application layers (generic)
- circle: users, clients, external actors
- diamond: routing, load balancers, decision points
- pill: APIs, endpoints, interfaces, proxies
- cylinder: databases, caches, message queues, storage
- hexagon: microservices, containers, isolated modules

## Node bg colors (use exactly these hex values, passed as colorBg)
- "#10233D" (blue) — APIs, web services, application layers
- "#0F2E18" (green) — databases, persistent storage
- "#2E1938" (purple) — async queues, event buses, pub/sub
- "#331B00" (orange) — gateways, load balancers, proxies
- "#062822" (teal) — caches, CDNs, read replicas
- "#3C1618" (red) — security, auth, rate limiters
- "#3A1726" (pink) — monitoring, logging, analytics
- "#1F1F1F" (dark) — utility services, background workers

## Layout
- First node at x=100, y=150
- Space nodes 280px horizontally, 220px vertically
- Flow left-to-right or top-to-bottom; cluster related services spatially
- Default width=160, height=60; use width=180 for labels longer than 20 chars

## Edge rules
- Every node MUST appear in at least one edge — no isolated nodes
- arrowType "source-to-target" for unidirectional, "bidirectional" for mutual
- Short edge labels for protocol or action (e.g. "HTTPS", "SQL", "publish")

## IDs
kebab-case slugs for nodes ("api-gateway", "redis-cache") and edges ("edge-lb-api").`;

// The exact tool set both tasks use.
export const canvasTools = {
  addNode: tool({
    description: "Add a new node to the canvas",
    inputSchema: z.object({
      id: z.string().describe("Unique kebab-case slug, e.g. 'api-gateway'"),
      label: z.string().describe("Display label shown on the node"),
      shape: z.enum(CANVAS_SHAPES),
      colorBg: z.string().describe("Background color hex from the allowed palette"),
      x: z.number(),
      y: z.number(),
      width: z.number().optional(),
      height: z.number().optional(),
    }),
  }),
  moveNode: tool({
    description: "Move an existing node",
    inputSchema: z.object({ id: z.string(), x: z.number(), y: z.number() }),
  }),
  resizeNode: tool({
    description: "Resize an existing node",
    inputSchema: z.object({ id: z.string(), width: z.number(), height: z.number() }),
  }),
  updateNodeData: tool({
    description: "Update label, color, or shape of an existing node",
    inputSchema: z.object({
      id: z.string(),
      label: z.string().optional(),
      colorBg: z.string().optional(),
      shape: z.enum(CANVAS_SHAPES).optional(),
    }),
  }),
  deleteNode: tool({
    description: "Delete a node",
    inputSchema: z.object({ id: z.string() }),
  }),
  addEdge: tool({
    description: "Add a directed edge between two nodes",
    inputSchema: z.object({
      id: z.string(),
      source: z.string(),
      target: z.string(),
      label: z.string().optional(),
      arrowType: z.enum(ARROW_TYPES).optional(),
    }),
  }),
  deleteEdge: tool({
    description: "Delete an edge",
    inputSchema: z.object({ id: z.string() }),
  }),
  finishDesign: tool({
    description: "Call this last to signal the design is complete",
    inputSchema: z.object({ summary: z.string() }),
  }),
};
```

### `trigger/lib/apply-canvas-mutations.ts`

This is the `mutateStorage` loop lifted out of `design-agent.ts`, unchanged. It also exposes the "read existing canvas" helper both tasks use.

```ts
import { LiveObject, LiveMap } from "@liveblocks/core";
import type { Liveblocks } from "@liveblocks/node";
import { NODE_COLORS, colorByBg } from "./canvas-tools";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ToolCall = { toolName: string; input: any };

export interface ExistingCanvas {
  nodes: Array<{ id: string; label: string }>;
  edges: Array<{ id: string; source: string; target: string }>;
}

export async function readExistingCanvas(
  liveblocks: Liveblocks,
  roomId: string,
): Promise<ExistingCanvas> {
  try {
    const storage = await liveblocks.getStorageDocument(roomId, "json");
    const flow = (storage as Record<string, unknown>)?.flow as Record<string, unknown> | undefined;
    if (!flow) return { nodes: [], edges: [] };
    const nodesObj = (flow.nodes ?? {}) as Record<string, unknown>;
    const edgesObj = (flow.edges ?? {}) as Record<string, unknown>;
    return {
      nodes: Object.values(nodesObj).map((n) => {
        const node = n as Record<string, unknown>;
        const data = node.data as Record<string, unknown> | undefined;
        return { id: node.id as string, label: (data?.label as string) ?? "" };
      }),
      edges: Object.values(edgesObj).map((e) => {
        const edge = e as Record<string, unknown>;
        return { id: edge.id as string, source: edge.source as string, target: edge.target as string };
      }),
    };
  } catch {
    return { nodes: [], edges: [] };
  }
}

// Applies the AI's tool calls to Liveblocks storage. Lifted verbatim from design-agent.
// `clearFirst` supports the GitHub-import "Replace canvas" option.
export async function applyCanvasMutations(
  liveblocks: Liveblocks,
  roomId: string,
  toolCalls: ToolCall[],
  opts: { clearFirst?: boolean } = {},
): Promise<void> {
  await liveblocks.mutateStorage(roomId, ({ root }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let flow = root.get("flow") as any;
    if (!flow) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      flow = new LiveObject({ nodes: new LiveMap<string, LiveObject<any>>(), edges: new LiveMap<string, LiveObject<any>>() });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (root as any).set("flow", flow);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let nodesMap: LiveMap<string, LiveObject<any>> = flow.get("nodes");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let edgesMap: LiveMap<string, LiveObject<any>> = flow.get("edges");
    if (!nodesMap) { nodesMap = new LiveMap(); flow.set("nodes", nodesMap); }
    if (!edgesMap) { edgesMap = new LiveMap(); flow.set("edges", edgesMap); }

    if (opts.clearFirst) {
      for (const k of Array.from(nodesMap.keys())) nodesMap.delete(k);
      for (const k of Array.from(edgesMap.keys())) edgesMap.delete(k);
    }

    for (const tc of toolCalls) {
      switch (tc.toolName) {
        case "addNode": {
          const { id, label, shape, colorBg, x, y, width, height } = tc.input;
          const resolvedBg = NODE_COLORS.find((c) => c.bg === colorBg)?.bg ?? "#1F1F1F";
          const resolvedText = colorByBg.get(resolvedBg) ?? "#EDEDED";
          nodesMap.set(id, new LiveObject({
            id, type: "canvasNode", position: { x, y },
            data: new LiveObject({ label, shape, color: resolvedBg, textColor: resolvedText }),
            width: width ?? 160, height: height ?? 60,
            selected: false, dragging: false, measured: false, resizing: false,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          }) as any);
          break;
        }
        case "moveNode": {
          const node = nodesMap.get(tc.input.id);
          if (node) node.set("position", { x: tc.input.x, y: tc.input.y });
          break;
        }
        case "resizeNode": {
          const node = nodesMap.get(tc.input.id);
          if (node) { node.set("width", tc.input.width); node.set("height", tc.input.height); }
          break;
        }
        case "updateNodeData": {
          const node = nodesMap.get(tc.input.id);
          if (node) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const data: LiveObject<any> | undefined = node.get("data");
            if (data) {
              if (tc.input.label !== undefined) data.set("label", tc.input.label);
              if (tc.input.colorBg) {
                data.set("color", tc.input.colorBg);
                data.set("textColor", colorByBg.get(tc.input.colorBg) ?? "#EDEDED");
              }
              if (tc.input.shape) data.set("shape", tc.input.shape);
            }
          }
          break;
        }
        case "deleteNode": nodesMap.delete(tc.input.id); break;
        case "addEdge": {
          const { id, source, target, label, arrowType } = tc.input;
          edgesMap.set(id, new LiveObject({
            id, type: "canvasEdge", source, target,
            data: new LiveObject({ label: label ?? "", arrowType: arrowType ?? "source-to-target" }),
            selected: false,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          }) as any);
          break;
        }
        case "deleteEdge": edgesMap.delete(tc.input.id); break;
      }
    }
  });
}
```

### `trigger/lib/task-status.ts`

```ts
import { metadata } from "@trigger.dev/sdk";
import type { Liveblocks } from "@liveblocks/node";

const AI_USER_ID = "ai-design-agent";

export function setStatus(status: string, message: string) {
  metadata.set("status", status);
  metadata.set("message", message);
}

export async function broadcastStatus(
  liveblocks: Liveblocks,
  roomId: string,
  runId: string,
  status: string,
  message: string,
) {
  await liveblocks
    .broadcastEvent(roomId, { type: "ai-status", runId, status, message })
    .catch(() => {});
}

export async function setAiThinking(
  liveblocks: Liveblocks,
  roomId: string,
  thinking: boolean,
  ttl = 120_000,
) {
  await liveblocks
    .setPresence(roomId, {
      userId: AI_USER_ID,
      data: { cursor: null, thinking },
      userInfo: { displayName: "AI Architect", avatarUrl: "", cursorColor: "#f0a030" },
      ttl,
    })
    .catch(() => {});
}
```

### Step 2 — Refactor `design-agent.ts`

Replace the inline definitions with imports. The `run` body keeps its exact flow; it now calls `readExistingCanvas`, `applyCanvasMutations`, `setStatus`, `broadcastStatus`, `setAiThinking`. Its `SYSTEM_PROMPT` becomes `"<design-agent-specific intro>" + CANVAS_CONVENTIONS + "<worked example>"`. **Verify the AI Architect still works before moving on** — this de-risks the new task, since any regression is isolated to the refactor.

---

## Step 3 — `RepoImport` Prisma model

`prisma/models/repo-import.prisma`:

```prisma
enum RepoImportStatus {
  PENDING
  COMPLETED
  FAILED
}

model RepoImport {
  id          String           @id @default(cuid())
  projectId   String
  userId      String
  runId       String           @unique
  repoUrl     String
  repoOwner   String
  repoName    String
  repoBranch  String?
  source      String           @default("url")   // "url" (Phase 1) | "oauth" (Phase 2)
  status      RepoImportStatus @default(PENDING)
  nodeCount   Int?
  edgeCount   Int?
  summary     String?
  createdAt   DateTime         @default(now())
  updatedAt   DateTime         @updatedAt

  @@index([projectId, createdAt])
  @@index([userId])
  @@index([runId])
}
```

Then:
```bash
npx prisma migrate dev --name add_repo_import
# build script already runs `prisma generate`
```

> Mirrors the existing `TaskRun` pattern (`runId @unique`, `userId`, `projectId`) but adds repo metadata + outcome so you can render import history and "last imported from owner/repo".

---

## Step 4 — `trigger/github-analyzer.ts`

```ts
import { task } from "@trigger.dev/sdk";
import { generateText } from "ai";
import { google } from "@ai-sdk/google";
import { getLiveblocksClient } from "@/lib/liveblocks";
import { GitHubClient, parseGitHubUrl } from "@/lib/github";
import { analyzeRepo, type RepoAnalysis } from "@/lib/repo-analysis";
import { canvasTools, CANVAS_CONVENTIONS } from "@/trigger/lib/canvas-tools";
import { applyCanvasMutations, readExistingCanvas } from "@/trigger/lib/apply-canvas-mutations";
import { setStatus, broadcastStatus, setAiThinking } from "@/trigger/lib/task-status";
import prisma from "@/lib/prisma";

const SYSTEM_PROMPT = `You are an AI that reverse-engineers a software repository into a
system architecture diagram on a collaborative canvas.

You are given a structured analysis of a GitHub repository: its languages, top-level
directories, detected frameworks/databases/infra/services, and excerpts of key config
files. Infer the runtime architecture and draw it.

## Your process
STEP 0 — PLAN (plain text): list every node id, then every edge as "source -> target : label".
STEP 1 — addNode for EVERY node.
STEP 2 — addEdge for EVERY edge (>= N-1 for N nodes; do not under-connect).
STEP 3 — finishDesign LAST.
Emit all tool calls in one response: nodes, then edges, then finishDesign.

## How to map a repo to a diagram
- Each detected service (from docker-compose services or monorepo apps/*) → a node.
- Detected databases → cylinder nodes (green). Caches/Redis → cylinder (teal).
- Message brokers (kafka/rabbitmq/sqs) → cylinder (purple).
- An API framework (express/fastapi/next api) → rectangle or pill (blue).
- A gateway / reverse proxy / load balancer → diamond (orange).
- External clients/users implied by a web frontend → circle (dark).
- Connect services to the datastores and brokers they use; connect the gateway/frontend
  to the services. Prefer a realistic request flow over a star.
- If signals are sparse, fall back to: client → app (framework) → database, plus anything
  the README or top-level dirs clearly imply. Always produce a usable diagram.

${CANVAS_CONVENTIONS}`;

function buildAnalysisPrompt(a: RepoAnalysis, existingCount: number, mode: "replace" | "append"): string {
  const s = a.signals;
  return [
    `# Repository: ${a.meta.owner}/${a.meta.repo}`,
    a.meta.description ? `Description: ${a.meta.description}` : "",
    `Primary language(s): ${a.languages.join(", ") || "unknown"}`,
    `Topics: ${a.meta.topics.join(", ") || "none"}`,
    `Total files: ${a.fileCount}`,
    `Top-level directories: ${a.topLevelDirs.join(", ") || "none"}`,
    "",
    "## Detected signals",
    `- Package managers: ${s.packageManagers.join(", ") || "none"}`,
    `- Frameworks: ${s.frameworks.join(", ") || "none"}`,
    `- Databases: ${s.databases.join(", ") || "none"}`,
    `- Messaging: ${s.messaging.join(", ") || "none"}`,
    `- Infra: ${s.infra.join(", ") || "none"}`,
    `- CI/CD: ${s.cicd.join(", ") || "none"}`,
    `- Services: ${s.services.join(", ") || "none"}`,
    "",
    "## Key file excerpts",
    ...a.keyFiles.map((f) => `### ${f.path}\n\`\`\`\n${f.excerpt}\n\`\`\``),
    "",
    a.readmeExcerpt ? `## README (excerpt)\n${a.readmeExcerpt}` : "",
    "",
    mode === "append" && existingCount > 0
      ? `The canvas already has ${existingCount} nodes. Extend without duplicating existing IDs.`
      : "Draw the full architecture from scratch.",
  ].filter(Boolean).join("\n");
}

export const githubAnalyzer = task({
  id: "github-analyzer",
  retry: { maxAttempts: 3, minTimeoutInMs: 10_000, maxTimeoutInMs: 60_000, factor: 2, randomize: true },
  run: async (
    payload: { repoUrl: string; roomId: string; projectId: string; userId: string; mode?: "replace" | "append"; accessToken?: string },
    { ctx },
  ) => {
    const { repoUrl, roomId, projectId, userId, accessToken } = payload;
    const mode = payload.mode ?? "append";
    const runId = ctx.run.id;
    const liveblocks = getLiveblocksClient();

    const parsed = parseGitHubUrl(repoUrl);
    if (!parsed) {
      setStatus("error", "That doesn't look like a GitHub repo URL.");
      await broadcastStatus(liveblocks, roomId, runId, "error", "That doesn't look like a GitHub repo URL.");
      await prisma.repoImport.update({ where: { runId }, data: { status: "FAILED" } }).catch(() => {});
      throw new Error("Invalid GitHub URL");
    }

    setStatus("thinking", "Fetching repository…");
    await setAiThinking(liveblocks, roomId, true);
    await broadcastStatus(liveblocks, roomId, runId, "thinking", "Fetching repository…");

    // Phase 1: server token. Phase 2 passes the user's token.
    const client = new GitHubClient(accessToken ?? process.env.GITHUB_TOKEN);

    setStatus("processing", "Analyzing repository structure…");
    await broadcastStatus(liveblocks, roomId, runId, "processing", "Analyzing repository structure…");

    const result = await analyzeRepo(client, parsed);
    if (!result.ok) {
      const msg =
        result.reason === "not_found"
          ? "Repository not found. If it's private, connect your GitHub account."
          : result.reason === "rate_limited"
          ? "GitHub rate limit reached. Please try again in a minute."
          : result.reason === "empty"
          ? "This repository looks empty."
          : "Couldn't analyze this repository.";
      setStatus("error", msg);
      await setAiThinking(liveblocks, roomId, false, 1_000);
      await broadcastStatus(liveblocks, roomId, runId, "error", msg);
      await prisma.repoImport.update({ where: { runId }, data: { status: "FAILED" } }).catch(() => {});
      throw new Error(`analyzeRepo failed: ${result.reason}`);
    }
    const analysis = result.analysis;

    const existing = mode === "append" ? await readExistingCanvas(liveblocks, roomId) : { nodes: [], edges: [] };

    setStatus("processing", `Designing architecture for ${analysis.meta.repo}…`);
    await broadcastStatus(liveblocks, roomId, runId, "processing", `Designing architecture for ${analysis.meta.repo}…`);

    const gen = await generateText({
      model: google("gemini-2.5-flash"),
      tools: canvasTools,
      system: SYSTEM_PROMPT,
      prompt: buildAnalysisPrompt(analysis, existing.nodes.length, mode),
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toolCalls = gen.toolCalls as Array<{ toolName: string; input: any }>;
    const nodes = toolCalls.filter((t) => t.toolName === "addNode").length;
    const edges = toolCalls.filter((t) => t.toolName === "addEdge").length;
    const finish = toolCalls.find((t) => t.toolName === "finishDesign");
    const summary = finish ? (finish.input as { summary: string }).summary : `Imported ${analysis.meta.repo}.`;

    const applyMsg = `Placing ${nodes} nodes and ${edges} connections…`;
    setStatus("applying", applyMsg);
    await broadcastStatus(liveblocks, roomId, runId, "applying", applyMsg);

    await applyCanvasMutations(liveblocks, roomId, toolCalls, { clearFirst: mode === "replace" });

    setStatus("done", summary);
    await setAiThinking(liveblocks, roomId, false, 3_000);
    await broadcastStatus(liveblocks, roomId, runId, "done", summary);

    await prisma.repoImport.update({
      where: { runId },
      data: { status: "COMPLETED", nodeCount: nodes, edgeCount: edges, summary },
    }).catch(() => {});

    return { success: true, summary, nodes, edges, repo: `${analysis.meta.owner}/${analysis.meta.repo}` };
  },
});
```

Note how steps 5–7 are identical in spirit to `design-agent`: `generateText` with the shared `canvasTools`, then `applyCanvasMutations`, then broadcast. The novelty is entirely in fetch + analyze + prompt-build.

---

## Step 5 — API routes

### `app/api/github/import/route.ts`

Mirrors `/api/ai/design/route.ts` exactly, plus URL validation and a `RepoImport` row.

```ts
import { tasks, auth as triggerAuth } from "@trigger.dev/sdk";
import { getCurrentUserIdentity, getAccessibleProject } from "@/lib/project-access";
import { parseGitHubUrl } from "@/lib/github";
import prisma from "@/lib/prisma";
import type { githubAnalyzer } from "@/trigger/github-analyzer";

export async function POST(request: Request) {
  const identity = await getCurrentUserIdentity();
  if (!identity) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body: Record<string, unknown> = await request.json().catch(() => ({}));
  const repoUrl = typeof body.url === "string" ? body.url.trim() : "";
  const roomId = typeof body.roomId === "string" ? body.roomId.trim() : "";
  const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
  const mode = body.mode === "replace" ? "replace" : "append";

  if (!repoUrl || !roomId || !projectId) {
    return Response.json({ error: "Missing required fields" }, { status: 400 });
  }

  const parsed = parseGitHubUrl(repoUrl);
  if (!parsed) return Response.json({ error: "Invalid GitHub URL" }, { status: 400 });

  const access = await getAccessibleProject(projectId, identity);
  if (!access) return Response.json({ error: "Forbidden" }, { status: 403 });

  let handle: Awaited<ReturnType<typeof tasks.trigger>>;
  try {
    handle = await tasks.trigger<typeof githubAnalyzer>("github-analyzer", {
      repoUrl, roomId, projectId, userId: identity.userId, mode,
      // Phase 2 will add: accessToken: <user's GitHub token>
    });
  } catch (err) {
    console.error("[/api/github/import] trigger failed:", err);
    return Response.json({ error: "Failed to start import" }, { status: 500 });
  }

  const [publicToken] = await Promise.allSettled([
    triggerAuth.createPublicToken({ scopes: { read: { runs: [handle.id] } }, expirationTime: "1h" }),
    prisma.repoImport.create({
      data: {
        runId: handle.id, projectId, userId: identity.userId,
        repoUrl, repoOwner: parsed.owner, repoName: parsed.repo,
        repoBranch: parsed.branch ?? null, source: "url",
      },
    }),
  ]).then((r) => r.map((x) => (x.status === "fulfilled" ? x.value : null)));

  return Response.json({ runId: handle.id, publicToken }, { status: 201 });
}
```

### `app/api/github/import/token/route.ts`

Identical to `/api/ai/design/token/route.ts` but checks `RepoImport` instead of `TaskRun`:

```ts
import { auth } from "@clerk/nextjs/server";
import { auth as triggerAuth } from "@trigger.dev/sdk/v3";
import prisma from "@/lib/prisma";

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body: Record<string, unknown> = await request.json().catch(() => ({}));
  const runId = typeof body.runId === "string" ? body.runId.trim() : "";
  if (!runId) return Response.json({ error: "Missing runId" }, { status: 400 });

  const imp = await prisma.repoImport.findUnique({ where: { runId } });
  if (!imp || imp.userId !== userId) return Response.json({ error: "Not found" }, { status: 404 });

  const token = await triggerAuth.createPublicToken({
    scopes: { read: { runs: [runId] } },
    expirationTime: "1h",
  });
  return Response.json({ token });
}
```

---

## Integration checklist (Phase 1 backend)

- [ ] `trigger/lib/canvas-tools.ts`, `apply-canvas-mutations.ts`, `task-status.ts` created.
- [ ] `design-agent.ts` refactored to import them; AI Architect still works end-to-end.
- [ ] `RepoImport` model migrated; `prisma generate` ran (via build).
- [ ] `github-analyzer` task registered (Trigger.dev picks up `trigger/**` automatically).
- [ ] `GITHUB_TOKEN` set in **both** Trigger.dev env and Vercel env.
- [ ] `/api/github/import` + `/api/github/import/token` deployed.
- [ ] `trigger dev` locally confirms the task runs and mutates the canvas.

Proceed to `34-repo-import-frontend.md`.
