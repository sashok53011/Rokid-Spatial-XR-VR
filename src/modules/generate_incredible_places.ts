import * as THREE from 'three';
import * as xb from 'xrblocks';

import type {
  SpatialPlaceId,
  SpatialPlaceSpec,
  VirtualSurfaceDescriptor,
} from '../types/spatial_contracts.ts';
import {
  build360ScreensAndPanels,
  type Screens360Bundle,
} from './build_360_screens_and_panels.ts';

/**
 * ============================================================================
 * МОДУЛЬ: generate_incredible_places.ts (10 невероятных 360°-локаций)
 * ============================================================================
 * НАЗНАЧЕНИЕ:
 *   Управляет библиотекой из 10 полностью процедурных 360-градусных миров
 *   (Zero-404, без внешних текстур/моделей), окружающих рабочий стол:
 *   1. Кибер-Неон Токио 2099 (`cyber-tokyo`)
 *   2. Орбитальная Станция «Горизонт» (`orbital-station`)
 *   3. Подводный Купол «Бездна» (`abyssal-dome`)
 *   4. Кристальная Пещера Эфира (`crystal-cavern`)
 *   5. Небесная Цитадель в Облаках (`sky-citadel`)
 *   6. Марсианский Купол «Арес-7» (`mars-outpost`)
 *   7. Био-Лес Пандоры (`bioluminescent-forest`)
 *   8. Квантовая Сингулярность (`quantum-nexus`)
 *   9. Северное Сияние Арктики (`arctic-aurora`)
 *   10. Синтвейв-Каньон 1984 (`synthwave-horizon`)
 *
 *   Каждая локация включает:
 *   - 360° шейдерный купол неба (`ShaderMaterial`) с динамическим эффектом
 *   - Композитные 3D-объекты архитектуры/природы по периметру (вне зоны окон)
 *   - `InstancedMesh` атмосферных частиц (звёзды, капли, пузыри, споры, снег)
 *   - Набор изогнутых 360°-экранов и 8 панелей привязки из `build_360_screens_and_panels.ts`
 *
 * ВХОДНЫЕ ДАННЫЕ:
 *   - `selectPlace(placeId)`: переключение на выбранную локацию с полным
 *     освобождением памяти предыдущей.
 *   - `nextPlace()` / `prevPlace()`: циклическое переключение.
 *   - `setSkyDomeEnabled(enabled)`: вкл/выкл 360°-купола (удобно для прозрачного AR
 *     на Rokid Max, чтобы оставлять только парящие 360°-экраны в реальной комнате!).
 *   - `setScreens360Visible(visible)`: показ/скрытие 360°-экранов.
 *
 * ВЫХОДНЫЕ ДАННЫЕ:
 *   - `getActivePlace()`: текущая спецификация `SpatialPlaceSpec`.
 *   - `onPlaceReady(place, panoramicSurfaces)`: коллбек передачи новых 360°-панелей
 *     в `VirtualSurfaceManager`.
 *
 * КАК ПОЛЬЗОВАТЬСЯ:
 *   const places = new IncrediblePlacesManager({
 *     onPlaceReady: (place, surfaces) => surfaceManager.setDynamic360Surfaces(surfaces),
 *     onLog: (msg) => monitor.log('INFO', 'PLACE', msg),
 *   });
 *   this.add(places);
 *
 * ЗАГЛУШКИ (STUB) И ЗАМЕНА В ПРОДАКШНЕ:
 *   - Окружение генерируется процедурным GLSL-шейдером и 3D-геометрией в коде
 *     для мгновенного запуска без сети.
 *   - КАК ЗАМЕНИТЬ В ПРОДАКШНЕ: для фотореалистичных локаций загружайте
 *     8K эквиректангулярные 360°-панорамы (`.exr`/`.webp`) или Gaussian Splats
 *     (`.spz` через `@sparkjsdev/spark`) в `buildPlaceEnvironment()`.
 * ============================================================================
 */

