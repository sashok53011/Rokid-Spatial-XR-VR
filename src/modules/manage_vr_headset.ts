import type * as THREE from 'three';
import * as xb from 'xrblocks';

import type {
  VrHeadsetPreferredMode,
  VrHeadsetSnapshot,
} from '../types/spatial_contracts.ts';
import {
  type HeadsetCapabilityReport,
  setSavedVrPreferredMode,
  toggleXRDisplayMode,
} from './configure_xr_workspace.ts';

/**
 * ============================================================================
 * МОДУЛЬ: manage_vr_headset.ts (Поддержка VR-гарнитур и контроллеров)
 * ============================================================================
 * НАЗНАЧЕНИЕ:
 *   Обеспечивает полноценную совместимость с VR-гарнитурами (Meta Quest,
 *   Pico, HTC Vive, Valve Index / PCVR, Google Cardboard VR):
 *   1. Отслеживает возможности `navigator.xr` (`immersive-vr` и `immersive-ar`)
 *      и состояние активной WebXR-сессии.
 *   2. Автоматически активирует 360°-купол, лучи контроллеров и безопасную
 *      конфигурацию без обязательного `depth-sensing` при входе в `immersive-vr`.
 *   3. Считывает оси стиков (thumbsticks) физических VR-контроллеров в реальном
 *      времени для плавного сдвига активного окна по XYZ и масштабирования
 *      (Zero-GC опрос `session.inputSources` без выделений памяти).
 *   4. Позволяет напрямую запускать сессию `immersive-vr` (или переключать
 *      предпочтительный режим запуска `auto | immersive-vr | immersive-ar`).
 *
 * ВХОДНЫЕ ДАННЫЕ:
 *   - `VrHeadsetConfig`: начальный `HeadsetCapabilityReport`, коллбеки
 *     сдвига/масштаба окна (`onMoveActiveWindow`, `onScaleActiveWindow`),
 *     переключения сцены (`onNextPlace`, `onPrevPlace`), активации 360°-купола
 *     (`onEnsureVrSkyDome`) и отладочного лога.
 *
 * ВЫХОДНЫЕ ДАННЫЕ:
 *   - `getSnapshot()`, `enterVrHeadset()`, `setPreferredMode(mode)`,
 *     `cyclePreferredMode()`.
 *
 * ЗАГЛУШКИ (STUB) И ЗАМЕНА В ПРОДАКШНЕ:
 *   - ЗАГЛУШКА (STUB): на десктопе или устройстве без WebXR VR-драйвера
 *     попытка входа в VR-гарнитуру корректно переводит сцену в студийный
 *     VR-симулятор с 360°-куполом (и без `window.alert`).
 *   - КАК ЗАМЕНИТЬ В ПРОДАКШНЕ: откройте приложение в браузере внутри Quest /
 *     Pico / SteamVR или Android Cardboard XR — при наличии `immersive-vr`
 *     `enterVrHeadset()` запросит нативную сессию WebXR напрямую.
 * ============================================================================
 */

export interface VrHeadsetConfig {
  readonly capabilityReport?: HeadsetCapabilityReport;
  readonly onMoveActiveWindow?: (dx: number, dy: number, dz: number) => void;
  readonly onScaleActiveWindow?: (deltaScale: number) => void;
  readonly onEnsureVrSkyDome?: () => void;
  readonly onEnableSbsFallback?: () => void;
  readonly onSnapshotChange?: (snapshot: VrHeadsetSnapshot) => void;
  readonly onLog?: (level: 'INFO' | 'WARN' | 'DEBUG', message: string) => void;
}

const DEADZONE = 0.18;

export class VrHeadsetSupportController extends xb.Script {
  private readonly config: VrHeadsetConfig;
  private preferredMode: VrHeadsetPreferredMode;
  private configuredSessionMode: 'immersive-vr' | 'immersive-ar';
  private xrSupportedVr: boolean;
  private xrSupportedAr: boolean;
  private isPresenting = false;
  private controllerCount = 0;
  private hasThumbstickAxes = false;
  private headsetLabel = 'Проверка WebXR...';
  private lastSampleMs = 0;

