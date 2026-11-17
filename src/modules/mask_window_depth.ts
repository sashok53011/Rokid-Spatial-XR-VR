import * as THREE from 'three';
import * as xb from 'xrblocks';

import type {
  DepthMaskStatusSnapshot,
  ManagedSpatialWindow,
  SpatialAppId,
} from '../types/spatial_contracts.ts';

/**
 * ============================================================================
 * МОДУЛЬ: mask_window_depth.ts (Z-маскировка глубины и окклюзия 3D-окон)
 * ============================================================================
 * НАЗНАЧЕНИЕ:
 *   Обеспечивает корректное перекрытие (depth masking / occlusion) виртуальных
 *   3D-окон (`xb.UICard`) и 3D-моделей за реальными физическими объектами в XR:
 *   1. Настраивает `xb.core.depth.depthMesh` в режиме чистого Z-Mask (записывает
 *      глубину реальной комнаты в буфер глубины без цветового закрашивания).
 *   2. Принудительно включает `depthTest = true` для мировых `xb.UICard` (так как
 *      UIKit по умолчанию может отключать depthTest для некоторых слоёв) и
 *      регистрирует совместимые материалы в `xb.OcclusionUtils` / `depth.occludableShaders`.
 *   3. Предоставляет переключаемый симулированный 3D-окклюдер (физическая стойка
 *      и перегородка стола) для визуальной проверки маскировки окон на десктопе.
 *
 * ВХОДНЫЕ ДАННЫЕ:
 *   - `getWindows()`: список управляемых окон `ManagedSpatialWindow[]`.
 *   - `toggleDepthMask()`, `toggleSimulatedOccluder()`, `refreshWindowMasks()`.
 *
 * ВЫХОДНЫЕ ДАННЫЕ:
 *   - Снимок `DepthMaskStatusSnapshot` со списком перекрытых окон (`occludedWindowIds`).
 *
 * КАК ПОЛЬЗОВАТЬСЯ:
 *   const depthMask = new WindowDepthMaskController({
 *     getWindows: () => windowManager.getWindows(),
 *     onLog: (lvl, msg) => monitor.log(lvl, 'DEPTH', msg),
 *   });
 *   this.add(depthMask);
 *
 * ЗАГЛУШКИ (STUB) И ЗАМЕНА В ПРОДАКШНЕ:
 *   - ЗАГЛУШКА (STUB): на десктопе без реального AR-сенсора глубины можно
 *     включить симулированный физический 3D-окклюдер (`toggleSimulatedOccluder()`),
 *     имитирующий колонну/монитор перед рабочими окнами.
 *   - КАК ЗАМЕНИТЬ В ПРОДАКШНЕ: на Android XR / устройстве с WebXR Depth Sensing
 *     модуль автоматически использует живой `xb.core.depth.depthMesh` и
 *     `xb.OcclusionUtils` для бесшовной окклюзии за реальной мебелью и руками.
 * ============================================================================
 */

export interface WindowDepthMaskConfig {
  readonly getWindows: () => readonly ManagedSpatialWindow[];
  readonly initialEnabled?: boolean;
  readonly initialSimOccluderVisible?: boolean;
  readonly onTelemetry?: (snapshot: DepthMaskStatusSnapshot) => void;
  readonly onLog?: (level: 'DEBUG' | 'INFO' | 'WARN', message: string) => void;
}

const _rayOrigin = new THREE.Vector3();
const _rayTarget = new THREE.Vector3();
const _rayDir = new THREE.Vector3();
const _raycaster = new THREE.Raycaster();
const _occluderHits: THREE.Intersection[] = [];

export class WindowDepthMaskController extends xb.Script {
  private readonly config: WindowDepthMaskConfig;
  private readonly patchedMaterials = new WeakSet<THREE.Material>();

  private enabled: boolean;
  private simulatedOccluderVisible: boolean;
  private depthMeshConfigured = false;
  private lastMaskScanMs = 0;
  private lastOcclusionCheckMs = 0;

  private simOccluderGroup!: THREE.Group;
  private simOccluderMeshes: THREE.Mesh[] = [];
  private simOccluderMaterial!: THREE.MeshStandardMaterial;
  private simWireMaterial!: THREE.MeshBasicMaterial;

  private readonly snapshot: DepthMaskStatusSnapshot = {
    enabled: true,
    depthMeshActive: false,
    simulatedOccluderVisible: false,
    maskedWindowsCount: 0,
    occludedWindowIds: [],
  };

  constructor(config: WindowDepthMaskConfig) {
    super();
    this.config = config;
    this.enabled = config.initialEnabled ?? true;
    this.simulatedOccluderVisible = config.initialSimOccluderVisible ?? false;
    this.snapshot.enabled = this.enabled;
    this.snapshot.simulatedOccluderVisible = this.simulatedOccluderVisible;
  }

