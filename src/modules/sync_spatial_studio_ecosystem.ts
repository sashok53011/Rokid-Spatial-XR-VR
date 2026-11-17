import type {
  ManagedSpatialWindow,
  StudioSceneManifest,
  WorkspaceEnvironmentState,
} from '../types/spatial_contracts.ts';

/**
 * ============================================================================
 * МОДУЛЬ: sync_spatial_studio_ecosystem.ts (Интеграция с rokid-spatial-studio-xr)
 * ============================================================================
 * НАЗНАЧЕНИЕ:
 *   Реализует обмен состоянием пространственного рабочего стола с экосистемой
 *   `rokid-spatial-studio-xr` (https://github.com/sashok53011/rokid-spatial-studio-xr):
 *   сериализация 3D-позиций окон, привязок к виртуальным стенам, активной темы,
 *   и оптического профиля в стандартный JSON-манифест `rokid-spatial-studio-xr/v1`.
 *
 * ВХОДНЫЕ ДАННЫЕ:
 *   - `buildManifest(envState, windows)`: текущее состояние среды и массив окон.
 *   - `saveLocalWorkspace(manifest)`: сохранение снимка в `localStorage`.
 *   - `loadLocalWorkspace()`: чтение сохранённого снимка при запуске.
 *   - `publishToStudioBus(manifest)`: рассылка снимка внешним инспекторам Studio XR.
 *
 * ВЫХОДНЫЕ ДАННЫЕ:
 *   - `StudioSceneManifest | null`: валидный манифест сцены.
 *
 * КАК ПОЛЬЗОВАТЬСЯ:
 *   const studioSync = new SpatialStudioEcosystemSync({
 *     onLog: (msg) => monitor.log('INFO', 'STUDIO', msg),
 *   });
 *   const manifest = studioSync.buildManifest(envState, windows);
 *   studioSync.saveLocalWorkspace(manifest);
 *
 * ЗАГЛУШКИ (STUB) И ЗАМЕНА В ПРОДАКШНЕ:
 *   - `publishToStudioBus` транслирует манифест через локальный `BroadcastChannel`
 *     и сохраняет его в `localStorage` под ключом `rokid_spatial_studio_manifest_v1`.
 *   - КАК ЗАМЕНИТЬ В ПРОДАКШНЕ: подключите HTTP/REST или WebSocket эндпоинт
 *     сервера `rokid-spatial-studio-xr` (например, `POST /api/studio/scenes/sync`)
 *     для синхронизации рабочих столов между устройствами пользователя.
 * ============================================================================
 */

const STORAGE_KEY = 'rokid_spatial_studio_manifest_v1';
const STUDIO_CHANNEL_NAME = 'rokid-spatial-studio-xr-sync';

export interface SpatialStudioSyncConfig {
  readonly onExternalManifest?: (manifest: StudioSceneManifest) => void;
  readonly onLog?: (message: string) => void;
}

export class SpatialStudioEcosystemSync {
  private readonly onExternalManifest?: (manifest: StudioSceneManifest) => void;
  private readonly onLog?: (message: string) => void;
  private channel: BroadcastChannel | null = null;

  constructor(config: SpatialStudioSyncConfig = {}) {
    this.onExternalManifest = config.onExternalManifest;
    this.onLog = config.onLog;

    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(STUDIO_CHANNEL_NAME);
      this.channel.onmessage = (event: MessageEvent<StudioSceneManifest>) => {
        if (event.data?.schema === 'rokid-spatial-studio-xr/v1') {
          this.onExternalManifest?.(event.data);
          this.onLog?.('Получено обновление манифеста от rokid-spatial-studio-xr');
        }
      };
    }
  }

  /**
   * Формирует снимок 3D-рабочего пространства по схеме `rokid-spatial-studio-xr/v1`.
   */
  buildManifest(
    envState: WorkspaceEnvironmentState,
    windows: readonly ManagedSpatialWindow[]
  ): StudioSceneManifest {
    return {
      schema: 'rokid-spatial-studio-xr/v1',
      savedAtIso: new Date().toISOString(),
      layoutMode: envState.layoutMode,
      theme: envState.theme,
      rokidMode: envState.rokidMode,
      placeId: envState.placeId,
      skyDomeEnabled: envState.skyDomeEnabled,
      screens360Visible: envState.screens360Visible,
      wallsVisible: envState.wallsVisible,
      hudVisible: envState.hudVisible,
      gestureGuideVisible: envState.gestureGuideVisible,
      sceneSelectorVisible: envState.sceneSelectorVisible,
      layoutEditorVisible: envState.layoutEditorVisible,
      activeLayoutPresetId: envState.activeLayoutPresetId,
      spatialAudioEnabled: envState.spatialAudioEnabled,
      windows: windows.map((win) => ({
        id: win.id,
        visible: win.card.visible,
        pinnedSurfaceId: win.pinnedSurfaceId,
        position: [
          Number(win.card.position.x.toFixed(3)),
          Number(win.card.position.y.toFixed(3)),
          Number(win.card.position.z.toFixed(3)),
        ],
        quaternion: [
          Number(win.card.quaternion.x.toFixed(4)),
          Number(win.card.quaternion.y.toFixed(4)),
          Number(win.card.quaternion.z.toFixed(4)),
          Number(win.card.quaternion.w.toFixed(4)),
        ],
        scale: Number(win.card.scale.x.toFixed(3)),
      })),
    };
  }

  /**
   * Сохраняет манифест в `localStorage` и публикует в шину Studio XR.
   */
  saveAndPublish(manifest: StudioSceneManifest): boolean {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(manifest));
      this.channel?.postMessage(manifest);
      this.onLog?.(
        `Сцена синхронизирована (${manifest.windows.length} окон, режим ${manifest.layoutMode})`
      );
      return true;
    } catch (error) {
      this.onLog?.(`Ошибка сохранения манифеста: ${String(error)}`);
      return false;
    }
  }

  /**
   * Загружает последний сохранённый манифест рабочего стола, если он валиден.
   */
  loadSavedManifest(): StudioSceneManifest | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<StudioSceneManifest>;
      if (
        parsed.schema !== 'rokid-spatial-studio-xr/v1' ||
        !Array.isArray(parsed.windows)
      ) {
        return null;
      }
      return parsed as StudioSceneManifest;
    } catch {
      return null;
    }
  }

  /**
   * Очищает сохранённый снимок рабочего стола (для полного сброса раскладки).
   */
  clearSavedManifest(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
      this.onLog?.('Сохранённый снимок Studio XR сброшен');
    } catch {
      // Игнорируем ошибку доступа к storage в приватном режиме.
    }
  }

  dispose(): void {
    this.channel?.close();
    this.channel = null;
  }
}
