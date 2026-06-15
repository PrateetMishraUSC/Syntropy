import "server-only";

import { clerkClient } from "@clerk/nextjs/server";

export interface GitHubIdentity {
  token: string;
  login: string | null;
}

// Returns the connected user's GitHub access token, or null if not connected.
export async function getUserGitHubToken(userId: string): Promise<string | null> {
  const id = await getUserGitHubIdentity(userId);
  return id?.token ?? null;
}

// Path A — Clerk-managed OAuth. Clerk stores and refreshes the GitHub token
// obtained via the GitHub social connection; we just read it back server-side.
export async function getUserGitHubIdentity(userId: string): Promise<GitHubIdentity | null> {
  try {
    const client = await clerkClient();
    const res = await client.users.getUserOauthAccessToken(userId, "github");
    // Return shape varies by @clerk/nextjs version: bare array vs { data: [...] }.
    const first = Array.isArray(res) ? res[0] : res?.data?.[0];
    if (!first?.token) return null;
    return { token: first.token, login: null };
  } catch {
    // No connected account / provider not configured → treat as disconnected.
    return null;
  }
}
