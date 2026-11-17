import * as THREE from 'three';
import * as xb from 'xrblocks';

import type {
  SbsAspectMode,
  SbsStereoSnapshot,
} from '../types/spatial_contracts.ts';

/**
 * ============================================================================
 * МОДУЛЬ: render_sbs_stereo.ts (Side-by-Side 3D стереорендеринг для SBS/VR)
 * ============================================================================
 * НАЗНАЧЕНИЕ:
 *   Реализует настоящий одновременный Side-by-Side (SBS: Левый | Правый глаз)
 *   стереорендеринг через `THREE.StereoCamera` и перехват `xb.core.renderSceneOverride`:
 *   - Поддержка Half-SBS (стандартное соотношение на 16:9 экранах / Cardboard /
 *     телефонных VR-боксах) и Full-SBS (Rokid Max 3840×1080 3D SBS).
 *   - Настраиваемое межзрачковое расстояние IPD (54..74 мм, по умолчанию 64 мм).
 *   - Сохранение по-глазных слоёв Three.js (`layer 1` — левый глаз,
 *     `layer 2` — правый глаз), совместимое с `xb.showOnlyInLeftEye/RightEye`.
 *   - Автоматическая передача управления нативному стерео WebXR, если активна
 *     гарнитура (`renderer.xr.isPresenting === true`), чтобы не двоить буферы.
 *
 * ВХОДНЫЕ ДАННЫЕ:
 *   - `SbsStereoConfig`: начальное состояние (`initialEnabled`), режим аспекта
 *     (`initialAspectMode`), IPD (`initialIpdMm`), коллбеки `onChange` и `onLog`.
 *
 * ВЫХОДНЫЕ ДАННЫЕ:
 *   - `toggleSbs()`, `setEnabled(bool)`, `setAspectMode('half-sbs'|'full-sbs')`,
 *     `toggleAspectMode()`, `cycleIpdMm()`, `setIpdMm(mm)`, `getSnapshot()`.
 *
 * КАК ПОЛЬЗОВАТЬСЯ:
 *   const sbs = new SbsStereoRenderController({ onLog: ... });
 *   this.add(sbs);
 *   sbs.setEnabled(true); // Делит экран на Левый | Правый глаз (SBS 3D)
 *
 * ЗАГЛУШКИ (STUB) И ЗАМЕНА В ПРОДАКШНЕ:
 *   - ЗАГЛУШКА (STUB): в браузере без аппаратной коррекции дисторсии линз VR
 *     используется прямое прямоугольное SBS-деление `setViewport/setScissor`
 *     (идеально для Rokid Max 3D SBS, 3D-мониторов и Cardboard).
 *   - КАК ЗАМЕНИТЬ В ПРОДАКШНЕ: для оптик без встроенного деварпинга можно
 *     подключить постобработку с полиномиальной дисторсией Брауна-Конради (k1, k2)
 *     поверх двух половин рендер-таргета и аппаратный EDID-триггер 3840x1080
 *     через `rokid-spatial-host`.
 * ============================================================================
 */

export interface SbsStereoConfig {
  readonly initialEnabled?: boolean;
  readonly initialAspectMode?: SbsAspectMode;
  readonly initialIpdMm?: number;
  readonly onChange?: (snapshot: SbsStereoSnapshot) => void;
  readonly onLog?: (level: 'INFO' | 'DEBUG' | 'WARN', message: string) => void;
}

const IPD_PRESETS_MM = [58, 62, 64, 68, 72] as const;

// Предвыделенные структуры для Zero-GC стереорендеринга каждый кадр.
const _renderSize = new THREE.Vector2();
const _savedViewport = new THREE.Vector4();
const _savedScissor = new THREE.Vector4();

export class SbsStereoRenderController extends xb.Script {
  private readonly config: SbsStereoConfig;
  private readonly stereoCamera = new THREE.StereoCamera();

  private enabled: boolean;
  private aspectMode: SbsAspectMode;
  private ipdMm: number;
  private deferredToWebXr = false;
  private dividerOverlayEl: HTMLDivElement | null = null;
  private badgeTextEl: HTMLSpanElement | null = null;

