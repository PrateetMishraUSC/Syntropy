export interface ParsedRepoUrl {
  owner: string;
  repo: string;
  branch?: string;
}

// Accepts: https://github.com/owner/repo, git@github.com:owner/repo.git, owner/repo, etc.
export function parseGitHubUrl(input: string): ParsedRepoUrl | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // SSH form: git@github.com:owner/repo.git
  const ssh = trimmed.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/);
  if (ssh) return { owner: ssh[1], repo: ssh[2] };

  let path = trimmed
    .replace(/^https?:\/\//, "")
    .replace(/^github\.com\//, "")
    .replace(/^www\.github\.com\//, "");

  if (path.startsWith("github.com/")) path = path.slice("github.com/".length);

  const parts = path.split("/").filter(Boolean);
  if (parts.length < 2) return null;

  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/, "");
  if (!owner || !repo) return null;

  let branch: string | undefined;
  if (parts[2] === "tree" && parts[3]) branch = parts[3];

  return { owner, repo, branch };
}

const GH_API = "https://api.github.com";

export interface RepoMeta {
  owner: string;
  repo: string;
  defaultBranch: string;
  description: string | null;
  primaryLanguage: string | null;
  topics: string[];
  stars: number;
  isPrivate: boolean;
  isFork: boolean;
}

export interface TreeEntry {
  path: string;
  type: "blob" | "tree";
  size?: number;
}

export type GitHubResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: "not_found" | "rate_limited" | "error"; message: string };

export class GitHubClient {
  private headers: Record<string, string>;

  constructor(token?: string) {
    this.headers = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "Syntropy-Importer",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }

  private async req<T>(path: string, raw = false): Promise<GitHubResult<T>> {
    let res: Response;
    try {
      res = await fetch(`${GH_API}${path}`, {
        headers: raw
          ? { ...this.headers, Accept: "application/vnd.github.raw" }
          : this.headers,
      });
    } catch (e) {
      return { ok: false, reason: "error", message: (e as Error).message };
    }

    if (res.status === 404) {
      return { ok: false, reason: "not_found", message: "Repository or path not found (it may be private)." };
    }
    if (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0") {
      return { ok: false, reason: "rate_limited", message: "GitHub API rate limit reached. Try again shortly." };
    }
    if (!res.ok) {
      return { ok: false, reason: "error", message: `GitHub API ${res.status}` };
    }

    const data = raw ? ((await res.text()) as unknown as T) : ((await res.json()) as T);
    return { ok: true, data };
  }

  async getRepo(owner: string, repo: string): Promise<GitHubResult<RepoMeta>> {
    const r = await this.req<Record<string, unknown>>(`/repos/${owner}/${repo}`);
    if (!r.ok) return r;
    const d = r.data;
    return {
      ok: true,
      data: {
        owner,
        repo,
        defaultBranch: (d.default_branch as string) ?? "main",
        description: (d.description as string | null) ?? null,
        primaryLanguage: (d.language as string | null) ?? null,
        topics: (d.topics as string[] | undefined) ?? [],
        stars: (d.stargazers_count as number) ?? 0,
        isPrivate: Boolean(d.private),
        isFork: Boolean(d.fork),
      },
    };
  }

  async getLanguages(owner: string, repo: string): Promise<GitHubResult<string[]>> {
    const r = await this.req<Record<string, number>>(`/repos/${owner}/${repo}/languages`);
    if (!r.ok) return r;
    return { ok: true, data: Object.keys(r.data) };
  }

  async getTree(owner: string, repo: string, branch: string): Promise<GitHubResult<TreeEntry[]>> {
    const r = await this.req<{ tree: TreeEntry[]; truncated: boolean }>(
      `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    );
    if (!r.ok) return r;
    return { ok: true, data: r.data.tree ?? [] };
  }

  async getFileContent(
    owner: string,
    repo: string,
    path: string,
    branch: string,
  ): Promise<GitHubResult<string>> {
    return this.req<string>(
      `/repos/${owner}/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(branch)}`,
      true,
    );
  }

  async getReadme(owner: string, repo: string): Promise<GitHubResult<string>> {
    return this.req<string>(`/repos/${owner}/${repo}/readme`, true);
  }
}
