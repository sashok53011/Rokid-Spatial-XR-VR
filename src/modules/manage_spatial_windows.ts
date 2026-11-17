import * as THREE from 'three';
import * as xb from 'xrblocks';

import type {
  ManagedSpatialWindow,
  SavedLayoutPreset,
  SavedWindowTransform,
  SpatialAppId,
  SpatialManipulationKind,
  SpatialWindowCreateInput,
  StudioSceneManifest,
  WorkspaceLayoutMode,
} from '../types/spatial_contracts.ts';
import {
  buildAppWindowContent,
  type AppContentBuildActions,
  type CompanionModelAttachment,
} from './build_app_window_content.ts';
import type {TransformInterpolator} from './interpolate_transforms.ts';
import type {VirtualSurfaceManager} from './snap_to_virtual_surfaces.ts';

/**
 * ============================================================================
 * МОДУЛЬ: manage_spatial_windows.ts (Менеджер пространственных окон приложений)
 * ============================================================================
 * НАЗНАЧЕНИЕ:
 *   Управляет жизненным циклом, фокусом, трансформациями, магнитной привязкой
 *   к виртуальным стенам и раскладками (`arc`, `grid`, `wall-pinned`) для всех
 *   3D-окон приложений (`xb.UICard` с `manipulation: true`, `edge: true`).
 *
 * ВХОДНЫЕ ДАННЫЕ:
 *   - `surfaceManager`: модуль виртуальных стен `VirtualSurfaceManager`.
 *   - `interpolator`: модуль плавной интерполяции `TransformInterpolator`.
 *   - `contentActions`: действия, передаваемые в фабрику контента окон.
 *   - Методы управления: `focusOrShowWindow(id)`, `applyLayout(mode)`,
 *     `togglePinWindow(id)`, `pinAllToWalls()`, `unpinAll()`,
 *     `nudgeActiveWindow(dx, dy, dz)`, `applyManifest(manifest)`.
 *
 * ВЫХОДНЫЕ ДАННЫЕ:
 *   - Массив управляемых окон `getWindows()`, ID активного окна `getActiveWindowId()`,
 *     коллбеки `onActiveWindowChange`, `onWorkspaceChanged`, `onLog`.
 *
 * КАК ПОЛЬЗОВАТЬСЯ:
 *   const windowManager = new SpatialWindowManager({
 *     surfaceManager,
 *     interpolator,
 *     contentActions,
 *     onLog: (lvl, msg) => monitor.log(lvl, 'WINDOW', msg),
 *   });
 *   this.add(windowManager);
 * ============================================================================
 */

export interface SpatialWindowManagerConfig {
  readonly surfaceManager: VirtualSurfaceManager;
  readonly interpolator: TransformInterpolator;
  readonly contentActions: AppContentBuildActions;
  readonly onActiveWindowChange?: (id: SpatialAppId) => void;
  readonly onWorkspaceChanged?: () => void;
  readonly onWindowManipulated?: (
    kind: SpatialManipulationKind,
    detail: string
  ) => void;
  readonly onManipulationLifecycle?: (
    phase: 'start' | 'update' | 'end' | 'cancel',
    kind: SpatialManipulationKind,
    targetObject: THREE.Object3D,
    anchorWorldPos?: THREE.Vector3
  ) => void;
  readonly onLog?: (level: 'DEBUG' | 'INFO' | 'WARN', message: string) => void;
}

