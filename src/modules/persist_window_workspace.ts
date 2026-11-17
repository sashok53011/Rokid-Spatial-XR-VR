import type {
  ManagedSpatialWindow,
  PersistedWorkspaceState,
  SavedWindowTransform,
  WorkspaceEnvironmentState,
} from '../types/spatial_contracts.ts';

/**
 * ============================================================================
 * МОДУЛЬ: persist_window_workspace.ts (Менеджер локального сохранения окон)
 * ============================================================================
 * НАЗНАНИЕ:
 *   Автоматически сохраняет в `localStorage` последние известные координаты
 *   (позиция XYZ, поворот quaternion), масштаб (`scale`), видимость (`visible`)
 *   и привязку к поверхности (`pinnedSurfaceId`) всех открытых/скрытых 3D-окон,
 *   а также состояние настроек среды, чтобы при следующем запуске конфигурация
 *   рабочего стола мгновенно восстанавливалась.
 *
 * ВХОДНЫЕ ДАННЫЕ:
 *   - `captureState(envState, windows)`: формирует снимок `PersistedWorkspaceState`.
 *   - `scheduleSave(envState, windows)`: отложенное (debounce) сохранение.
 *   - `saveNow(envState, windows)`: немедленная запись в `localStorage`.
 *   - `attachLifecycleFlush(provider)`: автосохранение перед закрытием вкладки.
 *
 * ВЫХОДНЫЕ ДАННЫЕ:
 *   - `load()`: возвращает сохранённый `PersistedWorkspaceState | null`.
 *   - `clear()`: очищает сохранённую конфигурацию.
 *
 * КАК ПОЛЬЗОВАТЬСЯ:
 *   const storageMgr = new WorkspaceLocalStorageManager({
 *     onLog: (lvl, msg) => monitor.log(lvl, 'PERSIST', msg),
 *   });
 *   const restored = storageMgr.load();
 *   storageMgr.attachLifecycleFlush(() => ({ state: this.state, windows: this.windowManager.getWindows() }));
 *
 * ЗАГЛУШКИ (STUB) И ЗАМЕНА В ПРОДАКШНЕ:
 *   - ЗАГЛУШКА (STUB): использует синхронное локальное хранилище браузера
 *     (`window.localStorage`) под ключом `rokid_spatial_workspace_state_v2`.
 *   - КАК ЗАМЕНИТЬ В ПРОДАКШНЕ: подмените методы `saveNow` / `load` на работу с
 *     IndexedDB, профилем пользователя `rokid-spatial-studio-xr` или файловым
 *     хранилищем демона `rokid-spatial-host`.
 * ============================================================================
 */

const LOCAL_WORKSPACE_STORAGE_KEY = 'rokid_spatial_workspace_state_v2';

export interface WorkspacePersistenceConfig {
  readonly debounceMs?: number;
  readonly onLog?: (level: 'DEBUG' | 'INFO' | 'WARN', message: string) => void;
}

export interface WorkspaceSnapshotProvider {
  (): {
    state: WorkspaceEnvironmentState;
    windows: readonly ManagedSpatialWindow[];
  };
}

export class WorkspaceLocalStorageManager {
  private readonly debounceMs: number;
  private readonly config: WorkspacePersistenceConfig;

  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private snapshotProvider: WorkspaceSnapshotProvider | null = null;
  private lifecycleAttached = false;
  private lastSavedSummary = 'Не сохранялось';

  constructor(config: WorkspacePersistenceConfig = {}) {
    this.config = config;
    this.debounceMs = config.debounceMs ?? 240;
  }

