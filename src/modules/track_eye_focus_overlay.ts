import * as THREE from 'three';
import * as xb from 'xrblocks';

import type {
  EyeFocusSnapshot,
  ManagedSpatialWindow,
  SpatialAppId,
} from '../types/spatial_contracts.ts';

/**
 * ============================================================================
 * МОДУЛЬ: track_eye_focus_overlay.ts (Оверлей отслеживания взгляда и фокуса)
 * ============================================================================
 * НАЗНАЧЕНИЕ:
 *   Отслеживает направление взгляда пользователя на виртуальные 3D-окна,
 *   подсвечивает целевое окно светящейся 3D-рамкой фокуса в пространстве и
 *   отображает компактный оверлей-индикатор `'focus'` для голосовых команд и
 *   жестов. При удержании взгляда (dwell >= 700 мс) может автоматически
 *   переводить активный фокус на выбранное окно.
 *
 * ВХОДНЫЕ ДАННЫЕ:
 *   - `getWindows()`: список управляемых 3D-окон.
 *   - `onGazeDwellFocus(appId)`: коллбек активации окна по удержанию взгляда.
 *   - `onGazeChange(snapshot)`: уведомление оркестратора об изменении цели.
 *
 * ВЫХОДНЫЕ ДАННЫЕ:
 *   - Визуальная 3D-рамка подсветки окна + view-space `UIOverlay` индикатор `FOCUS`.
 *   - Методы `getGazedWindowId()`, `toggle()`, `setEnabled()`.
 *
 * КАК ПОЛЬЗОВАТЬСЯ:
 *   const eyeFocus = new EyeTrackingFocusController({
 *     getWindows: () => windowManager.getWindows(),
 *     onGazeDwellFocus: (id) => windowManager.focusWindow(id),
 *   });
 *   this.add(eyeFocus);
 *
 * ЗАГЛУШКИ (STUB) И ЗАМЕНА В ПРОДАКШНЕ:
 *   - ЗАГЛУШКА (STUB): стандартный браузер/симулятор без аппаратного сенсора
 *     отслеживания глаз использует центральный фовеальный луч камеры
 *     (`xb.core.camera`, аналогично `xb.GazeController`) как симуляцию взгляда.
 *   - КАК ЗАМЕНИТЬ В ПРОДАКШНЕ: если активен WebXR-источник с
 *     `targetRayMode === 'gaze'` или нативный поток взгляда Rokid/Android XR
 *     через `rokid-spatial-host`, модуль автоматически использует вектор взгляда
 *     из `targetRaySpace`.
 * ============================================================================
 */

export interface EyeTrackingFocusConfig {
  readonly getWindows: () => readonly ManagedSpatialWindow[];
  readonly initialEnabled?: boolean;
  readonly dwellAutoFocusMs?: number;
  readonly onGazeDwellFocus?: (id: SpatialAppId) => void;
  readonly onGazeChange?: (snapshot: EyeFocusSnapshot) => void;
  readonly onVisibilityChange?: (enabled: boolean) => void;
  readonly onLog?: (level: 'DEBUG' | 'INFO' | 'WARN', message: string) => void;
}

const DEFAULT_DWELL_MS = 700;

// Предвыделенные структуры для Zero-GC лучевого перебора окон каждый кадр.
const _rayOrigin = new THREE.Vector3();
const _rayDir = new THREE.Vector3();
const _cardWorldPos = new THREE.Vector3();
const _cardWorldQuat = new THREE.Quaternion();
const _cardWorldScale = new THREE.Vector3();
const _cardMatrix = new THREE.Matrix4();
const _invCardMatrix = new THREE.Matrix4();
const _localOrigin = new THREE.Vector3();
const _localDir = new THREE.Vector3();
const _localHit = new THREE.Vector3();
const _worldHit = new THREE.Vector3();
const _gazeForward = new THREE.Vector3(0, 0, -1);
const _targetFrameScale = new THREE.Vector3(1, 1, 1);