  override init(): void {
    this.buildSimulatedPhysicalOccluder();
    this.configureDepthMeshMask();
    this.refreshWindowMasks();
    this.config.onLog?.(
      'INFO',
      `Z-маскировка глубины окон активна (${this.enabled ? 'ON' : 'OFF'})`
    );
  }

  override update(): void {
    const now = performance.now();

    if (!this.depthMeshConfigured) {
      this.configureDepthMeshMask();
    }

    // Периодически проверяем материалы окон (UIKit может достраивать меши асинхронно).
    if (now - this.lastMaskScanMs >= 650) {
      this.lastMaskScanMs = now;
      this.refreshWindowMasks();
    }

    if (now - this.lastOcclusionCheckMs >= 180) {
      this.lastOcclusionCheckMs = now;
      this.evaluateOccludedWindows();
    }
  }

  setEnabled(enabled: boolean): boolean {
    this.enabled = enabled;
    this.snapshot.enabled = enabled;
    this.configureDepthMeshMask();
    this.refreshWindowMasks();
    this.config.onTelemetry?.(this.snapshot);
    this.config.onLog?.(
      'INFO',
      `Маскировка глубины виртуальных окон: ${enabled ? 'ON' : 'OFF'}`
    );
    return this.enabled;
  }

  toggleDepthMask(): boolean {
    return this.setEnabled(!this.enabled);
  }

  setSimulatedOccluderVisible(visible: boolean): boolean {
    this.simulatedOccluderVisible = visible;
    this.snapshot.simulatedOccluderVisible = visible;
    if (this.simOccluderGroup) {
      this.simOccluderGroup.visible = visible;
    }
    this.evaluateOccludedWindows();
    this.config.onTelemetry?.(this.snapshot);
    this.config.onLog?.(
      'INFO',
      `Симулятор физического 3D-препятствия: ${visible ? 'ПОКАЗАН' : 'СКРЫТ'}`
    );
    return this.simulatedOccluderVisible;
  }

  toggleSimulatedOccluder(): boolean {
    return this.setSimulatedOccluderVisible(!this.simulatedOccluderVisible);
  }

