import * as THREE from 'three';
import * as xb from 'xrblocks';

import type {
  SurfaceSnapResult,
  VirtualSurfaceDescriptor,
} from '../types/spatial_contracts.ts';

/**
 * ============================================================================
 * МОДУЛЬ: snap_to_virtual_surfaces.ts (Виртуальные стены и магнитная привязка)
 * ============================================================================
 * НАЗНАЧЕНИЕ:
 *   Управляет виртуальными стенами и рабочими поверхностями в 3D-пространстве,
 *   а также поддерживает привязку к реальной сетке глубины (`xb.core.depth.depthMesh`).
 *   Позволяет закреплять (pin) окна приложений заподлицо с выбранной плоскостью
 *   без наложения граней (Z-fighting).
 *
 * ВХОДНЫЕ ДАННЫЕ:
 *   - `findBestSnapTarget(worldPosition, maxDistanceMeters)`: мировая точка окна
 *     и порог примагничивания в метрах.
 *   - `getSurfaceById(id)`: идентификатор поверхности (`wall-center`, `wall-left`,
 *     `wall-right`, `desk-surface`).
 *   - `setWallsVisible(visible)`: показать/скрыть направляющие сетки виртуальных стен.
 *
 * ВЫХОДНЫЕ ДАННЫЕ:
 *   - `SurfaceSnapResult | null`: вычисленная позиция и кватернион ориентации окна
 *     на поверхности с безопасным отступом по нормали (`SURFACE_OFFSET_METERS`).
 *
 * КАК ПОЛЬЗОВАТЬСЯ:
 *   const surfaceManager = new VirtualSurfaceManager({
 *     onSurfaceEvent: (msg) => monitor.log('INFO', 'SURFACE', msg),
 *   });
 *   this.add(surfaceManager);
 *   const snap = surfaceManager.findBestSnapTarget(card.position, 0.75);
 * ============================================================================
 */

export interface VirtualSurfaceManagerConfig {
  readonly onSurfaceEvent?: (message: string) => void;
}

const SURFACE_OFFSET_METERS = 0.025;
const DEFAULT_SNAP_THRESHOLD_METERS = 0.85;

// Предвыделенные временные векторы/матрицы для Zero-GC расчётов привязки.
const _localPoint = new THREE.Vector3();
const _clampedLocal = new THREE.Vector3();
const _worldPoint = new THREE.Vector3();
const _rayOrigin = new THREE.Vector3();
const _rayDir = new THREE.Vector3(0, 0, -1);
const _lookMatrix = new THREE.Matrix4();
const _up = new THREE.Vector3(0, 1, 0);

interface InternalSurfaceEntry {
  descriptor: VirtualSurfaceDescriptor;
  group: THREE.Group;
  planeMesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshPhysicalMaterial>;
  borderMesh: THREE.LineSegments<THREE.EdgesGeometry, THREE.LineBasicMaterial>;
  gridHelper: THREE.GridHelper;
  highlighted: boolean;
}

export class VirtualSurfaceManager extends xb.Script {
  static dependencies = {
    depth: xb.Depth,
  };

  private readonly onSurfaceEvent?: (message: string) => void;
  private readonly surfaces: InternalSurfaceEntry[] = [];
  private readonly dynamic360Surfaces: InternalSurfaceEntry[] = [];
  private readonly raycaster = new THREE.Raycaster();
  private depth: xb.Depth | null = null;
  private wallsVisible = true;

  constructor(config: VirtualSurfaceManagerConfig = {}) {
    super();
    this.onSurfaceEvent = config.onSurfaceEvent;
  }

  override init({depth}: {depth: xb.Depth}): void {
    this.depth = depth;
    this.createDefaultWorkspaceSurfaces();
    this.onSurfaceEvent?.(
      `Инициализировано ${this.surfaces.length} виртуальных поверхностей привязки`
    );
  }

  /**
   * Возвращает список дескрипторов всех виртуальных поверхностей.
   */
  getSurfaces(): readonly VirtualSurfaceDescriptor[] {
    return [...this.surfaces, ...this.dynamic360Surfaces].map(
      (entry) => entry.descriptor
    );
  }