export class EyeTrackingFocusController extends xb.Script {
  private readonly config: EyeTrackingFocusConfig;
  private readonly dwellAutoFocusMs: number;

  private enabled: boolean;
  private dwellAutoFocus = true;

  private focusFrameGroup!: THREE.Group;
  private bracketMaterial!: THREE.MeshBasicMaterial;
  private cornerMeshes: THREE.Mesh[] = [];
  private bracketArms: Array<{mesh: THREE.Mesh; offsetX: number; offsetY: number; rotZ: number}> = [];

  private overlay!: xb.UIOverlay;
  private focusBadgeText!: xb.UIText;
  private focusHintText!: xb.UIText;
  private dwellBarFill!: xb.UIPanel;

  private currentWindow: ManagedSpatialWindow | null = null;
  private currentSource: 'webxr-eye-gaze' | 'stub-center-fovea' = 'stub-center-fovea';
  private gazeEnteredAtMs = 0;
  private dwellTriggeredForWindow = false;
  private pulseTime = 0;
  private frameActive = false;

  private readonly snapshot: EyeFocusSnapshot = {
    enabled: true,
    source: 'stub-center-fovea',
    gazedWindowId: null,
    gazedWindowTitle: null,
    dwellProgress: 0,
    dwellAutoFocus: true,
  };

  constructor(config: EyeTrackingFocusConfig) {
    super();
    this.config = config;
    this.enabled = config.initialEnabled ?? true;
    this.dwellAutoFocusMs = config.dwellAutoFocusMs ?? DEFAULT_DWELL_MS;
    this.snapshot.enabled = this.enabled;
  }

  override init(): void {
    this.build3DFocusFrame();
    this.buildFocusOverlay();
    this.applyEnabledState();
    this.config.onLog?.(
      'INFO',
      `Оверлей отслеживания взгляда инициализирован (${this.enabled ? 'ON' : 'OFF'})`
    );
  }

  override update(): void {
    if (!this.enabled) return;

    const dt = Math.min(xb.getDeltaTime() || 0.016, 0.1);
    this.pulseTime += dt;

    if (!this.resolveGazeRay(_rayOrigin, _rayDir)) {
      this.clearGazeTarget();
      return;
    }

    const hitWindow = this.findLookedAtWindow(_rayOrigin, _rayDir);
    const now = performance.now();

    if (hitWindow !== this.currentWindow) {
      this.currentWindow = hitWindow;
      this.gazeEnteredAtMs = now;
      this.dwellTriggeredForWindow = false;

      this.snapshot.gazedWindowId = hitWindow ? hitWindow.id : null;
      this.snapshot.gazedWindowTitle = hitWindow ? hitWindow.title : null;
      this.snapshot.dwellProgress = 0;
      this.config.onGazeChange?.(this.snapshot);
      this.refreshOverlayText();
    }

    if (!hitWindow) {
      this.focusFrameGroup.visible = false;
      this.frameActive = false;
      this.dwellBarFill.style.width = '0%';
      return;
    }

    // Расчёт прогресса удержания взгляда (Dwell Focus).
    const elapsedMs = now - this.gazeEnteredAtMs;
    const progress = THREE.MathUtils.clamp(
      elapsedMs / this.dwellAutoFocusMs,
      0,
      1
    );
    this.snapshot.dwellProgress = Number(progress.toFixed(2));
    this.dwellBarFill.style.width = `${Math.round(progress * 100)}%`;

    if (
      this.dwellAutoFocus &&
      !this.dwellTriggeredForWindow &&
      elapsedMs >= this.dwellAutoFocusMs
    ) {
      this.dwellTriggeredForWindow = true;
      this.config.onGazeDwellFocus?.(hitWindow.id);
      this.refreshOverlayText();
    }

    this.update3DFocusFrame(hitWindow, dt, progress);
  }