const DEFAULT_WINDOW_SPECS: readonly SpatialWindowCreateInput[] = [
  {
    id: 'terminal',
    title: 'Spatial Host Terminal',
    icon: 'terminal',
    widthMeters: 0.62,
    heightMeters: 'auto',
    initialPosition: new THREE.Vector3(-0.72, 1.38, -1.32),
    initialRotationY: 0.34,
  },
  {
    id: 'studio',
    title: 'Rokid Spatial Studio',
    icon: 'dashboard_customize',
    widthMeters: 0.64,
    heightMeters: 'auto',
    initialPosition: new THREE.Vector3(0, 1.44, -1.48),
    initialRotationY: 0,
  },
  {
    id: 'telemetry',
    title: 'Debug & Perf Monitor',
    icon: 'monitoring',
    widthMeters: 0.66,
    heightMeters: 'auto',
    initialPosition: new THREE.Vector3(0.74, 1.38, -1.32),
    initialRotationY: -0.34,
  },
  {
    id: 'notes',
    title: 'Spatial Notes',
    icon: 'edit_note',
    widthMeters: 0.56,
    heightMeters: 'auto',
    initialPosition: new THREE.Vector3(-0.55, 0.96, -0.96),
    initialRotationY: 0.22,
  },
  {
    id: 'viewport3d',
    title: '3D Spatial Node',
    icon: 'view_in_ar',
    widthMeters: 0.54,
    heightMeters: 'auto',
    initialPosition: new THREE.Vector3(0.58, 0.96, -0.96),
    initialRotationY: -0.22,
  },
  {
    id: 'places',
    title: '10 Мест & 360° Экраны',
    icon: 'public',
    widthMeters: 0.64,
    heightMeters: 'auto',
    initialPosition: new THREE.Vector3(-1.26, 1.44, -0.82),
    initialRotationY: 0.72,
  },
];

// Предвыделенные временные объекты для Zero-GC обновлений в цикле `update()`.
const _companionWorldPos = new THREE.Vector3();
const _tempEuler = new THREE.Euler();
const _tempQuat = new THREE.Quaternion();
const _tempVec = new THREE.Vector3();

export class SpatialWindowManager extends xb.Script {
  private readonly config: SpatialWindowManagerConfig;
  private readonly windows = new Map<SpatialAppId, ManagedSpatialWindow>();
  private readonly companions: Array<{
    window: ManagedSpatialWindow;
    attachment: CompanionModelAttachment;
  }> = [];

  private activeWindowId: SpatialAppId = 'studio';
  private activeManipulatedWindow: ManagedSpatialWindow | null = null;
  private autoSnapDuringDrag = true;

  constructor(config: SpatialWindowManagerConfig) {
    super();
    this.config = config;
  }

  override init(): void {
    for (const spec of DEFAULT_WINDOW_SPECS) {
      this.createManagedWindow(spec);
    }
    this.focusWindow('studio');
    this.config.onLog?.(
      'INFO',
      `Создано ${this.windows.size} пространственных окон рабочего стола`
    );
  }

  override update(): void {
    // Продвигаем плавные анимации примагничивания и раскладок.
    const delta = xb.getDeltaTime();
    this.config.interpolator.step(delta);

    // Синхронизируем позицию 3D-моделей, привязанных к окну viewport3d.
    for (const item of this.companions) {
      const card = item.window.card;
      item.attachment.viewer.visible = card.visible && !item.window.minimized;
      if (!item.attachment.viewer.visible) continue;

      _companionWorldPos.copy(item.attachment.localOffset);
      card.localToWorld(_companionWorldPos);
      item.attachment.viewer.position.copy(_companionWorldPos);
      item.attachment.assembly.rotation.y += delta * 0.45;
    }

    // Во время перетаскивания подсвечиваем ближайшую виртуальную стену.
    if (this.activeManipulatedWindow && this.autoSnapDuringDrag) {
      const candidate = this.config.surfaceManager.findBestSnapTarget(
        this.activeManipulatedWindow.card.position
      );
      this.config.surfaceManager.highlightSurface(
        candidate?.surfaceId ?? null
      );
    }
  }

