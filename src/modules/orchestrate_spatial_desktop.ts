import * as THREE from 'three';
import * as xb from 'xrblocks';

import type {
  RokidOpticsMode,
  SpatialPlaceId,
  VoiceCommandAction,
  WorkspaceEnvironmentState,
  WorkspaceLayoutMode,
  WorkspaceThemePreset,
} from '../types/spatial_contracts.ts';
import {CameraAmbientLightingController} from './adapt_camera_lighting.ts';
import {
  resolveWorkflowIdFromKind,
  SpatialLayoutEditor,
} from './edit_spatial_layouts.ts';
import {RokidSpatialHostBridge} from './bridge_rokid_spatial_host.ts';
import {
  applyRokidOpticsProfile,
  type HeadsetCapabilityReport,
  toggleXRDisplayMode,
} from './configure_xr_workspace.ts';
import {AndroidCameraController} from './manage_android_camera.ts';
import {VrHeadsetSupportController} from './manage_vr_headset.ts';
import {GestureOnboardingGuide} from './guide_gesture_controls.ts';
import {
  IncrediblePlacesManager,
  SPATIAL_PLACES_CATALOG,
} from './generate_incredible_places.ts';
import {GestureNavigationController} from './handle_gesture_navigation.ts';
import {KeyboardMouseController} from './handle_keyboard_mouse_input.ts';
import {
  executeSafely,
  setRuntimeErrorSink,
} from './handle_runtime_errors.ts';
import {TransformInterpolator} from './interpolate_transforms.ts';
import {SpatialWindowManager} from './manage_spatial_windows.ts';
import {WindowDepthMaskController} from './mask_window_depth.ts';
import {PerformanceAndLogMonitor} from './monitor_performance_and_logs.ts';
import {WorkspaceLocalStorageManager} from './persist_window_workspace.ts';
import {VoiceCommandController} from './recognize_voice_commands.ts';
import {GestureHandGhostController} from './render_gesture_hand_ghost.ts';
import {PerformanceHudController} from './render_performance_hud.ts';
import {SbsStereoRenderController} from './render_sbs_stereo.ts';
import {SpatialDockController} from './render_spatial_dock.ts';
import {VoiceSceneSelector} from './select_voice_scene.ts';
import {VirtualSurfaceManager} from './snap_to_virtual_surfaces.ts';
import {SpatialStudioEcosystemSync} from './sync_spatial_studio_ecosystem.ts';
import {SpatialAudioEngine} from './synthesize_spatial_audio.ts';
import {
  CameraHandTrackingController,
  type HandPointerMoveEvent,
} from './track_camera_hands.ts';
import {EyeTrackingFocusController} from './track_eye_focus_overlay.ts';

/**
 * ============================================================================
 * МОДУЛЬ: orchestrate_spatial_desktop.ts (Главный оркестратор рабочего стола)
 * ============================================================================
 * НАЗНАЧЕНИЕ:
 *   Связывает все независимые модули пространственного рабочего стола через
 *   чистые контракты ввода/вывода:
 *   - Освещение и PBR-отражения (`RoomEnvironment` + 3-точечный свет)
 *   - Виртуальные стены и поверхности (`snap_to_virtual_surfaces.ts`)
 *   - Менеджер 3D-окон (`manage_spatial_windows.ts`)
 *   - Док и HUD (`render_spatial_dock.ts`)
 *   - Жесты (`handle_gesture_navigation.ts`)
 *   - Голос (`recognize_voice_commands.ts`)
 *   - Клавиатура/мышь (`handle_keyboard_mouse_input.ts`)
 *   - Мост `rokid-spatial-host` (`bridge_rokid_spatial_host.ts`)
 *   - Синхронизация `rokid-spatial-studio-xr` (`sync_spatial_studio_ecosystem.ts`)
 *   - Логи и телеметрия в реальном времени (`monitor_performance_and_logs.ts`)
 *
 * ВХОДНЫЕ ДАННЫЕ:
 *   - `options`: экземпляр `xb.Options`, переданный при запуске.
 *
 * ВЫХОДНЫЕ ДАННЫЕ:
 *   - Готовый `xb.Script` узел для `xb.add(...)`.
 *
 * КАК ПОЛЬЗОВАТЬСЯ:
 *   const orchestrator = new SpatialDesktopOrchestrator(options);
 *   xb.add(orchestrator);
 *   await xb.init(options);
 * ============================================================================
 */

const LAYOUT_ORDER: readonly WorkspaceLayoutMode[] = [
  'arc',
  'grid',
  'wall-pinned',
  'ring360',
];
const THEME_ORDER: readonly WorkspaceThemePreset[] = [
  'grayGlass',
  'glimmer',
  'glimmerGreen',
  'colorful',
];
const ROKID_ORDER: readonly RokidOpticsMode[] = [
  'standard-xr',
  'rokid-max-ar',
  'rokid-max-sbs',
];

const _cameraEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const _ghostAnchorPos = new THREE.Vector3();
const _handRaycaster = new THREE.Raycaster();
const _handNdc = new THREE.Vector2();

export class SpatialDesktopOrchestrator extends xb.Script {
  private readonly options: xb.Options;
  private readonly headsetCaps?: HeadsetCapabilityReport;
  private readonly monitor = new PerformanceAndLogMonitor({
    maxEntries: 150,
    uiPublishIntervalMs: 250,
  });
  private readonly interpolator = new TransformInterpolator();

  private surfaceManager!: VirtualSurfaceManager;
  private placesManager!: IncrediblePlacesManager;
  private windowManager!: SpatialWindowManager;
  private gestureController!: GestureNavigationController;
  private voiceController!: VoiceCommandController;
  private keyboardController!: KeyboardMouseController;
  private rokidBridge!: RokidSpatialHostBridge;
  private studioSync!: SpatialStudioEcosystemSync;
  private localStorageManager!: WorkspaceLocalStorageManager;
  private cameraLighting!: CameraAmbientLightingController;
  private depthMask!: WindowDepthMaskController;
  private eyeFocus!: EyeTrackingFocusController;
  private dockController!: SpatialDockController;
  private perfHud!: PerformanceHudController;
  private gestureGuide!: GestureOnboardingGuide;
  private handGhost!: GestureHandGhostController;
  private voiceSceneSelector!: VoiceSceneSelector;
  private layoutEditor!: SpatialLayoutEditor;
  private spatialAudio!: SpatialAudioEngine;
  private cameraHands!: CameraHandTrackingController;
  private sbsController!: SbsStereoRenderController;
  private vrHeadsetController!: VrHeadsetSupportController;
  private androidCameraController!: AndroidCameraController;

  private unsubscribeMonitor?: () => void;
  private releaseErrorSink?: () => void;

  private readonly state: WorkspaceEnvironmentState = {
    layoutMode: 'arc',
    theme: 'grayGlass',
    rokidMode: 'standard-xr',
    placeId: 'cyber-tokyo',
    skyDomeEnabled: true,
    screens360Visible: true,
    wallsVisible: true,
    debugVisible: true,
    hudVisible: true,
    gestureGuideVisible: true,
    sceneSelectorVisible: false,
    layoutEditorVisible: false,
    activeLayoutPresetId: 'workflow-dev',
    spatialAudioEnabled: true,
    spatialAudioVolume: 0.65,
    cameraLightingEnabled: true,
    lightingPreset: 'auto',
    depthMaskEnabled: true,
    depthOccluderSimVisible: false,
    eyeTrackingEnabled: true,
    gazeWindowId: null,
    cameraHandTrackingEnabled: false,
    cameraHandFacingMode: 'user',
    sbsEnabled: false,
    sbsIpdMm: 64,
    sbsAspectMode: 'half-sbs',
    vrPreferredMode: 'auto',
    androidCameraPanelVisible: false,
    voiceListening: false,
    xrMode: 'AR',
    activeWindowId: 'studio',
  };

  constructor(options: xb.Options, headsetCaps?: HeadsetCapabilityReport) {
    super();
    this.options = options;
    this.headsetCaps = headsetCaps;
    if (headsetCaps) {
      this.state.vrPreferredMode = headsetCaps.preferredMode;
      if (headsetCaps.configuredSessionMode === 'immersive-vr') {
        this.state.xrMode = 'VR';
      }
    }
  }

  override init(): void {
    this.releaseErrorSink = setRuntimeErrorSink((subsystem, message) => {
      this.monitor.log('ERROR', subsystem, message);
    });

    this.initializeSubsystems();
    this.restoreSavedWorkspace();

    this.monitor.log(
      'INFO',
      'CORE',
      'Rokid Spatial Desktop XR инициализирован и готов к работе'
    );
  }

  override update(): void {
    executeSafely(
      'RENDER',
      'Цикл обновления телеметрии и IMU',
      () => {
        const renderer = xb.core?.renderer;
        const rendererWithInfo =
          renderer && 'info' in renderer ? renderer : null;
        this.monitor.recordFrame(performance.now(), rendererWithInfo);

        if (xb.core?.camera) {
          _cameraEuler.setFromQuaternion(xb.core.camera.quaternion, 'YXZ');
          this.rokidBridge.sampleImuFromCameraYawPitch(
            _cameraEuler.y,
            _cameraEuler.x
          );
        }
      },
      undefined
    );
  }

