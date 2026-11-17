import * as THREE from 'three';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import * as xb from 'xrblocks';

import type {
  CameraLightingPreset,
  LightingEstimationSnapshot,
  SpatialPlaceSpec,
} from '../types/spatial_contracts.ts';

/**
 * ============================================================================
 * МОДУЛЬ: adapt_camera_lighting.ts (Адаптивное освещение по камере Android XR)
 * ============================================================================
 * НАЗНАНИЕ:
 *   Динамически подстраивает внешнее (ambient / hemisphere / directional)
 *   освещение 3D-среды рабочего стола под реальные условия освещённости из
 *   потока камеры устройства (`xb.core.deviceCamera`) и WebXR Light Estimation
 *   (`xb.core.lighting`). Обеспечивает бесшовное слияние виртуальных окон и
 *   3D-объектов с реальным окружением пользователя.
 *
 * ВХОДНЫЕ ДАННЫЕ:
 *   - `initialEnabled`: включить адаптивное освещение при запуске.
 *   - `initialPreset`: пресет `'auto' | 'daylight' | 'warm' | 'night'`.
 *   - `onTelemetry(snapshot)`: коллбек обновлений яркости, цвета и цветовой
 *     температуры (Кельвины) для телеметрии.
 *
 * ВЫХОДНЫЕ ДАННЫЕ:
 *   - Управляет освещением Three.js сцены и `RoomEnvironment`.
 *   - Возвращает `LightingEstimationSnapshot` через `getSnapshot()`.
 *
 * КАК ПОЛЬЗОВАТЬСЯ:
 *   const lighting = new CameraAmbientLightingController({
 *     onLog: (lvl, msg) => monitor.log(lvl, 'LIGHTING', msg),
 *   });
 *   this.add(lighting);
 *   lighting.setPreset('warm');
 *
 * ЗАГЛУШКИ (STUB) И ЗАМЕНА В ПРОДАКШНЕ:
 *   - ЗАГЛУШКА (STUB): на десктопе или при отсутствии/запрете доступа к камере
 *     Android модуль переключается в режим `stub-estimator`: вычисляет оценку
 *     освещения на основе палитры активной 360°-локации или тестовых пресетов
 *     (`daylight` 6500K, `warm` 3200K, `night` 4500K).
 *   - КАК ЗАМЕНИТЬ В ПРОДАКШНЕ: при активной задней камере (`facingMode: 'environment'`)
 *     на Android XR / Rokid Station модуль автоматически считывает кадры
 *     `xb.core.deviceCamera.getSnapshot({ outputFormat: 'imageData' })`, либо
 *     может принимать HDR Spherical Harmonics с OpenXR `XR_EXT_light_estimation`.
 * ============================================================================
 */

export interface CameraLightingConfig {
  readonly initialEnabled?: boolean;
  readonly initialPreset?: CameraLightingPreset;
  readonly sampleIntervalMs?: number;
  readonly onTelemetry?: (snapshot: LightingEstimationSnapshot) => void;
  readonly onLog?: (level: 'DEBUG' | 'INFO' | 'WARN', message: string) => void;
}

const PRESET_ORDER: readonly CameraLightingPreset[] = [
  'auto',
  'daylight',
  'warm',
  'night',
];

// Предвыделенные объекты для Zero-GC интерполяции освещения в `update()`.
const _targetSkyColor = new THREE.Color(0xdbeafe);
const _targetGroundColor = new THREE.Color(0x1e293b);
const _targetKeyColor = new THREE.Color(0xfff7ed);
const _targetAmbientColor = new THREE.Color(0x94a3b8);

export class CameraAmbientLightingController extends xb.Script {
  private readonly config: CameraLightingConfig;
  private readonly sampleIntervalMs: number;

  private hemiLight!: THREE.HemisphereLight;
  private keyLight!: THREE.DirectionalLight;
  private rimLight!: THREE.DirectionalLight;
  private ambientLight!: THREE.AmbientLight;
  private envMapTexture?: THREE.Texture;

  private enabled: boolean;
  private preset: CameraLightingPreset;
  private lastSampleAtMs = 0;
  private lastTelemetryAtMs = 0;
  private cameraWarningLogged = false;
  private pendingXrCapture = false;

  private targetHemiIntensity = 2.0;
  private targetKeyIntensity = 1.9;
  private targetAmbientIntensity = 0.45;
  private activePlaceAccentHex = 0x38bdf8;
  private activePlaceHorizonHex = 0x1e293b;

  private readonly snapshot: LightingEstimationSnapshot = {
    enabled: true,
    preset: 'auto',
    source: 'stub-estimator',
    luminance: 0.62,
    ambientHex: 0xdbeafe,
    kelvinApprox: 5600,
  };

