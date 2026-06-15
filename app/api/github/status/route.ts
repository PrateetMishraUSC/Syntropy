import { auth } from "@clerk/nextjs/server";
import { getUserGitHubIdentity } from "@/lib/github-oauth";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const identity = await getUserGitHubIdentity(userId);
  if (!identity) return Response.json({ connected: false });

  // Confirm the token still works + get the login for display.
  const res = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${identity.token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "Syntropy",
    },
  });
  if (res.status === 401) return Response.json({ connected: false, revoked: true });

  const login =
    identity.login ??
    ((await res.json().catch(() => null)) as { login?: string } | null)?.login ??
    null;
  return Response.json({ connected: true, login });
}
