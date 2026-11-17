import * as THREE from 'three';
import * as xb from 'xrblocks';

import type {
  AndroidCameraBackend,
  AndroidCameraSnapshot,
} from '../types/spatial_contracts.ts';

/**
 * ============================================================================
 * МОДУЛЬ: manage_android_camera.ts (Менеджер камеры Android XR и устройств)
 * ============================================================================
 * НАЗНАЧЕНИЕ:
 *   Обеспечивает полную видимость, контроль и работоспособность камеры Android
 *   внутри пространственного рабочего стола:
 *   1. Интеграция с `xb.core.deviceCamera` (`XRDeviceCamera`) — как стандартного
 *      потока Android Chrome `getUserMedia` (`facingMode: 'environment' | 'user'`),
 *      так и нативного WebXR Raw Camera Access API (`camera-access` для Android XR).
 *   2. Перечисление всех объективов Android (`Main Rear`, `Ultrawide`, `Front`,
 *      `Simulator Camera`) и переключение кнопками/командами.
 *   3. Захват снимка кадра (`captureSnapshot()`) через универсальный асинхронный
 *      API `deviceCamera.captureSnapshot()` (работает и для GPU WebXR `camera-access`).
 *   4. Пространственная карточка `xb.UICard` (`Android Camera Feed`, клавиша `O`)
 *      с живой видео-текстурой, метаданными разрешения/бэкенда и кнопками.
 *
 * ВХОДНЫЕ ДАННЫЕ:
 *   - `AndroidCameraConfig`: начальная видимость панели, коллбеки обновления
 *     снимка состояния и отладочного лога.
 *
 * ВЫХОДНЫЕ ДАННЫЕ:
 *   - `startOrShow()`, `togglePanel()`, `flipFacingMode()`, `cycleCameraLens()`,
 *     `capturePhotoSnapshot()`, `getSnapshot()`.
 *
 * ЗАГЛУШКИ (STUB) И ЗАМЕНА В ПРОДАКШНЕ:
 *   - ЗАГЛУШКА (STUB): если приложение запущено в headless-среде или на ПК
 *     без веб-камеры / с запрещённым доступом (`no_devices_found` / `error`),
 *     на холсте предпросмотра рисуется диагностический тест-паттерн пастру
 *     Android XR, чтобы интерфейс оставался полностью проверяемым.
 *   - КАК ЗАМЕНИТЬ В ПРОДАКШНЕ: на Android-смартфоне или гарнитуре Android XR
 *     разрешите доступ к камере — `xb.core.deviceCamera` автоматически подключит
 *     заднюю камеру (`environment`) или `XRWebGLBinding.getCameraImage()`.
 * ============================================================================
 */

export interface AndroidCameraConfig {
  readonly initialPanelVisible?: boolean;
  readonly onSnapshotChange?: (snapshot: AndroidCameraSnapshot) => void;
  readonly onLog?: (level: 'INFO' | 'WARN' | 'DEBUG', message: string) => void;
}

const PREVIEW_W = 420;
const PREVIEW_H = 236;

export class AndroidCameraController extends xb.Script {
  private readonly config: AndroidCameraConfig;

  private card!: xb.UICard;
  private previewImage!: xb.UIImage;
  private statusBadge!: xb.UIText;
  private detailsText!: xb.UIText;
  private facingBtn!: xb.UIButton;
  private snapBtn!: xb.UIButton;

  private stubCanvas!: HTMLCanvasElement;
  private stubCtx!: CanvasRenderingContext2D;
  private stubTexture!: THREE.CanvasTexture;
  private stubPhase = 0;

  private panelVisible: boolean;
  private currentFacing: 'environment' | 'user' = 'environment';
  private initializedStream = false;
  private boundDeviceCamera: xb.XRDeviceCamera | null = null;

  private readonly snapshot: AndroidCameraSnapshot = {
    backend: 'stub-unavailable',
    streamState: 'idle',
    deviceLabel: 'Ожидание инициализации',
    deviceCount: 0,
    deviceIndex: -1,
    width: 0,
    height: 0,
    panelVisible: false,
    lastSnapshotAtIso: null,
  };

  constructor(config: AndroidCameraConfig = {}) {
    super();
    this.config = config;
    this.panelVisible = config.initialPanelVisible ?? false;
    this.snapshot.panelVisible = this.panelVisible;
  }

  override init(): void {
    this.buildStubTexture();
    this.buildCard();
    this.bindDeviceCameraListener();
    this.refreshState();

    // На десктопе/Android вне WebXR-сессии при открытии панели сразу пробуем инициализировать камеру.
    if (this.panelVisible) {
      void this.ensureStarted();
    }
    this.config.onLog?.(
      'INFO',
      'Модуль Android Camera (environment/camera-access) готов (клавиша O)'
    );
  }