  override onXRSessionStarted(): void {
    this.monitor.log('INFO', 'CORE', 'WebXR сессия запущена');
    this.depthMask?.refreshWindowMasks();
    this.dockController.updateState(this.state, 'WebXR активен');
  }

  override onSimulatorStarted(): void {
    this.monitor.log('INFO', 'CORE', 'Симулятор XR Blocks запущен');
    this.depthMask?.refreshWindowMasks();
    this.dockController.updateState(this.state, 'Симулятор активен');
  }

  private initializeSubsystems(): void {
    // 0. Локальное автосохранение позиций, масштабов и открытости всех окон.
    this.localStorageManager = new WorkspaceLocalStorageManager({
      onLog: (lvl, msg) => this.monitor.log(lvl, 'PERSIST', msg),
    });

    // 0.5. Адаптивное освещение сцены по потоку камеры Android XR / пресетам.
    this.cameraLighting = new CameraAmbientLightingController({
      initialEnabled: this.state.cameraLightingEnabled,
      initialPreset: this.state.lightingPreset,
      onTelemetry: () => this.publishEnvironmentTelemetry(),
      onLog: (lvl, msg) => this.monitor.log(lvl, 'LIGHTING', msg),
    });
    this.add(this.cameraLighting);

    // 0.6. Side-by-Side (SBS) 3D стереорендерер (Rokid Max 3D / VR / Cardboard).
    this.sbsController = new SbsStereoRenderController({
      initialEnabled: this.state.sbsEnabled,
      initialAspectMode: this.state.sbsAspectMode,
      initialIpdMm: this.state.sbsIpdMm,
      onChange: (snap) => {
        this.state.sbsEnabled = snap.enabled;
        this.state.sbsAspectMode = snap.aspectMode;
        this.state.sbsIpdMm = snap.ipdMm;
        this.dockController?.updateState(this.state);
        this.publishEnvironmentTelemetry();
      },
      onLog: (lvl, msg) => this.monitor.log(lvl, 'SBS', msg),
    });
    this.add(this.sbsController);

    // 0.7. Поддержка VR-гарнитур (immersive-vr, стики контроллеров, 360°-студия).
    this.vrHeadsetController = new VrHeadsetSupportController({
      capabilityReport: this.headsetCaps,
      onMoveActiveWindow: (dx, dy, dz) =>
        this.windowManager?.nudgeActiveWindow(dx, dy, dz),
      onScaleActiveWindow: (delta) =>
        this.windowManager?.scaleActiveWindow(delta),
      onEnsureVrSkyDome: () => {
        this.state.xrMode = 'VR';
        toggleXRDisplayMode('VR');
        if (!this.placesManager?.isSkyDomeEnabled()) {
          this.placesManager?.setSkyDomeEnabled(true);
          this.state.skyDomeEnabled = true;
        }
      },
      onEnableSbsFallback: () => {
        this.sbsController?.setEnabled(true);
      },
      onSnapshotChange: (snap) => {
        this.state.vrPreferredMode = snap.preferredMode;
        this.dockController?.updateState(this.state);
        this.publishEnvironmentTelemetry();
      },
      onLog: (lvl, msg) => this.monitor.log(lvl, 'VRHEADSET', msg),
    });
    this.add(this.vrHeadsetController);

    // 0.8. Панель и управление камерой Android XR (environment / user / camera-access).
    this.androidCameraController = new AndroidCameraController({
      initialPanelVisible: this.state.androidCameraPanelVisible,
      onSnapshotChange: (snap) => {
        this.state.androidCameraPanelVisible = snap.panelVisible;
        this.dockController?.updateState(this.state);
        this.publishEnvironmentTelemetry();
      },
      onLog: (lvl, msg) => this.monitor.log(lvl, 'ANDROIDCAM', msg),
    });
    this.add(this.androidCameraController);

    // 1. Виртуальные стены и поверхности.
    this.surfaceManager = new VirtualSurfaceManager({
      onSurfaceEvent: (msg) => this.monitor.log('INFO', 'SURFACE', msg),
    });
    this.add(this.surfaceManager);

    // 2. Мост rokid-spatial-host.
    this.rokidBridge = new RokidSpatialHostBridge({
      onLog: (lvl, msg) => this.monitor.log(lvl, 'ROKID', msg),
      onPacket: (packet) => {
        this.monitor.log('DEBUG', 'ROKID', `Пакет ${packet.type} обработан`);
      },
      onStatusChange: (status) => {
        const terminal = this.windowManager?.getWindow('terminal');
        terminal?.bindings.onRokidStateUpdate?.(
          `Мост: ${status.transport} | ${status.opticsMode} | IMU ${status.lastYawDeg}°/${status.lastPitchDeg}°`
        );
      },
    });
    this.rokidBridge.connect(false);

    // 3. Синхронизация с экосистемой rokid-spatial-studio-xr.
    this.studioSync = new SpatialStudioEcosystemSync({
      onLog: (msg) => this.monitor.log('INFO', 'STUDIO', msg),
      onExternalManifest: (manifest) => {
        this.windowManager?.applyManifest(manifest);
      },
    });

    // 3.5. 3D-ретикл и голографический «Hand-Ghost» мгновенной обратной связи.
    this.handGhost = new GestureHandGhostController({
      enabled: true,
      onLog: (msg) => this.monitor.log('DEBUG', 'GESTURE', msg),
    });
    this.add(this.handGhost);

    // 4. Менеджер окон с фабрикой контента.
    this.windowManager = new SpatialWindowManager({
      surfaceManager: this.surfaceManager,
      interpolator: this.interpolator,
      contentActions: {
        onRunTerminalCommand: (cmd) => this.executeTerminalCommand(cmd),
        onRunVoiceText: (phrase) =>
          this.voiceController.processCommandText(phrase),
        onSelectLayout: (mode) => this.setLayoutMode(mode),
        onSelectTheme: (theme) => this.setTheme(theme),
        onCycleRokidMode: () => this.cycleRokidMode(),
        onToggleWalls: () => this.toggleWalls(),
        onPinAllToWalls: () => {
          this.windowManager.pinAllToWalls();
          this.state.layoutMode = 'wall-pinned';
          this.syncAndRefreshHud('Все окна привязаны к стенам');
        },
        onUnpinAll: () => {
          this.windowManager.unpinAll();
          this.syncAndRefreshHud('Все окна откреплены');
        },
        onClearLogs: () => this.monitor.clearLogs(),
        onToggleLogPause: () => {
          const next = !this.monitor.isPaused();
          this.monitor.setPaused(next);
          return next;
        },
        onSyncStudio: () => this.syncWorkspaceToStudio(),
        onResetWorkspace: () => this.resetWorkspace(),
        onSelectPlace: (placeId) => this.selectPlace(placeId),
        onNextPlace: () => this.nextPlace(),
        onPrevPlace: () => this.prevPlace(),
        onToggleSkyDome: () => this.toggleSkyDome(),
        onToggleScreens360: () => this.toggleScreens360(),
      },
      onActiveWindowChange: (id) => {
        this.state.activeWindowId = id;
        this.spatialAudio?.playSpatialPing(id, 1.0);
        this.dockController?.updateState(this.state);
        this.localStorageManager?.scheduleSave(
          this.state,
          this.windowManager.getWindows()
        );
      },
      onWindowManipulated: (kind, detail) => {
        this.gestureGuide?.reportManipulation(kind, detail);
        if (kind === 'pin') {
          this.spatialAudio?.playSpatialPing(this.state.activeWindowId, 1.25);
        }
      },
      onManipulationLifecycle: (phase, kind, targetObj, anchorPos) => {
        this.handGhost?.onManipulationEvent(phase, kind, targetObj, anchorPos);
      },
      onWorkspaceChanged: () => this.syncWorkspaceToStudio(),
      onLog: (lvl, msg) => this.monitor.log(lvl, 'WINDOW', msg),
    });
    this.add(this.windowManager);

    // 4.1. Привязываем автосохранение локального хранилища перед закрытием вкладки.
    this.localStorageManager.attachLifecycleFlush(() => ({
      state: this.state,
      windows: this.windowManager.getWindows(),
    }));

    // 4.2. Система Z-маскировки глубины и окклюзии окон за физическими 3D-объектами.
    this.depthMask = new WindowDepthMaskController({
      getWindows: () => this.windowManager.getWindows(),
      initialEnabled: this.state.depthMaskEnabled,
      initialSimOccluderVisible: this.state.depthOccluderSimVisible,
      onTelemetry: () => this.publishEnvironmentTelemetry(),
      onLog: (lvl, msg) => this.monitor.log(lvl, 'DEPTH', msg),
    });
    this.add(this.depthMask);

    // 4.3. Оверлей отслеживания взгляда с 3D-рамкой подсветки целевого окна.
    this.eyeFocus = new EyeTrackingFocusController({
      getWindows: () => this.windowManager.getWindows(),
      initialEnabled: this.state.eyeTrackingEnabled,
      onGazeDwellFocus: (appId) => {
        if (this.state.activeWindowId !== appId) {
          this.windowManager.focusWindow(appId);
        }
      },
      onGazeChange: (snap) => {
        this.state.gazeWindowId = snap.gazedWindowId;
        this.publishEnvironmentTelemetry();
      },
      onVisibilityChange: (enabled) => {
        this.state.eyeTrackingEnabled = enabled;
        this.dockController?.updateState(
          this.state,
          enabled ? 'Взгляд (Focus): ON' : 'Взгляд (Focus): OFF'
        );
      },
      onLog: (lvl, msg) => this.monitor.log(lvl, 'EYETRACK', msg),
    });
    this.add(this.eyeFocus);

    // 4.5. Генератор 10 невероятных 360°-локаций и панорамных экранов.
    this.placesManager = new IncrediblePlacesManager({
      initialPlaceId: this.state.placeId,
      onPlaceReady: (place, panoramicSurfaces) => {
        this.surfaceManager.setDynamic360Surfaces(panoramicSurfaces);
        this.cameraLighting?.setPlaceContext(place);
        this.state.placeId = place.id;
        this.voiceSceneSelector?.setActivePlace(place);
        const placesWin = this.windowManager.getWindow('places');
        placesWin?.bindings.onPlaceChanged?.(
          place,
          this.placesManager?.isSkyDomeEnabled() ?? true
        );
        this.rokidBridge.sendPacket('PLACE_SWITCH', {
          placeId: place.id,
          title: place.title,
          screenCount360: place.screenCount360,
        });
        this.dockController?.updateState(
          this.state,
          `Место ${place.index}/10: ${place.title}`
        );
      },
      onLog: (msg) => this.monitor.log('INFO', 'PLACE', msg),
    });
    this.add(this.placesManager);

    // 5. Жестовая навигация (учитывает окно в фокусе взгляда!).
    this.gestureController = new GestureNavigationController({
      onLayoutChange: (mode) => this.setLayoutMode(mode),
      onPinToggle: () => {
        const targetId =
          this.eyeFocus?.getGazedWindowId() ?? this.state.activeWindowId;
        this.windowManager.focusWindow(targetId);
        this.windowManager.togglePinWindow(targetId);
        this.dockController.updateState(this.state, `Жест: Pin (${targetId})`);
      },
      onSyncWorkspace: () => this.syncWorkspaceToStudio(),
      onToggleWalls: () => this.toggleWalls(),
      onNextPlace: () => this.nextPlace(),
      onGestureDetected: (hand, name) => {
        const activeCard = this.windowManager.getActiveWindowCard();
        let anchor: THREE.Vector3 | undefined;
        if (activeCard) {
          activeCard.getWorldPosition(_ghostAnchorPos);
          anchor = _ghostAnchorPos;
        }
        this.handGhost?.triggerGestureGhost(hand, name, anchor);
        this.gestureGuide?.reportGesture(hand, name);
        this.dockController.updateState(this.state, `Жест ${hand}: ${name}`);
      },
      onLog: (msg) => this.monitor.log('INFO', 'GESTURE', msg),
    });
    this.add(this.gestureController);

    // 5.5. Камерный трекинг движений и жестов рук (WebRTC + MediaPipe GestureRecognizer).
    this.cameraHands = new CameraHandTrackingController({
      initialFacingMode: this.state.cameraHandFacingMode,
      initialPanelVisible: true,
      onCameraHandsFrame: (hands) => {
        this.handGhost?.setExternalCameraHands(hands);
      },
      onHandPointer: (ev) => this.handleCameraHandPointer(ev),
      onTwoHandScale: (scaleDelta) => {
        this.windowManager.scaleActiveWindow(scaleDelta);
      },
      onGestureTriggered: (hand, gestureName, confidence) => {
        this.gestureController.handleGesture(hand, gestureName, confidence);
      },
      onSnapshotChange: (snap) => {
        this.state.cameraHandTrackingEnabled = snap.running;
        this.state.cameraHandFacingMode = snap.facingMode;
        this.dockController?.updateState(this.state);
        this.publishEnvironmentTelemetry();
      },
      onLog: (lvl, msg) => this.monitor.log(lvl, 'CAMHAND', msg),
    });
    this.add(this.cameraHands);

    // 6. Голосовое управление.
    this.voiceController = new VoiceCommandController({
      onCommand: (cmd) => this.handleVoiceCommand(cmd),
      onListeningChange: (listening, statusText) => {
        this.state.voiceListening = listening;
        this.voiceSceneSelector?.setListening(listening, statusText);
        this.dockController.updateState(this.state, statusText);
      },
      onLog: (lvl, msg) => this.monitor.log(lvl, 'VOICE', msg),
    });
    this.add(this.voiceController);

    // 7. Пространственный док и HUD.
    this.dockController = new SpatialDockController({
      onToggleWindow: (id) => {
        this.monitor.beginInputLatencyMark();
        this.windowManager.toggleWindowVisibility(id);
        this.monitor.endInputLatencyMark();
      },
      onCycleLayout: () => this.cycleLayout(),
      onToggleWalls: () => this.toggleWalls(),
      onToggleVoice: () => this.voiceController.toggleListening(),
      onCycleRokidMode: () => this.cycleRokidMode(),
      onToggleXRMode: () => this.toggleXRMode(),
      onPinActive: () => {
        this.monitor.beginInputLatencyMark();
        this.windowManager.togglePinWindow();
        this.monitor.endInputLatencyMark();
      },
      onNextPlace: () => this.nextPlace(),
      onPrevPlace: () => this.prevPlace(),
      onLayout360: () => this.setLayoutMode('ring360'),
      onToggleHud: () => this.toggleHud(),
      onToggleGestureGuide: () => this.toggleGestureGuide(),
      onToggleSceneSelector: () => this.toggleSceneSelector(),
      onToggleLayoutEditor: () => this.toggleLayoutEditor(),
      onToggleSpatialAudio: () => this.toggleSpatialAudio(),
      onToggleCameraLighting: () => this.toggleCameraLighting(),
      onCycleLightingPreset: () => this.cycleLightingPreset(),
      onToggleDepthMask: () => this.toggleDepthMask(),
      onToggleDepthOccluder: () => this.toggleDepthOccluder(),
      onToggleEyeTracking: () => this.toggleEyeTracking(),
      onToggleCameraHands: () => void this.toggleCameraHands(),
      onToggleSbs: () => this.toggleSbsStereo(),
      onEnterVrHeadset: () => void this.enterVrHeadset(),
      onToggleAndroidCamera: () => void this.toggleAndroidCamera(),
    });
    this.add(this.dockController);

    // 7.5. Ненавязчивый переключаемый HUD производительности (FPS, задержка, память).
    this.perfHud = new PerformanceHudController({
      initialVisible: this.state.hudVisible,
      onVisibilityChange: (visible) => {
        this.state.hudVisible = visible;
        this.dockController?.updateState(
          this.state,
          visible ? 'HUD метрик: ON' : 'HUD метрик: OFF'
        );
      },
      onLog: (msg) => this.monitor.log('INFO', 'RENDER', msg),
    });
    this.add(this.perfHud);

    // 7.6. Интерактивный гид по жестам перемещения и масштабирования окон.
    this.gestureGuide = new GestureOnboardingGuide({
      onDemoMoveForward: () => {
        this.monitor.beginInputLatencyMark();
        this.windowManager.nudgeActiveWindow(0.14, 0.04, 0);
        this.monitor.endInputLatencyMark();
      },
      onDemoMoveBack: () => {
        this.monitor.beginInputLatencyMark();
        this.windowManager.nudgeActiveWindow(-0.14, -0.04, 0);
        this.monitor.endInputLatencyMark();
      },
      onDemoScale: (delta) => {
        this.monitor.beginInputLatencyMark();
        this.windowManager.scaleActiveWindow(delta);
        this.monitor.endInputLatencyMark();
      },
      onResetScale: () => {
        this.monitor.beginInputLatencyMark();
        this.windowManager.scaleActiveWindow(0, true);
        this.monitor.endInputLatencyMark();
      },
      onSimulateGesture: (gestureName) => {
        this.gestureController.handleGesture('right', gestureName, 1);
      },
      onToggleWalls: () => this.toggleWalls(),
      onVisibilityChange: (visible) => {
        this.state.gestureGuideVisible = visible;
      },
      onLog: (msg) => this.monitor.log('INFO', 'GESTURE', msg),
    });
    this.state.gestureGuideVisible = this.gestureGuide.isVisible();
    this.add(this.gestureGuide);

    // 7.7. Голосовой селектор 10 виртуальных сцен (Office, Mountain, Space Station и др.).
    this.voiceSceneSelector = new VoiceSceneSelector({
      onSelectPlace: (placeId) => this.selectPlace(placeId),
      onNextPlace: () => this.nextPlace(),
      onPrevPlace: () => this.prevPlace(),
      onToggleVoice: () => this.voiceController.toggleListening(),
      onSubmitPhrase: (phrase) => this.voiceController.processCommandText(phrase),
      onVisibilityChange: (visible) => {
        this.state.sceneSelectorVisible = visible;
        this.dockController?.updateState(
          this.state,
          visible ? 'Селектор сцен открыт' : 'Селектор сцен скрыт'
        );
      },
      onLog: (msg) => this.monitor.log('INFO', 'VOICE', msg),
    });
    this.add(this.voiceSceneSelector);
    this.voiceSceneSelector.setActivePlace(this.placesManager.getActivePlace());

    // 7.8. Пространственное 3D-аудио (Web Audio API HRTF на каждое окно).
    this.spatialAudio = new SpatialAudioEngine({
      getWindows: () => this.windowManager.getWindows(),
      getActiveWindowId: () => this.state.activeWindowId,
      initialEnabled: this.state.spatialAudioEnabled,
      initialVolume: this.state.spatialAudioVolume,
      onTelemetryUpdate: (summary) => {
        this.layoutEditor?.updateSpatialAudioSummary(summary);
        const telemetryWin = this.windowManager?.getWindow('telemetry');
        if (telemetryWin?.card.visible) {
          telemetryWin.bindings.onSpatialAudioTelemetry?.(summary);
        }
      },
      onLog: (lvl, msg) => this.monitor.log(lvl, 'AUDIO', msg),
    });
    this.add(this.spatialAudio);

    // 7.9. Редактор раскладок (Development, Media, Communication + Custom Save/Load).
    this.layoutEditor = new SpatialLayoutEditor({
      getWindows: () => this.windowManager.getWindows(),
      onApplyPreset: (preset) => {
        this.state.activeLayoutPresetId = preset.id;
        this.state.layoutMode = preset.layoutMode;
        this.windowManager.applySavedPreset(preset);
        this.spatialAudio?.playSpatialPing(this.state.activeWindowId, 1.15);
        this.syncAndRefreshHud(`Профиль: ${preset.name}`);
      },
      onToggleSpatialAudio: () => this.toggleSpatialAudio(),
      onTestSpatialAudio: () => {
        if (!this.state.spatialAudioEnabled) {
          this.toggleSpatialAudio();
        } else {
          this.spatialAudio.playSpatialPing(this.state.activeWindowId, 1.0);
        }
      },
      onAdjustAudioVolume: (delta) => {
        const nextVol = this.spatialAudio.adjustVolume(delta);
        this.state.spatialAudioVolume = nextVol;
        this.dockController.updateState(
          this.state,
          `3D-Звук: ${Math.round(nextVol * 100)}%`
        );
        return nextVol;
      },
      onVisibilityChange: (visible) => {
        this.state.layoutEditorVisible = visible;
        this.dockController?.updateState(
          this.state,
          visible ? 'Редактор раскладок открыт' : 'Редактор раскладок скрыт'
        );
      },
      onLog: (msg) => this.monitor.log('INFO', 'LAYOUT', msg),
    });
    this.add(this.layoutEditor);

    // 8. Клавиатура и мышь.
    this.keyboardController = new KeyboardMouseController({
      onInputMark: () => this.monitor.beginInputLatencyMark(),
      onFocusWindow: (id) => {
        this.windowManager.focusWindow(id);
        this.monitor.endInputLatencyMark();
      },
      onTogglePinActive: () => {
        this.windowManager.togglePinWindow();
        this.monitor.endInputLatencyMark();
      },
      onToggleWalls: () => {
        this.toggleWalls();
        this.monitor.endInputLatencyMark();
      },
      onCycleLayout: () => {
        this.cycleLayout();
        this.monitor.endInputLatencyMark();
      },
      onCycleTheme: () => {
        const nextIdx =
          (THEME_ORDER.indexOf(this.state.theme) + 1) % THEME_ORDER.length;
        this.setTheme(THEME_ORDER[nextIdx]);
        this.monitor.endInputLatencyMark();
      },
      onToggleVoice: () => {
        this.voiceController.toggleListening();
        this.monitor.endInputLatencyMark();
      },
      onToggleDebug: () => {
        this.windowManager.toggleWindowVisibility('telemetry');
        this.monitor.endInputLatencyMark();
      },
      onCycleRokidMode: () => {
        this.cycleRokidMode();
        this.monitor.endInputLatencyMark();
      },
      onToggleDock: () => {
        const visible = this.dockController.toggleDockVisible();
        this.monitor.log(
          'INFO',
          'INPUT',
          visible ? 'Док показан' : 'Док скрыт (Zen Mode)'
        );
        this.monitor.endInputLatencyMark();
      },
      onNextPlace: () => {
        this.nextPlace();
        this.monitor.endInputLatencyMark();
      },
      onPrevPlace: () => {
        this.prevPlace();
        this.monitor.endInputLatencyMark();
      },
      onToggleSkyDome: () => {
        this.toggleSkyDome();
        this.monitor.endInputLatencyMark();
      },
      onToggleScreens360: () => {
        this.toggleScreens360();
        this.monitor.endInputLatencyMark();
      },
      onToggleHud: () => {
        this.toggleHud();
        this.monitor.endInputLatencyMark();
      },
      onToggleGestureGuide: () => {
        this.toggleGestureGuide();
        this.monitor.endInputLatencyMark();
      },
      onToggleSceneSelector: () => {
        this.toggleSceneSelector();
        this.monitor.endInputLatencyMark();
      },
      onToggleLayoutEditor: () => {
        this.toggleLayoutEditor();
        this.monitor.endInputLatencyMark();
      },
      onToggleSpatialAudio: () => {
        this.toggleSpatialAudio();
        this.monitor.endInputLatencyMark();
      },
      onToggleCameraLighting: () => {
        this.toggleCameraLighting();
        this.monitor.endInputLatencyMark();
      },
      onCycleLightingPreset: () => {
        this.cycleLightingPreset();
        this.monitor.endInputLatencyMark();
      },
      onToggleDepthMask: () => {
        this.toggleDepthMask();
        this.monitor.endInputLatencyMark();
      },
      onToggleDepthOccluder: () => {
        this.toggleDepthOccluder();
        this.monitor.endInputLatencyMark();
      },
      onToggleEyeTracking: () => {
        this.toggleEyeTracking();
        this.monitor.endInputLatencyMark();
      },
      onToggleCameraHands: () => {
        void this.toggleCameraHands();
        this.monitor.endInputLatencyMark();
      },
      onFlipHandCamera: () => {
        void this.flipHandCamera();
        this.monitor.endInputLatencyMark();
      },
      onToggleSbs: () => {
        this.toggleSbsStereo();
        this.monitor.endInputLatencyMark();
      },
      onCycleSbsSettings: () => {
        this.cycleSbsSettings();
        this.monitor.endInputLatencyMark();
      },
      onEnterVrHeadset: () => {
        void this.enterVrHeadset();
        this.monitor.endInputLatencyMark();
      },
      onToggleAndroidCamera: () => {
        void this.toggleAndroidCamera();
        this.monitor.endInputLatencyMark();
      },
      onCaptureAndroidSnapshot: () => {
        void this.captureAndroidSnapshot();
        this.monitor.endInputLatencyMark();
      },
      onNudgeActiveWindow: (dx, dy, dz) => {
        this.windowManager.nudgeActiveWindow(dx, dy, dz);
        this.monitor.endInputLatencyMark();
      },
      onScaleActiveWindow: (deltaScale) => {
        this.windowManager.scaleActiveWindow(deltaScale);
        this.monitor.endInputLatencyMark();
      },
      onLog: (msg) => this.monitor.log('INFO', 'INPUT', msg),
    });
    this.keyboardController.attach();

    // 9. Подписка HUD и окна телеметрии на живые метрики и логи.
    this.unsubscribeMonitor = this.monitor.subscribe((snapshot) => {
      this.perfHud?.updateMetrics(snapshot, this.state);

      const telemetryWin = this.windowManager.getWindow('telemetry');
      if (!telemetryWin || !telemetryWin.card.visible) return;
      telemetryWin.bindings.onTelemetryUpdate?.(snapshot);
      telemetryWin.bindings.onLogUpdate?.(
        this.monitor.getFormattedLogs('ALL', 13)
      );
    });
  }

