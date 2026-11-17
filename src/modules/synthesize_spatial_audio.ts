import * as THREE from 'three';
import * as xb from 'xrblocks';

import type {
  ManagedSpatialWindow,
  SpatialAppId,
  WindowSpatialAudioTelemetry,
} from '../types/spatial_contracts.ts';

/**
 * ============================================================================
 * МОДУЛЬ: synthesize_spatial_audio.ts (Пространственный звук Web Audio API)
 * ============================================================================
 * НАЗНАЧЕНИЕ:
 *   Реализует 3D-позиционированный звук на базе стандартного **Web Audio API**
 *   (`AudioContext`, `AudioListener`, `PannerNode` с моделью `HRTF`):
 *   - Каждое из 6 приложений (`terminal`, `notes`, `telemetry`, `studio`,
 *     `viewport3d`, `places`) привязано к собственному `PannerNode` в 3D.
 *   - В каждом кадре (`update()`) обновляются мировые координаты и ориентация
 *     слушателя (камеры пользователя) и источников (3D-окон), что автоматически
 *     меняет **громкость по расстоянию** (`inverse` rolloff) и **бинауральное
 *     панорамирование влево/вправо/вглубь** (`HRTF`).
 *   - Скрытые окна (`!card.visible`, например при переключении в режим `Media`
 *     или `Development`) плавно приглушают свой звуковой канал до нуля.
 *   - Поддерживает 3D-пространственные звуковые отклики (`playSpatialPing`)
 *     в точной 3D-позиции активного окна при фокусе, пине или тесте звука.
 *
 * ВХОДНЫЕ ДАННЫЕ:
 *   - `getWindows()`: список `ManagedSpatialWindow[]`.
 *   - `getActiveWindowId()`: ID активного окна для приоритетного акцента.
 *   - `setEnabled(enabled)`, `setMasterVolume(volume)`, `playSpatialPing(appId)`.
 *
 * ВЫХОДНЫЕ ДАННЫЕ:
 *   - Живая телеметрия `getTelemetrySnapshot()` (`distanceMeters`, `pan`, `gain`)
 *     и краткая строка `getActiveWindowSummary()` для HUD/редактора/отладчика.
 *
 * КАК ПОЛЬЗОВАТЬСЯ:
 *   const spatialAudio = new SpatialAudioEngine({
 *     getWindows: () => windowManager.getWindows(),
 *     getActiveWindowId: () => windowManager.getActiveWindowId(),
 *     onLog: (lvl, msg) => monitor.log(lvl, 'AUDIO', msg),
 *   });
 *   this.add(spatialAudio);
 *   // По клику пользователя:
 *   spatialAudio.playSpatialPing('studio');
 *
 * ЗАГЛУШКИ (STUB) И ЗАМЕНА В ПРОДАКШНЕ:
 *   - ЗАГЛУШКА АУДИОПОТОКОВ ОКОН: чтобы приложение работало без внешних `.mp3`/
 *     `.wav` файлов и 404-ошибок, звуковые каналы окон генерируются процедурно
 *     через узлы Web Audio API (`OscillatorNode` + `BiquadFilterNode` +
 *     мягкая огибающая LFO).
 *   - КАК ЗАМЕНИТЬ В ПРОДАКШНЕ: подключите реальные медиапотоки приложений через
 *     `audioCtx.createMediaElementSource(videoEl)` (для Media-плеера),
 *     `audioCtx.createMediaStreamSource(rtcStream)` (для звонков Communication),
 *     или стриминг системного аудио каналов из демона `rokid-spatial-host`
 *     вместо `createProceduralAppSource()`, подавая их на существующий `panner`.
 * ============================================================================
 */

export interface SpatialAudioEngineConfig {
  readonly getWindows: () => readonly ManagedSpatialWindow[];
  readonly getActiveWindowId: () => SpatialAppId;
  readonly initialEnabled?: boolean;
  readonly initialVolume?: number;
  readonly onTelemetryUpdate?: (
    activeSummary: string,
    all: readonly WindowSpatialAudioTelemetry[]
  ) => void;
  readonly onLog?: (level: 'DEBUG' | 'INFO' | 'WARN', message: string) => void;
}