  getSurfaceById(id: string): VirtualSurfaceDescriptor | null {
    return (
      this.surfaces.find((entry) => entry.descriptor.id === id)?.descriptor ??
      this.dynamic360Surfaces.find((entry) => entry.descriptor.id === id)
        ?.descriptor ??
      null
    );
  }

  /**
   * Регистрирует или обновляет набор 360-градусных панорамных панелей текущей локации.
   */
  setDynamic360Surfaces(
    descriptors: readonly VirtualSurfaceDescriptor[]
  ): void {
    this.clearDynamic360Surfaces();
    for (const desc of descriptors) {
      const euler = new THREE.Euler().setFromQuaternion(desc.quaternion);
      this.registerSurface(
        {
          id: desc.id,
          title: desc.title,
          kind: 'panoramic360',
          widthMeters: desc.widthMeters,
          heightMeters: desc.heightMeters,
          center: desc.center,
          euler,
        },
        this.dynamic360Surfaces
      );
    }
    this.onSurfaceEvent?.(
      `Подключено ${descriptors.length} кольцевых 360° панелей привязки`
    );
  }

  areWallsVisible(): boolean {
    return this.wallsVisible;
  }

  /**
   * Переключает визуальную видимость направляющих виртуальных стен и стола.
   * Сами плоскости привязки остаются доступными для расчётов.
   */
  setWallsVisible(visible: boolean): void {
    this.wallsVisible = visible;
    for (const entry of this.surfaces) {
      entry.group.visible = visible;
    }
    for (const entry of this.dynamic360Surfaces) {
      entry.group.visible = visible;
    }
    this.onSurfaceEvent?.(
      visible
        ? 'Виртуальные стены и 360°-панели показаны'
        : 'Виртуальные стены скрыты (привязка активна)'
    );
  }

  /**
   * Подсвечивает конкретную поверхность во время перетаскивания окна.
   */
  highlightSurface(surfaceId: string | null): void {
    const allEntries = [...this.surfaces, ...this.dynamic360Surfaces];
    for (const entry of allEntries) {
      const active = entry.descriptor.id === surfaceId;
      if (entry.highlighted === active) continue;
      entry.highlighted = active;

      entry.planeMesh.material.opacity = active ? 0.24 : 0.06;
      entry.planeMesh.material.color.setHex(active ? 0x38bdf8 : 0x1e293b);
      entry.borderMesh.material.color.setHex(active ? 0x7dd3fc : 0x38bdf8);
    }
  }

  /**
   * Ищет ближайшую виртуальную поверхность или реальную AR depth-поверхность
   * в пределах `maxDistanceMeters` от мировой позиции окна.
   */
  findBestSnapTarget(
    worldPosition: THREE.Vector3,
    maxDistanceMeters = DEFAULT_SNAP_THRESHOLD_METERS
  ): SurfaceSnapResult | null {
    let bestResult: SurfaceSnapResult | null = null;
    let bestDistance = maxDistanceMeters;

    const allEntries = [...this.surfaces, ...this.dynamic360Surfaces];
    for (const entry of allEntries) {
      const snapped = this.projectOntoSurface(entry.descriptor, worldPosition);
      if (snapped.distanceMeters <= bestDistance) {
        bestDistance = snapped.distanceMeters;
        bestResult = snapped;
      }
    }

    // Если в реальном AR включён DepthMesh и виртуальные стены далеко —
    // проверяем пересечение по направлению от камеры через окно к depthMesh.
    const depthMesh = this.depth?.depthMesh;
    if (!bestResult && depthMesh && xb.core?.camera) {
      _rayOrigin.copy(xb.core.camera.position);
      _rayDir.copy(worldPosition).sub(_rayOrigin).normalize();
      this.raycaster.set(_rayOrigin, _rayDir);
      const hits = this.raycaster.intersectObject(depthMesh, false);
      if (hits.length > 0 && hits[0].distance < 4.5) {
        const hit = hits[0];
        const normal = hit.normal ?? hit.face?.normal;
        if (normal) {
          const snappedPos = hit.point
            .clone()
            .addScaledVector(normal, SURFACE_OFFSET_METERS + 0.01);
          const targetPoint = snappedPos.clone().add(normal);
          _lookMatrix.lookAt(targetPoint, snappedPos, _up);
          const snappedQuat = new THREE.Quaternion().setFromRotationMatrix(
            _lookMatrix
          );
          bestResult = {
            surfaceId: 'ar-depth-surface',
            surfaceTitle: 'Реальная стена (Depth)',
            kind: 'depth',
            position: snappedPos,
            quaternion: snappedQuat,
            distanceMeters: hit.point.distanceTo(worldPosition),
          };
        }
      }
    }

    return bestResult;
  }