  private restoreSavedWorkspace(): void {
    const localSaved = this.localStorageManager.load();
    if (localSaved) {
      this.state.layoutMode = localSaved.layoutMode;
      this.setTheme(localSaved.theme);
      this.setRokidMode(localSaved.rokidMode);
      this.placesManager.selectPlace(localSaved.placeId);
      this.state.placeId = localSaved.placeId;
      this.state.skyDomeEnabled = localSaved.skyDomeEnabled;
      this.placesManager.setSkyDomeEnabled(localSaved.skyDomeEnabled);
      this.state.screens360Visible = localSaved.screens360Visible;
      this.placesManager.setScreens360Visible(localSaved.screens360Visible);
      this.state.hudVisible = localSaved.hudVisible;
      this.perfHud.setVisible(localSaved.hudVisible);
      this.state.sceneSelectorVisible = localSaved.sceneSelectorVisible;
      this.voiceSceneSelector.setVisible(localSaved.sceneSelectorVisible);
      this.state.layoutEditorVisible = localSaved.layoutEditorVisible;
      this.layoutEditor.setVisible(localSaved.layoutEditorVisible);
      this.state.activeLayoutPresetId = localSaved.activeLayoutPresetId;
      this.layoutEditor.setActivePresetId(localSaved.activeLayoutPresetId);
      this.state.spatialAudioEnabled = localSaved.spatialAudioEnabled;
      this.spatialAudio.setEnabled(localSaved.spatialAudioEnabled);
      this.layoutEditor.setAudioEnabledVisual(localSaved.spatialAudioEnabled);
      this.state.cameraLightingEnabled = localSaved.cameraLightingEnabled;
      this.cameraLighting.setEnabled(localSaved.cameraLightingEnabled);
      this.state.lightingPreset = localSaved.lightingPreset;
      this.cameraLighting.setPreset(localSaved.lightingPreset);
      this.state.depthMaskEnabled = localSaved.depthMaskEnabled;
      this.depthMask.setEnabled(localSaved.depthMaskEnabled);
      this.state.depthOccluderSimVisible = localSaved.depthOccluderSimVisible;
      this.depthMask.setSimulatedOccluderVisible(
        localSaved.depthOccluderSimVisible
      );
      this.state.eyeTrackingEnabled = localSaved.eyeTrackingEnabled;
      this.eyeFocus.setEnabled(localSaved.eyeTrackingEnabled);
      if (localSaved.cameraHandFacingMode) {
        this.state.cameraHandFacingMode = localSaved.cameraHandFacingMode;
      }
      if (localSaved.sbsAspectMode) {
        this.state.sbsAspectMode = localSaved.sbsAspectMode;
        this.sbsController.setAspectMode(localSaved.sbsAspectMode);
      }
      if (typeof localSaved.sbsIpdMm === 'number') {
        this.state.sbsIpdMm = localSaved.sbsIpdMm;
        this.sbsController.setIpdMm(localSaved.sbsIpdMm);
      }
      if (localSaved.sbsEnabled !== undefined) {
        this.state.sbsEnabled = localSaved.sbsEnabled;
        this.sbsController.setEnabled(localSaved.sbsEnabled);
      }
      if (localSaved.vrPreferredMode) {
        this.state.vrPreferredMode = localSaved.vrPreferredMode;
        this.vrHeadsetController.setPreferredMode(localSaved.vrPreferredMode);
      }
      if (localSaved.androidCameraPanelVisible !== undefined) {
        this.state.androidCameraPanelVisible =
          localSaved.androidCameraPanelVisible;
        this.androidCameraController.setPanelVisible(
          localSaved.androidCameraPanelVisible
        );
      }
      this.surfaceManager.setWallsVisible(localSaved.wallsVisible);
      this.state.wallsVisible = localSaved.wallsVisible;

      this.windowManager.restorePersistedWindows(
        localSaved.windows,
        localSaved.activeWindowId
      );
      this.depthMask.refreshWindowMasks();
      this.dockController.updateState(this.state, 'Восстановлено из LocalStorage');
      return;
    }

    const saved = this.studioSync.loadSavedManifest();
    if (!saved) {
      this.dockController.updateState(this.state, 'Стандартная сцена');
      return;
    }

    this.state.layoutMode = saved.layoutMode;
    this.setTheme(saved.theme);
    this.setRokidMode(saved.rokidMode);
    if (saved.placeId) {
      this.placesManager.selectPlace(saved.placeId);
      this.state.placeId = saved.placeId;
    }
    if (saved.skyDomeEnabled !== undefined) {
      this.state.skyDomeEnabled = saved.skyDomeEnabled;
      this.placesManager.setSkyDomeEnabled(saved.skyDomeEnabled);
    }
    if (saved.screens360Visible !== undefined) {
      this.state.screens360Visible = saved.screens360Visible;
      this.placesManager.setScreens360Visible(saved.screens360Visible);
    }
    if (saved.hudVisible !== undefined) {
      this.state.hudVisible = saved.hudVisible;
      this.perfHud.setVisible(saved.hudVisible);
    }
    if (saved.sceneSelectorVisible !== undefined) {
      this.state.sceneSelectorVisible = saved.sceneSelectorVisible;
      this.voiceSceneSelector.setVisible(saved.sceneSelectorVisible);
    }
    if (saved.layoutEditorVisible !== undefined) {
      this.state.layoutEditorVisible = saved.layoutEditorVisible;
      this.layoutEditor.setVisible(saved.layoutEditorVisible);
    }
    if (saved.activeLayoutPresetId) {
      this.state.activeLayoutPresetId = saved.activeLayoutPresetId;
      this.layoutEditor.setActivePresetId(saved.activeLayoutPresetId);
    }
    if (saved.spatialAudioEnabled !== undefined) {
      this.state.spatialAudioEnabled = saved.spatialAudioEnabled;
      this.spatialAudio.setEnabled(saved.spatialAudioEnabled);
      this.layoutEditor.setAudioEnabledVisual(saved.spatialAudioEnabled);
    }
    this.surfaceManager.setWallsVisible(saved.wallsVisible);
    this.state.wallsVisible = saved.wallsVisible;
    this.windowManager.applyManifest(saved);
    this.dockController.updateState(this.state, 'Восстановлено из Studio');
  }

