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
    payload: {
      repoUrl: string;
      roomId: string;
      projectId: string;
      userId: string;
      mode?: "replace" | "append";
      accessToken?: string;
    },
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