  /**
   * Перехватывает жизненный цикл манипуляции окна (хватание за край / перенос)
   * для отмены текущей анимации и магнитной привязки к стене при отпускании.
   */
  override onObjectManipulate(event: xb.ManipulationEvent): void {
    const win = this.findWindowByCard(event.owner);
    if (!win) return;

    const actionKind: SpatialManipulationKind =
      event.action === xb.ManipulationAction.Scale
        ? 'scale'
        : event.action === xb.ManipulationAction.Resize
          ? 'resize'
          : event.action === xb.ManipulationAction.Rotate
            ? 'rotate'
            : 'move';

    const anchorWorldPos =
      'point' in event
        ? event.point
        : 'center' in event
          ? event.center
          : undefined;

    this.config.onManipulationLifecycle?.(
      event.phase,
      actionKind,
      win.card,
      anchorWorldPos
    );

    if (event.phase === 'start') {
      this.config.interpolator.cancelFor(win.card);
      this.activeManipulatedWindow = win;
      this.focusWindow(win.id);
      if (win.pinnedSurfaceId) {
        win.pinnedSurfaceId = null;
        this.refreshPinVisuals(win);
        this.config.onLog?.(
          'DEBUG',
          `Окно "${win.title}" откреплено вручную при перетаскивании`
        );
      }
      return;
    }

    if (event.phase === 'update') {
      return;
    }

    if (event.phase === 'end' || event.phase === 'cancel') {
      if (this.activeManipulatedWindow === win) {
        this.activeManipulatedWindow = null;
      }
      this.config.surfaceManager.highlightSurface(null);

      if (event.phase === 'end') {
        if (actionKind === 'scale') {
          this.config.onWindowManipulated?.(
            'scale',
            `Масштаб "${win.title}": ${win.card.scale.x.toFixed(2)}x`
          );
        } else if (actionKind === 'resize') {
          this.config.onWindowManipulated?.(
            'resize',
            `Размер "${win.title}" изменён`
          );
        } else if (actionKind === 'rotate') {
          this.config.onWindowManipulated?.(
            'rotate',
            `Поворот "${win.title}"`
          );
        } else {
          this.config.onWindowManipulated?.(
            'move',
            `Окно "${win.title}" перемещено`
          );
        }

        if (this.autoSnapDuringDrag) {
          const snap = this.config.surfaceManager.findBestSnapTarget(
            win.card.position
          );
          if (snap) {
            this.pinWindowToResult(
              win,
              snap.surfaceId,
              snap.surfaceTitle,
              snap.position,
              snap.quaternion
            );
          } else {
            this.config.onWorkspaceChanged?.();
          }
        }
      }
    }
  }

  getWindows(): readonly ManagedSpatialWindow[] {
    return Array.from(this.windows.values());
  }

  getWindow(id: SpatialAppId): ManagedSpatialWindow | undefined {
    return this.windows.get(id);
  }

  getActiveWindowId(): SpatialAppId {
    return this.activeWindowId;
  }

  getActiveWindowCard(): xb.UICard | undefined {
    return this.windows.get(this.activeWindowId)?.card;
  }

  /**
   * Делает окно видимым, переводит на него фокус и подсвечивает заголовок.
   */
  focusWindow(id: SpatialAppId): void {
    const win = this.windows.get(id);
    if (!win) return;

    if (!win.card.visible) {
      win.card.visible = true;
    }
    win.minimized = false;
    win.lastActiveTimestamp = performance.now();
    this.activeWindowId = id;

    for (const item of this.windows.values()) {
      const isFocused = item.id === id;
      item.card.style.borderColor = isFocused
        ? 'rgba(56, 189, 248, 0.85)'
        : 'rgba(255, 255, 255, 0.18)';
    }

    this.config.onActiveWindowChange?.(id);
    this.config.onLog?.('DEBUG', `Фокус на окне: ${win.title}`);
  }

  /**
   * Переключает видимость окна (открыть/скрыть).
   */
  toggleWindowVisibility(id: SpatialAppId): boolean {
    const win = this.windows.get(id);
    if (!win) return false;
    if (win.card.visible) {
      win.card.visible = false;
      this.config.onLog?.('INFO', `Окно "${win.title}" скрыто`);
    } else {
      this.focusWindow(id);
      this.config.onLog?.('INFO', `Окно "${win.title}" открыто`);
    }
    this.config.onWorkspaceChanged?.();
    return win.card.visible;
  }