  private executeTerminalCommand(cmd: string): string {
    const lower = cmd.trim().toLowerCase();
    if (lower === 'studio sync') {
      this.syncWorkspaceToStudio();
      return '[STUDIO] Манифест сцены сохранён и отправлен в rokid-spatial-studio-xr';
    }
    if (lower === 'hud' || lower === 'hud toggle') {
      const visible = this.toggleHud();
      return `[HUD] Панель метрик (FPS/Latency/Memory): ${visible ? 'ON' : 'OFF'}`;
    }
    if (lower === 'guide' || lower === 'gestures') {
      const visible = this.toggleGestureGuide();
      return `[GUIDE] Интерактивный гид по жестам: ${visible ? 'OPEN' : 'CLOSED'}`;
    }
    if (lower === 'scenes' || lower === 'scene selector') {
      const visible = this.toggleSceneSelector();
      return `[SCENES] Голосовой селектор 10 миров: ${visible ? 'OPEN' : 'CLOSED'}`;
    }
    if (lower === 'layouts' || lower === 'layout editor') {
      const visible = this.toggleLayoutEditor();
      return `[LAYOUT] Редактор раскладок: ${visible ? 'OPEN' : 'CLOSED'}`;
    }
    if (lower === 'audio' || lower === 'audio toggle') {
      const enabled = this.toggleSpatialAudio();
      return `[AUDIO] Пространственное 3D-аудио (HRTF): ${enabled ? 'ON' : 'OFF'}`;
    }
    if (lower === 'light' || lower === 'lighting') {
      const enabled = this.toggleCameraLighting();
      return `[LIGHTING] Адаптивное освещение камеры: ${enabled ? 'ON' : 'OFF'}`;
    }
    if (lower === 'light preset') {
      const preset = this.cycleLightingPreset();
      return `[LIGHTING] Пресет освещения: ${preset}`;
    }
    if (lower === 'depth' || lower === 'depth mask') {
      const enabled = this.toggleDepthMask();
      return `[DEPTH] Z-маскировка глубины окон: ${enabled ? 'ON' : 'OFF'}`;
    }
    if (lower === 'occluder') {
      const visible = this.toggleDepthOccluder();
      return `[DEPTH] Тестовый 3D-окклюдер: ${visible ? 'ПОКАЗАН' : 'СКРЫТ'}`;
    }
    if (lower === 'gaze' || lower === 'eye') {
      const enabled = this.toggleEyeTracking();
      return `[EYETRACK] Оверлей отслеживания взгляда: ${enabled ? 'ON' : 'OFF'}`;
    }
    if (lower === 'camhand' || lower === 'camhand toggle') {
      void this.toggleCameraHands();
      return '[CAMHAND] Переключение камерного трекинга рук...';
    }
    if (lower === 'camhand start') {
      void this.cameraHands.startCamera();
      return '[CAMHAND] Запуск видеопотока камеры рук...';
    }
    if (lower === 'camhand stop') {
      this.cameraHands.stopCamera();
      return '[CAMHAND] Камерный трекинг рук остановлен';
    }
    if (lower === 'camhand flip') {
      void this.flipHandCamera();
      return '[CAMHAND] Переключение Фронт/Тыл камеры рук';
    }
    if (lower === 'camhand sim') {
      const simOn = this.cameraHands.toggleSimStub();
      return `[CAMHAND] Режим симуляции рук (Stub): ${simOn ? 'ON' : 'OFF'}`;
    }
    if (lower === 'camhand panel') {
      const vis = this.cameraHands.togglePanel();
      return `[CAMHAND] Панель камеры рук: ${vis ? 'ПОКАЗАНА' : 'СКРЫТА'}`;
    }
    if (lower === 'sbs' || lower === 'sbs toggle') {
      const on = this.toggleSbsStereo();
      return `[SBS] Side-by-Side 3D: ${on ? `ON (${this.state.sbsAspectMode}, IPD ${this.state.sbsIpdMm}мм)` : 'OFF (Mono)'}`;
    }
    if (lower === 'sbs full') {
      this.sbsController.setAspectMode('full-sbs');
      this.toggleSbsStereo(true);
      return `[SBS] Включён Full-SBS 3D (Rokid Max 3840×1080, IPD ${this.state.sbsIpdMm}мм)`;
    }
    if (lower === 'sbs half') {
      this.sbsController.setAspectMode('half-sbs');
      this.toggleSbsStereo(true);
      return `[SBS] Включён Half-SBS 3D (Desktop / Cardboard, IPD ${this.state.sbsIpdMm}мм)`;
    }
    if (lower.startsWith('sbs ipd ')) {
      const val = Number(lower.replace('sbs ipd ', '').trim());
      if (!Number.isFinite(val)) {
        return '[SBS] Укажите число в мм (52..76), например: sbs ipd 64';
      }
      const nextIpd = this.sbsController.setIpdMm(val);
      return `[SBS] IPD установлен: ${nextIpd} мм`;
    }
    if (lower === 'vr' || lower === 'vr enter') {
      void this.enterVrHeadset();
      return '[VRHEADSET] Запуск VR-гарнитуры (immersive-vr или VR-студия + SBS)...';
    }
    if (lower === 'vr ar') {
      this.vrHeadsetController.setPreferredMode('immersive-ar');
      return '[VRHEADSET] Предпочтительный режим сохранён: immersive-ar (перезапустите Enter XR для AR)';
    }
    if (lower === 'vr auto') {
      this.vrHeadsetController.setPreferredMode('auto');
      return '[VRHEADSET] Предпочтительный режим сохранён: auto';
    }
    if (lower === 'cam' || lower === 'android cam') {
      void this.toggleAndroidCamera();
      return '[ANDROIDCAM] Переключение панели камеры Android XR...';
    }
    if (lower === 'cam flip') {
      void this.androidCameraController.flipFacingMode();
      return '[ANDROIDCAM] Переключение Тыловой/Фронтальной камеры Android';
    }
    if (lower === 'cam next') {
      void this.androidCameraController.cycleCameraLens();
      return '[ANDROIDCAM] Перебор объектива камеры Android...';
    }
    if (lower === 'cam snap') {
      void this.captureAndroidSnapshot();
      return '[ANDROIDCAM] Захват снимка с камеры Android...';
    }
    if (lower === 'save state') {
      this.localStorageManager.saveNow(
        this.state,
        this.windowManager.getWindows()
      );
      return `[PERSIST] Конфигурация сохранена: ${this.localStorageManager.getLastSavedSummary()}`;
    }
    if (lower === 'clear state') {
      this.localStorageManager.clear();
      return '[PERSIST] Локальное хранилище позиций окон очищено';
    }
    if (lower.startsWith('workflow ')) {
      const arg = lower.replace('workflow ', '').trim();
      const targetId =
        arg.startsWith('dev')
          ? 'workflow-dev'
          : arg.startsWith('med')
            ? 'workflow-media'
            : arg.startsWith('com')
              ? 'workflow-comms'
              : arg;
      const applied = this.layoutEditor.applyPresetById(targetId);
      return applied
        ? `[LAYOUT] Активирован рабочий профиль: ${applied.name}`
        : '[LAYOUT] Доступны профили: dev, media, comms';
    }
    if (lower.startsWith('save layout')) {
      const name = cmd.trim().slice('save layout'.length).trim();
      const savedPreset = this.layoutEditor.saveCurrentArrangement(name);
      return `[LAYOUT] Сохранена пользовательская раскладка: "${savedPreset.name}"`;
    }
    if (lower === 'places' || lower === 'places list') {
      return SPATIAL_PLACES_CATALOG.map(
        (p) => `${p.index}. [${p.id}] ${p.title}`
      ).join('\n');
    }
    if (lower.startsWith('place ')) {
      const arg = lower.replace('place ', '').trim();
      const idx = Number(arg);
      const found = Number.isFinite(idx)
        ? SPATIAL_PLACES_CATALOG.find((p) => p.index === idx)
        : SPATIAL_PLACES_CATALOG.find((p) => p.id === arg);
      if (found) {
        this.selectPlace(found.id);
        return `[PLACE] Активировано место #${found.index}: ${found.title}`;
      }
      return '[PLACE] Неизвестное место. Введите `places` для списка.';
    }
    return this.rokidBridge.executeHostCommand(cmd);
  }

