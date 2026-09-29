import type {
  ToyPart,
  CadPart,
  CatalogComponent,
  ElectricalConnection,
} from "../viewport/types";
export type Stage =
  "workspace" | "requirements" | "refine" | "verify" | "export";
export type Spec = {
  schemaVersion: number;
  title: string;
  description: string;
  units: "mm";
  requirements: { id: string; text: string }[];
  questions: { id: string; question: string; options?: string[] }[];
  assumptions: string[];
  unknowns: string[];
  parts: ToyPart[];
  assembly: AssemblyStep[];
  physicsInputs?: Record<string, unknown>;
};
export type AssemblyStep = {
  id: string;
  title: string;
  partIds: string[];
  requires: string[];
  instructions: string[];
  checks: string[];
};
export type Claim = {
  id: string;
  label: string;
  status: "PASS" | "FAIL" | "UNKNOWN";
  critical: boolean;
  method: string;
  observed: unknown;
  required: unknown;
  details: unknown;
  partIds?: string[];
  connectionId?: string;
};
export type Verification = {
  revisionHash: string;
  overall: string;
  physical: string;
  claims: Claim[];
  limitations: string[];
};
export type Electrical = {
  schemaVersion: number;
  designHash: string;
  status: string;
  connections: ElectricalConnection[];
  components: {
    partId: string;
    profileId: string;
    name: string;
    identityStatus: string;
    terminals: { id: string; role: string }[];
  }[];
  claims: {
    id: string;
    name: string;
    status: string;
    method: string;
    actual: unknown;
    required: unknown;
    notes: unknown;
  }[];
  firmware: {
    status: string;
    reason: string;
    files: string[];
    pins?: Record<string, unknown>;
  };
  artifactPaths?: Record<string, string>;
};
export type Job = {
  id: string;
  status: string;
  designHash: string;
  spec?: Spec;
  progress?: string;
  error?: string;
  cad?: { parts: CadPart[]; assemblyStepUrl?: string };
  verification?: Verification;
  electrical?: Electrical;
  review?: {
    status: string;
    summary: string;
    concerns?: string[];
    suggestedTests?: string[];
  };
  portableRevision?: { id: string; designHash: string };
  kitId?: string;
  parameters?: Record<string, number>;
};
export type Workflow = {
  mode?: "auto" | "design" | "verify" | "deliver";
  id: string;
  status: string;
  stage: string;
  message: string;
  startedAt?: string;
  finishedAt?: string;
  inference?: {phase:string;model?:string;attempt?:number;elapsedMs?:number;firstContentMs?:number|null;outputCharacters?:number};
  repairLimit: number;
  jobId?: string;
  kitId?: string;
  parameters?: Record<string, number>;
  attempts: {
    number: number;
    jobId: string;
    designHash: string;
    status: string;
    overall?: string;
    criticalFailures: string[];
  }[];
};
export type Project = {
  pendingQuestions?: Spec["questions"];
  id: string;
  requiresDesignUpdate?: boolean;
  name?: string;
  request: string;
  budget: string;
  answers: { id: string; answer: string }[];
  spec?: Spec;
  revision: number;
  designHash?: string;
  jobId?: string | null;
  workflow?: Workflow;
  model?: string;
  updatedAt: string;
};
export type ViewState = {
  version: number;
  selectedPartIds: string[];
  activePartId: string | null;
  hiddenPartIds: string[];
  stage: Stage;
  viewMode: "model" | "wiring";
  projection: "perspective" | "orthographic";
  language: "zh" | "en";
};
export type Proposal = {
  decisionChanges?: {field:string;before:unknown;after:unknown}[];
  jobId?: string;
  nativeChecksPassed?: boolean;
  id: string;
  baseRevision: number;
  baseDesignHash: string;
  spec: Spec;
  designHash: string;
  changes: {
    partId: string | null;
    type: string;
    fields: string[];
    reason: string;
  }[];
  message: string;
  createdAt: string;
};
export type Conversation = {
  model?: string | null;
  id: string;
  role: "user" | "assistant";
  mode: "ask" | "propose";
  message: string;
  selectedPartIds: string[];
  revision: number;
  designHash: string | null;
  basis?: "candidate";
  proposalId?: string;
  questions?: { id: string; question: string; options?: string[] }[];
};
export type Catalog = {
  components: CatalogComponent[];
  materials: { id: string; name: string }[];
  kits: {
    id: string;
    name: string;
    availability: string;
    missingComponents: string[];
    parameters: Record<
      string,
      {
        label: string;
        minimum: number;
        maximum: number;
        default: number;
        unit: string;
      }
    >;
  }[];
};
export type Capabilities = {
  provider?: "ollama" | "vllm" | "codex-bridge";
  onlineRequired?: boolean;
  model?: string | { name?: string };
  configured?: boolean;
  cad?: { available: boolean; reason?: string };
  printers?: { id: string; label: string }[];
  skills?: unknown;
};