  constructor(config: VrHeadsetConfig = {}) {
    super();
    this.config = config;
    this.preferredMode = config.capabilityReport?.preferredMode ?? 'auto';
    this.configuredSessionMode =
      config.capabilityReport?.configuredSessionMode ?? 'immersive-ar';
    this.xrSupportedVr = config.capabilityReport?.supportsVr ?? false;
    this.xrSupportedAr = config.capabilityReport?.supportsAr ?? false;
    this.updateHeadsetLabel();
  }

  override init(): void {
    void this.refreshCapabilities();
    this.config.onLog?.(
      'INFO',
      `VR Headset модуль: AR=${this.xrSupportedAr ? 'YES' : 'NO'}, VR=${this.xrSupportedVr ? 'YES' : 'NO'}, сессия=${this.configuredSessionMode}`
    );
    this.emitSnapshot();
  }

  override onXRSessionStarted(session?: XRSession): void {
    this.isPresenting = true;
    const mode =
      (xb.core?.options?.xrSessionMode as 'immersive-vr' | 'immersive-ar') ??
      this.configuredSessionMode;

    // В VR-гарнитуре включаем 360°-небосвод и лучи контроллеров по умолчанию.
    if (
      mode === 'immersive-vr' ||
      session?.environmentBlendMode === 'opaque'
    ) {
      this.config.onEnsureVrSkyDome?.();
    }
    this.updateHeadsetLabel();
    this.emitSnapshot();
    this.config.onLog?.(
      'INFO',
      `WebXR гарнитура подключена (${mode}, blend=${session?.environmentBlendMode ?? 'default'})`
    );
  }

  override onXRSessionEnded(): void {
    this.isPresenting = false;
    this.controllerCount = 0;
    this.hasThumbstickAxes = false;
    this.updateHeadsetLabel();
    this.emitSnapshot();
  }

  override update(): void {
    const renderer = xb.core?.renderer;
    const session = renderer?.xr?.getSession?.();
    if (!session || !renderer?.xr?.isPresenting) return;

    const now = performance.now();
    if (now - this.lastSampleMs < 24) return;
    const dt = Math.min((now - this.lastSampleMs) * 0.001 || 0.024, 0.05);
    this.lastSampleMs = now;

    let trackedCount = 0;
    let foundAxes = false;

    for (const source of session.inputSources) {
      if (
        source.targetRayMode === 'tracked-pointer' ||
        source.handedness !== 'none'
      ) {
        trackedCount++;
      }

      const gp = source.gamepad;
      if (!gp || !gp.axes || gp.axes.length < 2) continue;

      // Стандарт WebXR Gamepad ('xr-standard'): axes[2], axes[3] — стик (fallback на [0], [1]).
      const ax = gp.axes.length >= 4 ? gp.axes[2] : gp.axes[0];
      const ay = gp.axes.length >= 4 ? gp.axes[3] : gp.axes[1];
      if (Math.abs(ax) > DEADZONE || Math.abs(ay) > DEADZONE) {
        foundAxes = true;
        const gripPressed = gp.buttons?.[1]?.pressed ?? false;
        if (source.handedness === 'left') {
          // Левый стик: глубина Z и горизонталь X (или масштаб при зажатом Grip).
          if (gripPressed) {
            this.config.onScaleActiveWindow?.(-ay * dt * 0.85);
          } else {
            this.config.onMoveActiveWindow?.(
              ax * dt * 0.9,
              0,
              ay * dt * 0.9
            );
          }
        } else {
          // Правый стик: сдвиг X/Y активного окна в пространстве.
          this.config.onMoveActiveWindow?.(
            ax * dt * 1.1,
            -ay * dt * 1.1,
            0
          );
        }
      }
    }

    if (
      trackedCount !== this.controllerCount ||
      foundAxes !== this.hasThumbstickAxes
    ) {
      this.controllerCount = trackedCount;
      this.hasThumbstickAxes = foundAxes;
      this.emitSnapshot();
    }
  }

