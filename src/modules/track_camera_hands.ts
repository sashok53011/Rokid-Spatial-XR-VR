import {
  FilesetResolver,
  GestureRecognizer,
  type GestureRecognizerResult,
} from '@mediapipe/tasks-vision';
import * as THREE from 'three';
import * as xb from 'xrblocks';

import type {
  CameraHandFacingMode,
  CameraHandFrameData,
  CameraHandTrackingSnapshot,
} from '../types/spatial_contracts.ts';

/**
 * ============================================================================
 * МОДУЛЬ: track_camera_hands.ts (Трекинг движений и жестов рук с камеры)
 * ============================================================================
 * НАЗНАЧЕНИЕ:
 *   Добавляет ввод с физической веб-камеры / фронтальной или тыловой камеры
 *   устройства для отслеживания движений рук и распознавания жестов в реальном
 *   времени на базе MediaPipe Tasks Vision (`GestureRecognizer`, 21 сустав):
 *   1. Захват видеопотока (`navigator.mediaDevices.getUserMedia`) с выбором
 *      камеры (`user` фронтальная / `environment` тыловая) и зеркалированием.
 *   2. Распознавание 21 ключевой точки кисти, щипка (pinch) и статических
 *      жестов (`open-palm`, `fist`, `thumbs-up`, `thumbs-down`, `victory`, `point`).
 *   3. Живой 3D-предпросмотр в пространственной карточке `xb.UICard` со
 *      скелетом кисти, индикатором щипка, координатами и кнопками управления.
 *   4. Прямое управление 3D-окнами:
 *      - Движение ладони/указательного пальца -> наведение на 3D-окна.
 *      - Щипок (Thumb + Index) + движение руки -> перетаскивание окна по XYZ.
 *      - Две руки одновременно (щипок и разведение) -> плавный масштаб окна.
 *      - Жесты -> команды рабочего стола (`fist`=Pin, `open-palm`=Arc и др.).
 *      - Проекция 21 сустава в мировой 3D-силуэт `GestureHandGhostController`.
 *
 * ВХОДНЫЕ ДАННЫЕ:
 *   - `CameraHandTrackingConfig`: начальный режим камеры (`facingMode`),
 *     коллбеки перемещения/щипка (`onHandPointer`), масштаба двумя руками
 *     (`onTwoHandScale`), жестов (`onGestureTriggered`), живых 3D-суставов
 *     (`onCameraHandsFrame`) и отладки (`onLog`).
 *
 * ВЫХОДНЫЕ ДАННЫЕ:
 *   - Методы управления: `startCamera()`, `stopCamera()`, `toggleCamera()`,
 *     `flipFacingMode()`, `toggleMirror()`, `toggleSimStub()`, `togglePanel()`,
 *     `getSnapshot()`, `setEnabled(boolean)`.
 *
 * КАК ПОЛЬЗОВАТЬСЯ:
 *   const camHands = new CameraHandTrackingController({
 *     onCameraHandsFrame: (hands) => handGhost.setExternalCameraHands(hands),
 *     onHandPointer: (ev) => ...,
 *     onTwoHandScale: (delta) => windowManager.scaleActiveWindow(delta),
 *     onGestureTriggered: (side, name, conf) => gestureCtrl.handleGesture(side, name, conf),
 *   });
 *   this.add(camHands);
 *   await camHands.startCamera();
 *
 * ЗАГЛУШКИ (STUB) И ЗАМЕНА В ПРОДАКШНЕ:
 *   - ЗАГЛУШКА (STUB) — СИМУЛЯЦИЯ КАМЕРНОГО ТРЕКИНГА (`simStubActive`):
 *     если на десктопе/сервере нет физической веб-камеры, пользователь запретил
 *     доступ к камере или нет доступа к CDN модели MediaPipe, модуль не падает и
 *     позволяет включить процедурную симуляцию 21 сустава руки на превью-холсте
 *     (`Демо-рука`) с полным прогоном движений, щипка и всех жестов в 3D-сцене.
 *   - ЗАГЛУШКА (STUB) — ПУТИ WASM/МОДЕЛИ:
 *     по умолчанию WASM и `.task`-файл загружаются с jsDelivr / Google Cloud
 *     Storage (`gesture_recognizer.task`). В офлайн-продакшне разместите файлы
 *     `wasm/` и `gesture_recognizer.task` в `public/mediapipe/` и передайте
 *     локальные URL через `wasmBasePath` и `modelAssetPath`.
 * ============================================================================
 */

export interface HandPointerMoveEvent {
  readonly phase: 'move' | 'pinch-start' | 'pinch-move' | 'pinch-end';
  readonly ndcX: number;
  readonly ndcY: number;
  readonly deltaX: number;
  readonly deltaY: number;
  readonly deltaZ: number;
  readonly pinching: boolean;
  readonly pinchStrength: number;
}

export interface CameraHandTrackingConfig {
  readonly initialFacingMode?: CameraHandFacingMode;
  readonly initialPanelVisible?: boolean;
  readonly wasmBasePath?: string;
  readonly modelAssetPath?: string;
  readonly onHandPointer?: (event: HandPointerMoveEvent) => void;
  readonly onTwoHandScale?: (scaleDelta: number) => void;
  readonly onGestureTriggered?: (
    hand: 'left' | 'right',
    gestureName: string,
    confidence: number
  ) => void;
  readonly onCameraHandsFrame?: (
    hands: readonly CameraHandFrameData[] | null
  ) => void;
  readonly onSnapshotChange?: (snapshot: CameraHandTrackingSnapshot) => void;
  readonly onLog?: (level: 'DEBUG' | 'INFO' | 'WARN', message: string) => void;
}

const DEFAULT_WASM_PATH =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm';
const DEFAULT_MODEL_PATH =
  'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task';

const PREVIEW_WIDTH = 420;
const PREVIEW_HEIGHT = 236;
const DETECT_INTERVAL_MS = 38; // ~26 Гц для нейросети при сохранении 90 FPS рендера
const GESTURE_HOLD_MS = 220;
const SIM_CYCLES = [
  'open-palm',
  'pinch',
  'fist',
  'victory',
  'thumbs-up',
  'thumbs-down',
] as const;