interface AppAudioChannel {
  readonly appId: SpatialAppId;
  readonly panner: PannerNode;
  readonly channelGain: GainNode;
  readonly baseGain: number;
  readonly carrierFreq: number;
  readonly oscPrimary: OscillatorNode;
  readonly oscHarmonic: OscillatorNode;
  readonly lfoOsc: OscillatorNode;
  readonly lfoDepth: GainNode;
}

interface AppToneSpec {
  readonly freq: number;
  readonly harmonicRatio: number;
  readonly baseGain: number;
  readonly lfoHz: number;
  readonly waveform: OscillatorType;
}

const APP_TONE_SPECS: Record<SpatialAppId, AppToneSpec> = {
  terminal: {
    freq: 196.0,
    harmonicRatio: 1.5,
    baseGain: 0.022,
    lfoHz: 0.45,
    waveform: 'triangle',
  },
  notes: {
    freq: 261.63,
    harmonicRatio: 1.25,
    baseGain: 0.026,
    lfoHz: 0.25,
    waveform: 'sine',
  },
  telemetry: {
    freq: 329.63,
    harmonicRatio: 2.0,
    baseGain: 0.018,
    lfoHz: 0.6,
    waveform: 'sine',
  },
  studio: {
    freq: 220.0,
    harmonicRatio: 1.5,
    baseGain: 0.028,
    lfoHz: 0.2,
    waveform: 'sine',
  },
  viewport3d: {
    freq: 440.0,
    harmonicRatio: 1.5,
    baseGain: 0.02,
    lfoHz: 0.35,
    waveform: 'triangle',
  },
  places: {
    freq: 174.61,
    harmonicRatio: 1.498,
    baseGain: 0.032,
    lfoHz: 0.16,
    waveform: 'sine',
  },
};

const REF_DISTANCE = 0.75;
const MAX_DISTANCE = 8.0;
const ROLLOFF_FACTOR = 1.35;

// Предвыделенные объекты для Zero-GC обновлений в цикле `update()`.
const _camPos = new THREE.Vector3();
const _camQuat = new THREE.Quaternion();
const _camForward = new THREE.Vector3();
const _camUp = new THREE.Vector3();
const _camRight = new THREE.Vector3();
const _winPos = new THREE.Vector3();
const _winQuat = new THREE.Quaternion();
const _winForward = new THREE.Vector3();
const _toWin = new THREE.Vector3();

export class SpatialAudioEngine extends xb.Script {
  private readonly config: SpatialAudioEngineConfig;
  private enabledState: boolean;
  private masterVolume: number;

  private audioCtx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private readonly channels = new Map<SpatialAppId, AppAudioChannel>();
  private readonly telemetryList: WindowSpatialAudioTelemetry[] = [];
  private readonly telemetryByApp = new Map<
    SpatialAppId,
    WindowSpatialAudioTelemetry
  >();

  private unlocked = false;
  private lastTelemetryEmitMs = 0;
  private lastActiveSummary = '3D-Аудио: нажмите любое действие для запуска';

  constructor(config: SpatialAudioEngineConfig) {
    super();
    this.config = config;
    this.enabledState = config.initialEnabled ?? true;
    this.masterVolume = THREE.MathUtils.clamp(
      config.initialVolume ?? 0.65,
      0,
      1
    );
  }

  override init(): void {
    window.addEventListener('pointerdown', this.handleUserGestureUnlock, {
      passive: true,
    });
    window.addEventListener('keydown', this.handleUserGestureUnlock, {
      passive: true,
    });

    this.config.onLog?.(
      'INFO',
      'Модуль пространственного звука Web Audio API (HRTF 3D) готов'
    );
  }