  private handleVoiceCommand(cmd: VoiceCommandAction): void {
    switch (cmd.action) {
      case 'LAYOUT_ARC':
        this.setLayoutMode('arc');
        break;
      case 'LAYOUT_GRID':
        this.setLayoutMode('grid');
        break;
      case 'LAYOUT_WALL':
        this.setLayoutMode('wall-pinned');
        break;
      case 'LAYOUT_360':
        this.setLayoutMode('ring360');
        break;
      case 'PIN_ACTIVE': {
        const targetId =
          this.eyeFocus?.getGazedWindowId() ?? this.state.activeWindowId;
        this.windowManager.focusWindow(targetId);
        this.windowManager.togglePinWindow(targetId);
        break;
      }
      case 'UNPIN_ALL':
        this.windowManager.unpinAll();
        break;
      case 'TOGGLE_WALLS':
        this.toggleWalls();
        break;
      case 'TOGGLE_360_SCREENS':
        this.toggleScreens360();
        break;
      case 'TOGGLE_SKYDOME':
        this.toggleSkyDome();
        break;
      case 'PLACE_NEXT':
        this.nextPlace();
        break;
      case 'PLACE_PREV':
        this.prevPlace();
        break;
      case 'PLACE_SELECT':
        if (cmd.placeId) {
          this.selectPlace(cmd.placeId);
          const matchedTitle =
            SPATIAL_PLACES_CATALOG.find((p) => p.id === cmd.placeId)?.title ??
            cmd.placeId;
          this.voiceSceneSelector.showMatchedFeedback(
            cmd.rawTranscript,
            matchedTitle
          );
        }
        break;
      case 'OPEN_SCENE_SELECTOR':
        this.voiceSceneSelector.setVisible(true);
        this.state.sceneSelectorVisible = true;
        this.syncAndRefreshHud('Селектор сцен открыт');
        break;
      case 'CLOSE_SCENE_SELECTOR':
        this.voiceSceneSelector.setVisible(false);
        this.state.sceneSelectorVisible = false;
        this.syncAndRefreshHud('Селектор сцен скрыт');
        break;
      case 'OPEN_LAYOUT_EDITOR':
        this.layoutEditor.setVisible(true);
        this.state.layoutEditorVisible = true;
        this.syncAndRefreshHud('Редактор раскладок открыт');
        break;
      case 'CLOSE_LAYOUT_EDITOR':
        this.layoutEditor.setVisible(false);
        this.state.layoutEditorVisible = false;
        this.syncAndRefreshHud('Редактор раскладок скрыт');
        break;
      case 'WORKFLOW_DEV':
        this.layoutEditor.applyPresetById(
          resolveWorkflowIdFromKind('development')
        );
        break;
      case 'WORKFLOW_MEDIA':
        this.layoutEditor.applyPresetById(resolveWorkflowIdFromKind('media'));
        break;
      case 'WORKFLOW_COMMS':
        this.layoutEditor.applyPresetById(
          resolveWorkflowIdFromKind('communication')
        );
        break;
      case 'SAVE_CUSTOM_LAYOUT': {
        const saved = this.layoutEditor.saveCurrentArrangement('');
        this.syncAndRefreshHud(`Сохранено: ${saved.name}`);
        break;
      }
      case 'TOGGLE_SPATIAL_AUDIO':
        this.toggleSpatialAudio();
        break;
      case 'TOGGLE_CAMERA_LIGHTING':
        this.toggleCameraLighting();
        break;
      case 'CYCLE_LIGHTING_PRESET':
        this.cycleLightingPreset();
        break;
      case 'TOGGLE_DEPTH_MASK':
        this.toggleDepthMask();
        break;
      case 'TOGGLE_DEPTH_OCCLUDER':
        this.toggleDepthOccluder();
        break;
      case 'TOGGLE_EYE_TRACKING':
        this.toggleEyeTracking();
        break;
      case 'TOGGLE_CAMERA_HANDS':
        void this.toggleCameraHands();
        break;
      case 'FLIP_HAND_CAMERA':
        void this.flipHandCamera();
        break;
      case 'TOGGLE_SBS':
        this.toggleSbsStereo();
        break;
      case 'SBS_FULL':
        this.sbsController.setAspectMode('full-sbs');
        this.toggleSbsStereo(true);
        break;
      case 'SBS_HALF':
        this.sbsController.setAspectMode('half-sbs');
        this.toggleSbsStereo(true);
        break;
      case 'ENTER_VR_HEADSET':
        void this.enterVrHeadset();
        break;
      case 'TOGGLE_ANDROID_CAMERA':
        void this.toggleAndroidCamera();
        break;
      case 'CAPTURE_ANDROID_SNAPSHOT':
        void this.captureAndroidSnapshot();
        break;
      case 'THEME_GLASS':
        this.setTheme('grayGlass');
        break;
      case 'THEME_GLIMMER':
        this.setTheme('glimmer');
        break;
      case 'THEME_COLORFUL':
        this.setTheme('colorful');
        break;
      case 'TOGGLE_ROKID':
        this.cycleRokidMode();
        break;
      case 'TOGGLE_XR_MODE':
        this.toggleXRMode();
        break;
      case 'TOGGLE_DEBUG':
        this.windowManager.toggleWindowVisibility('telemetry');
        break;
      case 'TOGGLE_HUD':
        this.toggleHud();
        break;
      case 'TOGGLE_GESTURE_GUIDE':
        this.toggleGestureGuide();
        break;
      case 'OPEN_APP':
        if (cmd.appId) this.windowManager.focusWindow(cmd.appId);
        break;
      case 'RESET_WORKSPACE':
        this.resetWorkspace();
        break;
      case 'UNKNOWN':
      default:
        this.dockController.updateState(
          this.state,
          `Неизвестная команда: "${cmd.rawTranscript}"`
        );
        break;
    }
  }