  /**
   * Прикрепляет или открепляет указанное (или активное) окно к ближайшей стене/столу.
   */
  togglePinWindow(targetId?: SpatialAppId): boolean {
    const win = this.windows.get(targetId ?? this.activeWindowId);
    if (!win) return false;

    if (win.pinnedSurfaceId) {
      win.pinnedSurfaceId = null;
      this.refreshPinVisuals(win);
      this.config.onLog?.('INFO', `Окно "${win.title}" откреплено от стены`);
      this.config.onWorkspaceChanged?.();
      return false;
    }

    const snap =
      this.config.surfaceManager.findBestSnapTarget(win.card.position, 4.0) ??
      this.config.surfaceManager.snapToSurfaceById(
        'wall-center',
        win.card.position
      );

    if (!snap) {
      this.config.onLog?.(
        'WARN',
        `Не найдена поверхность рядом с окном "${win.title}"`
      );
      return false;
    }

    this.pinWindowToResult(
      win,
      snap.surfaceId,
      snap.surfaceTitle,
      snap.position,
      snap.quaternion
    );
    return true;
  }

  /**
   * Привязывает все видимые окна к ближайшим виртуальным стенам/столу.
   */
  pinAllToWalls(): void {
    const wallAssignments: Record<SpatialAppId, string> = {
      studio: 'wall-center',
      terminal: 'wall-left',
      telemetry: 'wall-right',
      notes: 'desk-surface',
      viewport3d: 'desk-surface',
      places: 'wall-left',
    };

    for (const win of this.windows.values()) {
      win.card.visible = true;
      const surfaceId = wallAssignments[win.id];
      const snap = this.config.surfaceManager.snapToSurfaceById(
        surfaceId,
        win.card.position
      );
      if (snap) {
        this.pinWindowToResult(
          win,
          snap.surfaceId,
          snap.surfaceTitle,
          snap.position,
          snap.quaternion
        );
      }
    }
  }

  /**
   * Открепляет все окна от поверхностей для свободного 3D-перемещения.
   */
  unpinAll(): void {
    for (const win of this.windows.values()) {
      win.pinnedSurfaceId = null;
      this.refreshPinVisuals(win);
    }
    this.config.onLog?.('INFO', 'Все окна переведены в свободное парение');
    this.config.onWorkspaceChanged?.();
  }