  constructor(config: SbsStereoConfig = {}) {
    super();
    this.config = config;
    this.enabled = config.initialEnabled ?? false;
    this.aspectMode = config.initialAspectMode ?? 'half-sbs';
    this.ipdMm = THREE.MathUtils.clamp(config.initialIpdMm ?? 64, 52, 76);

    // Слой 1 -> только левый глаз, слой 2 -> только правый глаз (совместимо с XR Blocks).
    this.stereoCamera.cameraL.layers.enable(0);
    this.stereoCamera.cameraL.layers.enable(1);
    this.stereoCamera.cameraL.layers.disable(2);

    this.stereoCamera.cameraR.layers.enable(0);
    this.stereoCamera.cameraR.layers.disable(1);
    this.stereoCamera.cameraR.layers.enable(2);
    this.stereoCamera.eyeSep = this.ipdMm * 0.001;
  }

  override init(): void {
    this.syncRenderHook();
    this.syncDividerOverlay();
    this.emitChange();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getAspectMode(): SbsAspectMode {
    return this.aspectMode;
  }

  getIpdMm(): number {
    return this.ipdMm;
  }

  getSnapshot(): SbsStereoSnapshot {
    return {
      enabled: this.enabled,
      aspectMode: this.aspectMode,
      ipdMm: this.ipdMm,
      deferredToWebXrStereo: this.deferredToWebXr,
    };
  }

  toggleSbs(): boolean {
    return this.setEnabled(!this.enabled);
  }

  setEnabled(next: boolean): boolean {
    if (this.enabled === next) return this.enabled;
    this.enabled = next;
    this.syncRenderHook();
    this.syncDividerOverlay();
    this.config.onLog?.(
      'INFO',
      this.enabled
        ? `Режим Side-by-Side (SBS 3D) включён (${this.aspectMode}, IPD ${this.ipdMm}мм)`
        : 'Режим Side-by-Side (SBS 3D) выключен (Mono)'
    );
    this.emitChange();
    return this.enabled;
  }

  setAspectMode(mode: SbsAspectMode): SbsAspectMode {
    this.aspectMode = mode;
    this.syncDividerOverlay();
    this.config.onLog?.(
      'INFO',
      `Формат SBS переключён на: ${mode === 'full-sbs' ? 'Full-SBS (3840×1080 / Wide)' : 'Half-SBS (Desktop / Cardboard)'}`
    );
    this.emitChange();
    return this.aspectMode;
  }

  toggleAspectMode(): SbsAspectMode {
    const next: SbsAspectMode =
      this.aspectMode === 'half-sbs' ? 'full-sbs' : 'half-sbs';
    return this.setAspectMode(next);
  }

  setIpdMm(ipdMm: number): number {
    this.ipdMm = THREE.MathUtils.clamp(Math.round(ipdMm), 52, 76);
    this.stereoCamera.eyeSep = this.ipdMm * 0.001;
    this.syncDividerOverlay();
    this.config.onLog?.('DEBUG', `SBS IPD установлен: ${this.ipdMm} мм`);
    this.emitChange();
    return this.ipdMm;
  }

  cycleIpdMm(): number {
    const idx = IPD_PRESETS_MM.findIndex((v) => v >= this.ipdMm);
    const nextIdx = idx === -1 ? 0 : (idx + 1) % IPD_PRESETS_MM.length;
    return this.setIpdMm(IPD_PRESETS_MM[nextIdx]);
  }

  private syncRenderHook(): void {
    const core = xb.core;
    if (!core) return;
    if (this.enabled) {
      core.renderSceneOverride = this.renderSceneCallback;
    } else if (core.renderSceneOverride === this.renderSceneCallback) {
      core.renderSceneOverride = undefined;
    }
  }

  private readonly renderSceneCallback = (
    renderer: unknown,
    scene: THREE.Scene,
    camera: THREE.Camera
  ): void => {
    const glRenderer = renderer as THREE.WebGLRenderer;
    if (!glRenderer || typeof glRenderer.render !== 'function') return;

    // Если активна WebXR-сессия (гарнитура сама рисует два глаза), не режем вьюпорт повторно.
    if (glRenderer.xr?.isPresenting) {
      this.deferredToWebXr = true;
      glRenderer.render(scene, camera);
      return;
    }
    this.deferredToWebXr = false;

    if (!this.enabled) {
      glRenderer.render(scene, camera);
      return;
    }

    const perspCamera = camera as THREE.PerspectiveCamera;
    if (
      !perspCamera ||
      !perspCamera.isPerspectiveCamera ||
      typeof glRenderer.setViewport !== 'function' ||
      typeof glRenderer.getSize !== 'function'
    ) {
      glRenderer.render(scene, camera);
      return;
    }

    glRenderer.getSize(_renderSize);
    const width = Math.max(2, Math.floor(_renderSize.x));
    const height = Math.max(2, Math.floor(_renderSize.y));
    const halfWidth = Math.floor(width / 2);

    const prevScissorTest = glRenderer.getScissorTest();
    glRenderer.getViewport(_savedViewport);
    glRenderer.getScissor(_savedScissor);
    const prevAutoClear = glRenderer.autoClear;
    const prevAspect = perspCamera.aspect;

    // Half-SBS сохраняет аспект основного экрана; Full-SBS использует геометрию (w/2)/h (например, 3840x1080 -> 16:9 на глаз).
    const targetAspect =
      this.aspectMode === 'full-sbs' ? halfWidth / height : width / height;

    try {
      if (Math.abs(perspCamera.aspect - targetAspect) > 1e-4) {
        perspCamera.aspect = targetAspect;
        perspCamera.updateProjectionMatrix();
      }
      perspCamera.updateMatrixWorld();

      this.stereoCamera.eyeSep = this.ipdMm * 0.001;
      this.stereoCamera.aspect = targetAspect;
      this.stereoCamera.update(perspCamera);

      glRenderer.setScissorTest(true);
      glRenderer.autoClear = false;

      // Левый глаз (левая половина экрана)
      glRenderer.setViewport(0, 0, halfWidth, height);
      glRenderer.setScissor(0, 0, halfWidth, height);
      glRenderer.clear(true, true, true);
      glRenderer.render(scene, this.stereoCamera.cameraL);

      // Правый глаз (правая половина экрана)
      const rightWidth = width - halfWidth;
      glRenderer.setViewport(halfWidth, 0, rightWidth, height);
      glRenderer.setScissor(halfWidth, 0, rightWidth, height);
      glRenderer.clear(true, true, true);
      glRenderer.render(scene, this.stereoCamera.cameraR);
    } finally {
      if (Math.abs(perspCamera.aspect - prevAspect) > 1e-4) {
        perspCamera.aspect = prevAspect;
        perspCamera.updateProjectionMatrix();
      }
      glRenderer.setViewport(_savedViewport);
      glRenderer.setScissor(_savedScissor);
      glRenderer.setScissorTest(prevScissorTest);
      glRenderer.autoClear = prevAutoClear;
    }
  };

  private syncDividerOverlay(): void {
    if (typeof document === 'undefined') return;

    if (!this.enabled) {
      if (this.dividerOverlayEl) {
        this.dividerOverlayEl.style.display = 'none';
      }
      return;
    }

    if (!this.dividerOverlayEl) {
      const container = document.createElement('div');
      container.setAttribute('aria-hidden', 'true');
      container.style.position = 'fixed';
      container.style.inset = '0';
      container.style.pointerEvents = 'none';
      container.style.zIndex = '5';

      const centerLine = document.createElement('div');
      centerLine.style.position = 'absolute';
      centerLine.style.top = '0';
      centerLine.style.bottom = '0';
      centerLine.style.left = '50%';
      centerLine.style.width = '1px';
      centerLine.style.background =
        'linear-gradient(to bottom, rgba(56,189,248,0.65), rgba(255,255,255,0.22), rgba(56,189,248,0.65))';

      const badge = document.createElement('span');
      badge.style.position = 'absolute';
      badge.style.top = '10px';
      badge.style.left = '50%';
      badge.style.transform = 'translateX(-50%)';
      badge.style.padding = '3px 10px';
      badge.style.borderRadius = '8px';
      badge.style.fontSize = '11px';
      badge.style.fontWeight = '600';
      badge.style.letterSpacing = '0.04em';
      badge.style.color = '#e0f2fe';
      badge.style.backgroundColor = 'rgba(8, 15, 30, 0.72)';
      badge.style.border = '1px solid rgba(56, 189, 248, 0.45)';

      container.appendChild(centerLine);
      container.appendChild(badge);
      document.body.appendChild(container);
      this.dividerOverlayEl = container;
      this.badgeTextEl = badge;
    }

    this.dividerOverlayEl.style.display = 'block';
    if (this.badgeTextEl) {
      const modeLabel =
        this.aspectMode === 'full-sbs' ? 'FULL-SBS 3D' : 'HALF-SBS 3D';
      this.badgeTextEl.textContent = `L | R  ${modeLabel} • IPD ${this.ipdMm}mm (Y / Alt+Y)`;
    }
  }

  private emitChange(): void {
    this.config.onChange?.(this.getSnapshot());
  }

  override dispose(): void {
    if (xb.core?.renderSceneOverride === this.renderSceneCallback) {
      xb.core.renderSceneOverride = undefined;
    }
    this.dividerOverlayEl?.remove();
    this.dividerOverlayEl = null;
    this.badgeTextEl = null;
  }
}
