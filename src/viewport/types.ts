export type PointMm = [number, number, number];
export type BasicShape = {type: 'box'; size: PointMm} | {type: 'cylinder'; radius: number; height: number};
export type ToyShape = BasicShape | {type: 'catalog'; catalogId: string}
  | {type: 'library'; sourceSha256: string}
  | {type: 'union'; solids: (BasicShape & {position: PointMm; rotation: PointMm})[]};
export type ToyPart = {
  id: string; name: string; kind: 'printed' | 'purchased'; material: string; color: string;
  shape: ToyShape; position: PointMm; rotation: PointMm; fillet?: number;
  holes?: unknown[]; pockets?: {size: PointMm; position: PointMm}[]; source?: string;
  explanation?: {what?: string; role?: string; whyHere?: string; whyThis?: string; [key: string]: unknown};
  [key: string]: unknown;
};
export type CatalogComponent = {
  id: string; name: string; manufacturer?: string; mpn?: string; description?: string;
  geometry?: {boundsMm?: PointMm; status?: string; sourceUrl?: string};
  sources?: ({url: string; title?: string} | string)[]; sourceUrl?: string; fitStatus?: string;
  [key: string]: unknown;
};
export type CadPart = {
  id: string; name?: string; kind?: string; stlUrl?: string; stepUrl?: string;
  sha256?: {stl?: string; step?: string}; volumeMm3?: number; valid?: boolean; solidCount?: number;
  position?: number[]; rotation?: number[]; bounds?: {min: number[]; max: number[]};
};
export type LibrarySource = {
  sourceSha256: string; name: string; nativeImportCandidate: boolean;
  sourceBoundsMm: [number, number, number, number, number, number] | null;
  dimensionsMm?: PointMm | null; physicalFit?: string;
};
export type ElectricalEndpoint = {partId: string; terminal: string};
export type ElectricalConnection = {
  id: string; from: ElectricalEndpoint; to: ElectricalEndpoint; kind: string; color: string;
  wireAwg?: number; fromAnchorMm?: PointMm; toAnchorMm?: PointMm; polylineMm?: PointMm[];
  routingStatus: 'MODEL_ASSUMED' | 'MISSING_ANCHORS';
};
export type Selection = {ids: string[]; activeId: string | null};
export type AssemblyFrame = {stepId: string; settledIds: string[]; activeIds: string[]; movingIds: string[]; progress: number};
export type ViewDirection = 'front' | 'back' | 'right' | 'left' | 'top' | 'bottom';
export type Projection = 'perspective' | 'orthographic';
export type ViewportModel = {parts: ToyPart[]; cadParts?: CadPart[]; components?: CatalogComponent[]; connections?: ElectricalConnection[]; librarySources?: LibrarySource[]};
export type ViewportDisplay = {
  selectedIds: string[]; activeId: string | null; hiddenIds: string[];
  highlightedIds?: string[]; selectedConnection?: string | null;
};
export type ViewportStatus = {
  loaded: number; total: number; receivedBytes: number; parseMs: number; error: string;
  native: boolean; projection: Projection; direction: ViewDirection | 'user';
  routed: number; wiresVisible: boolean; exploded: boolean; showWires: boolean;
};
