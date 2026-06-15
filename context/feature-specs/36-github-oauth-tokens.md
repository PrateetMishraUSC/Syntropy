# GitHub OAuth & Token Handling (Phase 2)

Goal: a single server-only function

```ts
getUserGitHubToken(userId: string): Promise<string | null>
```

that the repos API and the import route call. Everything else (which OAuth path) hides behind it. `lib/github-oauth.ts` is that abstraction.

---

## `lib/github-oauth.ts` (the interface both paths implement)

```ts
import "server-only";

export interface GitHubIdentity {
  token: string;
  login: string | null;
}

// Returns the connected user's GitHub access token, or null if not connected.
export async function getUserGitHubToken(userId: string): Promise<string | null> {
  const id = await getUserGitHubIdentity(userId);
  return id?.token ?? null;
}

// Implementation differs by path — see below.
export async function getUserGitHubIdentity(userId: string): Promise<GitHubIdentity | null> {
  // PATH A or PATH B body goes here.
}
```

> `import "server-only"` guarantees this module never gets bundled into a client component — a hard safety rail around the token.

---

## Path A — Clerk-managed OAuth (recommended)

### 1. Configure in Clerk
- Clerk Dashboard → **User & Authentication → Social Connections → GitHub** → enable.
- Use **custom credentials** (your own GitHub OAuth App) so you control scopes — set scopes `read:user repo` (or `read:user public_repo`).
- This lets users connect GitHub either at sign-in or later from a profile/connect action.

### 2. Retrieve the token server-side

Clerk exposes connected-account OAuth tokens via its backend API:

```ts
import { clerkClient } from "@clerk/nextjs/server";

export async function getUserGitHubIdentity(userId: string): Promise<GitHubIdentity | null> {
  const client = await clerkClient();
  // Returns the stored OAuth access token(s) for the provider.
  const res = await client.users.getUserOauthAccessToken(userId, "github");
  const first = Array.isArray(res) ? res[0] : res?.data?.[0];
  if (!first?.token) return null;
  return { token: first.token, login: null };
}
```

> The exact return shape varies slightly by `@clerk/nextjs` version (`res.data` vs array). The defensive `Array.isArray(...) ? ... : res?.data?.[0]` handles both. Confirm against your installed version (`^7.4.2`) and simplify once verified.

### 3. "Is connected?" for Path A
`getUserGitHubToken(userId)` returning non-null **is** the connected check. The status route (file 37) just calls it. To get the GitHub login for display, do one `GET /user` with the token (cache it if you like).

### 4. Connect / disconnect UX for Path A
- **Connect:** Clerk provides a flow to connect a social account to an existing session. Use Clerk's `<UserProfile />` connected-accounts section, or trigger the OAuth connect via Clerk's client SDK from your "Connect GitHub" button. Simplest: deep-link to the Clerk-hosted account page's connected-accounts tab.
- **Disconnect:** handled in Clerk's account UI. You don't need a custom disconnect route on Path A (but the repo browser should detect a now-missing token and re-prompt).

### Path A summary
- **No `GitHubConnection` model.**
- **No callback route.**
- **No encryption.**
- `lib/github-oauth.ts` is ~10 lines.

---

## Path B — Custom GitHub OAuth App

Choose this only if you need full decoupling from Clerk.

### 1. Register a GitHub OAuth App
- GitHub → Settings → Developer settings → **OAuth Apps** → New.
- Authorization callback URL: `https://syntropy.<domain>/api/github/callback`.
- Capture `GITHUB_OAUTH_CLIENT_ID` / `GITHUB_OAUTH_CLIENT_SECRET`.

### 2. `GitHubConnection` model — `prisma/models/github-connection.prisma`

```prisma
model GitHubConnection {
  id           String   @id @default(cuid())
  userId       String   @unique           // Clerk user id
  githubLogin  String
  githubUserId String
  tokenCipher  String                      // AES-256-GCM encrypted access token
  tokenIv      String                      // iv for the cipher
  tokenTag     String                      // GCM auth tag
  scopes       String                      // space-delimited granted scopes
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@index([userId])
}
```

Migrate: `npx prisma migrate dev --name add_github_connection`.

### 3. Encryption helper — `lib/crypto.ts`

```ts
import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const KEY = Buffer.from(process.env.GITHUB_TOKEN_ENCRYPTION_KEY ?? "", "hex"); // 32 bytes (64 hex chars)

export function encryptToken(plain: string) {
  if (KEY.length !== 32) throw new Error("GITHUB_TOKEN_ENCRYPTION_KEY must be 32 bytes (64 hex chars)");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", KEY, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return { cipher: enc.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
}

export function decryptToken(cipherB64: string, ivB64: string, tagB64: string) {
  const decipher = createDecipheriv("aes-256-gcm", KEY, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(cipherB64, "base64")), decipher.final()]).toString("utf8");
}
```