  setEnabled(enabled: boolean): boolean {
    this.enabled = enabled;
    this.snapshot.enabled = enabled;
    this.applyEnabledState();
    this.config.onVisibilityChange?.(enabled);
    this.config.onGazeChange?.(this.snapshot);
    this.config.onLog?.(
      'INFO',
      `Оверлей отслеживания взгляда: ${enabled ? 'ON' : 'OFF'}`
    );
    return this.enabled;
  }

  toggle(): boolean {
    return this.setEnabled(!this.enabled);
  }

  setDwellAutoFocus(autoFocus: boolean): boolean {
    this.dwellAutoFocus = autoFocus;
    this.snapshot.dwellAutoFocus = autoFocus;
    this.refreshOverlayText();
    return this.dwellAutoFocus;
  }

  getGazedWindowId(): SpatialAppId | null {
    return this.enabled ? this.snapshot.gazedWindowId : null;
  }

  getSnapshot(): EyeFocusSnapshot {
    return this.snapshot;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  private applyEnabledState(): void {
    if (this.overlay) {
      this.overlay.visible = this.enabled;
    }
    if (!this.enabled) {
      this.clearGazeTarget();
    }
  }

  private clearGazeTarget(): void {
    const changed = this.currentWindow !== null;
    this.currentWindow = null;
    this.frameActive = false;
    if (this.focusFrameGroup) {
      this.focusFrameGroup.visible = false;
    }
    this.snapshot.gazedWindowId = null;
    this.snapshot.gazedWindowTitle = null;
    this.snapshot.dwellProgress = 0;
    if (this.dwellBarFill) {
      this.dwellBarFill.style.width = '0%';
    }
    if (changed) {
      this.config.onGazeChange?.(this.snapshot);
    }
    this.refreshOverlayText();
  }

  /**
   * Считывает луч взгляда: приоритет WebXR Eye-Gaze -> fallback центральная ось камеры.
   */
  private resolveGazeRay(originOut: THREE.Vector3, dirOut: THREE.Vector3): boolean {
    const xrManager = xb.core?.renderer?.xr;
    const frame = xrManager?.getFrame?.();
    const refSpace = xrManager?.getReferenceSpace?.();
    const session = xrManager?.getSession?.();

    if (session && frame && refSpace) {
      for (const source of session.inputSources) {
        if (source.targetRayMode === 'gaze' && source.targetRaySpace) {
          const pose = frame.getPose(source.targetRaySpace, refSpace);
          if (pose) {
            originOut.set(
              pose.transform.position.x,
              pose.transform.position.y,
              pose.transform.position.z
            );
            _cardWorldQuat.set(
              pose.transform.orientation.x,
              pose.transform.orientation.y,
              pose.transform.orientation.z,
              pose.transform.orientation.w
            );
            dirOut.copy(_gazeForward).applyQuaternion(_cardWorldQuat).normalize();
            this.currentSource = 'webxr-eye-gaze';
            this.snapshot.source = 'webxr-eye-gaze';
            return true;
          }
        }
      }
    }

    const camera = xb.core?.camera;
    if (!camera) return false;
    camera.getWorldPosition(originOut);
    camera.getWorldQuaternion(_cardWorldQuat);
    dirOut.copy(_gazeForward).applyQuaternion(_cardWorldQuat).normalize();
    this.currentSource = 'stub-center-fovea';
    this.snapshot.source = 'stub-center-fovea';
    return true;
  }

  /**
   * Быстрый Zero-GC перебор видимых окон аналитическим пересечением луча с плоскостью карточки.
   */
  private findLookedAtWindow(
    rayOrigin: THREE.Vector3,
    rayDir: THREE.Vector3
  ): ManagedSpatialWindow | null {
    const windows = this.config.getWindows();
    let bestWindow: ManagedSpatialWindow | null = null;
    let bestDist = Infinity;

    for (const win of windows) {
      if (!win.card.visible) continue;

      win.card.getWorldPosition(_cardWorldPos);
      win.card.getWorldQuaternion(_cardWorldQuat);
      win.card.getWorldScale(_cardWorldScale);

      _cardMatrix.compose(_cardWorldPos, _cardWorldQuat, _cardWorldScale);
      _invCardMatrix.copy(_cardMatrix).invert();

      _localOrigin.copy(rayOrigin).applyMatrix4(_invCardMatrix);
      _localDir
        .copy(rayDir)
        .transformDirection(_invCardMatrix)
        .normalize();

      if (Math.abs(_localDir.z) < 0.001) continue;
      const t = -_localOrigin.z / _localDir.z;
      if (t <= 0.1) continue;

      _localHit.copy(_localOrigin).addScaledVector(_localDir, t);

      const cardWidth =
        typeof win.card.size?.width === 'number' ? win.card.size.width : 0.64;
      const cardHeight =
        typeof win.card.size?.height === 'number' ? win.card.size.height : 0.48;
      // Допускаем небольшой фовеальный запас (+0.04 м) по краям для комфортного выбора.
      const halfW = cardWidth * 0.5 + 0.04;
      const halfH = cardHeight * 0.5 + 0.04;

      if (
        Math.abs(_localHit.x) <= halfW &&
        Math.abs(_localHit.y) <= halfH
      ) {
        _worldHit.copy(_localHit).applyMatrix4(_cardMatrix);
        const worldDist = rayOrigin.distanceTo(_worldHit);
        if (worldDist < bestDist) {
          bestDist = worldDist;
          bestWindow = win;
        }
      }
    }

    return bestWindow;
  }

  private build3DFocusFrame(): void {
    this.focusFrameGroup = new THREE.Group();
    this.focusFrameGroup.name = 'EyeTrackingFocusFrame';
    this.focusFrameGroup.visible = false;
    this.focusFrameGroup.xb = {pointerEvents: 'none'};

    this.bracketMaterial = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.92,
      depthTest: false,
    });