export const SPATIAL_PLACES_CATALOG: readonly SpatialPlaceSpec[] = [
  {
    id: 'cyber-tokyo',
    index: 1,
    title: 'Кибер-Неон Токио 2099',
    subtitle: 'Ночной мегаполис, голографические башни и поток данных',
    skyTopHex: 0x05081f,
    skyHorizonHex: 0x3b0764,
    skyBottomHex: 0x020617,
    accentHex: 0x22d3ee,
    secondaryHex: 0xf43f5e,
    fogDensity: 0.018,
    particleKind: 'rain',
    screenCount360: 8,
    screenRadiusMeters: 3.1,
    screenThemes: [
      'SHIBUYA TRAFFIC AI',
      'NEURAL GRID 360',
      'ROOFTOP WEATHER',
      'CYBER BUS STREAM',
    ],
  },
  {
    id: 'orbital-station',
    index: 2,
    title: 'Орбитальная Станция «Горизонт»',
    subtitle: 'Низкая орбита планеты, звёздный купол и солнечные крылья',
    skyTopHex: 0x000105,
    skyHorizonHex: 0x0b3b75,
    skyBottomHex: 0x02040a,
    accentHex: 0x38bdf8,
    secondaryHex: 0xfbbf24,
    fogDensity: 0.008,
    particleKind: 'stars',
    screenCount360: 6,
    screenRadiusMeters: 3.2,
    screenThemes: [
      'ORBITAL TELEMETRY',
      'SOLAR ARRAY OUTPUT',
      'DEEP SPACE RADAR',
      'LIFE SUPPORT 100%',
    ],
  },
  {
    id: 'abyssal-dome',
    index: 3,
    title: 'Подводный Купол «Бездна»',
    subtitle: 'Глубина 3400 м, биолюминесценция и океанический сонар',
    skyTopHex: 0x011627,
    skyHorizonHex: 0x0369a1,
    skyBottomHex: 0x020b14,
    accentHex: 0x2dd4bf,
    secondaryHex: 0x60a5fa,
    fogDensity: 0.025,
    particleKind: 'bubbles',
    screenCount360: 8,
    screenRadiusMeters: 3.0,
    screenThemes: [
      'ABYSSAL SONAR 360',
      'PRESSURE HULL 34MPa',
      'THERMAL VENT MAP',
      'BIO-SPECTRUM LOG',
    ],
  },
  {
    id: 'crystal-cavern',
    index: 4,
    title: 'Кристальная Пещера Эфира',
    subtitle: 'Резонансные кварцевые шпили и переливы спектров',
    skyTopHex: 0x0f0524,
    skyHorizonHex: 0x4c1d95,
    skyBottomHex: 0x080314,
    accentHex: 0xc084fc,
    secondaryHex: 0x34d399,
    fogDensity: 0.02,
    particleKind: 'spores',
    screenCount360: 6,
    screenRadiusMeters: 3.05,
    screenThemes: [
      'RESONANCE HARMONICS',
      'AETHER SPECTRUM',
      'GEO-SCAN 360',
      'LATTICE FIELD',
    ],
  },
  {
    id: 'sky-citadel',
    index: 5,
    title: 'Небесная Цитадель в Облаках',
    subtitle: 'Парящие колоннады на высоте 12 км над золотым рассветом',
    skyTopHex: 0x1e3a8a,
    skyHorizonHex: 0xfb923c,
    skyBottomHex: 0x312e81,
    accentHex: 0xfde047,
    secondaryHex: 0xfb7185,
    fogDensity: 0.014,
    particleKind: 'embers',
    screenCount360: 6,
    screenRadiusMeters: 3.15,
    screenThemes: [
      'ALTITUDE WIND FLOW',
      'SOLAR SANCTUM',
      'SKYLINE HORIZON',
      'CLOUD DENSITY 360',
    ],
  },
  {
    id: 'mars-outpost',
    index: 6,
    title: 'Марсианский Купол «Арес-7»',
    subtitle: 'Красная долина Маринера, геодезический каркас и роверы',
    skyTopHex: 0x2b0905,
    skyHorizonHex: 0xc2410c,
    skyBottomHex: 0x451a03,
    accentHex: 0xf97316,
    secondaryHex: 0x38bdf8,
    fogDensity: 0.022,
    particleKind: 'embers',
    screenCount360: 8,
    screenRadiusMeters: 3.1,
    screenThemes: [
      'OLYMPUS METEO',
      'OXYGEN SCRUBBER',
      'ROVER PATHFINDER',
      'HABITAT DOME 360',
    ],
  },
  {
    id: 'bioluminescent-forest',
    index: 7,
    title: 'Био-Лес Пандоры',
    subtitle: 'Светящиеся ночные деревья, пыльца и органический нейросеть-лес',
    skyTopHex: 0x021218,
    skyHorizonHex: 0x065f46,
    skyBottomHex: 0x010a0d,
    accentHex: 0x4ade80,
    secondaryHex: 0x22d3ee,
    fogDensity: 0.022,
    particleKind: 'spores',
    screenCount360: 6,
    screenRadiusMeters: 3.0,
    screenThemes: [
      'MYCELIUM LINK',
      'FLORA BIO-PULSE',
      'CANOPY SONIC 360',
      'ECOSYSTEM BALANCE',
    ],
  },
  {
    id: 'quantum-nexus',
    index: 8,
    title: 'Квантовая Сингулярность',
    subtitle: 'Вращающиеся кольца кубитов, матрица векторов и нулевая гравитация',
    skyTopHex: 0x020617,
    skyHorizonHex: 0x0f172a,
    skyBottomHex: 0x000000,
    accentHex: 0x00f5d4,
    secondaryHex: 0x818cf8,
    fogDensity: 0.012,
    particleKind: 'data',
    screenCount360: 10,
    screenRadiusMeters: 3.25,
    screenThemes: [
      'QUBIT COHERENCE',
      'PHASE MATRIX 360',
      'ENTANGLEMENT BUS',
      'TENSOR CORE',
    ],
  },
  {
    id: 'arctic-aurora',
    index: 9,
    title: 'Северное Сияние Арктики',
    subtitle: 'Ледяной павильон под переливающейся лентой Aurora Borealis',
    skyTopHex: 0x03071e,
    skyHorizonHex: 0x064e3b,
    skyBottomHex: 0x0f172a,
    accentHex: 0x34d399,
    secondaryHex: 0xa78bfa,
    fogDensity: 0.016,
    particleKind: 'snow',
    screenCount360: 6,
    screenRadiusMeters: 3.15,
    screenThemes: [
      'AURORA MAGNETIC',
      'SOLAR WIND KP-8',
      'GLACIER ACOUSTICS',
      'POLAR HORIZON 360',
    ],
  },
  {
    id: 'synthwave-horizon',
    index: 10,
    title: 'Синтвейв-Каньон 1984',
    subtitle: 'Неоновая сетка, закатное ретро-солнце и 360°-спектроанализатор',
    skyTopHex: 0x16003b,
    skyHorizonHex: 0xdb2777,
    skyBottomHex: 0x090018,
    accentHex: 0xf472b6,
    secondaryHex: 0x22d3ee,
    fogDensity: 0.015,
    particleKind: 'data',
    screenCount360: 8,
    screenRadiusMeters: 3.05,
    screenThemes: [
      'RETRO WAVE 84',
      'ANALOG SYNTH 360',
      'OUTRUN VECTOR',
      'TURBO GRID HUD',
    ],
  },
];

