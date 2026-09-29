<script setup lang="ts">
import { onBeforeUnmount, ref, watch, nextTick } from "vue";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { meshByteCache } from "../studio-mesh-cache.mjs";
import { useStudio } from "../studio/store";
export type PreviewLevel = {
  sha256: string;
  bytes: number;
  triangles: number;
  boundsMm: number[];
  url: string;
};
export type SourcePreview = {
  sourceSha256: string;
  name: string;
  sourceBoundsMm: number[];
  nativeSolids: number;
  licenseFile: string;
  eligibility?: string;
  qualificationNotes?: string[];
  levels: { overview: PreviewLevel; detail: PreviewLevel };
};
const props = defineProps<{ preview: SourcePreview }>(),
  s = useStudio(),
  host = ref<HTMLDivElement>(),
  level = ref<"overview" | "detail">("overview"),
  status = ref(""),
  error = ref("");
let cleanup = () => {};
watch(
  [() => props.preview, level],
  async () => {
    cleanup();
    await nextTick();
    const el = host.value;
    if (!el) return;
    const preview = props.preview,
      currentLevel = level.value,
      abort = new AbortController();
    let renderer: THREE.WebGLRenderer | undefined,
      scene: THREE.Scene | undefined,
      controls: OrbitControls | undefined,
      resize: ResizeObserver | undefined,
      frame = 0,
      disposed = false;
    const disposeObject = (object: THREE.Object3D) =>
      object.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          (Array.isArray(child.material)
            ? child.material
            : [child.material]
          ).forEach((material) => material.dispose());
        }
      });
    cleanup = () => {
      disposed = true;
      abort.abort();
      cancelAnimationFrame(frame);
      resize?.disconnect();
      controls?.dispose();
      if (scene) disposeObject(scene);
      renderer?.dispose();
      renderer?.domElement.remove();
    };
    status.value = s.t("正在加载源几何…", "Loading source geometry…");
    error.value = "";
    try {
      const asset = preview.levels[currentLevel];
      if (
        asset.url !==
        `/api/studio/library/previews/${preview.sourceSha256}/${currentLevel}.glb`
      )
        throw Error("Preview URL does not match source identity.");
      const bytes = await meshByteCache.load(
        asset.url,
        asset.sha256,
        abort.signal,
      );
      if (disposed) return;
      const view = new DataView(bytes);
      if (
        bytes.byteLength < 20 ||
        bytes.byteLength !== asset.bytes ||
        view.getUint32(0, true) !== 0x46546c67 ||
        view.getUint32(8, true) !== bytes.byteLength
      )
        throw Error("Invalid preview size or format.");
      const length = view.getUint32(12, true);
      if (length > bytes.byteLength - 20)
        throw Error("Invalid glTF metadata size.");
      const metadata = JSON.parse(
          new TextDecoder().decode(new Uint8Array(bytes, 20, length)),
        ),
        pending = [metadata];
      while (pending.length) {
        const item = pending.pop();
        if (item && typeof item === "object")
          for (const [key, value] of Object.entries(item)) {
            if (key === "uri")
              throw Error(
                "External resources are forbidden in offline previews.",
              );
            if (value && typeof value === "object") pending.push(value);
          }
      }
      const manager = new THREE.LoadingManager();
      manager.setURLModifier(() => {
        throw Error("Unexpected external preview resource.");
      });
      const gltf = await new GLTFLoader(manager).parseAsync(bytes, "");
      if (disposed) {
        disposeObject(gltf.scene);
        return;
      }
      scene = new THREE.Scene();
      scene.background = new THREE.Color("#202329");
      const source = new THREE.Group();
      source.rotation.x = Math.PI / 2;
      source.scale.setScalar(1000);
      source.add(gltf.scene);
      scene.add(source);
      source.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(source),
        actual = [...box.min.toArray(), ...box.max.toArray()];
      if (
        actual.some(
          (value, i) =>
            !Number.isFinite(value) ||
            Math.abs(value - asset.boundsMm[i]) > 0.03,
        )
      )
        throw Error("Source-frame bounds mismatch. No rescaled substitute.");
      let triangles = 0;
      source.traverse((child) => {
        if (child instanceof THREE.Mesh)
          triangles +=
            (child.geometry.index?.count ??
              child.geometry.getAttribute("position").count) / 3;
      });
      if (triangles !== asset.triangles)
        throw Error("Triangle inventory differs from source receipt.");
      const center = box.getCenter(new THREE.Vector3()),
        radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.1),
        camera = new THREE.PerspectiveCamera(
          36,
          1,
          Math.max(radius / 1000, 0.001),
          radius * 100,
        );
      camera.up.set(0, 0, 1);
      camera.position
        .copy(center)
        .add(
          new THREE.Vector3(1, -1.4, 1)
            .normalize()
            .multiplyScalar(radius * 3.7),
        );
      renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      el.appendChild(renderer.domElement);
      renderer.domElement.setAttribute("role", "img");
      renderer.domElement.setAttribute(
        "aria-label",
        `${preview.name} source-derived preview in millimetres`,
      );
      scene.add(new THREE.HemisphereLight(0xffffff, 0x7f8791, 2.4));
      const key = new THREE.DirectionalLight(0xffffff, 3);
      key.position
        .copy(center)
        .add(new THREE.Vector3(radius, -radius, radius * 2));
      scene.add(key);
      controls = new OrbitControls(camera, renderer.domElement);
      controls.target.copy(center);
      controls.enableDamping = !matchMedia("(prefers-reduced-motion: reduce)")
        .matches;
      controls.minDistance = radius * 0.15;
      controls.maxDistance = radius * 20;
      controls.update();
      resize = new ResizeObserver(() => {
        if (!el.clientWidth || !el.clientHeight) return;
        camera.aspect = el.clientWidth / el.clientHeight;
        camera.updateProjectionMatrix();
        renderer!.setSize(el.clientWidth, el.clientHeight);
      });
      resize.observe(el);
      const draw = () => {
        controls!.update();
        renderer!.render(scene!, camera);
        frame = requestAnimationFrame(draw);
      };
      draw();
      status.value = `Source-frame check passed · ${triangles.toLocaleString()} triangles · ${currentLevel}`;
    } catch (e) {
      if (!disposed) {
        error.value = (e as Error).message;
        status.value = s.t(
          "预览已阻止，没有占位替代。",
          "Preview withheld. No substitute model.",
        );
        if (renderer) {
          renderer.dispose();
          renderer.domElement.remove();
        }
      }
    }
  },
  { immediate: true },
);
onBeforeUnmount(() => cleanup());
</script>
<template>
  <section class="source-preview">
    <h3>{{ preview.name }}</h3>
    <label
      >{{ s.t("预览精度", "Preview quality")
      }}<select v-model="level">
        <option value="overview">
          Overview · {{ preview.levels.overview.triangles.toLocaleString() }}
        </option>
        <option value="detail">
          Detail · {{ preview.levels.detail.triangles.toLocaleString() }}
        </option>
      </select></label
    >
    <div ref="host" class="source-preview-canvas" />
    <p role="status">{{ status }}</p>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <p>
      {{
        s.t(
          "原始 STEP 几何，毫米，原始原点。不是打印替代件或实物配合证明。",
          "Original STEP geometry, millimetres and original origin. Not a printable replacement or physical fit proof.",
        )
      }}
    </p>
    <p>
      {{ preview.eligibility || "Qualification pending" }} ·
      {{ preview.nativeSolids }} solids · {{ preview.licenseFile }}
    </p>
    <ul>
      <li v-for="note in preview.qualificationNotes" :key="note">{{ note }}</li>
    </ul>
  </section>
</template>