  constructor(config: CameraLightingConfig = {}) {
    super();
    this.config = config;
    this.enabled = config.initialEnabled ?? true;
    this.preset = config.initialPreset ?? 'auto';
    this.sampleIntervalMs = config.sampleIntervalMs ?? 280;
    this.snapshot.enabled = this.enabled;
    this.snapshot.preset = this.preset;
  }

  override init(): void {
    this.ambientLight = new THREE.AmbientLight(0xcbd5e1, 0.45);
    this.add(this.ambientLight);

    this.hemiLight = new THREE.HemisphereLight(0xdbeafe, 0x1e293b, 2.0);
    this.add(this.hemiLight);

    this.keyLight = new THREE.DirectionalLight(0xfff7ed, 1.9);
    this.keyLight.position.set(1.8, 3.2, 2.0);
    this.add(this.keyLight);

    this.rimLight = new THREE.DirectionalLight(0x38bdf8, 1.05);
    this.rimLight.position.set(-2.2, 1.8, -2.5);
    this.add(this.rimLight);

    const renderer = xb.core?.renderer;
    const scene = xb.core?.scene;
    if (renderer && renderer instanceof THREE.WebGLRenderer && scene) {
      try {
        const pmrem = new THREE.PMREMGenerator(renderer);
        const envTarget = pmrem.fromScene(new RoomEnvironment(), 0.04);
        this.envMapTexture = envTarget.texture;
        scene.environment = this.envMapTexture;
        pmrem.dispose();
      } catch {
        // Игнорируем ошибку PMREM в средах без расширений WebGL.
      }
    }

    this.applyPresetTargets();
    this.config.onLog?.(
      'INFO',
      `Адаптивное освещение камеры инициализировано (${this.preset})`
    );
  }

  override update(): void {
    const dt = Math.min(xb.getDeltaTime() || 0.016, 0.1);
    const now = performance.now();

    if (this.enabled && this.preset === 'auto') {
      if (now - this.lastSampleAtMs >= this.sampleIntervalMs) {
        this.lastSampleAtMs = now;
        this.sampleEnvironmentLighting();
      }
    }

    // Плавная Zero-GC адаптация источников света без скачков экспозиции.
    const alpha = 1 - Math.exp(-dt * 4.5);
    this.hemiLight.color.lerp(_targetSkyColor, alpha);
    this.hemiLight.groundColor.lerp(_targetGroundColor, alpha);
    this.hemiLight.intensity = THREE.MathUtils.lerp(
      this.hemiLight.intensity,
      this.targetHemiIntensity,
      alpha
    );

    this.keyLight.color.lerp(_targetKeyColor, alpha);
    this.keyLight.intensity = THREE.MathUtils.lerp(
      this.keyLight.intensity,
      this.targetKeyIntensity,
      alpha
    );

    this.ambientLight.color.lerp(_targetAmbientColor, alpha);
    this.ambientLight.intensity = THREE.MathUtils.lerp(
      this.ambientLight.intensity,
      this.targetAmbientIntensity,
      alpha
    );

    if (now - this.lastTelemetryAtMs >= 500) {
      this.lastTelemetryAtMs = now;
      this.config.onTelemetry?.(this.snapshot);
    }
  }

  setEnabled(enabled: boolean): boolean {
    this.enabled = enabled;
    this.snapshot.enabled = enabled;
    if (!enabled) {
      // Возвращаем нейтральное студийное освещение при выключении адаптации.
      _targetSkyColor.setHex(0xdbeafe);
      _targetGroundColor.setHex(0x1e293b);
      _targetKeyColor.setHex(0xfff7ed);
      _targetAmbientColor.setHex(0xcbd5e1);
      this.targetHemiIntensity = 2.0;
      this.targetKeyIntensity = 1.9;
      this.targetAmbientIntensity = 0.45;
      this.snapshot.luminance = 0.65;
      this.snapshot.kelvinApprox = 5600;
      this.snapshot.ambientHex = 0xdbeafe;
    } else {
      this.applyPresetTargets();
    }
    this.config.onTelemetry?.(this.snapshot);
    this.config.onLog?.(
      'INFO',
      `Адаптивное освещение камеры: ${enabled ? 'ON' : 'OFF'}`
    );
    return this.enabled;
  }

  toggleEnabled(): boolean {
    return this.setEnabled(!this.enabled);
  }

  setPreset(preset: CameraLightingPreset): CameraLightingPreset {
    this.preset = preset;
    this.snapshot.preset = preset;
    this.applyPresetTargets();
    this.config.onTelemetry?.(this.snapshot);
    this.config.onLog?.('INFO', `Пресет освещения: ${preset}`);
    return this.preset;
  }