export interface IncrediblePlacesConfig {
  readonly initialPlaceId?: SpatialPlaceId;
  readonly onPlaceReady?: (
    place: SpatialPlaceSpec,
    panoramicSurfaces: readonly VirtualSurfaceDescriptor[]
  ) => void;
  readonly onLog?: (message: string) => void;
}

const PARTICLE_COUNT = 260;

// Предвыделенные временные объекты для Zero-GC анимации частиц.
const _dummy = new THREE.Object3D();

export class IncrediblePlacesManager extends xb.Script {
  private readonly config: IncrediblePlacesConfig;
  private activePlace: SpatialPlaceSpec = SPATIAL_PLACES_CATALOG[0];
  private skyDomeEnabled = true;
  private screens360Visible = true;

  private environmentGroup = new THREE.Group();
  private skyMesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> | null =
    null;
  private screensBundle: Screens360Bundle | null = null;
  private particlesMesh: THREE.InstancedMesh | null = null;
  private particleData = new Float32Array(PARTICLE_COUNT * 4); // x, y, z, speed
  private animatedObjects: Array<{obj: THREE.Object3D; speed: number}> = [];
  private placeDisposables: Array<{dispose: () => void}> = [];
  private elapsed = 0;

  constructor(config: IncrediblePlacesConfig = {}) {
    super();
    this.config = config;
    this.environmentGroup.name = 'IncrediblePlaceRoot';
    this.environmentGroup.xb = {pointerEvents: 'none'};
    if (config.initialPlaceId) {
      const found = SPATIAL_PLACES_CATALOG.find(
        (p) => p.id === config.initialPlaceId
      );
      if (found) this.activePlace = found;
    }
  }

