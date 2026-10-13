<script setup lang="ts">
import {onMounted,onBeforeUnmount,ref,computed,watch} from 'vue';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {STLLoader} from 'three/addons/loaders/STLLoader.js';
import {meshByteCache} from '../studio-mesh-cache.mjs';
import {DrivingWorld,initializePhysics,FIXED_STEP} from '../simulation/world.mjs';
import {DEFAULT_DRIVE} from '../../shared/driving-sandbox.mjs';
import {inferWheelGroups,installWheelRigs,setWheelTravel,rollingAngle,rollingRpm} from '../simulation/wheels.mjs';
import type {ToyPart,CadPart,BasicShape,CatalogComponent,LibrarySource} from '../viewport/types';

type WheelConfig={id:string;partIds:string[];radiusMm:number;driven?:boolean;assumed?:boolean};
type WheelRig=WheelConfig&{center:THREE.Vector3;width:number;pivot:THREE.Group};
const props=withDefaults(defineProps<{parts:ToyPart[];cadParts?:CadPart[];components?:CatalogComponent[];librarySources?:LibrarySource[];locale?:'zh'|'en';frontDirection?:'+x'|'-x';wheels?:WheelConfig[]}>(),{locale:'zh',frontDirection:'+x',components:()=>[],librarySources:()=>[],wheels:()=>[]});
const t=(zh:string,en:string)=>props.locale==='en'?en:zh;
const host=ref<HTMLDivElement>(),ready=ref(false),running=ref(false),error=ref(''),level=ref(25),obstacle=ref(true);
const front=ref(props.frontDirection);
const parameters=ref<Record<keyof typeof DEFAULT_DRIVE,number>>({...DEFAULT_DRIVE}),dimensions=ref<number[]>([0,0,0]);
const telemetry=ref({speed:0,x:0,time:0,on:false,collided:false,travelLimit:false,grounded:false,wheelContacts:0});
const wheelDetails=ref<{id:string;radiusMm:number;driven:boolean;assumed:boolean;centerZ:number}[]>([]),wheelMarkers=ref(true);
const wheelReadings=computed(()=>wheelDetails.value.map(w=>({...w,angle:rollingAngle(telemetry.value.x,w.radiusMm,front.value==='-x'?-1:1),rpm:rollingRpm(telemetry.value.speed,w.radiusMm)})));
const native=computed(()=>Boolean(props.cadParts?.length));
const fields=[{key:'massKg',zh:'总质量 / kg',en:'Total mass / kg',min:0.05,max:10,step:0.05},
  {key:'wheelDiameterMm',zh:'驱动轮直径 / mm',en:'Driven wheel / mm',min:10,max:200,step:1},
  {key:'rpm',zh:'额定电压空载转速 / rpm',en:'Rated no-load rpm',min:1,max:3000,step:10},
  {key:'stallTorqueNm',zh:'单电机堵转扭矩 / N·m（假设）',en:'Stall torque / N·m (assumed)',min:0.0001,max:2,step:0.001},
  {key:'motors',zh:'驱动电机数',en:'Driven motors',min:1,max:4,step:1},
  {key:'motorVoltage',zh:'电机额定电压 / V',en:'Rated voltage / V',min:1,max:24,step:0.1},
  {key:'supplyVoltage',zh:'电机供电 / V',en:'Motor supply / V',min:0,max:24,step:0.1},
  {key:'duty',zh:'PWM 占空比 / 0–1',en:'PWM duty / 0–1',min:0,max:1,step:0.05},
  {key:'rollingResistance',zh:'滚动阻力系数（假设）',en:'Rolling resistance (assumed)',min:0,max:0.2,step:0.01}] as const;
