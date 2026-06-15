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