  getSnapshot(): VrHeadsetSnapshot {
    const activeSessionMode = this.isPresenting
      ? this.configuredSessionMode
      : 'simulator';
    return {
      preferredMode: this.preferredMode,
      configuredSessionMode: this.configuredSessionMode,
      activeSessionMode,
      xrSupportedVr: this.xrSupportedVr,
      xrSupportedAr: this.xrSupportedAr,
      isPresenting: this.isPresenting,
      controllerCount: this.controllerCount,
      hasThumbstickAxes: this.hasThumbstickAxes,
      headsetLabel: this.headsetLabel,
    };
  }

  setPreferredMode(mode: VrHeadsetPreferredMode): VrHeadsetPreferredMode {
    this.preferredMode = mode;
    setSavedVrPreferredMode(mode);
    this.updateHeadsetLabel();
    this.emitSnapshot();
    this.config.onLog?.(
      'INFO',
      `Предпочтительный режим WebXR сохранён: ${mode} (будет использован для immersive-сессии)`
    );
    return mode;
  }

  /**
   * Запускает сессию VR-гарнитуры (`immersive-vr`), если браузер её поддерживает;
   * иначе корректно включает VR-студию с 360°-куполом и опционально SBS-стерео.
   */
  async enterVrHeadset(): Promise<'vr-session' | 'vr-simulator-sbs'> {
    await this.refreshCapabilities();

    const renderer = xb.core?.renderer as THREE.WebGLRenderer | undefined;
    if (
      this.xrSupportedVr &&
      typeof navigator !== 'undefined' &&
      navigator.xr &&
      renderer?.xr
    ) {
      try {
        const current = renderer.xr.getSession();
        if (current) {
          await current.end();
        }
        const session = await navigator.xr.requestSession('immersive-vr', {
          optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'],
        });
        this.configuredSessionMode = 'immersive-vr';
        setSavedVrPreferredMode('immersive-vr');
        this.preferredMode = 'immersive-vr';
        await renderer.xr.setSession(session);
        this.isPresenting = true;
        this.config.onEnsureVrSkyDome?.();
        this.updateHeadsetLabel();
        this.emitSnapshot();
        this.config.onLog?.(
          'INFO',
          'Запущена нативная WebXR VR-сессия (immersive-vr)'
        );
        return 'vr-session';
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.config.onLog?.(
          'WARN',
          `Не удалось открыть нативную VR-сессию (${msg}) — включаю VR-студию + SBS`
        );
      }
    } else {
      this.config.onLog?.(
        'WARN',
        'Нативная WebXR VR-гарнитура не обнаружена — активирована VR-студия и режим SBS 3D'
      );
    }

    // ЗАГЛУШКА (STUB) на десктопе: переводим фон в VR и активируем SBS для Cardboard/HMD-просмотра.
    this.setPreferredMode('immersive-vr');
    toggleXRDisplayMode('VR');
    this.config.onEnsureVrSkyDome?.();
    this.config.onEnableSbsFallback?.();
    return 'vr-simulator-sbs';
  }

  private async refreshCapabilities(): Promise<void> {
    if (typeof navigator === 'undefined' || !('xr' in navigator) || !navigator.xr) {
      return;
    }
    try {
      this.xrSupportedAr = await navigator.xr.isSessionSupported('immersive-ar');
    } catch {
      this.xrSupportedAr = false;
    }
    try {
      this.xrSupportedVr = await navigator.xr.isSessionSupported('immersive-vr');
    } catch {
      this.xrSupportedVr = false;
    }
    this.updateHeadsetLabel();
    this.emitSnapshot();
  }

  private updateHeadsetLabel(): void {
    if (this.isPresenting) {
      this.headsetLabel =
        this.configuredSessionMode === 'immersive-vr'
          ? 'Active VR Headset'
          : 'Active AR Glasses';
      return;
    }
    if (this.xrSupportedVr && this.xrSupportedAr) {
      this.headsetLabel = 'AR + VR Ready';
    } else if (this.xrSupportedVr) {
      this.headsetLabel = 'VR Headset Ready';
    } else if (this.xrSupportedAr) {
      this.headsetLabel = 'Android AR Ready';
    } else {
      this.headsetLabel = 'Desktop / SBS Sim';
    }
  }

  private emitSnapshot(): void {
    this.config.onSnapshotChange?.(this.getSnapshot());
  }
}