  /**
   * Плавно перестраивает окна по одной из 3 раскладок (`arc`, `grid`, `wall-pinned`).
   */
  applyLayout(mode: WorkspaceLayoutMode): void {
    if (mode === 'ring360') {
      // Распределяем все окна по полной 360° окружности с привязкой к 360°-панелям.
      const ringMap: Record<SpatialAppId, string> = {
        studio: 'ring360-0',
        telemetry: 'ring360-1',
        viewport3d: 'ring360-2',
        notes: 'ring360-4',
        terminal: 'ring360-6',
        places: 'ring360-7',
      };

      for (const win of this.windows.values()) {
        win.card.visible = true;
        const surfaceId = ringMap[win.id];
        const surface = this.config.surfaceManager.getSurfaceById(surfaceId);
        if (surface) {
          const snap = this.config.surfaceManager.snapToSurfaceById(
            surfaceId,
            surface.center
          );
          if (snap) {
            this.pinWindowToResult(
              win,
              snap.surfaceId,
              snap.surfaceTitle,
              snap.position,
              snap.quaternion
            );
          }
        }
      }
      this.config.onLog?.('INFO', 'Применена 360° круговая раскладка окон');
      return;
    }

    if (mode === 'wall-pinned') {
      // Сначала расставляем по базовым координатам напротив стен, затем примагничиваем.
      const presets: Record<SpatialAppId, {pos: [number, number, number]}> = {
        studio: {pos: [0, 1.5, -1.75]},
        terminal: {pos: [-1.62, 1.5, -1.02]},
        telemetry: {pos: [1.62, 1.5, -1.02]},
        notes: {pos: [-0.45, 0.92, -0.9]},
        viewport3d: {pos: [0.45, 0.92, -0.9]},
        places: {pos: [-1.4, 1.38, -0.82]},
      };
      const wallMap: Record<SpatialAppId, string> = {
        studio: 'wall-center',
        terminal: 'wall-left',
        telemetry: 'wall-right',
        notes: 'desk-surface',
        viewport3d: 'desk-surface',
        places: 'wall-left',
      };

      for (const win of this.windows.values()) {
        win.card.visible = true;
        _tempVec.set(...presets[win.id].pos);
        const snap = this.config.surfaceManager.snapToSurfaceById(
          wallMap[win.id],
          _tempVec
        );
        if (snap) {
          this.pinWindowToResult(
            win,
            snap.surfaceId,
            snap.surfaceTitle,
            snap.position,
            snap.quaternion
          );
        }
      }
      this.config.onLog?.('INFO', 'Применена раскладка "На виртуальные стены"');
      return;
    }

    if (mode === 'grid') {
      const gridCoords: Record<
        SpatialAppId,
        {pos: [number, number, number]; rotY: number}
      > = {
        terminal: {pos: [-0.72, 1.66, -1.45], rotY: 0.16},
        studio: {pos: [0, 1.66, -1.5], rotY: 0},
        telemetry: {pos: [0.72, 1.66, -1.45], rotY: -0.16},
        notes: {pos: [-0.7, 1.1, -1.35], rotY: 0.14},
        viewport3d: {pos: [0, 1.1, -1.4], rotY: 0},
        places: {pos: [0.7, 1.1, -1.35], rotY: -0.14},
      };

      for (const win of this.windows.values()) {
        win.card.visible = true;
        win.pinnedSurfaceId = null;
        this.refreshPinVisuals(win);
        const target = gridCoords[win.id];
        _tempVec.set(...target.pos);
        _tempEuler.set(0, target.rotY, 0);
        _tempQuat.setFromEuler(_tempEuler);
        this.config.interpolator.animateTo(win.card, {
          position: _tempVec,
          quaternion: _tempQuat,
          scale: 1,
        });
      }
      this.config.onLog?.('INFO', 'Применена раскладка "Сетка (Grid)"');
      this.config.onWorkspaceChanged?.();
      return;
    }

    // По умолчанию: Arc (эргономичная дуга вокруг пользователя).
    for (const spec of DEFAULT_WINDOW_SPECS) {
      const win = this.windows.get(spec.id);
      if (!win) continue;
      win.card.visible = true;
      win.pinnedSurfaceId = null;
      this.refreshPinVisuals(win);
      _tempEuler.set(0, spec.initialRotationY ?? 0, 0);
      _tempQuat.setFromEuler(_tempEuler);
      this.config.interpolator.animateTo(win.card, {
        position: spec.initialPosition,
        quaternion: _tempQuat,
        scale: 1,
      });
    }
    this.config.onLog?.('INFO', 'Применена раскладка "Дуга (Arc)"');
    this.config.onWorkspaceChanged?.();
  }

  /**
   * Сдвигает активное окно с клавиатуры/мыши и открепляет его при сдвиге.
   */
  nudgeActiveWindow(dx: number, dy: number, dz: number): void {
    const win = this.windows.get(this.activeWindowId);
    if (!win) return;
    if (!win.card.visible) win.card.visible = true;

    this.config.interpolator.cancelFor(win.card);
    win.card.position.x += dx;
    win.card.position.y = THREE.MathUtils.clamp(
      win.card.position.y + dy,
      0.55,
      2.4
    );
    win.card.position.z = THREE.MathUtils.clamp(
      win.card.position.z + dz,
      -3.2,
      -0.55
    );

    if (win.pinnedSurfaceId) {
      win.pinnedSurfaceId = null;
      this.refreshPinVisuals(win);
    }
    this.config.onManipulationLifecycle?.('start', 'move', win.card);
    this.config.onManipulationLifecycle?.('end', 'move', win.card);
    this.config.onWindowManipulated?.(
      'move',
      `Сдвиг "${win.title}" -> (${win.card.position.x.toFixed(2)}, ${win.card.position.y.toFixed(2)}, ${win.card.position.z.toFixed(2)})`
    );
    this.config.onWorkspaceChanged?.();
  }

