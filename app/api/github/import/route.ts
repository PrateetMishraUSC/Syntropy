import { tasks, auth as triggerAuth } from "@trigger.dev/sdk";
import { getCurrentUserIdentity, getAccessibleProject } from "@/lib/project-access";
import { getUserGitHubToken } from "@/lib/github-oauth";
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

  // Phase 2: attach the caller's GitHub token (if connected) so private repos
  // import. undefined falls back to the server GITHUB_TOKEN (Phase 1 behavior).
  const accessToken = (await getUserGitHubToken(identity.userId)) ?? undefined;

  let handle: Awaited<ReturnType<typeof tasks.trigger>>;
  try {
    handle = await tasks.trigger<typeof githubAnalyzer>("github-analyzer", {
      repoUrl, roomId, projectId, userId: identity.userId, mode, accessToken,
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
        repoBranch: parsed.branch ?? null, source: accessToken ? "oauth" : "url",
      },
    }),
  ]).then((r) => r.map((x) => (x.status === "fulfilled" ? x.value : null)));

  return Response.json({ runId: handle.id, publicToken }, { status: 201 });
}
