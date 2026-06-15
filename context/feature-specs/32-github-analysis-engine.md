# GitHub API Client + Repo Analysis Engine (Phase 1)

Two new server-only modules:

- `lib/github.ts` — a thin, fetch-based GitHub REST client (no SDK dependency).
- `lib/repo-analysis.ts` — turns raw GitHub data into a structured `RepoAnalysis` that the LLM can reason about.

> **Why no Octokit?** Syntropy already favors lean dependencies and the existing code uses raw `fetch`/Liveblocks-node. We need ~5 endpoints. A fetch client keeps the bundle small and avoids version churn. If you prefer Octokit, the same shapes apply — swap the internals of `lib/github.ts`.

---

## `lib/github.ts`

### Responsibilities
1. Parse a user-supplied URL/slug into `{ owner, repo, branch? }`.
2. Authenticated REST calls (server `GITHUB_TOKEN`, or a passed-in user token in Phase 2).
3. Five operations: repo metadata, languages, recursive tree, single-file content, README.
4. Normalize errors into typed results (`not_found` → private/missing, `rate_limited`, `ok`).

### URL parsing — accept everything users paste

```ts
export interface ParsedRepoUrl {
  owner: string;
  repo: string;
  branch?: string;
}

// Accepts:
//   https://github.com/owner/repo
//   https://github.com/owner/repo.git
//   https://github.com/owner/repo/tree/main/some/dir
//   git@github.com:owner/repo.git
//   github.com/owner/repo
//   owner/repo
export function parseGitHubUrl(input: string): ParsedRepoUrl | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // SSH form: git@github.com:owner/repo.git
  const ssh = trimmed.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/);
  if (ssh) return { owner: ssh[1], repo: ssh[2] };

  // Strip protocol + host if present
  let path = trimmed
    .replace(/^https?:\/\//, "")
    .replace(/^github\.com\//, "")
    .replace(/^www\.github\.com\//, "");

  // If a full github.com URL was given without the replace catching host:
  if (path.startsWith("github.com/")) path = path.slice("github.com/".length);

  const parts = path.split("/").filter(Boolean);
  if (parts.length < 2) return null;

  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/, "");
  if (!owner || !repo) return null;

  // Optional branch from /tree/<branch>
  let branch: string | undefined;
  if (parts[2] === "tree" && parts[3]) branch = parts[3];

  return { owner, repo, branch };
}
```

### The client

```ts
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
    // Object keys are languages, ordered by bytes desc by GitHub already.
    return { ok: true, data: Object.keys(r.data) };
  }

  async getTree(owner: string, repo: string, branch: string): Promise<GitHubResult<TreeEntry[]>> {
    // recursive=1 returns the WHOLE tree in one request.
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
    // raw media type returns the file body directly (no base64 round-trip).
    return this.req<string>(
      `/repos/${owner}/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(branch)}`,
      true,
    );
  }

  async getReadme(owner: string, repo: string): Promise<GitHubResult<string>> {
    return this.req<string>(`/repos/${owner}/${repo}/readme`, true);
  }
}
```

