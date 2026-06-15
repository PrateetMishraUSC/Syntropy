import { tool } from "ai";
import { z } from "zod";

export const CANVAS_SHAPES = ["rectangle", "circle", "diamond", "pill", "cylinder", "hexagon"] as const;
export const ARROW_TYPES = ["source-to-target", "target-to-source", "bidirectional"] as const;

export const NODE_COLORS = [
  { bg: "#1F1F1F", text: "#EDEDED" },
  { bg: "#10233D", text: "#52A8FF" },
  { bg: "#2E1938", text: "#BF7AF0" },
  { bg: "#331B00", text: "#FF990A" },
  { bg: "#3C1618", text: "#FF6166" },
  { bg: "#3A1726", text: "#F75F8F" },
  { bg: "#0F2E18", text: "#62C073" },
  { bg: "#062822", text: "#0AC7B4" },
] as const;

export const colorByBg: Map<string, string> = new Map(NODE_COLORS.map((c) => [c.bg, c.text]));

export const CANVAS_CONVENTIONS = `## Node shapes
- rectangle: services, servers, application layers (generic)
- circle: users, clients, external actors
- diamond: routing, load balancers, decision points
- pill: APIs, endpoints, interfaces, proxies
- cylinder: databases, caches, message queues, storage
- hexagon: microservices, containers, isolated modules

## Node bg colors (use exactly these hex values, passed as colorBg)
- "#10233D" (blue) — APIs, web services, application layers
- "#0F2E18" (green) — databases, persistent storage
- "#2E1938" (purple) — async queues, event buses, pub/sub
- "#331B00" (orange) — gateways, load balancers, proxies
- "#062822" (teal) — caches, CDNs, read replicas
- "#3C1618" (red) — security, auth, rate limiters
- "#3A1726" (pink) — monitoring, logging, analytics
- "#1F1F1F" (dark) — utility services, background workers

## Layout
- First node at x=100, y=150
- Space nodes 280px horizontally, 220px vertically
- Flow left-to-right or top-to-bottom; cluster related services spatially
- Default width=160, height=60; use width=180 for labels longer than 20 chars

## Edge rules
- Every node MUST appear in at least one edge — no isolated nodes
- arrowType "source-to-target" for unidirectional, "bidirectional" for mutual
- Short edge labels for protocol or action (e.g. "HTTPS", "SQL", "publish")

## IDs
kebab-case slugs for nodes ("api-gateway", "redis-cache") and edges ("edge-lb-api").`;

export const canvasTools = {
  addNode: tool({
    description: "Add a new node to the canvas",
    inputSchema: z.object({
      id: z.string().describe("Unique kebab-case slug, e.g. 'api-gateway'"),
      label: z.string().describe("Display label shown on the node"),
      shape: z.enum(CANVAS_SHAPES),
      colorBg: z.string().describe("Background color hex from the allowed palette"),
      x: z.number(),
      y: z.number(),
      width: z.number().optional(),
      height: z.number().optional(),
    }),
  }),
  moveNode: tool({
    description: "Move an existing node",
    inputSchema: z.object({ id: z.string(), x: z.number(), y: z.number() }),
  }),
  resizeNode: tool({
    description: "Resize an existing node",
    inputSchema: z.object({ id: z.string(), width: z.number(), height: z.number() }),
  }),
  updateNodeData: tool({
    description: "Update label, color, or shape of an existing node",
    inputSchema: z.object({
      id: z.string(),
      label: z.string().optional(),
      colorBg: z.string().optional(),
      shape: z.enum(CANVAS_SHAPES).optional(),
    }),
  }),
  deleteNode: tool({
    description: "Delete a node",
    inputSchema: z.object({ id: z.string() }),
  }),
  addEdge: tool({
    description: "Add a directed edge between two nodes",
    inputSchema: z.object({
      id: z.string(),
      source: z.string(),
      target: z.string(),
      label: z.string().optional(),
      arrowType: z.enum(ARROW_TYPES).optional(),
    }),
  }),
  deleteEdge: tool({
    description: "Delete an edge",
    inputSchema: z.object({ id: z.string() }),
  }),
  finishDesign: tool({
    description: "Call this last to signal the design is complete",
    inputSchema: z.object({ summary: z.string() }),
  }),
};