Generate a key once: `openssl rand -hex 32` → `GITHUB_TOKEN_ENCRYPTION_KEY`.

### 4. OAuth routes (Path B)

**`app/api/github/connect/route.ts`** — redirect to GitHub authorize:

```ts
import { auth } from "@clerk/nextjs/server";
import { randomBytes } from "crypto";
import { cookies } from "next/headers";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return Response.redirect("/sign-in");

  const state = randomBytes(16).toString("hex");
  (await cookies()).set("gh_oauth_state", state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/" });

  const params = new URLSearchParams({
    client_id: process.env.GITHUB_OAUTH_CLIENT_ID!,
    redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/github/callback`,
    scope: "read:user repo",
    state,
    allow_signup: "false",
  });
  return Response.redirect(`https://github.com/login/oauth/authorize?${params}`);
}
```

**`app/api/github/callback/route.ts`** — exchange code, store encrypted token:

```ts
import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { encryptToken } from "@/lib/crypto";

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) return Response.redirect("/sign-in");

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const saved = (await cookies()).get("gh_oauth_state")?.value;
  if (!code || !state || state !== saved) {
    return Response.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/editor?github=error`);
  }

  // Exchange code → token
  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.GITHUB_OAUTH_CLIENT_ID,
      client_secret: process.env.GITHUB_OAUTH_CLIENT_SECRET,
      code,
      redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/github/callback`,
    }),
  });
  const tokenJson = (await tokenRes.json()) as { access_token?: string; scope?: string };
  if (!tokenJson.access_token) {
    return Response.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/editor?github=error`);
  }

  // Identify the GitHub user
  const ghUser = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${tokenJson.access_token}`, Accept: "application/vnd.github+json" },
  }).then((r) => r.json() as Promise<{ login: string; id: number }>);

  const enc = encryptToken(tokenJson.access_token);
  await prisma.gitHubConnection.upsert({
    where: { userId },
    create: {
      userId, githubLogin: ghUser.login, githubUserId: String(ghUser.id),
      tokenCipher: enc.cipher, tokenIv: enc.iv, tokenTag: enc.tag, scopes: tokenJson.scope ?? "",
    },
    update: {
      githubLogin: ghUser.login, githubUserId: String(ghUser.id),
      tokenCipher: enc.cipher, tokenIv: enc.iv, tokenTag: enc.tag, scopes: tokenJson.scope ?? "",
    },
  });

  return Response.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/editor?github=connected`);
}
```

### 5. Path B implementation of the interface

```ts
import prisma from "@/lib/prisma";
import { decryptToken } from "@/lib/crypto";

export async function getUserGitHubIdentity(userId: string): Promise<GitHubIdentity | null> {
  const conn = await prisma.gitHubConnection.findUnique({ where: { userId } });
  if (!conn) return null;
  try {
    const token = decryptToken(conn.tokenCipher, conn.tokenIv, conn.tokenTag);
    return { token, login: conn.githubLogin };
  } catch {
    return null; // key rotated or corrupt — treat as disconnected
  }
}
```

---

## Security requirements (both paths)

1. **Token never reaches the client.** It lives only in server routes and the Trigger.dev task payload. The repos list returns repo metadata, never the token.
2. **`server-only` on `lib/github-oauth.ts` and `lib/crypto.ts`.**
3. **State param + httpOnly cookie** on the custom callback (CSRF protection) — Path B.
4. **CSRF/auth on every route:** all `/api/github/*` routes call Clerk `auth()` first.
5. **Least scope:** prefer `public_repo` unless private support is live and consented.
6. **Revocation tolerated:** any GitHub 401/403-revoked → surface "reconnect", and on Path B delete the stale row.
7. **Transparent consent copy** in the connect UI: read-only, structure only, never writes.

---

## Modify `/api/github/import/route.ts` for Phase 2

The only backend change to the import flow: attach the user's token.

```ts
import { getUserGitHubToken } from "@/lib/github-oauth";

// …after access check, before tasks.trigger:
const accessToken = (await getUserGitHubToken(identity.userId)) ?? undefined;

handle = await tasks.trigger<typeof githubAnalyzer>("github-analyzer", {
  repoUrl, roomId, projectId, userId: identity.userId, mode,
  accessToken,   // ← Phase 2. undefined falls back to server GITHUB_TOKEN (Phase 1 behavior).
});
```

This single line makes private-repo imports work while keeping public URL-paste imports (no token needed) functioning exactly as in Phase 1. Set `source: accessToken ? "oauth" : "url"` on the `RepoImport` row to track provenance.

Proceed to `37-github-repo-browser.md`.
