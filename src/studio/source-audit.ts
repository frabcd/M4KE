export type SourceAudit = {
  sourceSha256: string;
  name: string;
  metadataStatus: string;
  scaleStatus: string;
  nativeGeometryStatus: string;
  staticColliderStatus: string;
  dimensionsSourceMm: number[] | null;
  declaredSourceUnits: string[] | null;
  previewJoin: string;
  assetHashes: { overview: string; detail: string } | null;
  peerReportedEligibility: { inspect: boolean; staticFixedCollider: boolean };
  currentBytesVerified: boolean;
  nativeIssue: string | null;
  staticIssue: string | null;
  blockers: string[];
  permissions: {
    inspect: boolean;
    assembly: false;
    dynamicSimulation: false;
    manufacture: false;
    appPhysics: false;
  };
  buildQualified: false;
  physicalValidation: "UNKNOWN";
};
export type Usability = {
  available: boolean;
  status: string;
  reason?: string;
  auditSha256?: string;
  summary?: {
    records: number;
    reportedScalePass: number;
    reportedNativePass: number;
    reportedStaticEligible: number;
    matchedPinnedPreviews: number;
  };
  records: SourceAudit[];
};
const hash = (value: unknown) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const shortText = (value: unknown) =>
  typeof value === "string" && value.length <= 350;
const nullableText = (value: unknown) => value === null || shortText(value);
export function validSourceAudit(value: unknown): value is SourceAudit {
  if (!value || typeof value !== "object") return false;
  const r = value as SourceAudit;
  return (
    hash(r.sourceSha256) &&
    shortText(r.name) &&
    ["PEER_AUDIT_REPORTED", "INVALID_RECORD"].includes(r.metadataStatus) &&
    ["PASS", "REVIEW_REQUIRED", "NOT_AUDITED"].includes(r.scaleStatus) &&
    ["PASS", "REVIEW_REQUIRED", "NOT_AUDITED"].includes(
      r.nativeGeometryStatus,
    ) &&
    ["STATIC_ENGINE_CHECK_PASS", "REVIEW_REQUIRED", "NOT_AUDITED"].includes(
      r.staticColliderStatus,
    ) &&
    [
      "MATCHED_BOTH_LEVELS",
      "ASSET_OR_METADATA_MISMATCH",
      "NOT_IN_PINNED_PREVIEW",
    ].includes(r.previewJoin) &&
    nullableText(r.nativeIssue) &&
    nullableText(r.staticIssue) &&
    (r.dimensionsSourceMm === null ||
      (Array.isArray(r.dimensionsSourceMm) &&
        r.dimensionsSourceMm.length === 3 &&
        r.dimensionsSourceMm.every(
          (n) =>
            typeof n === "number" && Number.isFinite(n) && n > 0 && n < 1e6,
        ))) &&
    (r.declaredSourceUnits === null ||
      (Array.isArray(r.declaredSourceUnits) &&
        r.declaredSourceUnits.length > 0 &&
        r.declaredSourceUnits.length <= 8 &&
        r.declaredSourceUnits.every(
          (u) => typeof u === "string" && u.length <= 40,
        ))) &&
    Array.isArray(r.blockers) &&
    r.blockers.length <= 16 &&
    r.blockers.every(shortText) &&
    typeof r.currentBytesVerified === "boolean" &&
    typeof r.peerReportedEligibility?.inspect === "boolean" &&
    typeof r.peerReportedEligibility?.staticFixedCollider === "boolean" &&
    r.buildQualified === false &&
    r.physicalValidation === "UNKNOWN" &&
    typeof r.permissions?.inspect === "boolean" &&
    ["assembly", "dynamicSimulation", "manufacture", "appPhysics"].every(
      (k) => r.permissions[k as keyof typeof r.permissions] === false,
    ) &&
    (r.previewJoin === "MATCHED_BOTH_LEVELS"
      ? hash(r.assetHashes?.overview) && hash(r.assetHashes?.detail)
      : r.assetHashes === null)
  );
}
export function validUsability(value: unknown): value is Usability {
  if (!value || typeof value !== "object") return false;
  const data = value as Usability;
  if (
    typeof data.available !== "boolean" ||
    !Array.isArray(data.records) ||
    data.records.length > 2000 ||
    data.records.some(
      (r) =>
        !validSourceAudit(r) || r.currentBytesVerified || r.permissions.inspect,
    ) ||
    new Set(data.records.map((r) => r.sourceSha256)).size !==
      data.records.length
  )
    return false;
  if (!data.available)
    return (
      data.status === "AUDIT_UNAVAILABLE" &&
      shortText(data.reason) &&
      data.records.length === 0
    );
  return (
    data.status === "PEER_AUDIT_ONLY" &&
    hash(data.auditSha256) &&
    !!data.summary &&
    [
      "records",
      "reportedScalePass",
      "reportedNativePass",
      "reportedStaticEligible",
      "matchedPinnedPreviews",
    ].every(
      (k) =>
        Number.isSafeInteger(
          data.summary![k as keyof NonNullable<Usability["summary"]>],
        ) &&
        data.summary![k as keyof NonNullable<Usability["summary"]>] >= 0 &&
        data.summary![k as keyof NonNullable<Usability["summary"]>] <=
          data.records.length,
    ) &&
    data.summary.records === data.records.length
  );
}