  private setLayoutMode(mode: WorkspaceLayoutMode): void {
    this.state.layoutMode = mode;
    this.windowManager.applyLayout(mode);
    this.syncAndRefreshHud(`Раскладка: ${mode}`);
  }

  private cycleLayout(): void {
    const nextIdx =
      (LAYOUT_ORDER.indexOf(this.state.layoutMode) + 1) % LAYOUT_ORDER.length;
    this.setLayoutMode(LAYOUT_ORDER[nextIdx]);
  }

  private setTheme(theme: WorkspaceThemePreset): void {
    this.state.theme = theme;
    xb.ui.theme = theme;
    this.monitor.log('INFO', 'CORE', `Тема интерфейса изменена на: ${theme}`);
    this.syncAndRefreshHud(`Тема: ${theme}`);
  }

  private toggleWalls(): void {
    this.state.wallsVisible = !this.state.wallsVisible;
    this.surfaceManager.setWallsVisible(this.state.wallsVisible);
    this.syncAndRefreshHud(
      this.state.wallsVisible ? 'Стены показаны' : 'Стены скрыты'
    );
  }

  private setRokidMode(mode: RokidOpticsMode): void {
    const prevMode = this.state.rokidMode;
    this.state.rokidMode = mode;
    const profile = applyRokidOpticsProfile(mode, this.options);
    this.rokidBridge.setOpticsMode(mode);
    this.state.theme =
      mode === 'rokid-max-ar' || mode === 'rokid-max-sbs'
        ? 'glimmer'
        : 'grayGlass';

    if (mode === 'rokid-max-sbs') {
      this.sbsController?.setAspectMode('full-sbs');
      this.sbsController?.setEnabled(true);
    } else if (prevMode === 'rokid-max-sbs' && this.sbsController?.isEnabled()) {
      this.sbsController.setEnabled(false);
    }

    this.syncAndRefreshHud(profile.label);
  }