  override update(): void {
    const camera = xb.core?.camera;
    if (!camera) return;

    camera.getWorldPosition(_camPos);
    camera.getWorldQuaternion(_camQuat);
    _camForward.set(0, 0, -1).applyQuaternion(_camQuat).normalize();
    _camUp.set(0, 1, 0).applyQuaternion(_camQuat).normalize();
    _camRight.set(1, 0, 0).applyQuaternion(_camQuat).normalize();

    if (this.audioCtx && this.audioCtx.state === 'running') {
      this.applyListenerPose(
        this.audioCtx,
        _camPos,
        _camForward,
        _camUp
      );
    }

    const windows = this.config.getWindows();
    const activeId = this.config.getActiveWindowId();
    const nowTime = this.audioCtx?.currentTime ?? 0;

    for (let i = 0; i < windows.length; i++) {
      const win = windows[i];
      win.card.getWorldPosition(_winPos);
      win.card.getWorldQuaternion(_winQuat);
      _winForward.set(0, 0, 1).applyQuaternion(_winQuat).normalize();

      _toWin.subVectors(_winPos, _camPos);
      const dist = Math.max(0.15, _toWin.length());
      _toWin.divideScalar(dist);
      const pan = THREE.MathUtils.clamp(_toWin.dot(_camRight), -1, 1);

      // Аналитическая оценка затухания inverse-distance для HUD/логов.
      const clampedDist = Math.max(REF_DISTANCE, Math.min(dist, MAX_DISTANCE));
      const distGain =
        REF_DISTANCE /
        (REF_DISTANCE + ROLLOFF_FACTOR * (clampedDist - REF_DISTANCE));
      const focusBoost = win.id === activeId ? 1.0 : 0.45;
      const effectiveGain =
        this.enabledState && win.card.visible
          ? distGain * focusBoost * this.masterVolume
          : 0;

      let item = this.telemetryByApp.get(win.id);
      if (!item) {
        item = {
          appId: win.id,
          title: win.title,
          enabled: win.card.visible && this.enabledState,
          distanceMeters: dist,
          pan,
          gain: effectiveGain,
        };
        this.telemetryByApp.set(win.id, item);
        this.telemetryList.push(item);
      } else {
        item.enabled = win.card.visible && this.enabledState;
        item.distanceMeters = dist;
        item.pan = pan;
        item.gain = effectiveGain;
      }

      const channel = this.channels.get(win.id);
      if (channel && this.audioCtx && this.audioCtx.state === 'running') {
        this.applyPannerPose(channel.panner, _winPos, _winForward, nowTime);
        const targetGain =
          this.enabledState && win.card.visible
            ? channel.baseGain * focusBoost
            : 0;
        channel.channelGain.gain.setTargetAtTime(targetGain, nowTime, 0.08);
      }
    }

    const nowMs = performance.now();
    if (nowMs - this.lastTelemetryEmitMs >= 200) {
      this.lastTelemetryEmitMs = nowMs;
      const activeMetrics = this.telemetryByApp.get(activeId);
      if (activeMetrics) {
        const panDir =
          activeMetrics.pan < -0.08
            ? `L ${Math.abs(activeMetrics.pan).toFixed(2)}`
            : activeMetrics.pan > 0.08
              ? `R ${activeMetrics.pan.toFixed(2)}`
              : 'Center';
        const engineLabel = !this.enabledState
          ? 'Muted'
          : this.audioCtx?.state === 'running'
            ? 'HRTF 3D'
            : 'Standby';
        this.lastActiveSummary =
          `3D-Аудио [${engineLabel}] ${activeId}: ` +
          `${activeMetrics.distanceMeters.toFixed(2)}м | Pan ${panDir} | ` +
          `Vol ${Math.round(activeMetrics.gain * 100)}%`;
      }
      this.config.onTelemetryUpdate?.(
        this.lastActiveSummary,
        this.telemetryList
      );
    }
  }

  isEnabled(): boolean {
    return this.enabledState;
  }

  getMasterVolume(): number {
    return this.masterVolume;
  }

  getActiveWindowSummary(): string {
    return this.lastActiveSummary;
  }

  setEnabled(enabled: boolean): boolean {
    this.enabledState = enabled;
    if (enabled) {
      this.ensureAudioContextRunning();
    }
    if (this.masterGain && this.audioCtx) {
      this.masterGain.gain.setTargetAtTime(
        enabled ? this.masterVolume : 0,
        this.audioCtx.currentTime,
        0.06
      );
    }
    this.config.onLog?.(
      'INFO',
      enabled
        ? 'Пространственное 3D-аудио (HRTF) включено'
        : 'Пространственное 3D-аудио отключено'
    );
    return this.enabledState;
  }

  toggleEnabled(): boolean {
    const next = this.setEnabled(!this.enabledState);
    if (next) {
      this.playSpatialPing(this.config.getActiveWindowId());
    }
    return next;
  }