    const armGeo = new THREE.BoxGeometry(0.085, 0.011, 0.006);
    const corners: Array<[number, number]> = [
      [-1, 1],
      [1, 1],
      [-1, -1],
      [1, -1],
    ];

    for (const [cx, cy] of corners) {
      const horiz = new THREE.Mesh(armGeo, this.bracketMaterial);
      horiz.renderOrder = 60;
      horiz.xb = {pointerEvents: 'none'};

      const vert = new THREE.Mesh(armGeo, this.bracketMaterial);
      vert.rotation.z = Math.PI / 2;
      vert.renderOrder = 60;
      vert.xb = {pointerEvents: 'none'};

      this.cornerMeshes.push(horiz, vert);
      this.bracketArms.push(
        {mesh: horiz, offsetX: cx, offsetY: cy, rotZ: 0},
        {mesh: vert, offsetX: cx, offsetY: cy, rotZ: Math.PI / 2}
      );
      this.focusFrameGroup.add(horiz, vert);
    }

    this.add(this.focusFrameGroup);
  }

  private update3DFocusFrame(
    win: ManagedSpatialWindow,
    dt: number,
    progress: number
  ): void {
    win.card.getWorldPosition(_cardWorldPos);
    win.card.getWorldQuaternion(_cardWorldQuat);
    win.card.getWorldScale(_cardWorldScale);

    // Выносим рамку на 1.4 см перед поверхностью окна.
    _localOrigin.set(0, 0, 0.014).applyQuaternion(_cardWorldQuat);
    _cardWorldPos.add(_localOrigin);

    if (!this.frameActive) {
      this.focusFrameGroup.position.copy(_cardWorldPos);
      this.focusFrameGroup.quaternion.copy(_cardWorldQuat);
      this.focusFrameGroup.scale.copy(_cardWorldScale);
      this.frameActive = true;
    } else {
      const smooth = 1 - Math.exp(-dt * 18);
      this.focusFrameGroup.position.lerp(_cardWorldPos, smooth);
      this.focusFrameGroup.quaternion.slerp(_cardWorldQuat, smooth);
      _targetFrameScale.copy(_cardWorldScale);
      this.focusFrameGroup.scale.lerp(_targetFrameScale, smooth);
    }

    const cardWidth =
      typeof win.card.size?.width === 'number' ? win.card.size.width : 0.64;
    const cardHeight =
      typeof win.card.size?.height === 'number' ? win.card.size.height : 0.48;

    const pulse = 0.02 + Math.sin(this.pulseTime * 5.2) * 0.008;
    const halfW = cardWidth * 0.5 + pulse;
    const halfH = cardHeight * 0.5 + pulse;

    for (const arm of this.bracketArms) {
      const armInset = 0.038;
      if (arm.rotZ === 0) {
        arm.mesh.position.set(
          arm.offsetX * (halfW - armInset),
          arm.offsetY * halfH,
          0
        );
      } else {
        arm.mesh.position.set(
          arm.offsetX * halfW,
          arm.offsetY * (halfH - armInset),
          0
        );
      }
    }

    const locked = this.dwellTriggeredForWindow || progress >= 0.99;
    this.bracketMaterial.color.setHex(locked ? 0x34d399 : 0x38bdf8);
    this.bracketMaterial.opacity = 0.72 + Math.sin(this.pulseTime * 4) * 0.2;
    this.focusFrameGroup.visible = true;
  }

  private buildFocusOverlay(): void {
    this.focusBadgeText = new xb.UIText({
      text: '👁 FOCUS: Наведите взгляд на 3D-окно',
      pointerEvents: 'none',
      style: {
        fontSize: 13,
        fontWeight: 'bold',
        color: '#38bdf8',
        textAlign: 'center',
      },
    });

    this.focusHintText = new xb.UIText({
      text: 'Цель для голоса/жестов: ожидание...',
      pointerEvents: 'none',
      style: {
        fontSize: 11,
        opacity: 0.78,
        textAlign: 'center',
      },
    });

    this.dwellBarFill = new xb.UIPanel({
      pointerEvents: 'none',
      style: {
        width: '0%',
        height: 4,
        borderRadius: 2,
        backgroundColor: '#38bdf8',
      },
    });

    const dwellTrack = new xb.UIPanel({
      pointerEvents: 'none',
      style: {
        width: '100%',
        height: 4,
        borderRadius: 2,
        backgroundColor: 'rgba(255, 255, 255, 0.14)',
        overflow: 'hidden',
      },
      children: [this.dwellBarFill],
    });

    this.overlay = new xb.UIOverlay({
      pointerEvents: 'none',
      style: {
        width: 440,
        position: 'absolute',
        left: '50%',
        bottom: 78,
        transform: {translateX: '-50%'},
        flexDirection: 'column',
        gap: 4,
        padding: 10,
        borderRadius: 14,
      },
      children: [this.focusBadgeText, this.focusHintText, dwellTrack],
    });
    this.overlay.name = 'EyeTrackingFocusOverlay';
    this.add(this.overlay);
  }

  private refreshOverlayText(): void {
    if (!this.focusBadgeText || !this.focusHintText) return;
    if (!this.currentWindow) {
      this.focusBadgeText.text = '👁 FOCUS: Наведите взгляд на любое 3D-окно';
      this.focusBadgeText.style.color = '#94a3b8';
      this.focusHintText.text =
        this.currentSource === 'webxr-eye-gaze'
          ? 'Датчик глаз: WebXR Eye-Gaze активен'
          : 'Отслеживание взгляда (F): фокус для голоса и жестов';
      return;
    }

    const locked = this.dwellTriggeredForWindow;
    this.focusBadgeText.text = `👁 FOCUS: ${this.currentWindow.title}`;
    this.focusBadgeText.style.color = locked ? '#34d399' : '#38bdf8';
    this.focusHintText.text = locked
      ? 'Окно в фокусе! Голосовые команды («закрепи») и жесты направлены сюда'
      : 'Удерживайте взгляд для автофокуса или скажите команду...';
  }

  override dispose(): void {
    if (this.cornerMeshes.length > 0) {
      this.cornerMeshes[0].geometry.dispose();
    }
    this.bracketMaterial?.dispose();
  }
}
