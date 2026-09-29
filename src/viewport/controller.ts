import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {STLLoader} from 'three/addons/loaders/STLLoader.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {meshByteCache, loadMeshQueue} from '../studio-mesh-cache.mjs';
import {assemblyOffset} from './assembly-playback.mjs';
import type {AssemblyFrame} from './types';
import {changeVisibility, geometryKey, hasWireRoute, isPreviewShape, pickPart, viewportShortcut, wireIsVisible} from './interaction.mjs';
import type {BasicShape, CadPart, ElectricalConnection, Selection, ToyPart, ToyShape, ViewDirection, ViewportDisplay, ViewportModel, ViewportStatus} from './types';

type Callbacks = {
  select: (selection: Selection) => void;
  visibility: (hiddenIds: string[]) => void;
  selectConnection: (id: string | null) => void;
  status: (status: ViewportStatus) => void;
};
type PartMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;

function primitivePreview(shape: BasicShape): THREE.BufferGeometry {
  if (shape.type === 'box') return new THREE.BoxGeometry(...shape.size);
  const geometry = new THREE.CylinderGeometry(shape.radius, shape.radius, shape.height, 64);
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

function unionPreview(shape: Extract<ToyShape, {type: 'union'}>): THREE.BufferGeometry {
  const members = shape.solids.map(s => {
    const geometry = primitivePreview(s);
    geometry.applyMatrix4(transform(s.position, s.rotation));
    if (!geometry.index) return geometry;
    const flat = geometry.toNonIndexed();
    geometry.dispose();
    return flat;
  });
  const result = mergeGeometries(members);
  members.forEach(geometry => geometry.dispose());
  if (!result) throw new Error('Union members cannot be combined for concept preview.');
  return result;
}

function transform(position: number[], rotation: number[]): THREE.Matrix4 {
  return new THREE.Matrix4().compose(new THREE.Vector3().fromArray(position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation.map(THREE.MathUtils.degToRad) as [number, number, number])),
    new THREE.Vector3(1, 1, 1));
}

function disposeGroup(group: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  group.traverse(object => {
    if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
    }
  });
  geometries.forEach(geometry => geometry.dispose());
  materials.forEach(material => material.dispose());
  group.clear();
}

/** Renderer lifetime belongs to the mounted viewport, not to selection, camera or poll results. */
export class StudioViewportController {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly perspective = new THREE.PerspectiveCamera(34, 1, .05, 20000);
  private readonly orthographic = new THREE.OrthographicCamera(-100, 100, 100, -100, .05, 20000);
  private camera: THREE.PerspectiveCamera | THREE.OrthographicCamera = this.perspective;
  private readonly controls: OrbitControls;
  private readonly model = new THREE.Group();
  private readonly wires = new THREE.Group();
  private readonly floor: THREE.Mesh;
  private readonly grid: THREE.GridHelper;
  private readonly resizeObserver: ResizeObserver;
  private meshes = new Map<string, PartMesh>();
  private wireMeshes: PartMesh[] = [];
  private data: ViewportModel = {parts: []};
  private display: ViewportDisplay = {selectedIds: [], activeId: null, hiddenIds: []};
  private assembly: AssemblyFrame | null = null;
  private assemblyDistance = 60;
  private geometrySignature = '';
  private connectionSignature = '';
  private revision = 0;
  private abort = new AbortController();
  private frame = 0;
  private progressFrame = 0;
  private disposed = false;
  private userNavigated = false;
  private plannedBounds = new Map<string, THREE.Box3>();
  private worldCenter = new THREE.Vector3();
  private radius = 100;
  private orthoSpan = 200;
  private pointerDown: {x: number; y: number; id: number; button: number} | null = null;
  private readonly ray = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private state: ViewportStatus = {
    loaded: 0, total: 0, receivedBytes: 0, parseMs: 0, error: '', native: false,
    projection: 'perspective', direction: 'user', routed: 0, wiresVisible: false,
    exploded: false, showWires: true,
  };