  cyclePreset(): CameraLightingPreset {
    const nextIdx =
      (PRESET_ORDER.indexOf(this.preset) + 1) % PRESET_ORDER.length;
    return this.setPreset(PRESET_ORDER[nextIdx]);
  }

  setPlaceContext(place: SpatialPlaceSpec): void {
    this.activePlaceAccentHex = place.accentHex;
    this.activePlaceHorizonHex = place.skyHorizonHex;
    this.rimLight?.color.setHex(place.accentHex);
    if (this.enabled && this.preset === 'auto' && this.snapshot.source === 'stub-estimator') {
      this.applyStubEstimatorFromPlace();
    }
  }

  getSnapshot(): LightingEstimationSnapshot {
    return this.snapshot;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getPreset(): CameraLightingPreset {
    return this.preset;
  }

  private sampleEnvironmentLighting(): void {
    const deviceCamera = xb.core?.deviceCamera;
    if (deviceCamera && deviceCamera.state === 'streaming') {
      if (deviceCamera.isUsingXRCameraAccess) {
        if (!this.pendingXrCapture) {
          this.pendingXrCapture = true;
          void deviceCamera
            .captureSnapshot({
              outputFormat: 'imageData',
              width: 16,
              height: 12,
            })
            .then((imgData) => {
              this.pendingXrCapture = false;
              if (
                this.enabled &&
                this.preset === 'auto' &&
                imgData &&
                imgData.data &&
                imgData.data.length >= 4
              ) {
                this.applyCameraImageData(imgData);
              }
            })
            .catch(() => {
              this.pendingXrCapture = false;
            });
        }
        return;
      }

      try {
        const imgData = deviceCamera.getSnapshot({
          outputFormat: 'imageData',
          width: 16,
          height: 12,
        });
        if (imgData && imgData.data && imgData.data.length >= 4) {
          this.applyCameraImageData(imgData);
          return;
        }
      } catch {
        if (!this.cameraWarningLogged) {
          this.cameraWarningLogged = true;
          this.config.onLog?.(
            'WARN',
            'Чтение кадра камеры Android XR недоступно — активирован fallback-оценщик освещения'
          );
        }
      }
      this.applyStubEstimatorFromPlace();
      return;
    }

    // Проверяем встроенную оценку освещения WebXR (XREstimatedLight / Spherical Harmonics).
    const xrLighting = xb.core?.lighting;
    if (xrLighting && xrLighting.ambientLight.lengthSq() > 0.001) {
      this.snapshot.source = 'webxr-light';
      const ax = THREE.MathUtils.clamp(xrLighting.ambientLight.x, 0.1, 2.0);
      const ay = THREE.MathUtils.clamp(xrLighting.ambientLight.y, 0.1, 2.0);
      const az = THREE.MathUtils.clamp(xrLighting.ambientLight.z, 0.1, 2.0);
      _targetSkyColor.setRGB(
        THREE.MathUtils.clamp(ax, 0.2, 1),
        THREE.MathUtils.clamp(ay, 0.2, 1),
        THREE.MathUtils.clamp(az, 0.2, 1)
      );
      _targetAmbientColor.copy(_targetSkyColor);
      _targetKeyColor.copy(xrLighting.dirLight.color);
      const lum = THREE.MathUtils.clamp(0.2126 * ax + 0.7152 * ay + 0.0722 * az, 0.15, 1.0);
      this.targetHemiIntensity = 0.9 + lum * 1.5;
      this.targetKeyIntensity = 0.8 + lum * 1.6;
      this.targetAmbientIntensity = 0.25 + lum * 0.45;
      this.snapshot.luminance = Number(lum.toFixed(2));
      this.snapshot.ambientHex = _targetSkyColor.getHex();
      this.snapshot.kelvinApprox = Math.round(
        THREE.MathUtils.clamp(5500 + (az - ax) * 2400, 2700, 7800)
      );
      return;
    }

    this.applyStubEstimatorFromPlace();
  }

  private applyCameraImageData(imageData: ImageData): void {
    const pixels = imageData.data;
    const totalPixels = Math.max(1, pixels.length / 4);
    let rSum = 0;
    let gSum = 0;
    let bSum = 0;

    for (let i = 0; i < pixels.length; i += 4) {
      rSum += pixels[i];
      gSum += pixels[i + 1];
      bSum += pixels[i + 2];
    }

    const r = rSum / (totalPixels * 255);
    const g = gSum / (totalPixels * 255);
    const b = bSum / (totalPixels * 255);

    const luminance = THREE.MathUtils.clamp(
      0.2126 * r + 0.7152 * g + 0.0722 * b,
      0.08,
      1.0
    );

    // Смягчаем хроматический тон, чтобы 3D-окна не становились чрезмерно кислотными.
    _targetSkyColor.setRGB(
      THREE.MathUtils.lerp(0.85, r, 0.65),
      THREE.MathUtils.lerp(0.88, g, 0.65),
      THREE.MathUtils.lerp(0.92, b, 0.65)
    );
    _targetKeyColor.setRGB(
      THREE.MathUtils.lerp(1.0, r, 0.45),
      THREE.MathUtils.lerp(0.97, g, 0.45),
      THREE.MathUtils.lerp(0.94, b, 0.45)
    );
    _targetGroundColor.copy(_targetSkyColor).multiplyScalar(0.28);
    _targetAmbientColor.copy(_targetSkyColor);

    this.targetHemiIntensity = 0.75 + luminance * 1.9;
    this.targetKeyIntensity = 0.65 + luminance * 1.85;
    this.targetAmbientIntensity = 0.22 + luminance * 0.55;

    const warmthDelta = b - r;
    this.snapshot.source = 'android-camera';
    this.snapshot.luminance = Number(luminance.toFixed(2));
    this.snapshot.ambientHex = _targetSkyColor.getHex();
    this.snapshot.kelvinApprox = Math.round(
      THREE.MathUtils.clamp(5500 + warmthDelta * 3600, 2600, 8200)
    );
  }

  private applyPresetTargets(): void {
    if (!this.enabled) return;

    if (this.preset === 'daylight') {
      _targetSkyColor.setHex(0xe0f2fe);
      _targetGroundColor.setHex(0x334155);
      _targetKeyColor.setHex(0xffffff);
      _targetAmbientColor.setHex(0xbae6fd);
      this.targetHemiIntensity = 2.4;
      this.targetKeyIntensity = 2.2;
      this.targetAmbientIntensity = 0.55;
      this.snapshot.source = 'stub-estimator';
      this.snapshot.luminance = 0.88;
      this.snapshot.kelvinApprox = 6500;
      this.snapshot.ambientHex = 0xe0f2fe;
      return;
    }

    if (this.preset === 'warm') {
      _targetSkyColor.setHex(0xffedd5);
      _targetGroundColor.setHex(0x292524);
      _targetKeyColor.setHex(0xfdba74);
      _targetAmbientColor.setHex(0xfed7aa);
      this.targetHemiIntensity = 1.95;
      this.targetKeyIntensity = 1.85;
      this.targetAmbientIntensity = 0.5;
      this.snapshot.source = 'stub-estimator';
      this.snapshot.luminance = 0.62;
      this.snapshot.kelvinApprox = 3200;
      this.snapshot.ambientHex = 0xffedd5;
      return;
    }

    if (this.preset === 'night') {
      _targetSkyColor.setHex(0x38bdf8);
      _targetGroundColor.setHex(0x090d16);
      _targetKeyColor.setHex(0x93c5fd);
      _targetAmbientColor.setHex(0x1e3a8a);
      this.targetHemiIntensity = 1.15;
      this.targetKeyIntensity = 1.05;
      this.targetAmbientIntensity = 0.3;
      this.snapshot.source = 'stub-estimator';
      this.snapshot.luminance = 0.24;
      this.snapshot.kelvinApprox = 4400;
      this.snapshot.ambientHex = 0x38bdf8;
      return;
    }

    this.sampleEnvironmentLighting();
  }

  /**
   * ЗАГЛУШКА (STUB): локальная оценка освещения среды, если поток камеры Android
   * недоступен на десктопе или в симуляторе без веб-камеры.
   */
  private applyStubEstimatorFromPlace(): void {
    this.snapshot.source = 'stub-estimator';
    _targetSkyColor
      .setHex(this.activePlaceHorizonHex)
      .lerp(_targetKeyColor.setHex(0xe2e8f0), 0.55);
    _targetGroundColor.setHex(this.activePlaceHorizonHex).multiplyScalar(0.32);
    _targetKeyColor
      .setHex(0xfff7ed)
      .lerp(_targetAmbientColor.setHex(this.activePlaceAccentHex), 0.18);
    _targetAmbientColor.copy(_targetSkyColor);

    this.targetHemiIntensity = 1.95;
    this.targetKeyIntensity = 1.85;
    this.targetAmbientIntensity = 0.44;
    this.snapshot.luminance = 0.58;
    this.snapshot.ambientHex = _targetSkyColor.getHex();
    this.snapshot.kelvinApprox = 5400;
  }

  override dispose(): void {
    this.envMapTexture?.dispose();
  }
}