  /**
   * Изменяет или сбрасывает масштаб активного окна (для клавиатуры и гида жестов).
   */
  scaleActiveWindow(deltaFactor: number, reset = false): number {
    const win = this.windows.get(this.activeWindowId);
    if (!win) return 1;
    if (!win.card.visible) win.card.visible = true;

    this.config.interpolator.cancelFor(win.card);
    const nextScale = reset
      ? 1
      : THREE.MathUtils.clamp(win.card.scale.x + deltaFactor, 0.65, 1.75);
    win.card.scale.setScalar(nextScale);

    this.config.onManipulationLifecycle?.('start', 'scale', win.card);
    this.config.onManipulationLifecycle?.('end', 'scale', win.card);
    this.config.onWindowManipulated?.(
      'scale',
      `Масштаб "${win.title}": ${nextScale.toFixed(2)}x`
    );
    this.config.onLog?.(
      'INFO',
      `Масштаб окна "${win.title}": ${nextScale.toFixed(2)}x`
    );
    this.config.onWorkspaceChanged?.();
    return nextScale;
  }

  /**
   * Восстанавливает позы и привязки окон из сохранённого манифеста Studio XR.
   */
  applyManifest(manifest: StudioSceneManifest): void {
    for (const item of manifest.windows) {
      const win = this.windows.get(item.id);
      if (!win) continue;
      win.card.visible = item.visible;
      win.pinnedSurfaceId = item.pinnedSurfaceId;
      this.refreshPinVisuals(win);
      _tempVec.set(item.position[0], item.position[1], item.position[2]);
      _tempQuat.set(
        item.quaternion[0],
        item.quaternion[1],
        item.quaternion[2],
        item.quaternion[3]
      );
      this.config.interpolator.animateTo(win.card, {
        position: _tempVec,
        quaternion: _tempQuat,
        scale: item.scale || 1,
      });
    }
    this.config.onLog?.('INFO', 'Позиции окон восстановлены из манифеста');
  }

  /**
   * Мгновенно восстанавливает сохранённые позиции, повороты, масштабы и открытость окон
   * из `WorkspaceLocalStorageManager` при старте рабочего стола.
   */
  restorePersistedWindows(
    transforms: readonly SavedWindowTransform[],
    activeWindowId?: SpatialAppId
  ): void {
    for (const item of transforms) {
      const win = this.windows.get(item.id);
      if (!win) continue;
      this.config.interpolator.cancelFor(win.card);
      win.card.visible = item.visible;
      win.minimized = !item.visible;
      win.pinnedSurfaceId = item.pinnedSurfaceId;
      this.refreshPinVisuals(win);
      win.card.position.set(
        item.position[0],
        item.position[1],
        item.position[2]
      );
      win.card.quaternion.set(
        item.quaternion[0],
        item.quaternion[1],
        item.quaternion[2],
        item.quaternion[3]
      );
      win.card.scale.setScalar(item.scale || 1);
    }

    if (activeWindowId && this.windows.has(activeWindowId)) {
      const target = this.windows.get(activeWindowId)!;
      if (target.card.visible) {
        this.focusWindow(activeWindowId);
      }
    }
    this.config.onLog?.(
      'INFO',
      `Восстановлено ${transforms.length} окон из локального хранилища`
    );
  }

  /**
   * Плавно применяет встроенный или пользовательский пресет раскладки.
   */
  applySavedPreset(preset: SavedLayoutPreset): void {
    let firstVisibleId: SpatialAppId | null = null;
    for (const item of preset.windows) {
      const win = this.windows.get(item.id);
      if (!win) continue;
      win.card.visible = item.visible;
      win.minimized = !item.visible;
      win.pinnedSurfaceId = item.pinnedSurfaceId;
      this.refreshPinVisuals(win);
      if (item.visible && !firstVisibleId) {
        firstVisibleId = item.id;
      }
      _tempVec.set(item.position[0], item.position[1], item.position[2]);
      _tempQuat.set(
        item.quaternion[0],
        item.quaternion[1],
        item.quaternion[2],
        item.quaternion[3]
      );
      this.config.interpolator.animateTo(win.card, {
        position: _tempVec,
        quaternion: _tempQuat,
        scale: item.scale || 1,
      });
    }
    if (firstVisibleId) {
      this.focusWindow(firstVisibleId);
    }
    this.config.onLog?.(
      'INFO',
      `Применён профиль раскладки "${preset.name}"`
    );
    this.config.onWorkspaceChanged?.();
  }