  override init(): void {
    this.add(this.environmentGroup);
    this.selectPlace(this.activePlace.id);
  }

  override update(): void {
    const dt = Math.min(xb.getDeltaTime(), 0.1);
    this.elapsed += dt;

    if (this.skyMesh) {
      this.skyMesh.material.uniforms.uTime.value = this.elapsed;
    }

    this.screensBundle?.animate(this.elapsed);

    for (let i = 0; i < this.animatedObjects.length; i++) {
      const item = this.animatedObjects[i];
      item.obj.rotation.y += dt * item.speed;
    }

    this.updateParticles(dt);
  }

  getActivePlace(): SpatialPlaceSpec {
    return this.activePlace;
  }

  isSkyDomeEnabled(): boolean {
    return this.skyDomeEnabled;
  }

  areScreens360Visible(): boolean {
    return this.screens360Visible;
  }

  setSkyDomeEnabled(enabled: boolean): boolean {
    this.skyDomeEnabled = enabled;
    if (this.skyMesh) {
      this.skyMesh.visible = enabled;
    }
    this.config.onLog?.(
      enabled
        ? '360° небесный купол включён (Полное погружение)'
        : '360° купол скрыт (AR-режим: только 360°-экраны и объекты)'
    );
    return enabled;
  }

  setScreens360Visible(visible: boolean): boolean {
    this.screens360Visible = visible;
    this.screensBundle?.setVisible(visible);
    this.config.onLog?.(
      visible ? '360° панорамные экраны включены' : '360° экраны скрыты'
    );
    return visible;
  }

  nextPlace(): SpatialPlaceSpec {
    const idx = SPATIAL_PLACES_CATALOG.findIndex(
      (p) => p.id === this.activePlace.id
    );
    const next =
      SPATIAL_PLACES_CATALOG[(idx + 1) % SPATIAL_PLACES_CATALOG.length];
    this.selectPlace(next.id);
    return next;
  }

  prevPlace(): SpatialPlaceSpec {
    const idx = SPATIAL_PLACES_CATALOG.findIndex(
      (p) => p.id === this.activePlace.id
    );
    const prev =
      SPATIAL_PLACES_CATALOG[
        (idx - 1 + SPATIAL_PLACES_CATALOG.length) %
          SPATIAL_PLACES_CATALOG.length
      ];
    this.selectPlace(prev.id);
    return prev;
  }

  selectPlace(placeId: SpatialPlaceId): SpatialPlaceSpec {
    const found = SPATIAL_PLACES_CATALOG.find((p) => p.id === placeId);
    if (!found) return this.activePlace;

    this.disposeActivePlace();
    this.activePlace = found;

    this.buildSkyDome(found);
    this.buildGroundAndLandmarks(found);
    this.buildAmbientParticles(found);

    this.screensBundle = build360ScreensAndPanels(found);
    this.screensBundle.setVisible(this.screens360Visible);
    this.environmentGroup.add(this.screensBundle.screensGroup);

    this.config.onPlaceReady?.(found, this.screensBundle.panoramicSurfaces);
    this.config.onLog?.(
      `Активировано место #${found.index}/10: ${found.title} (${found.screenCount360} экранов 360°)`
    );
    return found;
  }