  override onXRSessionStarted(): void {
    this.bindDeviceCameraListener();
    this.refreshState();
  }

  override onSimulatorStarted(): void {
    this.bindDeviceCameraListener();
    this.refreshState();
  }

  override update(): void {
    if (!this.card?.visible) return;
    if (this.snapshot.backend === 'stub-unavailable') {
      const dt = Math.min(xb.getDeltaTime() || 0.016, 0.05);
      this.stubPhase += dt;
      this.drawStubFeed();
    }
  }

  isPanelVisible(): boolean {
    return this.card?.visible ?? this.panelVisible;
  }

  getSnapshot(): AndroidCameraSnapshot {
    return this.snapshot;
  }

  async togglePanel(): Promise<boolean> {
    this.panelVisible = !this.card.visible;
    this.card.visible = this.panelVisible;
    this.snapshot.panelVisible = this.panelVisible;
    if (this.panelVisible) {
      await this.ensureStarted();
    }
    this.refreshState();
    this.config.onLog?.(
      'INFO',
      this.panelVisible
        ? 'Панель камеры Android показана (O)'
        : 'Панель камеры Android скрыта'
    );
    return this.panelVisible;
  }

  setPanelVisible(visible: boolean): void {
    this.panelVisible = visible;
    this.snapshot.panelVisible = visible;
    if (this.card) {
      this.card.visible = visible;
    }
    if (visible) {
      void this.ensureStarted();
    }
  }

  async ensureStarted(): Promise<boolean> {
    const cam = xb.core?.deviceCamera;
    if (!cam) return false;
    this.bindDeviceCameraListener();
    if (cam.state === 'streaming') {
      this.refreshState();
      return true;
    }
    if (this.initializedStream && cam.state === 'initializing') {
      return false;
    }
    this.initializedStream = true;
    try {
      await cam.init();
      this.refreshState();
      return this.snapshot.streamState === 'streaming';
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.config.onLog?.(
        'WARN',
        `Android Camera fallback на Stub (${msg})`
      );
      this.refreshState();
      return false;
    }
  }