  private pinWindowToResult(
    win: ManagedSpatialWindow,
    surfaceId: string,
    surfaceTitle: string,
    position: THREE.Vector3,
    quaternion: THREE.Quaternion
  ): void {
    win.pinnedSurfaceId = surfaceId;
    this.refreshPinVisuals(win);
    this.config.interpolator.animateTo(win.card, {
      position,
      quaternion,
    });
    this.config.onWindowManipulated?.(
      'pin',
      `Окно "${win.title}" закреплено: ${surfaceTitle}`
    );
    this.config.onLog?.(
      'INFO',
      `Окно "${win.title}" закреплено на поверхности: ${surfaceTitle}`
    );
    this.config.onWorkspaceChanged?.();
  }

  private refreshPinVisuals(win: ManagedSpatialWindow): void {
    const pinned = Boolean(win.pinnedSurfaceId);
    win.pinBadge.text = pinned ? `PIN: ${win.pinnedSurfaceId}` : '3D FREE';
    win.pinBadge.style.color = pinned ? '#38bdf8' : '#cbd5e1';
    win.pinButton.icon = pinned ? 'pin_off' : 'push_pin';
    win.pinButton.ariaLabel = pinned
      ? `Открепить ${win.title}`
      : `Прикрепить ${win.title} к стене`;
  }

  private createManagedWindow(spec: SpatialWindowCreateInput): void {
    const built = buildAppWindowContent(spec.id, this.config.contentActions);

    const pinBadge = new xb.UIText({
      text: '3D FREE',
      style: {fontSize: 13, color: '#cbd5e1', opacity: 0.9},
    });

    const pinButton = new xb.UIButton({
      icon: 'push_pin',
      ariaLabel: `Прикрепить ${spec.title} к стене`,
      style: {width: 40, height: 40, padding: 0},
      onClick: () => {
        this.focusWindow(spec.id);
        this.togglePinWindow(spec.id);
      },
    });

    const closeButton = new xb.UIButton({
      icon: 'close',
      ariaLabel: `Скрыть ${spec.title}`,
      style: {width: 40, height: 40, padding: 0},
      onClick: () => {
        this.toggleWindowVisibility(spec.id);
      },
    });

    const titleBar = new xb.UIPanel({
      style: {
        width: '100%',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
        paddingBottom: 6,
      },
      children: [
        new xb.UIPanel({
          style: {
            flexGrow: 1,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
          },
          children: [
            new xb.UIIcon({
              icon: spec.icon,
              style: {width: 26, height: 26, color: '#38bdf8'},
            }),
            new xb.UIPanel({
              style: {flexDirection: 'column', gap: 2},
              children: [
                new xb.UIText({
                  text: spec.title,
                  style: {fontSize: 20, fontWeight: 'bold'},
                }),
                pinBadge,
              ],
            }),
          ],
        }),
        new xb.UIPanel({
          style: {flexDirection: 'row', gap: 6, alignItems: 'center'},
          children: [pinButton, closeButton],
        }),
      ],
    });

    const card = new xb.UICard({
      size: {width: spec.widthMeters, height: spec.heightMeters},
      manipulation: true,
      edge: true,
      style: {
        flexDirection: 'column',
        gap: 12,
        padding: 18,
      },
      children: [titleBar, ...built.children],
    });

    card.name = `Window_${spec.id}`;
    card.position.copy(spec.initialPosition);
    if (spec.initialRotationY) {
      card.rotation.y = spec.initialRotationY;
    }

    const managed: ManagedSpatialWindow = {
      id: spec.id,
      title: spec.title,
      card,
      pinBadge,
      pinButton,
      pinnedSurfaceId: null,
      minimized: false,
      lastActiveTimestamp: 0,
      bindings: built.bindings,
    };

    this.windows.set(spec.id, managed);
    this.add(card);

    if (built.companionModel) {
      this.add(built.companionModel.viewer);
      this.companions.push({
        window: managed,
        attachment: built.companionModel,
      });
    }
  }

  private findWindowByCard(
    owner: THREE.Object3D
  ): ManagedSpatialWindow | undefined {
    for (const win of this.windows.values()) {
      if (win.card === owner) return win;
    }
    return undefined;
  }

  override dispose(): void {
    this.config.interpolator.clear();
    this.windows.clear();
    this.companions.length = 0;
  }
}