  captureState(
    env: WorkspaceEnvironmentState,
    windows: readonly ManagedSpatialWindow[]
  ): PersistedWorkspaceState {
    const windowTransforms: SavedWindowTransform[] = windows.map((w) => ({
      id: w.id,
      visible: w.card.visible,
      pinnedSurfaceId: w.pinnedSurfaceId,
      position: [
        Number(w.card.position.x.toFixed(4)),
        Number(w.card.position.y.toFixed(4)),
        Number(w.card.position.z.toFixed(4)),
      ],
      quaternion: [
        Number(w.card.quaternion.x.toFixed(5)),
        Number(w.card.quaternion.y.toFixed(5)),
        Number(w.card.quaternion.z.toFixed(5)),
        Number(w.card.quaternion.w.toFixed(5)),
      ],
      scale: Number(w.card.scale.x.toFixed(3)),
    }));

    return {
      schema: 'rokid-spatial-local-workspace/v2',
      savedAtIso: new Date().toISOString(),
      activeWindowId: env.activeWindowId,
      layoutMode: env.layoutMode,
      theme: env.theme,
      rokidMode: env.rokidMode,
      placeId: env.placeId,
      skyDomeEnabled: env.skyDomeEnabled,
      screens360Visible: env.screens360Visible,
      wallsVisible: env.wallsVisible,
      hudVisible: env.hudVisible,
      gestureGuideVisible: env.gestureGuideVisible,
      sceneSelectorVisible: env.sceneSelectorVisible,
      layoutEditorVisible: env.layoutEditorVisible,
      activeLayoutPresetId: env.activeLayoutPresetId,
      spatialAudioEnabled: env.spatialAudioEnabled,
      spatialAudioVolume: env.spatialAudioVolume,
      cameraLightingEnabled: env.cameraLightingEnabled,
      lightingPreset: env.lightingPreset,
      depthMaskEnabled: env.depthMaskEnabled,
      depthOccluderSimVisible: env.depthOccluderSimVisible,
      eyeTrackingEnabled: env.eyeTrackingEnabled,
      cameraHandTrackingEnabled: env.cameraHandTrackingEnabled,
      cameraHandFacingMode: env.cameraHandFacingMode,
      sbsEnabled: env.sbsEnabled,
      sbsIpdMm: env.sbsIpdMm,
      sbsAspectMode: env.sbsAspectMode,
      vrPreferredMode: env.vrPreferredMode,
      androidCameraPanelVisible: env.androidCameraPanelVisible,
      windows: windowTransforms,
    };
  }

  scheduleSave(
    env: WorkspaceEnvironmentState,
    windows: readonly ManagedSpatialWindow[]
  ): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.saveNow(env, windows, true);
    }, this.debounceMs);
  }

  saveNow(
    env: WorkspaceEnvironmentState,
    windows: readonly ManagedSpatialWindow[],
    quiet = false
  ): PersistedWorkspaceState | null {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    const payload = this.captureState(env, windows);
    try {
      localStorage.setItem(LOCAL_WORKSPACE_STORAGE_KEY, JSON.stringify(payload));
      const openCount = payload.windows.filter((w) => w.visible).length;
      this.lastSavedSummary = `${openCount}/${payload.windows.length} окон (${new Date().toLocaleTimeString()})`;
      if (!quiet) {
        this.config.onLog?.(
          'INFO',
          `Состояние окон сохранено в localStorage (${openCount} открыто)`
        );
      }
      return payload;
    } catch {
      this.config.onLog?.(
        'WARN',
        'Не удалось записать конфигурацию окон в localStorage'
      );
      return null;
    }
  }

  load(): PersistedWorkspaceState | null {
    try {
      const raw = localStorage.getItem(LOCAL_WORKSPACE_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as PersistedWorkspaceState;
      if (
        !parsed ||
        parsed.schema !== 'rokid-spatial-local-workspace/v2' ||
        !Array.isArray(parsed.windows)
      ) {
        return null;
      }
      const openCount = parsed.windows.filter((w) => w.visible).length;
      this.lastSavedSummary = `Загружено ${openCount}/${parsed.windows.length} окон`;
      this.config.onLog?.(
        'INFO',
        `Восстановлена последняя конфигурация рабочего стола (${openCount} открытых окон)`
      );
      return parsed;
    } catch {
      return null;
    }
  }

  clear(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    try {
      localStorage.removeItem(LOCAL_WORKSPACE_STORAGE_KEY);
      this.lastSavedSummary = 'Очищено';
      this.config.onLog?.('INFO', 'Локальная конфигурация окон сброшена');
    } catch {
      // Игнорируем ошибку в приватном режиме.
    }
  }

  getLastSavedSummary(): string {
    return this.lastSavedSummary;
  }

  attachLifecycleFlush(provider: WorkspaceSnapshotProvider): void {
    this.snapshotProvider = provider;
    if (this.lifecycleAttached) return;
    window.addEventListener('beforeunload', this.handleBeforeUnload);
    window.addEventListener('pagehide', this.handleBeforeUnload);
    this.lifecycleAttached = true;
  }

  detach(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.lifecycleAttached) {
      window.removeEventListener('beforeunload', this.handleBeforeUnload);
      window.removeEventListener('pagehide', this.handleBeforeUnload);
      this.lifecycleAttached = false;
    }
    this.snapshotProvider = null;
  }

  private readonly handleBeforeUnload = (): void => {
    if (!this.snapshotProvider) return;
    const {state, windows} = this.snapshotProvider();
    this.saveNow(state, windows, true);
  };
}