  async flipFacingMode(): Promise<'environment' | 'user'> {
    this.currentFacing =
      this.currentFacing === 'environment' ? 'user' : 'environment';
    const cam = xb.core?.deviceCamera;
    if (!cam) return this.currentFacing;
    try {
      await cam.setFacingMode(this.currentFacing);
      this.config.onLog?.(
        'INFO',
        `Камера Android переключена на: ${this.currentFacing === 'environment' ? 'Тыловая (environment)' : 'Фронтальная (user)'}`
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.config.onLog?.(
        'WARN',
        `Не удалось сменить сторону камеры Android: ${msg}`
      );
    }
    this.refreshState();
    return this.currentFacing;
  }

  async cycleCameraLens(): Promise<string> {
    const cam = xb.core?.deviceCamera;
    if (!cam) return 'unavailable';

    let devices = cam.getAvailableDevices();
    if (!devices || devices.length === 0) {
      devices = await cam.getAvailableVideoDevices();
    }
    if (!devices || devices.length <= 1) {
      return await this.flipFacingMode();
    }

    const currentIdx = cam.getCurrentDeviceIndex();
    const nextIdx = (currentIdx + 1 + devices.length) % devices.length;
    const nextDevice = devices[nextIdx];
    try {
      await cam.setDeviceId(nextDevice.deviceId);
      this.config.onLog?.(
        'INFO',
        `Выбран объектив Android #${nextIdx + 1}/${devices.length}: ${nextDevice.label || nextDevice.deviceId}`
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.config.onLog?.('WARN', `Ошибка выбора объектива: ${msg}`);
    }
    this.refreshState();
    return nextDevice.label || `Lens #${nextIdx + 1}`;
  }

  async capturePhotoSnapshot(): Promise<string | null> {
    const cam = xb.core?.deviceCamera;
    if (!cam || cam.state !== 'streaming') {
      this.snapshot.lastSnapshotAtIso = new Date().toISOString();
      this.drawStubFeed('SNAPSHOT CAPTURED (STUB)');
      this.refreshState();
      this.config.onLog?.(
        'WARN',
        'Сделан тестовый снимок Stub-камеры (реальная камера Android не активна)'
      );
      return null;
    }

    try {
      const dataUrl = await cam.captureSnapshot({
        outputFormat: 'base64',
        mimeType: 'image/jpeg',
        quality: 0.85,
        width: 640,
        height: 360,
      });
      this.snapshot.lastSnapshotAtIso = new Date().toISOString();
      this.refreshState();
      this.config.onLog?.(
        'INFO',
        `Снимок Android Camera сохранён (${this.snapshot.width}×${this.snapshot.height}, ${dataUrl ? Math.round(dataUrl.length / 1024) : 0} KB)`
      );
      return dataUrl;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.config.onLog?.('WARN', `Ошибка снимка Android Camera: ${msg}`);
      return null;
    }
  }

  private bindDeviceCameraListener(): void {
    const cam = xb.core?.deviceCamera;
    if (!cam || cam === this.boundDeviceCamera) return;
    if (this.boundDeviceCamera) {
      this.boundDeviceCamera.removeEventListener(
        'statechange',
        this.onDeviceCameraStateChange
      );
    }
    this.boundDeviceCamera = cam;
    cam.addEventListener('statechange', this.onDeviceCameraStateChange);
  }

  private readonly onDeviceCameraStateChange = (): void => {
    this.refreshState();
  };

  private refreshState(): void {
    const cam = xb.core?.deviceCamera;
    const state = cam?.state ?? 'idle';
    const devices = cam?.getAvailableDevices?.() ?? [];
    const activeDev = cam?.getCurrentDevice?.();
    const settings = cam?.getCurrentTrackSettings?.();
    const isStreaming = state === 'streaming';

    let backend: AndroidCameraBackend = 'stub-unavailable';
    if (isStreaming && cam) {
      if (cam.isUsingXRCameraAccess) {
        backend = 'webxr-camera-access';
      } else if (activeDev?.groupId === 'simulator') {
        backend = 'simulator-camera';
      } else if (
        settings?.facingMode === 'user' ||
        this.currentFacing === 'user'
      ) {
        backend = 'getusermedia-front';
      } else {
        backend = 'getusermedia-rear';
      }
    }

    this.snapshot.backend = backend;
    this.snapshot.streamState = state;
    this.snapshot.deviceLabel =
      activeDev?.label ||
      (cam?.isUsingXRCameraAccess
        ? 'WebXR Raw Camera Access (Android XR)'
        : state === 'no_devices_found'
          ? 'Камера не найдена (Stub)'
          : 'Android Rear Camera (environment)');
    this.snapshot.deviceCount = devices.length;
    this.snapshot.deviceIndex = cam?.getCurrentDeviceIndex?.() ?? -1;
    this.snapshot.width = cam?.width || 0;
    this.snapshot.height = cam?.height || 0;
    this.snapshot.panelVisible = this.card?.visible ?? this.panelVisible;

    if (this.previewImage) {
      if (isStreaming && cam?.texture) {
        this.previewImage.src = cam.texture;
      } else {
        this.previewImage.src = this.stubTexture;
        this.drawStubFeed();
      }
    }

    if (this.statusBadge) {
      const badgeLabelMap: Record<AndroidCameraBackend, string> = {
        'webxr-camera-access': 'XR CAMERA-ACCESS',
        'getusermedia-rear': 'ANDROID REAR LIVE',
        'getusermedia-front': 'ANDROID FRONT LIVE',
        'simulator-camera': 'SIMULATOR CAM',
        'stub-unavailable': 'STUB FEED',
      };
      this.statusBadge.text = badgeLabelMap[backend];
      this.statusBadge.style.color =
        backend === 'stub-unavailable' ? '#fbbf24' : '#4ade80';
    }

    if (this.detailsText) {
      const res =
        this.snapshot.width > 0
          ? `${this.snapshot.width}×${this.snapshot.height}`
          : '640×360 (Stub)';
      const camIdx =
        this.snapshot.deviceCount > 0
          ? `${Math.max(1, this.snapshot.deviceIndex + 1)}/${this.snapshot.deviceCount}`
          : '0';
      const snapTime = this.snapshot.lastSnapshotAtIso
        ? ` | Снимок: ${new Date(this.snapshot.lastSnapshotAtIso).toLocaleTimeString()}`
        : '';
      this.detailsText.text = `${this.snapshot.deviceLabel} | ${res} | Линзы: ${camIdx}${snapTime}`;
    }

    if (this.facingBtn) {
      this.facingBtn.label =
        this.currentFacing === 'environment' ? 'Тыл (Env)' : 'Фронт (User)';
    }

    this.config.onSnapshotChange?.(this.snapshot);
  }

  private buildStubTexture(): void {
    this.stubCanvas = document.createElement('canvas');
    this.stubCanvas.width = PREVIEW_W;
    this.stubCanvas.height = PREVIEW_H;
    const ctx = this.stubCanvas.getContext('2d');
    if (!ctx) {
      throw new Error('Не удалось создать Canvas2D для превью Android Camera');
    }
    this.stubCtx = ctx;
    this.stubTexture = new THREE.CanvasTexture(this.stubCanvas);
    this.stubTexture.colorSpace = THREE.SRGBColorSpace;
    this.stubTexture.minFilter = THREE.LinearFilter;
    this.stubTexture.magFilter = THREE.LinearFilter;
    this.drawStubFeed();
  }

  private drawStubFeed(banner?: string): void {
    const ctx = this.stubCtx;
    ctx.fillStyle = '#070f1e';
    ctx.fillRect(0, 0, PREVIEW_W, PREVIEW_H);

    // Сетка пастру Android XR
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.16)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= PREVIEW_W; x += 28) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, PREVIEW_H);
      ctx.stroke();
    }
    for (let y = 0; y <= PREVIEW_H; y += 28) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(PREVIEW_W, y);
      ctx.stroke();
    }

    // Движущийся радарный скан-луч для визуальной проверки обновления текстуры
    const scanY =
      ((Math.sin(this.stubPhase * 1.4) + 1) * 0.5) * (PREVIEW_H - 20) + 10;
    ctx.strokeStyle = 'rgba(74, 222, 128, 0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(16, scanY);
    ctx.lineTo(PREVIEW_W - 16, scanY);
    ctx.stroke();

    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(
      banner ?? 'Android Camera Passthrough (STUB)',
      PREVIEW_W / 2,
      PREVIEW_H / 2 - 10
    );
    ctx.fillStyle = '#94a3b8';
    ctx.font = '12px sans-serif';
    ctx.fillText(
      'На Android XR / Chrome автоматически подключается camera-access / rear cam',
      PREVIEW_W / 2,
      PREVIEW_H / 2 + 16
    );
    this.stubTexture.needsUpdate = true;
  }

  private buildCard(): void {
    this.statusBadge = new xb.UIText({
      text: 'IDLE',
      style: {fontSize: 13, fontWeight: 'bold', color: '#38bdf8'},
    });

    this.previewImage = new xb.UIImage({
      src: this.stubTexture,
      ariaLabel: 'Живой поток камеры Android устройства',
      pointerEvents: 'none',
      style: {
        width: '100%',
        height: 204,
        objectFit: 'cover',
        borderRadius: 14,
        backgroundColor: '#050914',
      },
    });

    this.detailsText = new xb.UIText({
      text: 'Android Rear Camera (environment)',
      style: {
        width: '100%',
        fontSize: 12,
        color: '#e2e8f0',
        padding: 8,
        backgroundColor: 'rgba(15, 23, 42, 0.78)',
        borderRadius: 10,
      },
    });

    this.facingBtn = new xb.UIButton({
      label: 'Тыл (Env)',
      icon: 'cameraswitch',
      style: {flexGrow: 1},
      onClick: () => void this.flipFacingMode(),
    });

    const lensBtn = new xb.UIButton({
      label: 'Линза',
      icon: 'camera',
      style: {flexGrow: 1},
      onClick: () => void this.cycleCameraLens(),
    });

    this.snapBtn = new xb.UIButton({
      label: 'Снимок',
      icon: 'photo_camera',
      style: {flexGrow: 1},
      onClick: () => void this.capturePhotoSnapshot(),
    });

    const hideBtn = new xb.UIButton({
      label: 'Скрыть (O)',
      icon: 'close',
      style: {flexGrow: 1},
      onClick: () => void this.togglePanel(),
    });

    const headerRow = new xb.UIPanel({
      style: {
        width: '100%',
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
      },
      children: [
        new xb.UIPanel({
          style: {flexDirection: 'row', alignItems: 'center', gap: 8},
          children: [
            new xb.UIIcon({
              icon: 'android',
              style: {width: 24, height: 24, color: '#4ade80'},
            }),
            new xb.UIText({
              text: 'Камера Android XR',
              style: {fontSize: 18, fontWeight: 'bold'},
            }),
          ],
        }),
        this.statusBadge,
      ],
    });

    const controlsRow = new xb.UIPanel({
      style: {width: '100%', flexDirection: 'row', gap: 6},
      children: [this.facingBtn, lensBtn, this.snapBtn, hideBtn],
    });

    this.card = new xb.UICard({
      size: {width: 0.58, height: 'auto'},
      manipulation: true,
      edge: true,
      style: {
        flexDirection: 'column',
        gap: 10,
        padding: 14,
      },
      children: [headerRow, this.previewImage, this.detailsText, controlsRow],
    });
    this.card.name = 'AndroidCameraFeedCard';
    this.card.position.set(-1.26, 1.44, -0.82);
    this.card.rotation.y = 0.72;
    this.card.visible = this.panelVisible;
    this.add(this.card);
  }

  override dispose(): void {
    this.boundDeviceCamera?.removeEventListener(
      'statechange',
      this.onDeviceCameraStateChange
    );
    this.boundDeviceCamera = null;
    this.stubTexture?.dispose();
  }
}