  getSnapshot(): DepthMaskStatusSnapshot {
    return this.snapshot;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  isSimulatedOccluderVisible(): boolean {
    return this.simulatedOccluderVisible;
  }

  /**
   * Настраивает DepthMesh как невидимый цветовой, но пишущий в Z-буфер маскировщик.
   */
  private configureDepthMeshMask(): void {
    const depth = xb.core?.depth;
    const depthMesh = depth?.depthMesh;
    if (!depthMesh) {
      this.snapshot.depthMeshActive = false;
      return;
    }

    this.depthMeshConfigured = true;
    this.snapshot.depthMeshActive = Boolean(depth.enabled && this.enabled);

    depthMesh.visible = this.enabled;
    depthMesh.renderOrder = -20;

    const mat = depthMesh.material as THREE.Material & {
      colorWrite?: boolean;
      depthWrite?: boolean;
      depthTest?: boolean;
    };
    if (mat) {
      // В режиме AR оставляем depthMesh невидимым по цвету, но записывающим глубину для окклюзии окон.
      mat.depthTest = true;
      mat.depthWrite = this.enabled;
      mat.colorWrite = false;
    }
  }

  /**
   * Гарантирует `depthTest = true` и подключение шейдеров окклюзии для всех 3D-окон.
   */
  refreshWindowMasks(): void {
    const windows = this.config.getWindows();
    const depth = xb.core?.depth;
    const useDepthShader = Boolean(
      this.enabled && depth?.options?.occlusion?.enabled && depth.occludableShaders
    );

    let maskedCount = 0;

    for (const win of windows) {
      maskedCount += 1;
      win.card.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh || !mesh.material) return;

        // Окна должны рисоваться ПОСЛЕ Z-препасса препятствий (-20..-10) и тестировать глубину.
        mesh.renderOrder = this.enabled
          ? Math.max(mesh.renderOrder, 2)
          : mesh.renderOrder;

        const materials = Array.isArray(mesh.material)
          ? mesh.material
          : [mesh.material];

        for (const mat of materials) {
          if (!mat) continue;
          mat.depthTest = this.enabled;

          if (useDepthShader && !this.patchedMaterials.has(mat)) {
            this.patchedMaterials.add(mat);
            try {
              // Не патчим сырые RawShaderMaterial, несовместимые со стандартной вставкой.
              if (!(mat as THREE.RawShaderMaterial).isRawShaderMaterial) {
                xb.OcclusionUtils.addOcclusionToMaterial(mat, (shader) => {
                  depth?.occludableShaders?.add(shader);
                });
              }
            } catch {
              // В fallback-режиме достаточно аппаратного Z-буфера `mat.depthTest = true`.
            }
          }
        }
      });
    }

    this.snapshot.maskedWindowsCount = maskedCount;
  }

  /**
   * ЗАГЛУШКА (STUB): создаёт физическую 3D-колонну/мониторную стойку перед
   * рабочим столом для тестирования перекрытия виртуальных окон на десктопе.
   */
  private buildSimulatedPhysicalOccluder(): void {
    this.simOccluderGroup = new THREE.Group();
    this.simOccluderGroup.name = 'SimulatedPhysicalDepthOccluder';
    this.simOccluderGroup.xb = {pointerEvents: 'none'};
    this.simOccluderGroup.visible = this.simulatedOccluderVisible;

    this.simOccluderMaterial = new THREE.MeshStandardMaterial({
      color: 0x111827,
      roughness: 0.52,
      metalness: 0.45,
      depthWrite: true,
      depthTest: true,
    });
    this.simWireMaterial = new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      wireframe: true,
      transparent: true,
      opacity: 0.28,
      depthWrite: true,
      depthTest: true,
    });

    // Физическая стойка слева-впереди, частично перекрывающая Terminal/Studio при движении головы.
    const pillarGeo = new THREE.BoxGeometry(0.24, 0.72, 0.14);
    const pillar = new THREE.Mesh(pillarGeo, this.simOccluderMaterial);
    pillar.position.set(-0.34, 1.32, -1.04);
    pillar.renderOrder = -10;
    pillar.xb = {pointerEvents: 'none'};

    const pillarEdge = new THREE.Mesh(pillarGeo, this.simWireMaterial);
    pillarEdge.position.copy(pillar.position);
    pillarEdge.scale.setScalar(1.01);
    pillarEdge.renderOrder = -9;
    pillarEdge.xb = {pointerEvents: 'none'};

    // Горизонтальная полка/подставка на столе.
    const shelfGeo = new THREE.BoxGeometry(0.46, 0.14, 0.16);
    const shelf = new THREE.Mesh(shelfGeo, this.simOccluderMaterial);
    shelf.position.set(0.32, 1.06, -0.78);
    shelf.renderOrder = -10;
    shelf.xb = {pointerEvents: 'none'};

    const shelfEdge = new THREE.Mesh(shelfGeo, this.simWireMaterial);
    shelfEdge.position.copy(shelf.position);
    shelfEdge.scale.setScalar(1.01);
    shelfEdge.renderOrder = -9;
    shelfEdge.xb = {pointerEvents: 'none'};

    this.simOccluderMeshes = [pillar, shelf];
    this.simOccluderGroup.add(pillar, pillarEdge, shelf, shelfEdge);
    this.add(this.simOccluderGroup);
  }

  private evaluateOccludedWindows(): void {
    const camera = xb.core?.camera;
    if (!camera || !this.enabled) {
      this.snapshot.occludedWindowIds = [];
      return;
    }

    const targets: THREE.Object3D[] = [];
    if (this.simulatedOccluderVisible) {
      targets.push(...this.simOccluderMeshes);
    }
    const depthMesh = xb.core?.depth?.depthMesh;
    if (depthMesh && this.snapshot.depthMeshActive) {
      targets.push(depthMesh);
    }

    if (targets.length === 0) {
      this.snapshot.occludedWindowIds = [];
      return;
    }

    camera.getWorldPosition(_rayOrigin);
    const occluded: SpatialAppId[] = [];
    const windows = this.config.getWindows();

    for (const win of windows) {
      if (!win.card.visible) continue;
      win.card.getWorldPosition(_rayTarget);
      _rayDir.copy(_rayTarget).sub(_rayOrigin);
      const windowDist = _rayDir.length();
      if (windowDist < 0.05) continue;
      _rayDir.divideScalar(windowDist);

      _raycaster.set(_rayOrigin, _rayDir);
      _raycaster.near = 0.05;
      _raycaster.far = Math.max(0.1, windowDist - 0.05);

      _occluderHits.length = 0;
      _raycaster.intersectObjects(targets, false, _occluderHits);
      if (_occluderHits.length > 0) {
        occluded.push(win.id);
      }
    }

    this.snapshot.occludedWindowIds = occluded;
    this.config.onTelemetry?.(this.snapshot);
  }

  override dispose(): void {
    for (const mesh of this.simOccluderMeshes) {
      mesh.geometry.dispose();
    }
    this.simOccluderMaterial?.dispose();
    this.simWireMaterial?.dispose();
  }
}