  /**
   * Проецирует мировую точку на конкретную виртуальную поверхность по её ID.
   */
  snapToSurfaceById(
    surfaceId: string,
    worldPosition: THREE.Vector3
  ): SurfaceSnapResult | null {
    const descriptor = this.getSurfaceById(surfaceId);
    if (!descriptor) return null;
    return this.projectOntoSurface(descriptor, worldPosition);
  }

  private projectOntoSurface(
    surface: VirtualSurfaceDescriptor,
    worldPosition: THREE.Vector3
  ): SurfaceSnapResult {
    // Переводим точку в локальную систему координат плоскости.
    _localPoint
      .copy(worldPosition)
      .sub(surface.center)
      .applyQuaternion(surface.quaternion.clone().invert());

    const halfW = Math.max(0.2, surface.widthMeters * 0.5 - 0.25);
    const halfH = Math.max(0.15, surface.heightMeters * 0.5 - 0.18);

    _clampedLocal.set(
      THREE.MathUtils.clamp(_localPoint.x, -halfW, halfW),
      THREE.MathUtils.clamp(_localPoint.y, -halfH, halfH),
      SURFACE_OFFSET_METERS
    );

    _worldPoint
      .copy(_clampedLocal)
      .applyQuaternion(surface.quaternion)
      .add(surface.center);

    const distanceMeters = worldPosition.distanceTo(_worldPoint);

    // Для наклонной поверхности стола окно слегка наклоняется к пользователю.
    const snappedQuat = surface.quaternion.clone();

    return {
      surfaceId: surface.id,
      surfaceTitle: surface.title,
      kind: surface.kind,
      position: _worldPoint.clone(),
      quaternion: snappedQuat,
      distanceMeters,
    };
  }

  private createDefaultWorkspaceSurfaces(): void {
    // 1. Центральная виртуальная стена перед пользователем.
    this.registerSurface({
      id: 'wall-center',
      title: 'Центральная стена',
      kind: 'wall',
      widthMeters: 2.8,
      heightMeters: 1.55,
      center: new THREE.Vector3(0, 1.48, -1.78),
      euler: new THREE.Euler(0, 0, 0),
    });

    // 2. Левая боковая стена рабочей станции (угол +38°).
    this.registerSurface({
      id: 'wall-left',
      title: 'Левая стена',
      kind: 'wall',
      widthMeters: 1.9,
      heightMeters: 1.45,
      center: new THREE.Vector3(-1.68, 1.48, -1.05),
      euler: new THREE.Euler(0, THREE.MathUtils.degToRad(40), 0),
    });

    // 3. Правая боковая стена рабочей станции (угол -38°).
    this.registerSurface({
      id: 'wall-right',
      title: 'Правая стена',
      kind: 'wall',
      widthMeters: 1.9,
      heightMeters: 1.45,
      center: new THREE.Vector3(1.68, 1.48, -1.05),
      euler: new THREE.Euler(0, THREE.MathUtils.degToRad(-40), 0),
    });

    // 4. Наклонная консоль-стол перед пользователем (удобно для терминала/заметок).
    this.registerSurface({
      id: 'desk-surface',
      title: 'Рабочий стол',
      kind: 'desk',
      widthMeters: 2.1,
      heightMeters: 0.72,
      center: new THREE.Vector3(0, 0.88, -0.92),
      euler: new THREE.Euler(THREE.MathUtils.degToRad(-55), 0, 0),
    });
  }