Notes:
- The `raw` Accept header makes file reads return the body directly — no base64 decode.
- `getTree` with `recursive=1` is the efficiency keystone: one request for the full file list. (GitHub may set `truncated: true` for enormous repos >100k entries; that's fine — we only need top-level structure + known paths.)
- Every method returns a typed `GitHubResult` so the task can branch on `not_found` (→ "private repo" UX) vs `rate_limited` vs generic error.

---

## `lib/repo-analysis.ts`

This is the brain. It converts GitHub data into a compact, structured description an LLM can map to an architecture.

### The output shape

```ts
export interface RepoAnalysis {
  meta: RepoMeta;
  languages: string[];
  fileCount: number;
  topLevelDirs: string[];
  signals: {
    packageManagers: string[]; // npm, pip, go-mod, maven, cargo, bundler, composer
    frameworks: string[];      // next, react, express, fastapi, django, spring, rails…
    databases: string[];       // postgres, mysql, mongo, redis, prisma, sqlite…
    infra: string[];           // docker, docker-compose, kubernetes, terraform
    cicd: string[];            // github-actions, circleci, gitlab-ci
    services: string[];        // service names from compose / monorepo packages
    messaging: string[];       // kafka, rabbitmq, sqs, nats (from deps/compose)
  };
  keyFiles: { path: string; excerpt: string }[];
  readmeExcerpt: string | null;
}
```

### Signal-file selection

We only read files that reveal architecture. Define the catalog:

```ts
const MAX_FILES = 18;
const MAX_EXCERPT_BYTES = 4000;

// Files we read in full (excerpt-capped) wherever they appear at root or one level deep.
const SIGNAL_FILES: { match: (p: string) => boolean; kind: string }[] = [
  { match: (p) => p === "package.json", kind: "node" },
  { match: (p) => p === "requirements.txt", kind: "python" },
  { match: (p) => p === "pyproject.toml", kind: "python" },
  { match: (p) => p === "Pipfile", kind: "python" },
  { match: (p) => p === "go.mod", kind: "go" },
  { match: (p) => p === "pom.xml", kind: "java" },
  { match: (p) => p === "build.gradle" || p === "build.gradle.kts", kind: "java" },
  { match: (p) => p === "Cargo.toml", kind: "rust" },
  { match: (p) => p === "Gemfile", kind: "ruby" },
  { match: (p) => p === "composer.json", kind: "php" },
  { match: (p) => /^docker-compose\.ya?ml$/.test(p), kind: "compose" },
  { match: (p) => p === "Dockerfile" || /\/Dockerfile$/.test(p), kind: "docker" },
  { match: (p) => p === "prisma/schema.prisma", kind: "prisma" },
  { match: (p) => /^\.github\/workflows\/.+\.ya?ml$/.test(p), kind: "github-actions" },
  { match: (p) => /^(k8s|kubernetes|deploy)\/.+\.ya?ml$/.test(p), kind: "kubernetes" },
  { match: (p) => /\.tf$/.test(p), kind: "terraform" },
  { match: (p) => p === "serverless.yml" || p === "serverless.yaml", kind: "serverless" },
  { match: (p) => p === "next.config.js" || p === "next.config.ts" || p === "next.config.mjs", kind: "next" },
];

// Dependency → framework/db/messaging keyword maps (substring match against manifests)
const DEP_KEYWORDS = {
  frameworks: ["next", "react", "vue", "svelte", "angular", "express", "fastify",
               "nestjs", "fastapi", "flask", "django", "spring", "rails", "gin", "echo", "actix"],
  databases: ["postgres", "pg", "mysql", "mongodb", "mongoose", "redis", "ioredis",
              "prisma", "sqlite", "sqlalchemy", "dynamodb", "cassandra", "elasticsearch"],
  messaging: ["kafka", "kafkajs", "amqplib", "rabbitmq", "bullmq", "sqs", "nats", "pubsub"],
};
```

### The analyzer

```ts
import { GitHubClient, type ParsedRepoUrl, type RepoMeta, type TreeEntry } from "@/lib/github";

export type AnalyzeResult =
  | { ok: true; analysis: RepoAnalysis }
  | { ok: false; reason: "not_found" | "rate_limited" | "empty" | "error"; message: string };

export async function analyzeRepo(
  client: GitHubClient,
  parsed: ParsedRepoUrl,
): Promise<AnalyzeResult> {
  const { owner, repo } = parsed;

  const metaRes = await client.getRepo(owner, repo);
  if (!metaRes.ok) return { ok: false, reason: metaRes.reason, message: metaRes.message };
  const meta = metaRes.data;
  const branch = parsed.branch ?? meta.defaultBranch;

  const [langRes, treeRes] = await Promise.all([
    client.getLanguages(owner, repo),
    client.getTree(owner, repo, branch),
  ]);

  const languages = langRes.ok ? langRes.data : (meta.primaryLanguage ? [meta.primaryLanguage] : []);
  const tree = treeRes.ok ? treeRes.data : [];
  const blobs = tree.filter((t) => t.type === "blob");

  if (blobs.length === 0) {
    return { ok: false, reason: "empty", message: "Repository appears to be empty." };
  }

  // Top-level directories (architecture hint: each may be a service/module)
  const topLevelDirs = Array.from(
    new Set(
      tree
        .filter((t) => t.type === "tree" && !t.path.includes("/"))
        .map((t) => t.path)
        .filter((d) => !d.startsWith(".") && d !== "node_modules"),
    ),
  );

  // Pick signal files, capped at MAX_FILES
  const picked: { path: string; kind: string }[] = [];
  for (const entry of blobs) {
    if (picked.length >= MAX_FILES) break;
    const sig = SIGNAL_FILES.find((s) => s.match(entry.path));
    if (sig) picked.push({ path: entry.path, kind: sig.kind });
  }

  // Fetch contents (bounded, parallel) + README
  const [readmeRes, ...contents] = await Promise.all([
    client.getReadme(owner, repo),
    ...picked.map((p) => client.getFileContent(owner, repo, p.path, branch)),
  ]);

  const keyFiles: { path: string; excerpt: string }[] = [];
  picked.forEach((p, i) => {
    const c = contents[i];
    if (c.ok) keyFiles.push({ path: p.path, excerpt: c.data.slice(0, MAX_EXCERPT_BYTES) });
  });

  const signals = deriveSignals(picked, keyFiles, tree);

  return {
    ok: true,
    analysis: {
      meta,
      languages,
      fileCount: blobs.length,
      topLevelDirs,
      signals,
      keyFiles,
      readmeExcerpt: readmeRes.ok ? readmeRes.data.slice(0, 3000) : null,
    },
  };
}
```

### Signal derivation

```ts
function deriveSignals(
  picked: { path: string; kind: string }[],
  keyFiles: { path: string; excerpt: string }[],
  tree: TreeEntry[],
): RepoAnalysis["signals"] {
  const kinds = new Set(picked.map((p) => p.kind));
  const allManifestText = keyFiles.map((f) => f.excerpt.toLowerCase()).join("\n");

  const matchKeywords = (list: string[]) =>
    Array.from(new Set(list.filter((kw) => allManifestText.includes(kw))));

  const packageManagers = [
    kinds.has("node") && "npm",
    kinds.has("python") && "pip",
    kinds.has("go") && "go-mod",
    kinds.has("java") && "maven/gradle",
    kinds.has("rust") && "cargo",
    kinds.has("ruby") && "bundler",
    kinds.has("php") && "composer",
  ].filter(Boolean) as string[];

  const infra = [
    (kinds.has("docker") || kinds.has("compose")) && "docker",
    kinds.has("compose") && "docker-compose",
    kinds.has("kubernetes") && "kubernetes",
    kinds.has("terraform") && "terraform",
    kinds.has("serverless") && "serverless",
  ].filter(Boolean) as string[];

  const cicd = [
    kinds.has("github-actions") && "github-actions",
    tree.some((t) => t.path === ".circleci/config.yml") && "circleci",
    tree.some((t) => t.path === ".gitlab-ci.yml") && "gitlab-ci",
  ].filter(Boolean) as string[];

  // Service names from docker-compose `services:` keys (light YAML scan)
  const services: string[] = [];
  const compose = keyFiles.find((f) => /docker-compose/.test(f.path));
  if (compose) {
    const m = compose.excerpt.match(/^services:\s*$([\s\S]*?)(^\w|$(?![\r\n]))/m);
    const block = m?.[1] ?? compose.excerpt;
    for (const line of block.split("\n")) {
      const svc = line.match(/^\s{2}([a-z0-9._-]+):\s*$/i);
      if (svc) services.push(svc[1]);
    }
  }
  // Monorepo packages (apps/* or packages/* or services/*) as services too
  for (const t of tree) {
    const mono = t.path.match(/^(?:apps|services|packages)\/([^/]+)\/(?:package\.json|go\.mod|pom\.xml)$/);
    if (mono) services.push(mono[1]);
  }

  return {
    packageManagers,
    frameworks: matchKeywords(DEP_KEYWORDS.frameworks),
    databases: [
      ...matchKeywords(DEP_KEYWORDS.databases),
      ...(kinds.has("prisma") ? ["prisma"] : []),
    ],
    infra,
    cicd,
    services: Array.from(new Set(services)),
    messaging: matchKeywords(DEP_KEYWORDS.messaging),
  };
}
```

---

## Request-budget summary (per import)

| Call | Count | Notes |
|------|-------|-------|
| `getRepo` | 1 | |
| `getLanguages` | 1 | parallel with tree |
| `getTree` (recursive) | 1 | whole file list |
| `getReadme` | 1 | parallel with file reads |
| `getFileContent` | ≤ 18 | bounded by `MAX_FILES` |
| **Total** | **≤ 22 requests** | Well under the 5,000/hr server-token budget; even at 60/hr unauthenticated, ~2 imports before throttling — hence the server token is required for production. |

---

## Edge cases handled here

- **Private repo (Phase 1):** `getRepo` returns `not_found` → analyzer returns `{ ok:false, reason:"not_found" }` → task surfaces the "connect your account" message.
- **Empty repo:** zero blobs → `reason:"empty"`.
- **No recognizable signals:** `signals` arrays are empty but `languages`, `topLevelDirs`, and `readmeExcerpt` still feed the LLM, so it produces a reasonable skeleton.
- **Huge files:** every excerpt capped at 4 KB; README at 3 KB.
- **Huge repos:** tree may be `truncated`, but top-level dirs + known signal paths are still present.