  private buildSkyDome(place: SpatialPlaceSpec): void {
    const skyGeo = new THREE.SphereGeometry(38, 48, 32);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uTime: {value: this.elapsed},
        uTopColor: {value: new THREE.Color(place.skyTopHex)},
        uHorizonColor: {value: new THREE.Color(place.skyHorizonHex)},
        uBottomColor: {value: new THREE.Color(place.skyBottomHex)},
        uAccentColor: {value: new THREE.Color(place.accentHex)},
        uSecondaryColor: {value: new THREE.Color(place.secondaryHex)},
        uPlaceIndex: {value: place.index},
      },
      vertexShader: `
        varying vec3 vWorldDir;
        void main() {
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldDir = normalize(position);
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uTopColor;
        uniform vec3 uHorizonColor;
        uniform vec3 uBottomColor;
        uniform vec3 uAccentColor;
        uniform vec3 uSecondaryColor;
        uniform float uPlaceIndex;
        varying vec3 vWorldDir;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }

        void main() {
          vec3 dir = normalize(vWorldDir);
          float h = dir.y;
          vec3 base = h >= 0.0
            ? mix(uHorizonColor, uTopColor, pow(clamp(h, 0.0, 1.0), 0.65))
            : mix(uHorizonColor, uBottomColor, pow(clamp(-h, 0.0, 1.0), 0.55));

          float angle = atan(dir.z, dir.x);

          // 360-градусные атмосферные волны (Сияние / Каустика / Небула).
          float wave = sin(angle * 4.0 + uTime * 0.35 + h * 6.0) * 0.5 + 0.5;
          float band = smoothstep(0.02, 0.55, h) * (1.0 - smoothstep(0.55, 0.92, h));
          base += mix(uAccentColor, uSecondaryColor, wave) * band * 0.24;

          // Процедурное звёздное небо 360°.
          vec2 starUv = floor(vec2(angle * 42.0, dir.y * 64.0));
          float star = step(0.992, hash(starUv));
          float twinkle = 0.6 + 0.4 * sin(uTime * 2.5 + hash(starUv) * 20.0);
          base += vec3(0.9, 0.96, 1.0) * star * twinkle * smoothstep(0.05, 0.35, h);

          // Ретро-солнце для Синтвейва (#10) или планетарный диск для Орбиты (#2).
          if (uPlaceIndex > 9.5) {
            vec3 sunDir = normalize(vec3(0.0, 0.18, -1.0));
            float sunDist = distance(dir, sunDir);
            if (sunDist < 0.22) {
              float stripe = step(0.35, fract(dir.y * 55.0));
              vec3 sunCol = mix(uAccentColor, vec3(1.0, 0.85, 0.2), clamp((dir.y - 0.02) * 4.0, 0.0, 1.0));
              base = mix(base, sunCol, stripe * 0.92);
            }
          } else if (abs(uPlaceIndex - 2.0) < 0.2) {
            vec3 planetDir = normalize(vec3(0.35, 0.22, -0.9));
            float pDist = distance(dir, planetDir);
            if (pDist < 0.28) {
              float rim = smoothstep(0.28, 0.2, pDist);
              base = mix(base, mix(uHorizonColor, uAccentColor, rim), 0.78);
            }
          }

          gl_FragColor = vec4(base, 1.0);
        }
      `,
    });

    this.skyMesh = new THREE.Mesh(skyGeo, skyMat);
    this.skyMesh.visible = this.skyDomeEnabled;
    this.skyMesh.xb = {pointerEvents: 'none'};
    this.environmentGroup.add(this.skyMesh);
    this.placeDisposables.push(skyGeo, skyMat);
  }

  private buildGroundAndLandmarks(place: SpatialPlaceSpec): void {
    // 1. Рабочая платформа под ногами и неоновое кольцо периметра.
    const floorGeo = new THREE.CircleGeometry(14, 64);
    const floorMat = new THREE.MeshStandardMaterial({
      color: place.skyBottomHex,
      roughness: 0.48,
      metalness: 0.35,
      transparent: true,
      opacity: 0.82,
    });
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.y = -0.02;
    floorMesh.xb = {pointerEvents: 'none'};
    this.environmentGroup.add(floorMesh);
    this.placeDisposables.push(floorGeo, floorMat);

    const grid = new THREE.GridHelper(
      26,
      26,
      place.accentHex,
      place.secondaryHex
    );
    grid.position.y = 0.0;
    grid.xb = {pointerEvents: 'none'};
    if (Array.isArray(grid.material)) {
      grid.material.forEach((m) => {
        m.transparent = true;
        m.opacity = 0.32;
      });
    } else {
      grid.material.transparent = true;
      grid.material.opacity = 0.32;
    }
    this.environmentGroup.add(grid);
    this.placeDisposables.push(grid);

    // 2. Композитные 3D-ориентиры на 360° периметре (радиус 5.5–10 м, не мешают окнам).
    const primaryMat = new THREE.MeshStandardMaterial({
      color: place.skyHorizonHex,
      roughness: 0.4,
      metalness: 0.55,
    });
    const accentMat = new THREE.MeshStandardMaterial({
      color: place.accentHex,
      emissive: place.accentHex,
      emissiveIntensity: 0.85,
      roughness: 0.25,
      metalness: 0.35,
    });
    const secondaryMat = new THREE.MeshStandardMaterial({
      color: place.secondaryHex,
      emissive: place.secondaryHex,
      emissiveIntensity: 0.6,
      roughness: 0.3,
      metalness: 0.65,
    });
    this.placeDisposables.push(primaryMat, accentMat, secondaryMat);

    const pillarCount = 12;
    const baseRadius = 6.2;

    for (let i = 0; i < pillarCount; i++) {
      const angle = (i / pillarCount) * Math.PI * 2;
      const dist = baseRadius + (i % 3) * 1.4;
      const x = Math.cos(angle) * dist;
      const z = Math.sin(angle) * dist;

      const landmark = new THREE.Group();
      landmark.position.set(x, 0, z);
      landmark.lookAt(0, 0, 0);
      landmark.xb = {pointerEvents: 'none'};

      this.populateLandmarkParts(
        place.id,
        landmark,
        i,
        primaryMat,
        accentMat,
        secondaryMat
      );

      this.environmentGroup.add(landmark);
    }

    // 3. Орбитальное верхнее кольцо над рабочим пространством для 360°-объёма.
    const haloGeo = new THREE.TorusGeometry(4.4, 0.04, 12, 72);
    const halo = new THREE.Mesh(haloGeo, accentMat);
    halo.rotation.x = Math.PI / 2;
    halo.position.y = 3.85;
    halo.xb = {pointerEvents: 'none'};
    this.environmentGroup.add(halo);
    this.animatedObjects.push({obj: halo, speed: 0.12});
    this.placeDisposables.push(haloGeo);
  }

  private populateLandmarkParts(
    placeId: SpatialPlaceId,
    group: THREE.Group,
    index: number,
    primaryMat: THREE.Material,
    accentMat: THREE.Material,
    secondaryMat: THREE.Material
  ): void {
    const scaleH = 2.6 + (index % 4) * 0.9;

    if (placeId === 'cyber-tokyo' || placeId === 'synthwave-horizon') {
      const bodyGeo = new THREE.BoxGeometry(0.95, scaleH, 0.95);
      const trimGeo = new THREE.BoxGeometry(1.02, 0.12, 1.02);
      const body = new THREE.Mesh(bodyGeo, primaryMat);
      body.position.y = scaleH / 2;
      const trim = new THREE.Mesh(
        trimGeo,
        index % 2 === 0 ? accentMat : secondaryMat
      );
      trim.position.y = scaleH - 0.25;
      group.add(body, trim);
      this.placeDisposables.push(bodyGeo, trimGeo);
      return;
    }

    if (placeId === 'crystal-cavern' || placeId === 'arctic-aurora') {
      const crystalGeo = new THREE.ConeGeometry(0.48, scaleH, 6);
      const shardGeo = new THREE.OctahedronGeometry(0.32, 0);
      const crystal = new THREE.Mesh(
        crystalGeo,
        index % 2 === 0 ? accentMat : secondaryMat
      );
      crystal.position.y = scaleH / 2;
      crystal.rotation.z = (index % 2 === 0 ? 1 : -1) * 0.14;
      const shard = new THREE.Mesh(shardGeo, primaryMat);
      shard.position.set(0.35, 0.6, 0.2);
      group.add(crystal, shard);
      this.placeDisposables.push(crystalGeo, shardGeo);
      return;
    }

    if (placeId === 'orbital-station' || placeId === 'quantum-nexus') {
      const ringGeo = new THREE.TorusGeometry(0.7, 0.08, 10, 28);
      const coreGeo = new THREE.OctahedronGeometry(0.28, 1);
      const ring = new THREE.Mesh(
        ringGeo,
        index % 2 === 0 ? accentMat : secondaryMat
      );
      ring.position.y = 2.1 + (index % 3) * 0.5;
      const core = new THREE.Mesh(coreGeo, primaryMat);
      core.position.copy(ring.position);
      group.add(ring, core);
      this.animatedObjects.push({
        obj: ring,
        speed: index % 2 === 0 ? 0.35 : -0.35,
      });
      this.placeDisposables.push(ringGeo, coreGeo);
      return;
    }

    if (placeId === 'bioluminescent-forest' || placeId === 'abyssal-dome') {
      const stemGeo = new THREE.CylinderGeometry(0.08, 0.18, scaleH * 0.7, 10);
      const capGeo = new THREE.SphereGeometry(0.65, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5);
      const stem = new THREE.Mesh(stemGeo, primaryMat);
      stem.position.y = scaleH * 0.35;
      const cap = new THREE.Mesh(capGeo, index % 2 === 0 ? accentMat : secondaryMat);
      cap.position.y = scaleH * 0.7;
      group.add(stem, cap);
      this.placeDisposables.push(stemGeo, capGeo);
      return;
    }

    // Небесная Цитадель и Марсианский Купол: колонны + парящие арки/купольные опоры.
    const colGeo = new THREE.CylinderGeometry(0.22, 0.28, scaleH, 12);
    const crownGeo = new THREE.BoxGeometry(0.85, 0.2, 0.85);
    const col = new THREE.Mesh(colGeo, primaryMat);
    col.position.y = scaleH / 2;
    const crown = new THREE.Mesh(crownGeo, accentMat);
    crown.position.y = scaleH + 0.1;
    group.add(col, crown);
    this.placeDisposables.push(colGeo, crownGeo);
  }

  private buildAmbientParticles(place: SpatialPlaceSpec): void {
    const geo = new THREE.OctahedronGeometry(0.032, 0);
    const mat = new THREE.MeshBasicMaterial({
      color: place.accentHex,
      transparent: true,
      opacity: 0.78,
    });
    const instanced = new THREE.InstancedMesh(geo, mat, PARTICLE_COUNT);
    instanced.frustumCulled = false;
    instanced.xb = {pointerEvents: 'none'};

    const colorA = new THREE.Color(place.accentHex);
    const colorB = new THREE.Color(place.secondaryHex);

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = 2.6 + Math.random() * 8.5;
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;
      const y = 0.2 + Math.random() * 5.2;
      const speed = 0.25 + Math.random() * 0.85;

      this.particleData[i * 4] = x;
      this.particleData[i * 4 + 1] = y;
      this.particleData[i * 4 + 2] = z;
      this.particleData[i * 4 + 3] = speed;

      _dummy.position.set(x, y, z);
      _dummy.scale.setScalar(0.6 + Math.random() * 0.9);
      _dummy.updateMatrix();
      instanced.setMatrixAt(i, _dummy.matrix);
      instanced.setColorAt(i, i % 2 === 0 ? colorA : colorB);
    }

    instanced.instanceMatrix.needsUpdate = true;
    if (instanced.instanceColor) instanced.instanceColor.needsUpdate = true;

    this.particlesMesh = instanced;
    this.environmentGroup.add(instanced);
    this.placeDisposables.push(geo, mat, instanced);
  }

  private updateParticles(dt: number): void {
    if (!this.particlesMesh) return;
    const kind = this.activePlace.particleKind;
    const falling = kind === 'rain' || kind === 'snow';
    const rising = kind === 'bubbles' || kind === 'embers' || kind === 'spores';

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const base = i * 4;
      let x = this.particleData[base];
      let y = this.particleData[base + 1];
      let z = this.particleData[base + 2];
      const speed = this.particleData[base + 3];

      if (falling) {
        y -= dt * speed * (kind === 'rain' ? 3.2 : 0.7);
        if (y < 0.1) y = 5.4;
      } else if (rising) {
        y += dt * speed * 0.55;
        x += Math.sin(this.elapsed + i) * dt * 0.12;
        if (y > 5.4) y = 0.15;
      } else {
        // stars / data: мягкое 360°-кружение вокруг рабочего стола.
        const rot = dt * speed * 0.14;
        const nx = x * Math.cos(rot) - z * Math.sin(rot);
        const nz = x * Math.sin(rot) + z * Math.cos(rot);
        x = nx;
        z = nz;
      }

      this.particleData[base] = x;
      this.particleData[base + 1] = y;
      this.particleData[base + 2] = z;

      _dummy.position.set(x, y, z);
      _dummy.rotation.y = this.elapsed + i;
      _dummy.updateMatrix();
      this.particlesMesh.setMatrixAt(i, _dummy.matrix);
    }
    this.particlesMesh.instanceMatrix.needsUpdate = true;
  }

  private disposeActivePlace(): void {
    this.screensBundle?.dispose();
    this.screensBundle = null;
    this.skyMesh = null;
    this.particlesMesh = null;
    this.animatedObjects.length = 0;

    for (const item of this.placeDisposables) {
      item.dispose();
    }
    this.placeDisposables.length = 0;

    while (this.environmentGroup.children.length > 0) {
      this.environmentGroup.remove(this.environmentGroup.children[0]);
    }
  }

  override dispose(): void {
    this.disposeActivePlace();
  }
}
