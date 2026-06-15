import { task, metadata } from "@trigger.dev/sdk";
import { generateText } from "ai";
import { google } from "@ai-sdk/google";
import { put } from "@vercel/blob";
import prisma from "@/lib/prisma";
import { z } from "zod";

const PayloadSchema = z.object({
  projectId: z.string().min(1),
  roomId: z.string().min(1),
  chatHistory: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() }))
    .default([]),
  nodes: z.array(z.unknown()).default([]),
  edges: z.array(z.unknown()).default([]),
});

type Payload = z.infer<typeof PayloadSchema>;

function setStatus(status: string, message: string) {
  metadata.set("status", status);
  metadata.set("message", message);
}

function buildPrompt(payload: Payload): string {
  const nodeLines = payload.nodes
    .map((n) => {
      const node = n as Record<string, unknown>;
      const data = node.data as Record<string, unknown> | undefined;
      const label = (data?.label as string | undefined) ?? (node.id as string) ?? "unnamed";
      const shape = (data?.shape as string | undefined) ?? "rectangle";
      return `- **${label}** (id: ${node.id}, shape: ${shape})`;
    })
    .join("\n");

  const edgeLines = payload.edges
    .map((e) => {
      const edge = e as Record<string, unknown>;
      const data = edge.data as Record<string, unknown> | undefined;
      const label = (data?.label as string | undefined) ?? "";
      const arrowType = (data?.arrowType as string | undefined) ?? "source-to-target";
      const arrow = arrowType === "bidirectional" ? "↔" : arrowType === "target-to-source" ? "←" : "→";
      return `- ${edge.source} ${arrow} ${edge.target}${label ? ` [${label}]` : ""}`;
    })
    .join("\n");

  const chatLines = payload.chatHistory
    .map((m) => `${m.role === "user" ? "**User**" : "**AI**"}: ${m.content}`)
    .join("\n\n");

  return [
    "## Canvas Nodes",
    nodeLines || "_No nodes on canvas._",
    "",
    "## Canvas Edges",
    edgeLines || "_No edges on canvas._",
    "",
    ...(chatLines
      ? ["## Design Conversation", chatLines, ""]
      : []),
    `Project ID: ${payload.projectId}`,
  ].join("\n");
}

const SYSTEM_PROMPT = `You are a technical architect. Given a system design canvas (nodes and edges) and optional design conversation context, produce a comprehensive Markdown technical specification.

The spec must follow this structure:

# [System Name] — Technical Specification

## Overview
One-paragraph summary of what the system does.

## Architecture
Describe the overall architectural pattern (e.g. microservices, event-driven, monolith).

## Components
For each node on the canvas, a subsection:
### [Component Name]
- **Type**: (service / database / queue / gateway / etc.)
- **Responsibility**: What this component does.
- **Interfaces**: Inbound and outbound connections.

## Data Flow
Step-by-step description of key request/data flows through the system and a new line for every point.

## Integration Points
List all external integrations, APIs, and protocols inferred from edge labels.

## Non-Functional Requirements
Bullet points for scalability, reliability, security, and observability considerations inferred from the design.

## Open Questions
Any ambiguities or decisions that require further clarification.

Rules:
- Output only Markdown — no preamble, no code fences around the spec.
- Base all content strictly on the provided canvas data and conversation context.
- Use technical language appropriate for a senior engineering audience.
- If the canvas is empty, produce a minimal spec skeleton with placeholders.`;

export const generateSpec = task({
  id: "generate-spec",
  retry: {
    maxAttempts: 3,
    factor: 2,
    minTimeoutInMs: 1000,
    maxTimeoutInMs: 10000,
    randomize: true,
  },
  run: async (rawPayload: unknown) => {
    const payload = PayloadSchema.parse(rawPayload);

    setStatus("thinking", "Analyzing your architecture…");

    const prompt = buildPrompt(payload);

    setStatus("processing", "Writing technical specification…");

    let spec: string;
    try {
      const result = await generateText({
        model: google("gemini-2.5-flash"),
        system: SYSTEM_PROMPT,
        prompt,
      });
      spec = result.text;
    } catch (error) {
      setStatus("error", "Spec generation failed.");
      throw error;
    }

    setStatus("saving", "Saving specification…");

    const specId = `spec_${Date.now()}`;
    const blob = await put(`specs/${payload.projectId}/${specId}.md`, spec, {
      access: "private",
      contentType: "text/markdown",
      allowOverwrite: false,
    });

    await prisma.projectSpec.create({
      data: {
        id: specId,
        projectId: payload.projectId,
        filePath: blob.url,
      },
    });

    setStatus("done", "Specification saved.");

    return { specId, projectId: payload.projectId, roomId: payload.roomId };
  },
});