  private cycleRokidMode(): void {
    const nextIdx =
      (ROKID_ORDER.indexOf(this.state.rokidMode) + 1) % ROKID_ORDER.length;
    this.setRokidMode(ROKID_ORDER[nextIdx]);
  }

  private toggleXRMode(): void {
    const nextMode = this.state.xrMode === 'AR' ? 'VR' : 'AR';
    this.state.xrMode = toggleXRDisplayMode(nextMode);
    this.monitor.log('INFO', 'CORE', `Режим фона переключён на ${nextMode}`);
    this.dockController.updateState(this.state, `Фон: ${nextMode}`);
  }

  private syncWorkspaceToStudio(): void {
    const windows = this.windowManager.getWindows();
    this.localStorageManager.scheduleSave(this.state, windows);

    const manifest = this.studioSync.buildManifest(this.state, windows);
    this.studioSync.saveAndPublish(manifest);
    const studioWin = this.windowManager.getWindow('studio');
    studioWin?.bindings.onStatusUpdate?.(
      `Синхронизировано: ${new Date().toLocaleTimeString()} (${manifest.windows.length} окон)`
    );
  }

  private syncAndRefreshHud(detail: string): void {
    this.dockController.updateState(this.state, detail);
    this.syncWorkspaceToStudio();
  }

  private selectPlace(placeId: SpatialPlaceId): void {
    const place = this.placesManager.selectPlace(placeId);
    this.state.placeId = place.id;
    this.syncAndRefreshHud(`Место ${place.index}/10: ${place.title}`);
  }

  private nextPlace(): void {
    const place = this.placesManager.nextPlace();
    this.state.placeId = place.id;
    this.syncAndRefreshHud(`Место ${place.index}/10: ${place.title}`);
  }

  private prevPlace(): void {
    const place = this.placesManager.prevPlace();
    this.state.placeId = place.id;
    this.syncAndRefreshHud(`Место ${place.index}/10: ${place.title}`);
  }

  private toggleSkyDome(): boolean {
    const next = this.placesManager.setSkyDomeEnabled(
      !this.placesManager.isSkyDomeEnabled()
    );
    this.state.skyDomeEnabled = next;
    const placesWin = this.windowManager.getWindow('places');
    placesWin?.bindings.onPlaceChanged?.(
      this.placesManager.getActivePlace(),
      next
    );
    this.syncAndRefreshHud(next ? 'Купол 360°: ON' : 'AR Прозрачный');
    return next;
  }

  private toggleScreens360(): boolean {
    const next = this.placesManager.setScreens360Visible(
      !this.placesManager.areScreens360Visible()
    );
    this.state.screens360Visible = next;
    this.syncAndRefreshHud(
      next ? '360° Экраны: ON' : '360° Экраны: OFF'
    );
    return next;
  }

  private toggleHud(): boolean {
    const next = this.perfHud.toggleVisible();
    this.state.hudVisible = next;
    this.syncAndRefreshHud(next ? 'HUD метрик: ON' : 'HUD метрик: OFF');
    return next;
  }

  private toggleGestureGuide(): boolean {
    const next = this.gestureGuide.toggle();
    this.state.gestureGuideVisible = next;
    this.dockController.updateState(
      this.state,
      next ? 'Гид жестов открыт' : 'Гид жестов скрыт'
    );
    return next;
  }

  private toggleSceneSelector(): boolean {
    const next = this.voiceSceneSelector.toggle();
    this.state.sceneSelectorVisible = next;
    this.syncAndRefreshHud(next ? 'Селектор сцен открыт' : 'Селектор сцен скрыт');
    return next;
  }

  private toggleLayoutEditor(): boolean {
    const next = this.layoutEditor.toggle();
    this.state.layoutEditorVisible = next;
    this.syncAndRefreshHud(
      next ? 'Редактор раскладок открыт' : 'Редактор раскладок скрыт'
    );
    return next;
  }

  private toggleSpatialAudio(): boolean {
    const next = this.spatialAudio.toggleEnabled();
    this.state.spatialAudioEnabled = next;
    this.layoutEditor.setAudioEnabledVisual(next);
    this.syncAndRefreshHud(next ? '3D-Аудио: ON' : '3D-Аудио: OFF');
    return next;
  }

  private toggleCameraLighting(): boolean {
    const next = this.cameraLighting.toggleEnabled();
    this.state.cameraLightingEnabled = next;
    this.syncAndRefreshHud(
      next ? `Свет камеры: ON (${this.state.lightingPreset})` : 'Свет камеры: OFF'
    );
    this.publishEnvironmentTelemetry();
    return next;
  }

  private cycleLightingPreset(): WorkspaceEnvironmentState['lightingPreset'] {
    if (!this.state.cameraLightingEnabled) {
      this.state.cameraLightingEnabled = true;
      this.cameraLighting.setEnabled(true);
    }
    const next = this.cameraLighting.cyclePreset();
    this.state.lightingPreset = next;
    this.syncAndRefreshHud(`Тон освещения: ${next}`);
    this.publishEnvironmentTelemetry();
    return next;
  }

  private toggleDepthMask(): boolean {
    const next = this.depthMask.toggleDepthMask();
    this.state.depthMaskEnabled = next;
    this.syncAndRefreshHud(next ? 'Z-Маска глубины: ON' : 'Z-Маска глубины: OFF');
    this.publishEnvironmentTelemetry();
    return next;
  }