let renderer:THREE.WebGLRenderer|undefined,scene:THREE.Scene,camera:THREE.PerspectiveCamera,controls:OrbitControls;
let vehicle:THREE.Group,barrier:THREE.Mesh,world:DrivingWorld|undefined,observer:ResizeObserver|undefined,frame=0,last=0,accumulator=0,disposed=false;
let wheelRigs:WheelRig[]=[];const markers:THREE.Mesh[]=[];
const abort=new AbortController(),geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>();
function primitive(s:BasicShape){const g=s.type==='box'?new THREE.BoxGeometry(...s.size):new THREE.CylinderGeometry(s.radius,s.radius,s.height,40);if(s.type==='cylinder')g.rotateX(Math.PI/2);geometries.add(g);return g;}
function material(color:string){const m=new THREE.MeshStandardMaterial({color,roughness:0.44,metalness:0.12});materials.add(m);return m;}
function resize(){if(!renderer||!host.value)return;const w=host.value.clientWidth,h=host.value.clientHeight;if(!w||!h)return;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();}
function pause(){running.value=false;accumulator=0;}
function reset(){pause();world?.dispose();world=undefined;if(!ready.value)return;try{world=new DrivingWorld(dimensions.value,parameters.value,wheelDetails.value.map(w=>({centerZ:w.centerZ,radiusM:w.radiusMm/1000,driven:w.driven})));world.setObstacle(obstacle.value);telemetry.value={speed:0,x:0,time:0,on:false,collided:false,travelLimit:false,grounded:false,wheelContacts:0};setWheelTravel(wheelRigs,0);vehicle.rotation.z=front.value==='-x'?Math.PI:0;vehicle.position.set(0,0,dimensions.value[2]/2000+0.002);camera.position.set(-0.48,-0.60,0.38);controls.target.set(0,0,0.04);controls.update();error.value='';}catch(e){error.value=String(e);}}
function toggleRun(){if(!ready.value||error.value)return;running.value=!running.value;last=performance.now();}
function visibility(){if(document.hidden)pause();}
function key(event:KeyboardEvent){if(event.code==='Space'){event.preventDefault();toggleRun();}}
function animate(now:number){if(disposed||!renderer)return;const elapsed=Math.min(0.1,Math.max(0,(now-last)/1000));last=now;
  if(running.value&&world){accumulator=Math.min(0.1,accumulator+elapsed);const old=telemetry.value.x;while(accumulator>=FIXED_STEP){telemetry.value=world.step(level.value);accumulator-=FIXED_STEP;}
    const delta=telemetry.value.x-old;vehicle.position.set(telemetry.value.x,0,world.body.translation().z);setWheelTravel(wheelRigs,telemetry.value.x,front.value==='-x'?-1:1);camera.position.x+=delta;controls.target.x+=delta;if(telemetry.value.travelLimit)pause();}
  controls.update();renderer.render(scene,camera);frame=requestAnimationFrame(animate);
}
watch(front,()=>reset());
watch(wheelMarkers,show=>markers.forEach(m=>m.visible=show));
watch(obstacle,enabled=>{world?.setObstacle(enabled);if(barrier)barrier.visible=enabled;});
watch(()=>[props.parts,props.cadParts],()=>{pause();ready.value=false;error.value=t('设计版本已变化。关闭并重新打开仿真以载入新版本。','Design changed. Close and reopen this sandbox to load the new revision.');});
onMounted(async()=>{try{
  await initializePhysics();if(disposed||!host.value)return;
  scene=new THREE.Scene();scene.background=new THREE.Color('#111926');scene.fog=new THREE.Fog('#111926',8,20);
  camera=new THREE.PerspectiveCamera(42,1,0.005,50);camera.up.set(0,0,1);
  renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;
  host.value.appendChild(renderer.domElement);renderer.domElement.tabIndex=0;renderer.domElement.setAttribute('aria-label',t('行驶仿真视口；空格暂停或继续','Driving sandbox; Space pauses or resumes'));renderer.domElement.addEventListener('keydown',key);
  controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.minDistance=0.15;controls.maxDistance=12;
  scene.add(new THREE.HemisphereLight(0xf0f6ff,0x606675,3));const light=new THREE.DirectionalLight(0xffffff,3);light.position.set(-1,-2,4);scene.add(light);
  const groundG=new THREE.PlaneGeometry(30,4);geometries.add(groundG);const ground=new THREE.Mesh(groundG,material('#243045'));ground.position.set(10,0,-0.001);scene.add(ground);
  const grid=new THREE.GridHelper(30,150,0x506383,0x2f3d53);grid.rotation.x=Math.PI/2;grid.position.x=10;scene.add(grid);geometries.add(grid.geometry);for(const m of Array.isArray(grid.material)?grid.material:[grid.material])materials.add(m);
  const bg=new THREE.BoxGeometry(0.12,1.2,0.24);geometries.add(bg);barrier=new THREE.Mesh(bg,material('#f7a654'));barrier.position.set(3,0,0.12);scene.add(barrier);
  vehicle=new THREE.Group();const source=new THREE.Group();vehicle.add(source);scene.add(vehicle);
  if(!props.parts.length)throw Error('No design parts available.');
  const cad=new Map(props.cadParts?.map(p=>[p.id,p]));
  for(const part of props.parts){
    if(disposed)return;const group=new THREE.Group(),m=material(part.color||'#d95738');
    if(native.value){const record=cad.get(part.id);if(!record?.stlUrl||!record.sha256?.stl)throw Error(`Native STL/hash missing: ${part.id}`);
      const bytes=await meshByteCache.load(record.stlUrl,record.sha256.stl,abort.signal);if(disposed)return;
      const g=new STLLoader().parse(bytes as ArrayBuffer);geometries.add(g);group.add(new THREE.Mesh(g,m));
    }else if(part.shape.type==='box'||part.shape.type==='cylinder'){group.add(new THREE.Mesh(primitive(part.shape),m));}
    else if(part.shape.type==='union'){for(const s of part.shape.solids){const mesh=new THREE.Mesh(primitive(s),m);mesh.position.fromArray(s.position);mesh.rotation.set(...s.rotation.map(THREE.MathUtils.degToRad) as [number,number,number]);group.add(mesh);}}
    else if(part.shape.type==='profileExtrusion'||part.shape.type==='profileLoft')throw Error(`Native CAD mesh required for profile part: ${part.id}`);
    else {const shape=part.shape;const size=shape.type==='catalog'?props.components.find(c=>c.id===shape.catalogId)?.geometry?.boundsMm:props.librarySources.find(s=>s.sourceSha256===shape.sourceSha256)?.dimensionsMm;
      if(!size)throw Error(`Component envelope unavailable: ${part.id}`);group.add(new THREE.Mesh(primitive({type:'box',size}),m));}
    group.position.fromArray(part.position);group.rotation.set(...part.rotation.map(THREE.MathUtils.degToRad) as [number,number,number]);group.userData={partId:part.id,partName:part.name};source.add(group);
  }
  const bounds=new THREE.Box3().setFromObject(source),size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());
  wheelRigs=installWheelRigs(source,props.wheels.length?props.wheels:inferWheelGroups(source));
  wheelDetails.value=wheelRigs.map(w=>({id:w.id,radiusMm:w.radiusMm,driven:Boolean(w.driven),assumed:Boolean(w.assumed),centerZ:(w.center.z-center.z)/1000}));
  const driven=wheelDetails.value.filter(w=>w.driven);
  if(driven.length){parameters.value.wheelDiameterMm=driven[0].radiusMm*2;parameters.value.motors=driven.length;}
  for(const w of wheelRigs){const g=new THREE.BoxGeometry(2,0.6,Math.min(5,w.radiusMm*.25));geometries.add(g);const marker=new THREE.Mesh(g,material('#f8e6a8'));marker.position.set(0,Math.sign(w.center.y||1)*(w.width/2+.35),w.radiusMm*.78);w.pivot.add(marker);markers.push(marker);}
  dimensions.value=size.toArray();source.position.copy(center).multiplyScalar(-0.001);source.scale.setScalar(0.001);
  observer=new ResizeObserver(resize);observer.observe(host.value);resize();ready.value=true;reset();last=performance.now();frame=requestAnimationFrame(animate);document.addEventListener('visibilitychange',visibility);
}catch(e){if(!disposed){pause();error.value=String(e);}}});
onBeforeUnmount(()=>{disposed=true;abort.abort();cancelAnimationFrame(frame);document.removeEventListener('visibilitychange',visibility);observer?.disconnect();controls?.dispose();world?.dispose();geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());renderer?.domElement.removeEventListener('keydown',key);renderer?.dispose();renderer?.domElement.remove();});
</script>
<template>
  <section class="drive-sandbox" data-testid="driving-sandbox" :data-ready="ready" :data-running="running">
    <header><div><small>M4KE / MOTION LAB</small><h2>{{t('先在虚拟路面试一试。','Take it for a virtual drive.')}}</h2></div><span>{{t('估算仿真 · 非实物验证','ESTIMATED · NOT PHYSICAL VALIDATION')}}</span></header>
    <p class="drive-boundary">{{t('平整路面、X 方向直行、包围盒碰撞；不模拟真实悬挂、电池压降、麦克风或固件。默认电机/质量数据是可修改假设，不是你购买零件的实测值。','Flat floor, straight along X, box collisions. No real suspension, battery sag, microphone or firmware model. Motor and mass defaults are editable assumptions, not measurements of your purchased parts.')}}</p>
    <div class="drive-scene"><div ref="host" class="drive-canvas"/><div class="drive-hud" aria-live="off"><strong>{{telemetry.speed.toFixed(2)}} <small>m/s</small></strong><span>{{telemetry.x.toFixed(2)}} m · {{telemetry.time.toFixed(1)}} s</span><span>{{telemetry.collided?t('接触障碍物','Obstacle contact'):telemetry.on?t('响度超过阈值 · 驱动中','Above threshold · driving'):t('安静 · 制动/停止','Quiet · braking/stopped')}}</span></div><p v-if="!ready&&!error" class="drive-loading">{{t('正在加载本地物理引擎和模型…','Loading local physics and geometry…')}}</p></div>
    <p v-if="error" role="alert" class="drive-error">{{error}} {{t('不会替换成假模型。','No substitute model is used.')}}</p>
    <div class="drive-controls"><button :disabled="!ready||!!error" @click="toggleRun">{{running?t('暂停','Pause'):t('开始 / 继续','Run / Resume')}}</button><button :disabled="!ready" @click="reset">{{t('复位并应用参数','Reset & apply parameters')}}</button><label>{{t('模型车头方向','Model front')}} <select v-model="front" :disabled="running"><option value="+x">+X</option><option value="-x">−X</option></select></label><label><input v-model="obstacle" type="checkbox"/>{{t('3 m 处放置障碍物','Obstacle at 3 m')}}</label><span>{{dimensions.map(n=>n.toFixed(1)).join(' × ')}} mm · {{native?t('原生模型','Native geometry'):t('概念几何','Concept geometry')}}</span></div>
    <div class="drive-sound"><label>{{t('模拟相对响度（不是分贝）','Simulated relative loudness (not dB)')}} <b>{{level}}</b><input v-model.number="level" type="range" min="0" max="100" :aria-label="t('模拟相对响度','Simulated relative loudness')"/></label><button @click="level=80">{{t('响声','Loud')}}</button><button @click="level=20">{{t('安静','Quiet')}}</button></div>
    <div v-if="wheelReadings.length" class="wheel-telemetry"><label><input v-model="wheelMarkers" type="checkbox"/>{{t('轮缘转动标记（仅预览）','Rolling markers (preview only)')}}</label><span>{{t('接地轮组','Wheel contacts')}} {{telemetry.wheelContacts}} / {{wheelReadings.length}} · θ = s / r</span><div v-for="w in wheelReadings" :key="w.id" class="wheel-reading" :data-wheel-id="w.id" :data-angle="w.angle"><b>{{w.id}}</b><span>Ø {{(w.radiusMm*2).toFixed(1)}} mm · {{w.rpm.toFixed(1)}} rpm · {{(Math.abs(w.angle)/Math.PI/2).toFixed(2)}} {{t('圈','turns')}}</span></div><small>{{t('轮圈与轮胎同轴联动；按无滑动滚动计算，不模拟打滑或悬挂。标记不进入打印文件。','Rims and tyres share their axle. No-slip rolling, not wheelspin or suspension. Markers are not exported.')}} {{wheelDetails.some(w=>w.assumed)?t('轮组来自名称/包围盒推断，需核对。','Wheel grouping inferred from labels/bounds; review required.'):''}}</small></div>
    <p v-else class="drive-boundary">{{t('未识别到可用的 Y 轴车轮；当前仅为包围盒平移预演，不证明轮组或传动可用。','No supported Y-axis wheels identified: envelope motion only, not proof of a working drivetrain.')}}</p>
    <details><summary>{{t('参数与计算假设（更改后点击复位）','Parameters & assumptions (reset to apply)')}}</summary><div class="drive-fields"><label v-for="f in fields" :key="f.key">{{t(f.zh,f.en)}}<input v-model.number="parameters[f.key]" type="number" :min="f.min" :max="f.max" :step="f.step" :disabled="running||(['wheelDiameterMm','motors'].includes(f.key)&&wheelDetails.some(w=>w.driven))"/></label></div><p>{{t('默认值：2 电机、额定 6 V / 供电 5.5 V（均可改）、抓地系数 0.6、制动减速度 1.2 m/s²、相对阈值 60 / 回差 5。空气阻力忽略，20 m 自动暂停。仿真参数不修改设计、打印文件或验证记录。','Defaults: 2 motors, rated 6 V / supplied 5.5 V (editable), traction 0.6, braking 1.2 m/s², relative threshold 60 / hysteresis 5. No aerodynamic drag. Pauses at 20 m. Sandbox parameters never change design, print files or verification records.')}}</p></details>
  </section>
