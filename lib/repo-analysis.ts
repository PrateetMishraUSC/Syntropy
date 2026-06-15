import { GitHubClient, type ParsedRepoUrl, type RepoMeta, type TreeEntry } from "@/lib/github";

export interface RepoAnalysis {
  meta: RepoMeta;
  languages: string[];
  fileCount: number;
  topLevelDirs: string[];
  signals: {
    packageManagers: string[];
    frameworks: string[];
    databases: string[];
    infra: string[];
    cicd: string[];
    services: string[];
    messaging: string[];
  };
  keyFiles: { path: string; excerpt: string }[];
  readmeExcerpt: string | null;
}

export type AnalyzeResult =
  | { ok: true; analysis: RepoAnalysis }
  | { ok: false; reason: "not_found" | "rate_limited" | "empty" | "error"; message: string };

const MAX_FILES = 18;
const MAX_EXCERPT_BYTES = 4000;

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

const DEP_KEYWORDS = {
  frameworks: ["next", "react", "vue", "svelte", "angular", "express", "fastify",
               "nestjs", "fastapi", "flask", "django", "spring", "rails", "gin", "echo", "actix"],
  databases: ["postgres", "pg", "mysql", "mongodb", "mongoose", "redis", "ioredis",
              "prisma", "sqlite", "sqlalchemy", "dynamodb", "cassandra", "elasticsearch"],
  messaging: ["kafka", "kafkajs", "amqplib", "rabbitmq", "bullmq", "sqs", "nats", "pubsub"],
};

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

  const topLevelDirs = Array.from(
    new Set(
      tree
        .filter((t) => t.type === "tree" && !t.path.includes("/"))
        .map((t) => t.path)
        .filter((d) => !d.startsWith(".") && d !== "node_modules"),
    ),
  );

  const picked: { path: string; kind: string }[] = [];
  for (const entry of blobs) {
    if (picked.length >= MAX_FILES) break;
    const sig = SIGNAL_FILES.find((s) => s.match(entry.path));
    if (sig) picked.push({ path: entry.path, kind: sig.kind });
  }

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