  private toggleDepthOccluder(): boolean {
    const next = this.depthMask.toggleSimulatedOccluder();
    this.state.depthOccluderSimVisible = next;
    this.syncAndRefreshHud(
      next ? '3D-Преграда: ON (проверьте перекрытие)' : '3D-Преграда: OFF'
    );
    this.publishEnvironmentTelemetry();
    return next;
  }

  private toggleEyeTracking(): boolean {
    const next = this.eyeFocus.toggle();
    this.state.eyeTrackingEnabled = next;
    this.syncAndRefreshHud(
      next ? 'Взгляд (Eye-Focus): ON' : 'Взгляд (Eye-Focus): OFF'
    );
    this.publishEnvironmentTelemetry();
    return next;
  }

  private async toggleCameraHands(): Promise<boolean> {
    const running = await this.cameraHands.toggleCamera();
    this.state.cameraHandTrackingEnabled = running;
    this.syncAndRefreshHud(
      running ? 'Камера рук: LIVE' : 'Камера рук: OFF'
    );
    this.publishEnvironmentTelemetry();
    return running;
  }

  private async flipHandCamera(): Promise<void> {
    const nextFacing = await this.cameraHands.flipFacingMode();
    this.state.cameraHandFacingMode = nextFacing;
    this.syncAndRefreshHud(
      `Камера рук: ${nextFacing === 'user' ? 'Фронт' : 'Тыл'}`
    );
    this.publishEnvironmentTelemetry();
  }

  private handleCameraHandPointer(ev: HandPointerMoveEvent): void {
    if (ev.phase === 'move' && xb.core?.camera) {
      _handNdc.set(ev.ndcX, ev.ndcY);
      _handRaycaster.setFromCamera(_handNdc, xb.core.camera);
      for (const win of this.windowManager.getWindows()) {
        if (!win.card.visible) continue;
        const hits = _handRaycaster.intersectObject(win.card, false);
        if (hits.length > 0 && win.id !== this.state.activeWindowId) {
          this.windowManager.focusWindow(win.id);
          break;
        }
      }
      return;
    }

    if (ev.phase === 'pinch-start') {
      this.monitor.beginInputLatencyMark();
      this.gestureGuide?.reportManipulation(
        'move',
        `Захват щипком с камеры: "${this.state.activeWindowId}"`
      );
      return;
    }

    if (ev.phase === 'pinch-move') {
      if (
        Math.abs(ev.deltaX) > 0.002 ||
        Math.abs(ev.deltaY) > 0.002 ||
        Math.abs(ev.deltaZ) > 0.002
      ) {
        this.windowManager.nudgeActiveWindow(ev.deltaX, ev.deltaY, ev.deltaZ);
      }
      return;
    }

    if (ev.phase === 'pinch-end') {
      this.monitor.endInputLatencyMark();
      this.syncWorkspaceToStudio();
    }
  }

  private toggleSbsStereo(forceState?: boolean): boolean {
    const next =
      typeof forceState === 'boolean'
        ? this.sbsController.setEnabled(forceState)
        : this.sbsController.toggleSbs();
    this.state.sbsEnabled = next;
    this.syncAndRefreshHud(
      next
        ? `SBS 3D: ON (${this.state.sbsAspectMode}, ${this.state.sbsIpdMm}мм)`
        : 'SBS 3D: OFF'
    );
    this.publishEnvironmentTelemetry();
    return next;
  }

  private cycleSbsSettings(): void {
    const nextAspect = this.sbsController.toggleAspectMode();
    const nextIpd = this.sbsController.cycleIpdMm();
    if (!this.sbsController.isEnabled()) {
      this.sbsController.setEnabled(true);
    }
    this.syncAndRefreshHud(`SBS: ${nextAspect} • IPD ${nextIpd}мм`);
    this.publishEnvironmentTelemetry();
  }

  private async enterVrHeadset(): Promise<void> {
    const result = await this.vrHeadsetController.enterVrHeadset();
    const detail =
      result === 'vr-session'
        ? 'VR Гарнитура (immersive-vr)'
        : 'VR Студия + SBS 3D (Y)';
    this.syncAndRefreshHud(detail);
    this.publishEnvironmentTelemetry();
  }

  private async toggleAndroidCamera(): Promise<void> {
    const visible = await this.androidCameraController.togglePanel();
    this.state.androidCameraPanelVisible = visible;
    this.syncAndRefreshHud(
      visible ? 'Камера Android: OPEN' : 'Камера Android: CLOSED'
    );
    this.publishEnvironmentTelemetry();
  }

  private async captureAndroidSnapshot(): Promise<void> {
    if (!this.androidCameraController.isPanelVisible()) {
      this.androidCameraController.setPanelVisible(true);
      await this.androidCameraController.ensureStarted();
    }
    await this.androidCameraController.capturePhotoSnapshot();
    this.syncAndRefreshHud('Снимок Android Camera');
    this.publishEnvironmentTelemetry();
  }

  private publishEnvironmentTelemetry(): void {
    const telemetryWin = this.windowManager?.getWindow('telemetry');
    if (!telemetryWin?.card.visible) return;

    const light = this.cameraLighting?.getSnapshot();
    const depth = this.depthMask?.getSnapshot();
    const gaze = this.eyeFocus?.getSnapshot();
    const camHands = this.cameraHands?.getSnapshot();
    const sbs = this.sbsController?.getSnapshot();
    const vr = this.vrHeadsetController?.getSnapshot();
    const androidCam = this.androidCameraController?.getSnapshot();
    const persistText = this.localStorageManager?.getLastSavedSummary() ?? '--';

    const occludedText =
      depth && depth.occludedWindowIds.length > 0
        ? depth.occludedWindowIds.join(',')
        : 'нет';
    const summary =
      `Свет: ${light?.source ?? '--'} (${Math.round((light?.luminance ?? 0) * 100)}% / ${light?.kelvinApprox ?? 5500}K) | ` +
      `Z-Маска: ${depth?.enabled ? 'ON' : 'OFF'} (перекр: ${occludedText}) | ` +
      `Взгляд: ${gaze?.gazedWindowId ?? 'none'} | ` +
      `Кам-Руки: ${camHands?.running ? `${camHands.handsDetected}р/${camHands.activeGesture}` : 'OFF'} | ` +
      `SBS: ${sbs?.enabled ? `${sbs.aspectMode}/${sbs.ipdMm}mm` : 'OFF'} | ` +
      `VR: ${vr?.headsetLabel ?? '--'} | ` +
      `AndroidCam: ${androidCam?.backend ?? 'idle'} | ` +
      `Сохр: ${persistText}`;

    telemetryWin.bindings.onEnvironmentTelemetry?.(summary);
  }

  private resetWorkspace(): void {
    this.studioSync.clearSavedManifest();
    this.localStorageManager.clear();
    this.state.layoutMode = 'arc';
    this.state.wallsVisible = true;
    this.state.skyDomeEnabled = true;
    this.state.screens360Visible = true;
    this.state.hudVisible = true;
    this.state.sceneSelectorVisible = false;
    this.state.layoutEditorVisible = false;
    this.state.activeLayoutPresetId = 'workflow-dev';
    this.state.spatialAudioEnabled = true;
    this.state.cameraLightingEnabled = true;
    this.state.lightingPreset = 'auto';
    this.state.depthMaskEnabled = true;
    this.state.depthOccluderSimVisible = false;
    this.state.eyeTrackingEnabled = true;
    this.state.gazeWindowId = null;
    this.state.sbsEnabled = false;
    this.state.sbsAspectMode = 'half-sbs';
    this.state.sbsIpdMm = 64;
    this.state.androidCameraPanelVisible = false;
    this.surfaceManager.setWallsVisible(true);
    this.placesManager.setSkyDomeEnabled(true);
    this.placesManager.setScreens360Visible(true);
    this.perfHud.setVisible(true);
    this.voiceSceneSelector.setVisible(false);
    this.layoutEditor.setVisible(false);
    this.layoutEditor.setActivePresetId('workflow-dev');
    this.spatialAudio.setEnabled(true);
    this.layoutEditor.setAudioEnabledVisual(true);
    this.cameraLighting.setEnabled(true);
    this.cameraLighting.setPreset('auto');
    this.depthMask.setEnabled(true);
    this.depthMask.setSimulatedOccluderVisible(false);
    this.eyeFocus.setEnabled(true);
    this.sbsController.setAspectMode('half-sbs');
    this.sbsController.setIpdMm(64);
    this.sbsController.setEnabled(false);
    this.androidCameraController.setPanelVisible(false);
    this.placesManager.selectPlace('cyber-tokyo');
    this.setTheme('grayGlass');
    this.setRokidMode('standard-xr');
    this.windowManager.applyLayout('arc');
    this.syncAndRefreshHud('Сброс выполнен');
  }

  override dispose(): void {
    this.localStorageManager?.saveNow(
      this.state,
      this.windowManager?.getWindows() ?? [],
      true
    );
    this.localStorageManager?.detach();
    this.unsubscribeMonitor?.();
    this.releaseErrorSink?.();
    this.keyboardController?.detach();
    this.rokidBridge?.dispose();
    this.studioSync?.dispose();
  }
}