</template>
<style scoped>
.wheel-telemetry{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px;font-size:12px;color:#b9c8df}.wheel-telemetry>label,.wheel-telemetry>span{margin-right:12px}.wheel-reading{padding:8px 12px;background:#1c293d;border-radius:8px;display:grid;gap:3px}.wheel-telemetry small{flex-basis:100%;letter-spacing:0}.wheel-reading b{font-weight:500}
.drive-canvas :deep(canvas){display:block;width:100%;height:100%}
.drive-sandbox{color:#e8eef8;background:#131a27;border:1px solid #344055;border-radius:18px;padding:20px;max-width:1280px;margin:auto;font:14px/1.5 system-ui}.drive-sandbox header{display:flex;align-items:center;justify-content:space-between;gap:16px}.drive-sandbox h2{font-size:24px;margin:3px 0 8px;letter-spacing:-.6px}.drive-sandbox small{font-size:11px;letter-spacing:1px;color:#91a4c3}.drive-sandbox header>span{color:#edb668;font-size:12px;border:1px solid #756048;padding:5px 10px;border-radius:30px}.drive-boundary{color:#aab8ce;font-size:12px;max-width:950px}.drive-scene{height:430px;position:relative;border-radius:12px;overflow:hidden;background:#111926}.drive-canvas{width:100%;height:100%}.drive-hud{position:absolute;top:20px;left:22px;display:flex;flex-direction:column;pointer-events:none;text-shadow:0 1px 8px #000}.drive-hud strong{font-size:35px;font-variant-numeric:tabular-nums}.drive-hud span{font-size:12px;color:#b6c5dc}.drive-controls,.drive-sound{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:16px}.drive-controls>span{margin-left:auto;color:#aab8ce;font-size:12px}.drive-sandbox button{background:#243650;color:#eef5ff;padding:10px 16px;border:1px solid #47628b;border-radius:9px;cursor:pointer}.drive-sandbox button:disabled{opacity:.45;cursor:default}.drive-controls button:first-child{background:#376cec}.drive-sound label{display:flex;gap:12px;align-items:center;flex:1;min-width:260px}.drive-sound input{flex:1;accent-color:#7099ff}.drive-sandbox details{margin-top:20px;color:#aab8ce;font-size:12px}.drive-fields{display:grid;grid-template-columns:repeat(3,1fr);gap:15px;margin-top:12px}.drive-fields label{display:grid;gap:5px}.drive-fields input{background:#1c283b;border:1px solid #41536e;border-radius:7px;color:#fff;padding:8px;width:100%;box-sizing:border-box}.drive-error{color:#ffb0a7}.drive-loading{position:absolute;bottom:20px;left:20px}.drive-sandbox :focus-visible{outline:2px solid #91b4ff;outline-offset:3px}@media(max-width:700px){.drive-sandbox header{align-items:flex-start;flex-direction:column}.drive-scene{height:330px}.drive-fields{grid-template-columns:1fr 1fr}.drive-sound label{flex-wrap:wrap}}
</style>