  private registerSurface(
    params: {
      id: string;
      title: string;
      kind: 'wall' | 'desk' | 'panoramic360';
      widthMeters: number;
      heightMeters: number;
      center: THREE.Vector3;
      euler: THREE.Euler;
    },
    targetArray: InternalSurfaceEntry[] = this.surfaces
  ): void {
    const quaternion = new THREE.Quaternion().setFromEuler(params.euler);
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion);

    const descriptor: VirtualSurfaceDescriptor = {
      id: params.id,
      title: params.title,
      kind: params.kind,
      widthMeters: params.widthMeters,
      heightMeters: params.heightMeters,
      center: params.center.clone(),
      normal,
      quaternion,
    };

    const group = new THREE.Group();
    group.name = `VirtualSurface_${params.id}`;
    group.position.copy(params.center);
    group.quaternion.copy(quaternion);
    group.visible = this.wallsVisible;
    // Поверхности прозрачны для ретикла, чтобы не перехватывать клики на окна.
    group.xb = {pointerEvents: 'none'};

    const planeGeo = new THREE.PlaneGeometry(
      params.widthMeters,
      params.heightMeters
    );
    const planeMat = new THREE.MeshPhysicalMaterial({
      color: params.kind === 'panoramic360' ? 0x0f172a : 0x1e293b,
      transparent: true,
      opacity: params.kind === 'panoramic360' ? 0.04 : 0.08,
      roughness: 0.35,
      metalness: 0.1,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const planeMesh = new THREE.Mesh(planeGeo, planeMat);
    planeMesh.xb = {pointerEvents: 'none'};
    planeMesh.renderOrder = -2;

    const edgesGeo = new THREE.EdgesGeometry(planeGeo);
    const edgesMat = new THREE.LineBasicMaterial({
      color: params.kind === 'panoramic360' ? 0x22d3ee : 0x38bdf8,
      transparent: true,
      opacity: params.kind === 'panoramic360' ? 0.3 : 0.48,
    });
    const borderMesh = new THREE.LineSegments(edgesGeo, edgesMat);
    borderMesh.position.z = 0.002;
    borderMesh.xb = {pointerEvents: 'none'};

    const gridSize = Math.max(params.widthMeters, params.heightMeters);
    const gridHelper = new THREE.GridHelper(
      gridSize,
      10,
      0x38bdf8,
      0x1e3a5f
    );
    gridHelper.rotation.x = Math.PI / 2;
    gridHelper.scale.set(
      params.widthMeters / gridSize,
      1,
      params.heightMeters / gridSize
    );
    gridHelper.position.z = 0.001;
    gridHelper.xb = {pointerEvents: 'none'};
    const gridMat = gridHelper.material;
    if (Array.isArray(gridMat)) {
      gridMat.forEach((m) => {
        m.transparent = true;
        m.opacity = params.kind === 'panoramic360' ? 0.12 : 0.22;
        m.depthWrite = false;
      });
    } else {
      gridMat.transparent = true;
      gridMat.opacity = params.kind === 'panoramic360' ? 0.12 : 0.22;
      gridMat.depthWrite = false;
    }

    group.add(planeMesh, borderMesh, gridHelper);
    this.add(group);

    targetArray.push({
      descriptor,
      group,
      planeMesh,
      borderMesh,
      gridHelper,
      highlighted: false,
    });
  }

  private clearDynamic360Surfaces(): void {
    for (const entry of this.dynamic360Surfaces) {
      this.disposeSurfaceEntry(entry);
    }
    this.dynamic360Surfaces.length = 0;
  }

  private disposeSurfaceEntry(entry: InternalSurfaceEntry): void {
    entry.planeMesh.geometry.dispose();
    entry.planeMesh.material.dispose();
    entry.borderMesh.geometry.dispose();
    entry.borderMesh.material.dispose();
    entry.gridHelper.geometry.dispose();
    if (Array.isArray(entry.gridHelper.material)) {
      entry.gridHelper.material.forEach((m) => m.dispose());
    } else {
      entry.gridHelper.material.dispose();
    }
    entry.group.removeFromParent();
  }

  override dispose(): void {
    for (const entry of this.surfaces) {
      this.disposeSurfaceEntry(entry);
    }
    this.surfaces.length = 0;
    this.clearDynamic360Surfaces();
  }
}
