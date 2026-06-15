import { metadata } from "@trigger.dev/sdk";
import type { Liveblocks } from "@liveblocks/node";

const AI_USER_ID = "ai-design-agent";

export function setStatus(status: string, message: string) {
  metadata.set("status", status);
  metadata.set("message", message);
}

export async function broadcastStatus(
  liveblocks: Liveblocks,
  roomId: string,
  runId: string,
  status: string,
  message: string,
) {
  await liveblocks
    .broadcastEvent(roomId, {
      type: "ai-status",
      runId,
      status: status as "thinking" | "processing" | "applying" | "done" | "error",
      message,
    })
    .catch(() => {});
}

export async function setAiThinking(
  liveblocks: Liveblocks,
  roomId: string,
  thinking: boolean,
  ttl = 120_000,
) {
  await liveblocks
    .setPresence(roomId, {
      userId: AI_USER_ID,
      data: { cursor: null, thinking },
      userInfo: { displayName: "AI Architect", avatarUrl: "", cursorColor: "#f0a030" },
      ttl,
    })
    .catch(() => {});
}