const HAND_BONE_PAIRS: readonly [number, number][] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [0, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [0, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [0, 17],
  [17, 18],
  [18, 19],
  [19, 20],
  [5, 9],
  [9, 13],
  [13, 17],
];

// Предвыделенные временные объекты для Zero-GC проекции 21 сустава в 3D-сцену.
const _camForward = new THREE.Vector3();
const _camRight = new THREE.Vector3();
const _camUp = new THREE.Vector3();
const _wristWorld = new THREE.Vector3();

function createJointPool(): THREE.Vector3[] {
  const arr: THREE.Vector3[] = [];
  for (let i = 0; i < 21; i++) arr.push(new THREE.Vector3());
  return arr;
}

export class CameraHandTrackingController extends xb.Script {
  private readonly config: CameraHandTrackingConfig;
  private readonly wasmBasePath: string;
  private readonly modelAssetPath: string;

  private card!: xb.UICard;
  private statusBadge!: xb.UIText;
  private telemetryText!: xb.UIText;
  private startStopButton!: xb.UIButton;
  private flipCameraButton!: xb.UIButton;
  private mirrorButton!: xb.UIButton;
  private simStubButton!: xb.UIButton;

  private previewCanvas!: HTMLCanvasElement;
  private previewCtx!: CanvasRenderingContext2D;
  private previewTexture!: THREE.CanvasTexture;

  private videoEl: HTMLVideoElement | null = null;
  private mediaStream: MediaStream | null = null;
  private recognizer: GestureRecognizer | null = null;
  private recognizerLoadPromise: Promise<GestureRecognizer | null> | null = null;
  private recognizerFailed = false;

  private facingMode: CameraHandFacingMode;
  private activeDeviceId: string | null = null;
  private mirrored = true;
  private running = false;
  private simStubActive = false;
  private panelVisible: boolean;

  private lastVideoTime = -1;
  private lastDetectMs = 0;
  private fpsCounter = 0;
  private fpsWindowStartMs = performance.now();
  private measuredFps = 0;
  private simPhase = 0;

  // Сглаженное состояние ведущей руки для плавного перетаскивания без дрожания.
  private smoothInitialized = false;
  private smoothPalmX = 0.5;
  private smoothPalmY = 0.5;
  private smoothPalmZ = 0;
  private smoothIndexX = 0.5;
  private smoothIndexY = 0.5;
  private prevSmoothPalmX = 0.5;
  private prevSmoothPalmY = 0.5;
  private prevSmoothPalmZ = 0;
  private isPinching = false;

  // Двухручное масштабирование.
  private prevTwoHandSpan: number | null = null;

  // Антидребезг дискретных жестов.
  private pendingGestureKey = '';
  private pendingGestureSinceMs = 0;
  private firedCurrentHold = false;

  // Предвыделенные буферы 21 мирового сустава для 2 рук (Zero-GC).
  private readonly worldJointPools: [THREE.Vector3[], THREE.Vector3[]] = [
    createJointPool(),
    createJointPool(),
  ];
  private readonly simLandmarks: Array<{x: number; y: number; z: number}> =
    Array.from({length: 21}, () => ({x: 0.5, y: 0.5, z: 0}));

  private readonly snapshot: CameraHandTrackingSnapshot = {
    running: false,
    simStubActive: false,
    status: 'Ожидание запуска',
    cameraLabel: 'Не выбрана',
    facingMode: 'user',
    mirrored: true,
    fps: 0,
    handsDetected: 0,
    activeGesture: 'none',
    pinching: false,
    pinchStrength: 0,
    pointerNdcX: 0,
    pointerNdcY: 0,
  };

  constructor(config: CameraHandTrackingConfig = {}) {
    super();
    this.config = config;
    this.facingMode = config.initialFacingMode ?? 'user';
    this.mirrored = this.facingMode === 'user';
    this.panelVisible = config.initialPanelVisible ?? true;
    this.wasmBasePath = config.wasmBasePath ?? DEFAULT_WASM_PATH;
    this.modelAssetPath = config.modelAssetPath ?? DEFAULT_MODEL_PATH;

    this.snapshot.facingMode = this.facingMode;
    this.snapshot.mirrored = this.mirrored;
  }

  override init(): void {
    this.buildPreviewCanvas();
    this.buildSpatialCard();
    this.drawIdleCanvas('Камера рук готова.\nНажмите «Старт (J)» или «Демо-рука».');
    this.refreshCardUI();
    this.config.onLog?.(
      'INFO',
      'Модуль камерного трекинга движений и жестов рук готов (клавиша J)'
    );
  }

  override update(): void {
    const dt = Math.min(xb.getDeltaTime() || 0.016, 0.05);
    const now = performance.now();

    if (this.simStubActive) {
      this.stepSimulationStub(dt, now);
      return;
    }

    if (!this.running || !this.videoEl) {
      return;
    }

    if (now - this.lastDetectMs < DETECT_INTERVAL_MS) {
      return;
    }
    this.lastDetectMs = now;

    if (
      this.videoEl.readyState < 2 ||
      this.videoEl.videoWidth === 0 ||
      this.videoEl.videoHeight === 0
    ) {
      return;
    }

    if (this.videoEl.currentTime === this.lastVideoTime) {
      return;
    }
    this.lastVideoTime = this.videoEl.currentTime;

    this.fpsCounter++;
    if (now - this.fpsWindowStartMs >= 1000) {
      this.measuredFps = Math.round(
        (this.fpsCounter * 1000) / (now - this.fpsWindowStartMs)
      );
      this.snapshot.fps = this.measuredFps;
      this.fpsCounter = 0;
      this.fpsWindowStartMs = now;
    }

    let result: GestureRecognizerResult | null = null;
    if (this.recognizer) {
      try {
        result = this.recognizer.recognizeForVideo(this.videoEl, now);
      } catch {
        // Пропускаем отдельный сбойный видеокадр без остановки цикла.
      }
    }

    this.drawVideoFrame(this.videoEl);
    this.processMediaPipeResult(result, now);
  }

  isRunning(): boolean {
    return this.running || this.simStubActive;
  }

  isPanelVisible(): boolean {
    return this.card?.visible ?? this.panelVisible;
  }

  togglePanel(): boolean {
    this.panelVisible = !this.card.visible;
    this.card.visible = this.panelVisible;
    this.config.onLog?.(
      'INFO',
      this.panelVisible
        ? 'Панель трекинга рук с камеры показана'
        : 'Панель трекинга рук с камеры скрыта'
    );
    return this.panelVisible;
  }

  setPanelVisible(visible: boolean): void {
    this.panelVisible = visible;
    if (this.card) this.card.visible = visible;
  }

  getSnapshot(): CameraHandTrackingSnapshot {
    return this.snapshot;
  }

  async toggleCamera(): Promise<boolean> {
    if (this.running) {
      this.stopCamera();
      return false;
    }
    return this.startCamera();
  }

  async startCamera(
    facingOverride?: CameraHandFacingMode,
    deviceIdOverride?: string | null
  ): Promise<boolean> {
    if (facingOverride) {
      this.facingMode = facingOverride;
      this.mirrored = facingOverride === 'user';
      if (deviceIdOverride === undefined) {
        this.activeDeviceId = null;
      }
    }
    if (deviceIdOverride !== undefined) {
      this.activeDeviceId = deviceIdOverride;
    }

    if (this.simStubActive) {
      this.simStubActive = false;
      this.snapshot.simStubActive = false;
    }

    if (this.running) {
      this.stopMediaTracksOnly();
    }

    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      !navigator.mediaDevices.getUserMedia
    ) {
      this.handleCameraError(
        'API navigator.mediaDevices.getUserMedia недоступен. Активируйте «Демо-рука (Stub)» для проверки жестов.'
      );
      return false;
    }

    this.snapshot.status = 'Запрос камеры...';
    this.snapshot.facingMode = this.facingMode;
    this.snapshot.mirrored = this.mirrored;
    this.refreshCardUI();

    try {
      const videoConstraints: MediaTrackConstraints = this.activeDeviceId
        ? {
            deviceId: {exact: this.activeDeviceId},
            width: {ideal: 640},
            height: {ideal: 360},
            frameRate: {ideal: 30},
          }
        : {
            facingMode: {ideal: this.facingMode},
            width: {ideal: 640},
            height: {ideal: 360},
            frameRate: {ideal: 30},
          };

      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: videoConstraints,
      });

      const videoTrack = this.mediaStream.getVideoTracks()[0];
      const trackLabel = videoTrack?.label || `Камера (${this.facingMode})`;

      if (!this.videoEl) {
        this.videoEl = document.createElement('video');
        this.videoEl.playsInline = true;
        this.videoEl.muted = true;
        this.videoEl.autoplay = true;
      }
      this.videoEl.srcObject = this.mediaStream;
      await this.videoEl.play();

      this.running = true;
      this.lastVideoTime = -1;
      this.smoothInitialized = false;
      this.snapshot.running = true;
      this.snapshot.cameraLabel = trackLabel;
      this.snapshot.status = 'Загрузка MediaPipe Hands...';
      this.card.visible = true;
      this.panelVisible = true;
      this.refreshCardUI();

      this.config.onLog?.(
        'INFO',
        `Камера рук запущена: ${trackLabel} (${this.facingMode})`
      );

      // Загружаем MediaPipe GestureRecognizer асинхронно, чтобы видео появилось мгновенно.
      const loaded = await this.ensureRecognizerLoaded();
      if (this.running) {
        this.snapshot.status = loaded
          ? 'LIVE MediaPipe (21 сустав)'
          : 'Камера без ML (сеть/WASM недоступна)';
        this.refreshCardUI();
        this.config.onSnapshotChange?.(this.snapshot);
      }
      return true;
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : 'Нет доступа к камере';
      this.handleCameraError(
        `Не удалось открыть камеру (${msg}). Можно включить «Демо-рука (Stub)».`
      );
      return false;
    }
  }

  stopCamera(): void {
    this.stopMediaTracksOnly();
    this.running = false;
    this.simStubActive = false;
    this.isPinching = false;
    this.smoothInitialized = false;
    this.prevTwoHandSpan = null;
    this.snapshot.running = false;
    this.snapshot.simStubActive = false;
    this.snapshot.handsDetected = 0;
    this.snapshot.fps = 0;
    this.snapshot.pinching = false;
    this.snapshot.pinchStrength = 0;
    this.snapshot.activeGesture = 'none';
    this.snapshot.status = 'Остановлено';
    this.config.onCameraHandsFrame?.(null);
    this.drawIdleCanvas('Камера остановлена.\nНажмите «Старт (J)» или «Демо-рука».');
    this.refreshCardUI();
    this.config.onSnapshotChange?.(this.snapshot);
    this.config.onLog?.('INFO', 'Камера трекинга рук остановлена');
  }

  async flipFacingMode(): Promise<CameraHandFacingMode> {
    this.activeDeviceId = null;
    this.facingMode = this.facingMode === 'user' ? 'environment' : 'user';
    this.mirrored = this.facingMode === 'user';
    this.snapshot.facingMode = this.facingMode;
    this.snapshot.mirrored = this.mirrored;
    this.config.onLog?.(
      'INFO',
      `Режим камеры рук переключён на: ${this.facingMode === 'user' ? 'Фронт (user)' : 'Тыл (environment)'}`
    );
    if (this.running) {
      await this.startCamera(this.facingMode, null);
    } else {
      this.refreshCardUI();
    }
    return this.facingMode;
  }

  async cycleCameraDevice(): Promise<string> {
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.enumerateDevices
    ) {
      return await this.flipFacingMode();
    }
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter(
      (d) => d.kind === 'videoinput'
    );
    if (devices.length <= 1) {
      return await this.flipFacingMode();
    }
    const currentIdx = devices.findIndex(
      (d) => d.deviceId === this.activeDeviceId
    );
    const nextIdx = (currentIdx + 1 + devices.length) % devices.length;
    const nextDev = devices[nextIdx];
    const isRear = /back|rear|environment/i.test(nextDev.label);
    this.facingMode = isRear ? 'environment' : 'user';
    this.mirrored = !isRear;
    await this.startCamera(this.facingMode, nextDev.deviceId);
    return nextDev.label || `Camera #${nextIdx + 1}`;
  }

  toggleMirror(): boolean {
    this.mirrored = !this.mirrored;
    this.snapshot.mirrored = this.mirrored;
    this.refreshCardUI();
    this.config.onLog?.(
      'DEBUG',
      `Зеркало камеры рук: ${this.mirrored ? 'ON' : 'OFF'}`
    );
    return this.mirrored;
  }

  /**
   * Включает / выключает процедурную симуляцию 21-суставной руки на холсте камеры
   * (ЗАГЛУШКА STUB для тестирования без физической веб-камеры).
   */
  toggleSimStub(): boolean {
    if (this.simStubActive) {
      this.stopCamera();
      return false;
    }

    this.stopMediaTracksOnly();
    this.running = false;
    this.simStubActive = true;
    this.smoothInitialized = false;
    this.isPinching = false;
    this.prevTwoHandSpan = null;
    this.simPhase = 0;

    this.snapshot.running = true;
    this.snapshot.simStubActive = true;
    this.snapshot.cameraLabel = 'Virtual Stub Cam (21-Joint)';
    this.snapshot.status = 'SIM STUB (Демо-трекинг)';
    this.card.visible = true;
    this.panelVisible = true;
    this.refreshCardUI();
    this.config.onSnapshotChange?.(this.snapshot);
    this.config.onLog?.(
      'WARN',
      'Активирована ЗАГЛУШКА (STUB) камерного трекинга рук: симуляция 21 сустава и жестов'
    );
    return true;
  }

  private handleCameraError(reason: string): void {
    this.stopMediaTracksOnly();
    this.running = false;
    this.snapshot.running = false;
    this.snapshot.status = 'Камера недоступна (доступен Stub)';
    this.drawIdleCanvas(reason);
    this.refreshCardUI();
    this.config.onSnapshotChange?.(this.snapshot);
    this.config.onLog?.('WARN', reason);
  }

  private stopMediaTracksOnly(): void {
    if (this.mediaStream) {
      for (const track of this.mediaStream.getTracks()) {
        track.stop();
      }
      this.mediaStream = null;
    }
    if (this.videoEl) {
      this.videoEl.srcObject = null;
    }
  }

  private async ensureRecognizerLoaded(): Promise<GestureRecognizer | null> {
    if (this.recognizer) return this.recognizer;
    if (this.recognizerFailed) return null;
    if (this.recognizerLoadPromise) return this.recognizerLoadPromise;

    this.recognizerLoadPromise = (async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(this.wasmBasePath);
        try {
          this.recognizer = await GestureRecognizer.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: this.modelAssetPath,
              delegate: 'GPU',
            },
            runningMode: 'VIDEO',
            numHands: 2,
            minHandDetectionConfidence: 0.5,
            minHandPresenceConfidence: 0.5,
            minTrackingConfidence: 0.5,
          });
        } catch {
          // Фоллбек на CPU delegate, если WebGL-делегат недоступен.
          this.recognizer = await GestureRecognizer.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: this.modelAssetPath,
              delegate: 'CPU',
            },
            runningMode: 'VIDEO',
            numHands: 2,
          });
        }
        this.config.onLog?.(
          'INFO',
          'MediaPipe GestureRecognizer загружен (2 руки, 21 сустав)'
        );
        return this.recognizer;
      } catch (error) {
        this.recognizerFailed = true;
        const msg = error instanceof Error ? error.message : String(error);
        this.config.onLog?.(
          'WARN',
          `Не удалось загрузить WASM/модель MediaPipe (${msg}). Используйте режим «Демо-рука (Stub)».`
        );
        return null;
      } finally {
        this.recognizerLoadPromise = null;
      }
    })();

    return this.recognizerLoadPromise;
  }

  private processMediaPipeResult(
    result: GestureRecognizerResult | null,
    nowMs: number
  ): void {
    const landmarksList = result?.landmarks ?? [];
    if (landmarksList.length === 0) {
      this.handleNoHandsDetected();
      return;
    }

    const trackedHands: CameraHandFrameData[] = [];
    for (let h = 0; h < Math.min(landmarksList.length, 2); h++) {
      const rawLm = landmarksList[h];
      if (!rawLm || rawLm.length < 21) continue;

      const handednessRaw =
        result?.handedness?.[h]?.[0]?.categoryName?.toLowerCase() ?? 'right';
      // При зеркальной фронтальной камере инвертируем левую/правую метку для естественности.
      const side: 'left' | 'right' = this.mirrored
        ? handednessRaw === 'left'
          ? 'right'
          : 'left'
        : handednessRaw === 'left'
          ? 'left'
          : 'right';

      const canned = result?.gestures?.[h]?.[0];
      const mappedGesture = this.resolveMappedGesture(
        rawLm,
        canned?.categoryName ?? '',
        canned?.score ?? 0
      );

      const frameHand = this.analyzeHandFrame(
        h,
        side,
        rawLm,
        mappedGesture.name,
        mappedGesture.confidence
      );
      trackedHands.push(frameHand);
      this.drawSkeletonOverlay(rawLm, frameHand);
    }

    this.previewTexture.needsUpdate = true;
    this.dispatchTrackedHands(trackedHands, nowMs);
  }

  private handleNoHandsDetected(): void {
    if (this.isPinching) {
      this.isPinching = false;
      this.config.onHandPointer?.({
        phase: 'pinch-end',
        ndcX: (this.smoothIndexX - 0.5) * 2,
        ndcY: (0.5 - this.smoothIndexY) * 2,
        deltaX: 0,
        deltaY: 0,
        deltaZ: 0,
        pinching: false,
        pinchStrength: 0,
      });
    }
    this.smoothInitialized = false;
    this.prevTwoHandSpan = null;
    this.pendingGestureKey = '';
    this.firedCurrentHold = false;
    this.snapshot.handsDetected = 0;
    this.snapshot.pinching = false;
    this.snapshot.pinchStrength = 0;
    this.snapshot.activeGesture = 'none';
    this.config.onCameraHandsFrame?.(null);
    this.previewTexture.needsUpdate = true;
    this.refreshCardUI();
  }

  private dispatchTrackedHands(
    trackedHands: CameraHandFrameData[],
    nowMs: number
  ): void {
    if (trackedHands.length === 0) {
      this.handleNoHandsDetected();
      return;
    }

    this.snapshot.handsDetected = trackedHands.length;
    this.config.onCameraHandsFrame?.(trackedHands);

    // 1. Ведущая рука (первая обнаруженная) управляет 3D-указателем и щипком.
    const primary = trackedHands[0];
    const [px, py, pz] = primary.palmNormalized;
    const [ix, iy] = primary.indexTipNormalized;

    const alpha = 0.42;
    if (!this.smoothInitialized) {
      this.smoothPalmX = px;
      this.smoothPalmY = py;
      this.smoothPalmZ = pz;
      this.smoothIndexX = ix;
      this.smoothIndexY = iy;
      this.prevSmoothPalmX = px;
      this.prevSmoothPalmY = py;
      this.prevSmoothPalmZ = pz;
      this.smoothInitialized = true;
    } else {
      this.prevSmoothPalmX = this.smoothPalmX;
      this.prevSmoothPalmY = this.smoothPalmY;
      this.prevSmoothPalmZ = this.smoothPalmZ;
      this.smoothPalmX = THREE.MathUtils.lerp(this.smoothPalmX, px, alpha);
      this.smoothPalmY = THREE.MathUtils.lerp(this.smoothPalmY, py, alpha);
      this.smoothPalmZ = THREE.MathUtils.lerp(this.smoothPalmZ, pz, alpha);
      this.smoothIndexX = THREE.MathUtils.lerp(this.smoothIndexX, ix, alpha);
      this.smoothIndexY = THREE.MathUtils.lerp(this.smoothIndexY, iy, alpha);
    }

    const dx = (this.smoothPalmX - this.prevSmoothPalmX) * 2.1;
    const dy = (this.prevSmoothPalmY - this.smoothPalmY) * 1.8;
    const dz = THREE.MathUtils.clamp(
      (this.smoothPalmZ - this.prevSmoothPalmZ) * 1.4,
      -0.08,
      0.08
    );

    const ndcX = THREE.MathUtils.clamp((this.smoothIndexX - 0.5) * 2, -1, 1);
    const ndcY = THREE.MathUtils.clamp((0.5 - this.smoothIndexY) * 2, -1, 1);

    let phase: HandPointerMoveEvent['phase'] = 'move';
    if (!this.isPinching && primary.pinching) {
      this.isPinching = true;
      phase = 'pinch-start';
    } else if (this.isPinching && primary.pinching) {
      phase = 'pinch-move';
    } else if (this.isPinching && !primary.pinching) {
      this.isPinching = false;
      phase = 'pinch-end';
    }

    this.snapshot.pinching = this.isPinching;
    this.snapshot.pinchStrength = primary.pinchStrength;
    this.snapshot.pointerNdcX = ndcX;
    this.snapshot.pointerNdcY = ndcY;
    this.snapshot.activeGesture = this.isPinching ? 'pinch' : primary.gesture;

    // Двухручное масштабирование при видимости двух рук (разведение/сведение ладоней).
    if (trackedHands.length >= 2) {
      const h0 = trackedHands[0];
      const h1 = trackedHands[1];
      const span = Math.hypot(
        h0.palmNormalized[0] - h1.palmNormalized[0],
        h0.palmNormalized[1] - h1.palmNormalized[1]
      );
      if (h0.pinching || h1.pinching) {
        if (this.prevTwoHandSpan !== null) {
          const spanDelta = span - this.prevTwoHandSpan;
          if (Math.abs(spanDelta) > 0.004) {
            this.config.onTwoHandScale?.(spanDelta * 1.9);
          }
        }
        this.prevTwoHandSpan = span;
      } else {
        this.prevTwoHandSpan = span;
      }
    } else {
      this.prevTwoHandSpan = null;
    }

    this.config.onHandPointer?.({
      phase,
      ndcX,
      ndcY,
      deltaX: dx,
      deltaY: dy,
      deltaZ: dz,
      pinching: this.isPinching,
      pinchStrength: primary.pinchStrength,
    });

    // Дискретный триггер жеста (подавляется во время активного щипка-перетаскивания).
    if (!this.isPinching && primary.gesture !== 'none') {
      const key = `${primary.side}:${primary.gesture}`;
      if (key !== this.pendingGestureKey) {
        this.pendingGestureKey = key;
        this.pendingGestureSinceMs = nowMs;
        this.firedCurrentHold = false;
      } else if (
        !this.firedCurrentHold &&
        nowMs - this.pendingGestureSinceMs >= GESTURE_HOLD_MS
      ) {
        this.firedCurrentHold = true;
        this.config.onGestureTriggered?.(
          primary.side,
          primary.gesture,
          primary.confidence
        );
      }
    } else if (this.isPinching) {
      this.pendingGestureKey = '';
      this.firedCurrentHold = false;
    }

    this.refreshCardUI();
    this.config.onSnapshotChange?.(this.snapshot);
  }

  private analyzeHandFrame(
    poolIndex: number,
    side: 'left' | 'right',
    rawLm: ReadonlyArray<{x: number; y: number; z?: number}>,
    gestureName: string,
    confidence: number
  ): CameraHandFrameData {
    const wrist = rawLm[0];
    const thumbTip = rawLm[4];
    const indexTip = rawLm[8];
    const middleMcp = rawLm[9];

    const mx = (v: number) => (this.mirrored ? 1 - v : v);
    const palmX = mx((wrist.x + middleMcp.x) * 0.5);
    const palmY = (wrist.y + middleMcp.y) * 0.5;
    const palmSpan = Math.max(
      0.06,
      Math.hypot(wrist.x - middleMcp.x, wrist.y - middleMcp.y)
    );

    const pinchDist = Math.hypot(
      thumbTip.x - indexTip.x,
      thumbTip.y - indexTip.y
    );
    const pinchRatio = pinchDist / palmSpan;
    const pinchStrength = THREE.MathUtils.clamp(
      1 - (pinchRatio - 0.18) / 0.52,
      0,
      1
    );
    const pinching = this.isPinching ? pinchRatio < 0.49 : pinchRatio < 0.36;

    // Проецируем все 21 сустав в 3D-пространство перед камерой пользователя (Zero-GC).
    const jointPool = this.worldJointPools[poolIndex];
    const cam = xb.core?.camera;
    if (cam) {
      _camForward.set(0, 0, -1).applyQuaternion(cam.quaternion);
      _camRight.set(1, 0, 0).applyQuaternion(cam.quaternion);
      _camUp.set(0, 1, 0).applyQuaternion(cam.quaternion);
      _wristWorld.copy(cam.position).addScaledVector(_camForward, 0.78);
    } else {
      _camForward.set(0, 0, -1);
      _camRight.set(1, 0, 0);
      _camUp.set(0, 1, 0);
      _wristWorld.set(0, 1.4, -0.78);
    }

    const scaleXY = 0.85;
    const scaleZ = 0.65;
    for (let i = 0; i < 21; i++) {
      const lm = rawLm[i];
      const lx = (mx(lm.x) - 0.5) * scaleXY;
      const ly = (0.45 - lm.y) * (scaleXY * 0.72);
      const lz = (lm.z ?? 0) * scaleZ;
      jointPool[i]
        .copy(_wristWorld)
        .addScaledVector(_camRight, lx)
        .addScaledVector(_camUp, ly)
        .addScaledVector(_camForward, -lz);
    }

    return {
      side,
      palmNormalized: [palmX, palmY, (palmSpan - 0.16) * 2.2],
      indexTipNormalized: [mx(indexTip.x), indexTip.y],
      pinching,
      pinchStrength,
      gesture: gestureName,
      confidence,
      worldJoints: jointPool,
    };
  }

  private resolveMappedGesture(
    rawLm: ReadonlyArray<{x: number; y: number; z?: number}>,
    cannedCategory: string,
    cannedScore: number
  ): {name: string; confidence: number} {
    if (cannedScore >= 0.45) {
      switch (cannedCategory) {
        case 'Closed_Fist':
          return {name: 'fist', confidence: cannedScore};
        case 'Open_Palm':
          return {name: 'open-palm', confidence: cannedScore};
        case 'Thumb_Up':
          return {name: 'thumbs-up', confidence: cannedScore};
        case 'Thumb_Down':
          return {name: 'thumbs-down', confidence: cannedScore};
        case 'Victory':
          return {name: 'victory', confidence: cannedScore};
        case 'Pointing_Up':
          return {name: 'point', confidence: cannedScore};
        default:
          break;
      }
    }

    // Геометрический фоллбек на случай низкой уверенности классификатора.
    const wrist = rawLm[0];
    const isExtended = (tipIdx: number, pipIdx: number): boolean => {
      const dTip = Math.hypot(
        rawLm[tipIdx].x - wrist.x,
        rawLm[tipIdx].y - wrist.y
      );
      const dPip = Math.hypot(
        rawLm[pipIdx].x - wrist.x,
        rawLm[pipIdx].y - wrist.y
      );
      return dTip > dPip * 1.15;
    };

    const indexUp = isExtended(8, 6);
    const middleUp = isExtended(12, 10);
    const ringUp = isExtended(16, 14);
    const pinkyUp = isExtended(20, 18);

    if (indexUp && middleUp && ringUp && pinkyUp) {
      return {name: 'open-palm', confidence: 0.78};
    }
    if (indexUp && middleUp && !ringUp && !pinkyUp) {
      return {name: 'victory', confidence: 0.76};
    }
    if (indexUp && !middleUp && !ringUp && !pinkyUp) {
      return {name: 'point', confidence: 0.74};
    }
    if (!indexUp && !middleUp && !ringUp && !pinkyUp) {
      const thumbUpDist = rawLm[0].y - rawLm[4].y;
      if (thumbUpDist > 0.14) return {name: 'thumbs-up', confidence: 0.72};
      if (thumbUpDist < -0.1) return {name: 'thumbs-down', confidence: 0.72};
      return {name: 'fist', confidence: 0.72};
    }
    return {name: 'none', confidence: 0};
  }

  /**
   * ЗАГЛУШКА (STUB): генерирует плавную анимацию 21 сустава руки,
   * циклов щипка/перетаскивания и всех 5 жестов для тестирования без камеры.
   */
  private stepSimulationStub(dt: number, now: number): void {
    this.simPhase += dt;
    this.measuredFps = 30;
    this.snapshot.fps = 30;

    const cycleIdx = Math.floor(this.simPhase / 2.8) % SIM_CYCLES.length;
    const activeGesture = SIM_CYCLES[cycleIdx];
    const centerX = 0.5 + Math.sin(this.simPhase * 1.35) * 0.22;
    const centerY = 0.54 + Math.cos(this.simPhase * 1.9) * 0.13;
    const isPinchCycle = activeGesture === 'pinch';
    const curl =
      activeGesture === 'fist'
        ? 0.88
        : activeGesture === 'open-palm'
          ? 0.05
          : isPinchCycle
            ? 0.42
            : 0.72;

    // Заполняем 21 нормализованный сустав.
    this.simLandmarks[0].x = centerX;
    this.simLandmarks[0].y = centerY + 0.14;
    this.simLandmarks[0].z = 0;

    const thumbUpSign = activeGesture === 'thumbs-down' ? -1 : 1;
    this.simLandmarks[1].x = centerX - 0.05;
    this.simLandmarks[1].y = centerY + 0.08;
    this.simLandmarks[2].x = centerX - 0.09;
    this.simLandmarks[2].y = centerY + 0.02 * thumbUpSign;
    this.simLandmarks[3].x = isPinchCycle ? centerX - 0.045 : centerX - 0.11;
    this.simLandmarks[3].y = centerY - 0.04 * thumbUpSign;
    this.simLandmarks[4].x = isPinchCycle ? centerX - 0.028 : centerX - 0.13;
    this.simLandmarks[4].y = isPinchCycle
      ? centerY - 0.085
      : centerY - 0.09 * thumbUpSign;

    const fingerOffsets = [-0.045, -0.015, 0.016, 0.046];
    const fingerHeights = [0.16, 0.18, 0.165, 0.135];
    for (let f = 0; f < 4; f++) {
      const base = 5 + f * 4;
      const fx = centerX + fingerOffsets[f];
      const fh = fingerHeights[f];
      const fCurl =
        activeGesture === 'victory' && (f === 0 || f === 1)
          ? 0.06
          : isPinchCycle && f === 0
            ? 0.48
            : curl;

      this.simLandmarks[base].x = fx;
      this.simLandmarks[base].y = centerY;
      this.simLandmarks[base + 1].x = fx + (f - 1.5) * 0.008;
      this.simLandmarks[base + 1].y = centerY - fh * (1 - fCurl * 0.25) * 0.42;
      this.simLandmarks[base + 2].x = fx + (f - 1.5) * 0.012;
      this.simLandmarks[base + 2].y = centerY - fh * (1 - fCurl * 0.58) * 0.78;
      this.simLandmarks[base + 3].x =
        isPinchCycle && f === 0 ? centerX - 0.024 : fx + (f - 1.5) * 0.016;
      this.simLandmarks[base + 3].y =
        isPinchCycle && f === 0
          ? centerY - 0.086
          : centerY - fh * (1 - fCurl * 0.88);
    }

    this.drawStubBackground();
    const frameHand = this.analyzeHandFrame(
      0,
      'right',
      this.simLandmarks,
      isPinchCycle ? 'none' : activeGesture,
      0.95
    );
    this.drawSkeletonOverlay(this.simLandmarks, frameHand, true);
    this.previewTexture.needsUpdate = true;
    this.dispatchTrackedHands([frameHand], now);
  }

  private buildPreviewCanvas(): void {
    this.previewCanvas = document.createElement('canvas');
    this.previewCanvas.width = PREVIEW_WIDTH;
    this.previewCanvas.height = PREVIEW_HEIGHT;
    const ctx = this.previewCanvas.getContext('2d');
    if (!ctx) {
      throw new Error('Не удалось создать 2D контекст для превью камеры рук');
    }
    this.previewCtx = ctx;
    this.previewTexture = new THREE.CanvasTexture(this.previewCanvas);
    this.previewTexture.colorSpace = THREE.SRGBColorSpace;
    this.previewTexture.minFilter = THREE.LinearFilter;
    this.previewTexture.magFilter = THREE.LinearFilter;
  }

  private buildSpatialCard(): void {
    this.statusBadge = new xb.UIText({
      text: 'OFF | Готов',
      style: {fontSize: 14, fontWeight: 'bold', color: '#38bdf8'},
    });

    const previewFrame = new xb.UIImage({
      src: this.previewTexture,
      ariaLabel: 'Превью камеры и 21-суставного скелета руки',
      pointerEvents: 'none',
      style: {
        width: '100%',
        height: 214,
        objectFit: 'cover',
        borderRadius: 14,
        backgroundColor: '#050914',
      },
    });

    this.telemetryText = new xb.UIText({
      text: 'Рук: 0 | Жест: -- | Щипок: 0% | Движение: --',
      style: {
        width: '100%',
        fontSize: 13,
        color: '#e2e8f0',
        padding: 8,
        backgroundColor: 'rgba(15, 23, 42, 0.78)',
        borderRadius: 10,
      },
    });

    this.startStopButton = new xb.UIButton({
      label: 'Старт (J)',
      icon: 'videocam',
      style: {flexGrow: 1},
      onClick: () => void this.toggleCamera(),
    });

    this.flipCameraButton = new xb.UIButton({
      label: 'Фронт',
      icon: 'cameraswitch',
      style: {flexGrow: 1},
      onClick: () => void this.flipFacingMode(),
    });

    this.mirrorButton = new xb.UIButton({
      label: 'Зеркало: ON',
      icon: 'flip',
      style: {flexGrow: 1},
      onClick: () => this.toggleMirror(),
    });

    this.simStubButton = new xb.UIButton({
      label: 'Демо-рука (Stub)',
      icon: 'pan_tool',
      style: {flexGrow: 1},
      onClick: () => this.toggleSimStub(),
    });

    const controlsRow1 = new xb.UIPanel({
      style: {width: '100%', flexDirection: 'row', gap: 6},
      children: [
        this.startStopButton,
        this.flipCameraButton,
        this.mirrorButton,
      ],
    });

    const controlsRow2 = new xb.UIPanel({
      style: {width: '100%', flexDirection: 'row', gap: 6},
      children: [
        this.simStubButton,
        new xb.UIButton({
          label: 'Скрыть',
          icon: 'close',
          style: {flexGrow: 1},
          onClick: () => this.togglePanel(),
        }),
      ],
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
              icon: 'front_hand',
              style: {width: 24, height: 24, color: '#22d3ee'},
            }),
            new xb.UIText({
              text: 'Камера: Руки и Жесты',
              style: {fontSize: 18, fontWeight: 'bold'},
            }),
          ],
        }),
        this.statusBadge,
      ],
    });

    const hint = new xb.UIText({
      text: 'Щипок+движение = тащить окно • 2 руки = масштаб • Ладонь=Arc • Кулак=Pin • ✌=Место',
      style: {fontSize: 12, opacity: 0.78, textAlign: 'center'},
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
      children: [
        headerRow,
        previewFrame,
        this.telemetryText,
        controlsRow1,
        controlsRow2,
        hint,
      ],
    });
    this.card.name = 'CameraHandTrackerCard';
    this.card.position.set(1.26, 1.44, -0.82);
    this.card.rotation.y = -0.72;
    this.card.visible = this.panelVisible;
    this.add(this.card);
  }

  private refreshCardUI(): void {
    if (!this.statusBadge) return;
    if (this.simStubActive) {
      this.statusBadge.text = `SIM STUB • ${this.snapshot.fps} FPS`;
      this.statusBadge.style.color = '#fbbf24';
    } else if (this.running) {
      this.statusBadge.text = `LIVE • ${this.snapshot.fps} FPS`;
      this.statusBadge.style.color = '#4ade80';
    } else {
      this.statusBadge.text = 'OFF';
      this.statusBadge.style.color = '#94a3b8';
    }

    this.startStopButton.label = this.running ? 'Стоп (J)' : 'Старт (J)';
    this.startStopButton.icon = this.running ? 'videocam_off' : 'videocam';
    this.flipCameraButton.label =
      this.facingMode === 'user' ? 'Фронт' : 'Тыл';
    this.mirrorButton.label = this.mirrored ? 'Зеркало: ON' : 'Зеркало: OFF';
    this.simStubButton.label = this.simStubActive
      ? 'Стоп Демо'
      : 'Демо-рука (Stub)';

    const pct = Math.round(this.snapshot.pinchStrength * 100);
    const nx = this.snapshot.pointerNdcX.toFixed(2);
    const ny = this.snapshot.pointerNdcY.toFixed(2);
    this.telemetryText.text =
      `Рук: ${this.snapshot.handsDetected} | Жест: ${this.snapshot.activeGesture} | ` +
      `Щипок: ${this.snapshot.pinching ? 'YES' : 'NO'} (${pct}%) | XY(${nx}, ${ny})`;
  }

  private drawIdleCanvas(message: string): void {
    const ctx = this.previewCtx;
    ctx.fillStyle = '#070d1a';
    ctx.fillRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);

    ctx.strokeStyle = 'rgba(56, 189, 248, 0.16)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= PREVIEW_WIDTH; x += 28) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, PREVIEW_HEIGHT);
      ctx.stroke();
    }
    for (let y = 0; y <= PREVIEW_HEIGHT; y += 28) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(PREVIEW_WIDTH, y);
      ctx.stroke();
    }

    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    const lines = message.split('\n');
    lines.forEach((line, i) => {
      ctx.fillText(line, PREVIEW_WIDTH / 2, PREVIEW_HEIGHT / 2 - 8 + i * 24);
    });
    this.previewTexture.needsUpdate = true;
  }

  private drawStubBackground(): void {
    const ctx = this.previewCtx;
    ctx.fillStyle = '#050b18';
    ctx.fillRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
    ctx.strokeStyle = 'rgba(34, 211, 238, 0.18)';
    ctx.lineWidth = 1;
    for (let x = 20; x < PREVIEW_WIDTH; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, PREVIEW_HEIGHT);
      ctx.stroke();
    }
    for (let y = 20; y < PREVIEW_HEIGHT; y += 32) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(PREVIEW_WIDTH, y);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(251, 191, 36, 0.9)';
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('CAMERA STUB MODE (NO WEBCAM REQUIRED)', 10, 18);
  }

  private drawVideoFrame(video: HTMLVideoElement): void {
    const ctx = this.previewCtx;
    ctx.save();
    if (this.mirrored) {
      ctx.translate(PREVIEW_WIDTH, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
    ctx.restore();

    ctx.fillStyle = 'rgba(2, 6, 23, 0.22)';
    ctx.fillRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
  }

  private drawSkeletonOverlay(
    rawLm: ReadonlyArray<{x: number; y: number; z?: number}>,
    handData: CameraHandFrameData,
    alreadyMirrored = false
  ): void {
    const ctx = this.previewCtx;
    const mapX = (x: number) =>
      (this.mirrored && !alreadyMirrored ? 1 - x : x) * PREVIEW_WIDTH;
    const mapY = (y: number) => y * PREVIEW_HEIGHT;

    ctx.strokeStyle = handData.pinching ? '#fbbf24' : '#22d3ee';
    ctx.lineWidth = 2.4;
    for (const [a, b] of HAND_BONE_PAIRS) {
      const p0 = rawLm[a];
      const p1 = rawLm[b];
      ctx.beginPath();
      ctx.moveTo(mapX(p0.x), mapY(p0.y));
      ctx.lineTo(mapX(p1.x), mapY(p1.y));
      ctx.stroke();
    }

    // Линия щипка между большим (4) и указательным (8) пальцами.
    ctx.strokeStyle = handData.pinching ? '#4ade80' : 'rgba(251, 191, 36, 0.7)';
    ctx.lineWidth = handData.pinching ? 3.5 : 1.5;
    ctx.beginPath();
    ctx.moveTo(mapX(rawLm[4].x), mapY(rawLm[4].y));
    ctx.lineTo(mapX(rawLm[8].x), mapY(rawLm[8].y));
    ctx.stroke();

    for (let i = 0; i < 21; i++) {
      const pt = rawLm[i];
      const isTip = i % 4 === 0 && i > 0;
      ctx.fillStyle =
        isTip && handData.pinching && (i === 4 || i === 8)
          ? '#4ade80'
          : isTip
            ? '#f8fafc'
            : '#38bdf8';
      ctx.beginPath();
      ctx.arc(mapX(pt.x), mapY(pt.y), isTip ? 4.4 : 2.8, 0, Math.PI * 2);
      ctx.fill();
    }

    const labelX = THREE.MathUtils.clamp(
      mapX(rawLm[0].x),
      56,
      PREVIEW_WIDTH - 56
    );
    const labelY = THREE.MathUtils.clamp(mapY(rawLm[0].y) - 10, 22, PREVIEW_HEIGHT - 10);
    const badge = `${handData.side.toUpperCase()}: ${handData.pinching ? 'PINCH' : handData.gesture}`;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.fillRect(labelX - 54, labelY - 14, 108, 18);
    ctx.fillStyle = handData.pinching ? '#4ade80' : '#38bdf8';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(badge, labelX, labelY - 1);
  }

  override dispose(): void {
    this.stopMediaTracksOnly();
    this.running = false;
    this.simStubActive = false;
    if (this.recognizer) {
      try {
        this.recognizer.close();
      } catch {
        // Игнорируем ошибку закрытия WASM-инстанса при выгрузке.
      }
      this.recognizer = null;
    }
    this.previewTexture?.dispose();
  }
}
