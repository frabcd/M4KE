import type { Claim } from "./types";
import type { ToyPart, ElectricalConnection } from "../viewport/types";
/** Locate only structured identity references; never infer evidence from prose. */
export function claimTargets(
  claim: Claim,
  parts: ToyPart[],
  connections: ElectricalConnection[] = [],
) {
  const known = new Set(parts.map((p) => p.id)),
    wires = new Set(connections.map((c) => c.id)),
    partIds = new Set<string>(),
    connectionIds = new Set<string>();
  let visited = 0;
  const addPart = (v: unknown) => {
    if (typeof v === "string" && known.has(v)) partIds.add(v);
  };
  const addWire = (v: unknown) => {
    if (typeof v === "string" && wires.has(v)) connectionIds.add(v);
  };
  const visit = (v: unknown, depth = 0) => {
    if (depth > 6 || ++visited > 256 || !v || typeof v !== "object") return;
    if (Array.isArray(v)) {
      v.slice(0, 128).forEach((x) => visit(x, depth + 1));
      return;
    }
    for (const [k, x] of Object.entries(v)) {
      if (k === "partId" || k === "framePartId") addPart(x);
      else if (
        [
          "partIds",
          "parts",
          "mismatches",
          "unknownProfiles",
          "printed",
          "assumed",
        ].includes(k) &&
        Array.isArray(x)
      )
        x.forEach(addPart);
      else if (k === "connectionId") addWire(x);
      else if (
        ["connectionIds", "missingAnchors"].includes(k) &&
        Array.isArray(x)
      )
        x.forEach(addWire);
      else visit(x, depth + 1);
    }
  };
  claim.partIds?.forEach(addPart);
  addWire(claim.connectionId);
  if (claim.id.startsWith("part-")) addPart(claim.id.slice(5));
  visit(claim.observed);
  for (const id of connectionIds) {
    const c = connections.find((x) => x.id === id)!;
    addPart(c.from.partId);
    addPart(c.to.partId);
  }
  return { partIds: [...partIds], connectionIds: [...connectionIds] };
}