  constructor(private readonly host: HTMLElement, private readonly callbacks: Callbacks) {
    this.renderer = new THREE.WebGLRenderer({antialias: true, alpha: false});
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.setAttribute('role', 'application');
    this.renderer.domElement.setAttribute('aria-describedby', 'viewport-instructions');
    this.host.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color('#101827');
    this.perspective.up.set(0, 0, 1);
    this.orthographic.up.set(0, 0, 1);
    this.camera.position.set(320, -420, 310);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = .1;
    this.controls.minDistance = .5;
    this.controls.maxDistance = 10000;
    this.controls.minZoom = .02;
    this.controls.maxZoom = 500;
    this.controls.mouseButtons = {LEFT: null, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: null};
    this.controls.addEventListener('start', this.navigationStarted);
    this.controls.addEventListener('change', this.requestRender);
    this.scene.add(new THREE.HemisphereLight(0xf4f8ff, 0x677584, 2));
    const key = new THREE.DirectionalLight(0xffffff, 3.5);
    key.position.set(-160, -240, 400);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, {left: -400, right: 400, top: 400, bottom: -400, far: 1500});
    key.shadow.normalBias = .1;
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xc6deff, 1.8);
    fill.position.set(250, 180, 250);
    this.scene.add(fill);
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.ShadowMaterial({opacity: .2}));
    this.floor.receiveShadow = true;
    this.scene.add(this.floor);
    this.grid = new THREE.GridHelper(1000, 50, 0x354360, 0x202d43);
    this.grid.rotation.x = Math.PI / 2;
    this.grid.position.z = -.02;
    this.scene.add(this.grid, this.model, this.wires);
    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.addEventListener('pointerup', this.onPointerUp);
    this.renderer.domElement.addEventListener('pointercancel', this.onPointerCancel);
    this.renderer.domElement.addEventListener('keydown', this.onKeyDown);
    this.renderer.domElement.addEventListener('contextmenu', this.onContextMenu);
    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(this.host);
    this.resize();
    this.requestRender();
  }

  setLabel(label: string): void { this.renderer.domElement.setAttribute('aria-label', label); }
  focus(): void { this.renderer.domElement.focus({preventScroll: true}); }
  getStatus(): ViewportStatus { return {...this.state}; }

  private publish(patch: Partial<ViewportStatus> = {}): void {
    if (this.disposed) return;
    this.state = {...this.state, ...patch};
    this.callbacks.status({...this.state});
    this.requestRender();
  }

  private navigationStarted = (): void => {
    this.userNavigated = true;
    if (this.state.direction !== 'user') this.publish({direction: 'user'});
  };

  /** Metadata and identity changes do not invalidate native bytes; only geometry inputs do. */
  setModel(model: ViewportModel): void {
    if (this.disposed) return;
    this.data = model;
    const signature = geometryKey(model);
    if (signature !== this.geometrySignature) {
      this.geometrySignature = signature;
      this.reloadGeometry();
    }
    const connections = JSON.stringify(model.connections || []);
    if (connections !== this.connectionSignature) {
      this.connectionSignature = connections;
      this.rebuildWires();
    }
    this.applyDisplay();
  }

  setDisplay(display: ViewportDisplay): void {
    this.display = {...display, selectedIds: [...display.selectedIds], hiddenIds: [...display.hiddenIds]};
    this.applyDisplay();
  }

  /** Reuse exact meshes. Playback is not an assembly-path or collision solver. */
  setAssemblyFrame(frame: AssemblyFrame | null): void {
    const changedStep = frame?.stepId !== this.assembly?.stepId;
    if (frame && this.state.exploded) this.setExploded(false);
    if (!this.assembly && frame) this.assemblyDistance = Math.max(25, this.radius * .5);
    this.assembly = frame;
    for (const [id, mesh] of this.meshes) {
      mesh.position.copy(mesh.userData.origin as THREE.Vector3);
      if (frame?.movingIds.includes(id)) mesh.position.z += assemblyOffset(frame.progress, this.assemblyDistance);
    }
    this.model.updateMatrixWorld(true);
    this.applyDisplay();
    if (changedStep && frame) this.fit();
  }

  private reloadGeometry(): void {
    this.abort.abort();
    this.abort = new AbortController();
    const revision = ++this.revision;
    cancelAnimationFrame(this.progressFrame);
    this.progressFrame = 0;
    disposeGroup(this.model);
    this.meshes.clear();
    this.plannedBounds.clear();
    this.userNavigated = false;
    this.publish({native: this.data.cadParts !== undefined, loaded: 0, total: this.data.cadParts?.length || 0,
      error: '', receivedBytes: 0, parseMs: 0, exploded: false});
    const parts = new Map(this.data.parts.map(part => [part.id, part]));
    if (parts.size !== this.data.parts.length) {
      this.publish({error: 'Duplicate part identifiers; geometry cannot be associated safely.'});
      return;
    }
    if (this.data.cadParts !== undefined) {
      const artifacts = this.data.cadParts;
      for (const artifact of artifacts) {
        const part = parts.get(artifact.id), bounds = artifact.bounds;
        if (part && bounds?.min?.length === 3 && bounds?.max?.length === 3
          && [...bounds.min, ...bounds.max].every(Number.isFinite)
          && bounds.min.every((n, i) => n <= bounds.max[i])) {
          this.plannedBounds.set(part.id, new THREE.Box3(new THREE.Vector3().fromArray(bounds.min),
            new THREE.Vector3().fromArray(bounds.max)).applyMatrix4(transform(part.position, part.rotation)));
        }
      }
      if (this.plannedBounds.size) this.fit();
      const artifactIds = new Set(artifacts.map(part => part.id));
      if (artifactIds.size !== artifacts.length || artifactIds.size !== parts.size || [...parts.keys()].some(id => !artifactIds.has(id))) {
        this.publish({error: 'Native CAD parts do not match this design. No preview substitution.'});
        return;
      }
      void this.loadNative(artifacts, parts, revision, this.abort.signal);
    } else {
      for (const part of this.data.parts) {
        try {
          if (!isPreviewShape(part.shape)) throw new Error('Unsupported concept shape; no substitute geometry.');
          if (part.shape.type === 'library') {
            const sourceSha256 = part.shape.sourceSha256;
            const bounds = this.data.librarySources?.find(source => source.sourceSha256 === sourceSha256)?.sourceBoundsMm;
            if (!bounds || bounds.length !== 6 || !bounds.every(Number.isFinite)
              || bounds.slice(0, 3).some((min, i) => bounds[i + 3] <= min)) {
              throw new Error(`Source-local bounds unavailable for ${part.name}; no invented source geometry.`);
            }
            const geometry = new THREE.BoxGeometry(bounds[3] - bounds[0], bounds[4] - bounds[1], bounds[5] - bounds[2]);
            // Envelope uses the original STEP frame: never recenter or resize the source.
            geometry.translate((bounds[0] + bounds[3]) / 2, (bounds[1] + bounds[4]) / 2, (bounds[2] + bounds[5]) / 2);
            this.addPart(part, geometry, true);
          } else if (part.shape.type === 'catalog') {
            const catalogId = part.shape.catalogId;
            const bounds = this.data.components?.find(component => component.id === catalogId)?.geometry?.boundsMm;
            if (!bounds || bounds.length !== 3 || bounds.some(value => !Number.isFinite(value) || value <= 0)) {
              throw new Error(`Catalog bounds unavailable for ${part.name}; no substitute geometry.`);
            }
            this.addPart(part, new THREE.BoxGeometry(...bounds), true);
          } else this.addPart(part, part.shape.type === 'union' ? unionPreview(part.shape) : primitivePreview(part.shape));
        } catch (error) { this.publish({error: error instanceof Error ? error.message : String(error)}); }
      }
      if (this.meshes.size) this.fit();
    }
  }

  private async loadNative(artifacts: CadPart[], parts: Map<string, ToyPart>, revision: number, signal: AbortSignal): Promise<void> {
    const loader = new STLLoader();
    const parsed = new Map<string, THREE.BufferGeometry>();
    const received = new Map<string, number>();
    const isCurrent = () => !this.disposed && !signal.aborted && revision === this.revision;
    const progress = (key: string, bytes: number) => {
      if (!isCurrent()) return;
      received.set(key, bytes);
      if (!this.progressFrame) this.progressFrame = requestAnimationFrame(() => {
        this.progressFrame = 0;
        if (isCurrent()) this.publish({receivedBytes: [...received.values()].reduce((a, b) => a + b, 0)});
      });
    };
    const priority = (artifact: CadPart) => {
      const part = parts.get(artifact.id);
      return part?.shape.type === 'catalog' || part?.shape.type === 'library' ? 2 : part?.kind === 'printed' ? 0 : 1;
    };
    await loadMeshQueue([...artifacts].sort((a, b) => priority(a) - priority(b)), async (artifact: CadPart) => {
      if (!artifact.stlUrl) throw new Error(`Missing STL artifact for ${artifact.id}.`);
      const key = artifact.sha256?.stl || artifact.stlUrl;
      return meshByteCache.load(artifact.stlUrl, artifact.sha256?.stl, signal,
        (value: {receivedBytes: number}) => progress(key, value.receivedBytes));
    }, {
      concurrency: 4, signal,
      onLoad: async (artifact: CadPart, bytes: ArrayBuffer) => {
        if (!isCurrent()) return;
        const started = performance.now(), key = artifact.sha256?.stl;
        let geometry = key ? parsed.get(key) : undefined;
        if (!geometry) {
          geometry = loader.parse(bytes);
          const positions = geometry.getAttribute('position');
          if (!positions || !positions.count || positions.count % 3 || !positions.array.every(Number.isFinite)) {
            geometry.dispose();
            throw new Error('STL contains no valid finite triangle geometry.');
          }
          if (key) parsed.set(key, geometry);
        }
        const parseMs = performance.now() - started;
        this.addPart(parts.get(artifact.id)!, geometry);
        this.publish({loaded: this.state.loaded + 1, parseMs: this.state.parseMs + parseMs});
        this.updateWires();
        // Yield between native parses, without postponing visibility of verified parts.
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      },
      onError: (artifact: CadPart, error: Error) => {
        if (isCurrent()) this.publish({error: `Could not load ${parts.get(artifact.id)?.name || artifact.id}: ${error.message}. No preview substitution.`});
      },
    });
  }

  private addPart(part: ToyPart, geometry: THREE.BufferGeometry, catalogPreview = false): void {
    if (this.disposed) { geometry.dispose(); return; }
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({
      color: catalogPreview ? '#8ba6c4' : /^#[a-f0-9]{6}$/i.test(part.color) ? part.color : '#8095ac',
      roughness: part.kind === 'printed' ? .48 : .56, metalness: part.kind === 'printed' ? .04 : .22,
      transparent: catalogPreview, opacity: catalogPreview ? .38 : 1,
      depthWrite: !catalogPreview,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = part.id;
    mesh.position.fromArray(part.position);
    mesh.rotation.set(...part.rotation.map(THREE.MathUtils.degToRad) as [number, number, number]);
    mesh.castShadow = !catalogPreview;
    mesh.receiveShadow = true;
    mesh.userData.origin = mesh.position.clone();
    mesh.userData.catalogEnvelope = catalogPreview;
    if (this.assembly?.movingIds.includes(part.id)) mesh.position.z += assemblyOffset(this.assembly.progress, this.assemblyDistance);
    this.meshes.set(part.id, mesh);
    this.model.add(mesh);
    this.model.updateMatrixWorld(true);
    if (!this.plannedBounds.size && !this.userNavigated && this.state.native) this.fit();
    this.applyDisplay();
  }

  private rebuildWires(): void {
    disposeGroup(this.wires);
    this.wireMeshes = [];
    const connections = (this.data.connections || []).filter(hasWireRoute);
    for (const connection of connections) {
      const material = new THREE.MeshStandardMaterial({
        color: /^#[a-f0-9]{6}$/i.test(connection.color) ? connection.color : '#7e91a8', roughness: .48, metalness: .03,
      });
      const add = (geometry: THREE.BufferGeometry, position: THREE.Vector3, quaternion?: THREE.Quaternion) => {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.copy(position);
        if (quaternion) mesh.quaternion.copy(quaternion);
        mesh.userData.connection = connection;
        this.wires.add(mesh);
        this.wireMeshes.push(mesh);
      };
      const points = connection.polylineMm!.map(point => new THREE.Vector3(...point));
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i], delta = b.clone().sub(a), length = delta.length();
        if (length < 1e-6) continue;
        add(new THREE.CylinderGeometry(.55, .55, length, 8), a.clone().add(b).multiplyScalar(.5),
          new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()));
      }
      for (const point of [points[0], points[points.length - 1]]) add(new THREE.SphereGeometry(1, 10, 8), point);
    }
    this.publish({routed: connections.length});
    this.updateWires();
  }

  private applyDisplay(): void {
    const selected = new Set(this.display.selectedIds), hidden = new Set(this.display.hiddenIds);
    const highlighted = new Set(this.display.highlightedIds || []);
    for (const [id, mesh] of this.meshes) {
      mesh.visible = !hidden.has(id) && (!this.assembly || this.assembly.settledIds.includes(id) || this.assembly.activeIds.includes(id));
      const active = this.display.activeId === id;
      mesh.material.emissive.set(active ? '#e9a145' : selected.has(id) ? '#6ba2f4' : this.assembly?.activeIds.includes(id) || highlighted.has(id) ? '#85add8' : '#000000');
      mesh.material.emissiveIntensity = active ? .3 : selected.has(id) || this.assembly?.activeIds.includes(id) || highlighted.has(id) ? .2 : 0;
    }
    this.updateWires();
  }

  private updateWires(): void {
    const hidden = new Set(this.display.hiddenIds), loaded = new Set(this.meshes.keys());
    for (const [id, mesh] of this.meshes) if (!mesh.visible || (this.assembly && this.assembly.progress < 1 && this.assembly.movingIds.includes(id))) hidden.add(id);
    this.wires.visible = this.state.showWires && !this.state.exploded && !this.state.error
      && loaded.size === this.data.parts.length;
    for (const mesh of this.wireMeshes) {
      const connection = mesh.userData.connection as ElectricalConnection;
      mesh.visible = wireIsVisible(connection, hidden, loaded);
      const active = connection.id === this.display.selectedConnection;
      const dimmed = !!this.display.selectedConnection && !active;
      mesh.material.transparent = dimmed;
      mesh.material.opacity = dimmed ? .16 : 1;
      mesh.material.depthWrite = !dimmed;
      mesh.material.emissive.copy(active ? mesh.material.color : new THREE.Color(0));
      mesh.material.emissiveIntensity = active ? .4 : 0;
    }
    const wiresVisible = this.wires.visible && this.wireMeshes.some(mesh => mesh.visible);
    if (wiresVisible !== this.state.wiresVisible) this.publish({wiresVisible});
    this.requestRender();
  }

  private bounds(ids?: Set<string>): THREE.Box3 {
    const box = new THREE.Box3(), hidden = new Set(this.display.hiddenIds);
    for (const part of this.data.parts) {
      if (hidden.has(part.id) || (ids && !ids.has(part.id))) continue;
      const mesh = this.meshes.get(part.id), planned = this.plannedBounds.get(part.id);
      if (mesh?.visible) {
        const extent = new THREE.Box3().setFromObject(mesh);
        if (this.assembly?.movingIds.includes(part.id)) {
          // Frame both ends once so replay cannot lift a part out of view.
          extent.translate(new THREE.Vector3(0, 0, -assemblyOffset(this.assembly.progress, this.assemblyDistance)));
          box.union(extent);
          extent.translate(new THREE.Vector3(0, 0, this.assemblyDistance));
        }
        box.union(extent);
      }
      else if (!mesh && planned) box.union(planned);
    }
    return box;
  }

  fit(selectedOnly = false): void {
    const box = this.bounds(selectedOnly ? new Set(this.display.selectedIds) : undefined);
    if (box.isEmpty()) return;
    this.worldCenter = box.getCenter(new THREE.Vector3());
    this.radius = Math.max(box.getSize(new THREE.Vector3()).length() * .5, 2);
    const direction = this.camera.position.clone().sub(this.controls.target).normalize();
    if (!direction.lengthSq()) direction.set(1, -1.4, 1).normalize();
    const aspect = Math.max(this.host.clientWidth, 1) / Math.max(this.host.clientHeight, 1);
    const halfFov = THREE.MathUtils.degToRad(this.perspective.fov / 2);
    const fitFov = Math.min(halfFov, Math.atan(Math.tan(halfFov) * aspect));
    const distance = this.radius / Math.sin(fitFov) * 1.1;
    this.controls.target.copy(this.worldCenter);
    this.camera.position.copy(this.worldCenter).addScaledVector(direction, distance);
    this.orthoSpan = this.radius * 2.2 / Math.min(aspect, 1);
    this.orthographic.zoom = 1;
    for (const camera of [this.perspective, this.orthographic]) {
      camera.near = Math.max(this.radius / 1000, .01);
      camera.far = Math.max(distance + this.radius * 100, 2000);
      camera.updateProjectionMatrix();
    }
    if (!selectedOnly) {
      this.floor.position.z = box.min.z - .06;
      this.grid.position.z = box.min.z - .08;
    }
    this.resize();
    this.controls.update();
  }

  setView(view: ViewDirection): void {
    this.userNavigated = true;
    if (this.camera === this.perspective) this.toggleProjection();
    const vectors: Record<ViewDirection, [number, number, number]> = {
      front: [0, -1, 0], back: [0, 1, 0], right: [1, 0, 0], left: [-1, 0, 0],
      top: [0, -.000001, 1], bottom: [0, -.000001, -1],
    };
    const distance = Math.max(this.camera.position.distanceTo(this.controls.target), this.radius * 3);
    this.camera.position.copy(this.controls.target).addScaledVector(new THREE.Vector3(...vectors[view]).normalize(), distance);
    this.camera.lookAt(this.controls.target);
    this.controls.update();
    this.publish({direction: view});
  }

  toggleProjection(): void {
    const previous = this.camera;
    if (previous === this.perspective) {
      this.orthoSpan = 2 * previous.position.distanceTo(this.controls.target) * Math.tan(THREE.MathUtils.degToRad(previous.fov / 2));
      this.orthographic.zoom = 1;
      this.camera = this.orthographic;
    } else {
      const direction = previous.position.clone().sub(this.controls.target).normalize();
      const distance = this.orthoSpan / previous.zoom / (2 * Math.tan(THREE.MathUtils.degToRad(this.perspective.fov / 2)));
      this.perspective.position.copy(this.controls.target).addScaledVector(direction, distance);
      this.camera = this.perspective;
    }
    if (this.camera === this.orthographic) this.camera.position.copy(previous.position);
    this.camera.quaternion.copy(previous.quaternion);
    this.camera.near = previous.near;
    this.camera.far = previous.far;
    this.controls.object = this.camera;
    this.resize();
    this.controls.update();
    this.publish({projection: this.camera === this.perspective ? 'perspective' : 'orthographic'});
  }

  setWires(show: boolean): void { this.publish({showWires: show}); this.updateWires(); }
  setExploded(exploded: boolean): void {
    if (exploded && this.assembly) return;
    this.publish({exploded});
    let index = 0;
    for (const mesh of this.meshes.values()) {
      const origin = mesh.userData.origin as THREE.Vector3;
      mesh.position.copy(origin);
      if (exploded) {
        const offset = origin.clone().sub(this.worldCenter);
        if (offset.length() < 5) offset.set((index % 3) - 1, (index % 2) - .5, 1);
        mesh.position.addScaledVector(offset.normalize(), this.radius * .38);
      }
      index++;
    }
    this.model.updateMatrixWorld(true);
    this.updateWires();
  }
  visibility(mode: 'selected' | 'others' | 'all'): void {
    this.callbacks.visibility(changeVisibility(this.data.parts.map(part => part.id), this.display.hiddenIds, this.display.selectedIds, mode));
  }

  private onPointerDown = (event: PointerEvent): void => {
    this.focus();
    this.pointerDown = {x: event.clientX, y: event.clientY, id: event.pointerId, button: event.button};
  };
  private onPointerCancel = (): void => { this.pointerDown = null; };
  private onPointerUp = (event: PointerEvent): void => {
    const down = this.pointerDown;
    this.pointerDown = null;
    if (!down || down.id !== event.pointerId || down.button !== 0 || event.button !== 0
      || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    this.ray.setFromCamera(this.pointer, this.camera);
    const pickable = [...this.meshes.values()].filter(mesh => mesh.visible);
    if (this.wires.visible) pickable.push(...this.wireMeshes.filter(mesh => mesh.visible));
    this.scene.updateMatrixWorld(true);
    const hit = this.ray.intersectObjects(pickable, false)[0]?.object;
    if (hit?.userData.connection) { this.callbacks.selectConnection(hit.userData.connection.id); return; }
    this.callbacks.selectConnection(null);
    this.callbacks.select(pickPart(this.display.selectedIds, this.display.activeId, hit?.name || null, event.shiftKey));
  };
  private onContextMenu = (event: MouseEvent): void => { event.preventDefault(); };
  private onKeyDown = (event: KeyboardEvent): void => {
    // Never intercept editing, toolbar, browser or document shortcuts.
    if (event.target !== this.renderer.domElement || document.activeElement !== this.renderer.domElement) return;
    const command = viewportShortcut(event);
    if (!command) return;
    event.preventDefault();
    event.stopPropagation();
    if (command.action === 'view') this.setView(command.direction as ViewDirection);
    else if (command.action === 'projection') this.toggleProjection();
    else if (command.action === 'frame-selected') this.fit(true);
    else if (command.action === 'fit') this.fit();
    else if (command.action === 'hide-selected') this.visibility('selected');
    else if (command.action === 'hide-others') this.visibility('others');
    else if (command.action === 'show-all') this.visibility('all');
  };

  private resize = (): void => {
    if (this.disposed) return;
    const width = this.host.clientWidth, height = this.host.clientHeight;
    if (!width || !height) return;
    const aspect = width / height;
    this.perspective.aspect = aspect;
    this.perspective.updateProjectionMatrix();
    this.orthographic.left = -this.orthoSpan * aspect / 2;
    this.orthographic.right = this.orthoSpan * aspect / 2;
    this.orthographic.top = this.orthoSpan / 2;
    this.orthographic.bottom = -this.orthoSpan / 2;
    this.orthographic.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.requestRender();
  };

  // A static CAD scene must not consume continuous software-renderer frames.
  // OrbitControls emits change while damping settles, so motion stays smooth.
  private requestRender = (): void => {
    if (!this.disposed && !this.frame) this.frame = requestAnimationFrame(this.animate);
  };

  private animate = (): void => {
    this.frame = 0;
    if (this.disposed) return;
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abort.abort();
    cancelAnimationFrame(this.frame);
    cancelAnimationFrame(this.progressFrame);
    this.resizeObserver.disconnect();
    this.controls.removeEventListener('start', this.navigationStarted);
    this.controls.removeEventListener('change', this.requestRender);
    this.controls.dispose();
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.removeEventListener('pointerup', this.onPointerUp);
    this.renderer.domElement.removeEventListener('pointercancel', this.onPointerCancel);
    this.renderer.domElement.removeEventListener('keydown', this.onKeyDown);
    this.renderer.domElement.removeEventListener('contextmenu', this.onContextMenu);
    this.scene.traverse(object => {
      if (object instanceof THREE.DirectionalLight || object instanceof THREE.PointLight || object instanceof THREE.SpotLight) object.shadow.dispose();
    });
    disposeGroup(this.scene);
    this.meshes.clear();
    this.wireMeshes = [];
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