  adjustVolume(delta: number): number {
    this.masterVolume = THREE.MathUtils.clamp(
      this.masterVolume + delta,
      0.05,
      1.0
    );
    this.ensureAudioContextRunning();
    if (this.masterGain && this.audioCtx && this.enabledState) {
      this.masterGain.gain.setTargetAtTime(
        this.masterVolume,
        this.audioCtx.currentTime,
        0.05
      );
    }
    this.playSpatialPing(this.config.getActiveWindowId());
    this.config.onLog?.(
      'INFO',
      `Громкость 3D-аудио: ${Math.round(this.masterVolume * 100)}%`
    );
    return this.masterVolume;
  }

  /**
   * Воспроизводит чистый 3D-пространственный отклик из позиции указанного окна,
   * чтобы пользователь чётко слышал панорамирование L/R и затухание по дистанции.
   */
  playSpatialPing(appId: SpatialAppId, freqBoost = 1.0): void {
    if (!this.enabledState) return;
    this.ensureAudioContextRunning();
    if (!this.audioCtx || !this.masterGain) return;

    const channel = this.channels.get(appId);
    if (!channel) return;

    const now = this.audioCtx.currentTime;
    const osc = this.audioCtx.createOscillator();
    const subOsc = this.audioCtx.createOscillator();
    const envGain = this.audioCtx.createGain();

    const baseFreq = channel.carrierFreq * 2 * freqBoost;
    osc.type = 'sine';
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.25, now + 0.16);

    subOsc.type = 'triangle';
    subOsc.frequency.setValueAtTime(baseFreq * 1.5, now);

