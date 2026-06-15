import { LiveObject, LiveMap } from "@liveblocks/core";
import type { Liveblocks } from "@liveblocks/node";
import { NODE_COLORS, colorByBg } from "./canvas-tools";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ToolCall = { toolName: string; input: any };

export interface ExistingCanvas {
  nodes: Array<{ id: string; label: string }>;
  edges: Array<{ id: string; source: string; target: string }>;
}

export async function readExistingCanvas(
  liveblocks: Liveblocks,
  roomId: string,
): Promise<ExistingCanvas> {
  try {
    const storage = await liveblocks.getStorageDocument(roomId, "json");
    const flow = (storage as Record<string, unknown>)?.flow as Record<string, unknown> | undefined;
    if (!flow) return { nodes: [], edges: [] };
    const nodesObj = (flow.nodes ?? {}) as Record<string, unknown>;
    const edgesObj = (flow.edges ?? {}) as Record<string, unknown>;
    return {
      nodes: Object.values(nodesObj).map((n) => {
        const node = n as Record<string, unknown>;
        const data = node.data as Record<string, unknown> | undefined;
        return { id: node.id as string, label: (data?.label as string) ?? "" };
      }),
      edges: Object.values(edgesObj).map((e) => {
        const edge = e as Record<string, unknown>;
        return { id: edge.id as string, source: edge.source as string, target: edge.target as string };
      }),
    };
  } catch {
    return { nodes: [], edges: [] };
  }
}

export async function applyCanvasMutations(
  liveblocks: Liveblocks,
  roomId: string,
  toolCalls: ToolCall[],
  opts: { clearFirst?: boolean } = {},
): Promise<void> {
  await liveblocks.mutateStorage(roomId, ({ root }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let flow = root.get("flow") as any;
    if (!flow) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      flow = new LiveObject({ nodes: new LiveMap<string, LiveObject<any>>(), edges: new LiveMap<string, LiveObject<any>>() });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (root as any).set("flow", flow);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let nodesMap: LiveMap<string, LiveObject<any>> = flow.get("nodes");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let edgesMap: LiveMap<string, LiveObject<any>> = flow.get("edges");
    if (!nodesMap) { nodesMap = new LiveMap(); flow.set("nodes", nodesMap); }
    if (!edgesMap) { edgesMap = new LiveMap(); flow.set("edges", edgesMap); }

    if (opts.clearFirst) {
      for (const k of Array.from(nodesMap.keys())) nodesMap.delete(k);
      for (const k of Array.from(edgesMap.keys())) edgesMap.delete(k);
    }

    for (const tc of toolCalls) {
      switch (tc.toolName) {
        case "addNode": {
          const { id, label, shape, colorBg, x, y, width, height } = tc.input;
          const resolvedBg = NODE_COLORS.find((c) => c.bg === colorBg)?.bg ?? "#1F1F1F";
          const resolvedText = colorByBg.get(resolvedBg) ?? "#EDEDED";
          nodesMap.set(id, new LiveObject({
            id, type: "canvasNode", position: { x, y },
            data: new LiveObject({ label, shape, color: resolvedBg, textColor: resolvedText }),
            width: width ?? 160, height: height ?? 60,
            selected: false, dragging: false, measured: false, resizing: false,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          }) as any);
          break;
        }
        case "moveNode": {
          const node = nodesMap.get(tc.input.id);
          if (node) node.set("position", { x: tc.input.x, y: tc.input.y });
          break;
        }
        case "resizeNode": {
          const node = nodesMap.get(tc.input.id);
          if (node) { node.set("width", tc.input.width); node.set("height", tc.input.height); }
          break;
        }
        case "updateNodeData": {
          const node = nodesMap.get(tc.input.id);
          if (node) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const data: LiveObject<any> | undefined = node.get("data");
            if (data) {
              if (tc.input.label !== undefined) data.set("label", tc.input.label);
              if (tc.input.colorBg) {
                data.set("color", tc.input.colorBg);
                data.set("textColor", colorByBg.get(tc.input.colorBg) ?? "#EDEDED");
              }
              if (tc.input.shape) data.set("shape", tc.input.shape);
            }
          }
          break;
        }
        case "deleteNode": nodesMap.delete(tc.input.id); break;
        case "addEdge": {
          const { id, source, target, label, arrowType } = tc.input;
          edgesMap.set(id, new LiveObject({
            id, type: "canvasEdge", source, target,
            data: new LiveObject({ label: label ?? "", arrowType: arrowType ?? "source-to-target" }),
            selected: false,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          }) as any);
          break;
        }
        case "deleteEdge": edgesMap.delete(tc.input.id); break;
      }
    }
  });
}
