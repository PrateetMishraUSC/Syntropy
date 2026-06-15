import { auth } from "@clerk/nextjs/server";
import { getUserGitHubToken } from "@/lib/github-oauth";

type GhRepo = {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  language: string | null;
  private: boolean;
  fork: boolean;
  stargazers_count: number;
  pushed_at: string;
};

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const token = await getUserGitHubToken(userId);
  if (!token) return Response.json({ error: "Not connected" }, { status: 403 });

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();

  // Sorted by recently pushed; affiliation includes repos the user can read.
  const res = await fetch(
    `https://api.github.com/user/repos?per_page=30&page=${page}&sort=pushed&affiliation=owner,collaborator,organization_member`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "Syntropy",
      },
    },
  );

  if (res.status === 401)
    return Response.json({ error: "GitHub connection expired", revoked: true }, { status: 401 });
  if (!res.ok) return Response.json({ error: "Failed to load repositories" }, { status: 502 });

  const repos = (await res.json()) as GhRepo[];

  const mapped = repos
    .filter((r) => (q ? r.full_name.toLowerCase().includes(q) : true))
    .map((r) => ({
      id: r.id,
      name: r.name,
      fullName: r.full_name,
      url: r.html_url,
      description: r.description,
      language: r.language,
      isPrivate: r.private,
      isFork: r.fork,
      stars: r.stargazers_count,
      pushedAt: r.pushed_at,
    }));

  // GitHub sends a Link header for next-page detection.
  const hasNext = (res.headers.get("link") ?? "").includes('rel="next"');
  return Response.json({ repos: mapped, page, hasNext });
}