    envGain.gain.setValueAtTime(0.0001, now);
    envGain.gain.exponentialRampToValueAtTime(0.16, now + 0.025);
    envGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);

    osc.connect(envGain);
    subOsc.connect(envGain);
    envGain.connect(channel.panner);

    osc.start(now);
    subOsc.start(now);
    osc.stop(now + 0.45);
    subOsc.stop(now + 0.45);
  }

  private readonly handleUserGestureUnlock = (): void => {
    if (!this.enabledState) return;
    this.ensureAudioContextRunning();
  };

  private ensureAudioContextRunning(): void {
    if (typeof window === 'undefined') return;
    const AudioCtxCtor =
      window.AudioContext ||
      (window as unknown as {webkitAudioContext?: typeof AudioContext})
        .webkitAudioContext;
    if (!AudioCtxCtor) return;

    if (!this.audioCtx) {
      try {
        this.audioCtx = new AudioCtxCtor();
        this.masterGain = this.audioCtx.createGain();
        this.masterGain.gain.value = this.enabledState ? this.masterVolume : 0;
        this.masterGain.connect(this.audioCtx.destination);
        this.buildAllWindowChannels(this.audioCtx, this.masterGain);
      } catch (error) {
        this.config.onLog?.(
          'WARN',
          `Не удалось инициализировать Web Audio API: ${String(error)}`
        );
        return;
      }
    }

    if (this.audioCtx.state === 'suspended') {
      void this.audioCtx.resume().then(() => {
        if (!this.unlocked) {
          this.unlocked = true;
          this.config.onLog?.(
            'INFO',
            'AudioContext разблокирован: пространственный звук HRTF 3D активен'
          );
        }
      });
    } else if (!this.unlocked && this.audioCtx.state === 'running') {
      this.unlocked = true;
    }
  }

  private buildAllWindowChannels(
    ctx: AudioContext,
    masterOut: GainNode
  ): void {
    const appIds = Object.keys(APP_TONE_SPECS) as SpatialAppId[];
    for (const appId of appIds) {
      const spec = APP_TONE_SPECS[appId];
      const panner = ctx.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = REF_DISTANCE;
      panner.maxDistance = MAX_DISTANCE;
      panner.rolloffFactor = ROLLOFF_FACTOR;
      panner.coneInnerAngle = 150;
      panner.coneOuterAngle = 270;
      panner.coneOuterGain = 0.4;

      const channelGain = ctx.createGain();
      channelGain.gain.value = 0;

      const tremorGain = ctx.createGain();
      tremorGain.gain.value = 0.78;

      // Мягкий LowPass-фильтр делает фоновый пространственный тембр ненавязчивым.
      const lowPass = ctx.createBiquadFilter();
      lowPass.type = 'lowpass';
      lowPass.frequency.value = 920;

      // ЗАГЛУШКА (STUB): процедурный синтезатор фонового тембра окна.
      const oscPrimary = ctx.createOscillator();
      oscPrimary.type = spec.waveform;
      oscPrimary.frequency.value = spec.freq;

      const oscHarmonic = ctx.createOscillator();
      oscHarmonic.type = 'sine';
      oscHarmonic.frequency.value = spec.freq * spec.harmonicRatio;

      const harmonicGain = ctx.createGain();
      harmonicGain.gain.value = 0.35;

      const lfoOsc = ctx.createOscillator();
      lfoOsc.type = 'sine';
      lfoOsc.frequency.value = spec.lfoHz;

      const lfoDepth = ctx.createGain();
      lfoDepth.gain.value = 0.22;
      lfoOsc.connect(lfoDepth);
      lfoDepth.connect(tremorGain.gain);

      oscPrimary.connect(lowPass);
      oscHarmonic.connect(harmonicGain);
      harmonicGain.connect(lowPass);

      lowPass.connect(tremorGain);
      tremorGain.connect(channelGain);
      channelGain.connect(panner);
      panner.connect(masterOut);

      oscPrimary.start();
      oscHarmonic.start();
      lfoOsc.start();

      this.channels.set(appId, {
        appId,
        panner,
        channelGain,
        baseGain: spec.baseGain,
        carrierFreq: spec.freq,
        oscPrimary,
        oscHarmonic,
        lfoOsc,
        lfoDepth,
      });
    }
  }

  private applyListenerPose(
    ctx: AudioContext,
    pos: THREE.Vector3,
    fwd: THREE.Vector3,
    up: THREE.Vector3
  ): void {
    const listener = ctx.listener;
    if ('positionX' in listener && listener.positionX) {
      listener.positionX.value = pos.x;
      listener.positionY.value = pos.y;
      listener.positionZ.value = pos.z;
      listener.forwardX.value = fwd.x;
      listener.forwardY.value = fwd.y;
      listener.forwardZ.value = fwd.z;
      listener.upX.value = up.x;
      listener.upY.value = up.y;
      listener.upZ.value = up.z;
    } else {
      const legacy = listener as unknown as {
        setPosition?: (x: number, y: number, z: number) => void;
        setOrientation?: (
          fx: number,
          fy: number,
          fz: number,
          ux: number,
          uy: number,
          uz: number
        ) => void;
      };
      legacy.setPosition?.(pos.x, pos.y, pos.z);
      legacy.setOrientation?.(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
    }
  }

  private applyPannerPose(
    panner: PannerNode,
    pos: THREE.Vector3,
    fwd: THREE.Vector3,
    _nowTime: number
  ): void {
    if ('positionX' in panner && panner.positionX) {
      panner.positionX.value = pos.x;
      panner.positionY.value = pos.y;
      panner.positionZ.value = pos.z;
      panner.orientationX.value = fwd.x;
      panner.orientationY.value = fwd.y;
      panner.orientationZ.value = fwd.z;
    } else {
      const legacy = panner as unknown as {
        setPosition?: (x: number, y: number, z: number) => void;
        setOrientation?: (x: number, y: number, z: number) => void;
      };
      legacy.setPosition?.(pos.x, pos.y, pos.z);
      legacy.setOrientation?.(fwd.x, fwd.y, fwd.z);
    }
  }

  override dispose(): void {
    window.removeEventListener('pointerdown', this.handleUserGestureUnlock);
    window.removeEventListener('keydown', this.handleUserGestureUnlock);

    for (const ch of this.channels.values()) {
      try {
        ch.oscPrimary.stop();
        ch.oscHarmonic.stop();
        ch.lfoOsc.stop();
      } catch {
        // Игнорируем, если уже остановлены.
      }
      ch.panner.disconnect();
      ch.channelGain.disconnect();
    }
    this.channels.clear();

    if (this.audioCtx) {
      void this.audioCtx.close();
      this.audioCtx = null;
    }
  }
}
