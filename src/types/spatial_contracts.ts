import type * as THREE from 'three';
import type * as xb from 'xrblocks';

/**
 * ============================================================================
 * МОДУЛЬ: spatial_contracts.ts (Общие контракты ввода/вывода модулей)
 * ============================================================================
 * НАЗНАЧЕНИЕ:
 *   Единый справочник типов и структур данных для всех независимых модулей
 *   пространственного рабочего стола. Позволяет безопасно переставлять,
 *   заменять или тестировать модули изолированно, меняя только входные и
 *   выходные параметры.
 *
 * КАК ПОЛЬЗОВАТЬСЯ:
 *   Импортируйте необходимые интерфейсы в целевой модуль:
 *   `import type { ManagedSpatialWindow, SpatialPlaceSpec } from '../types/spatial_contracts.ts';`
 * ============================================================================
 */

/** Идентификатор встроенного или пользовательского приложения рабочего стола. */
export type SpatialAppId =
  | 'terminal'
  | 'notes'
  | 'telemetry'
  | 'studio'
  | 'viewport3d'
  | 'places';

/** Идентификаторы 10 невероятных 360°-локаций рабочего пространства. */
export type SpatialPlaceId =
  | 'cyber-tokyo'
  | 'orbital-station'
  | 'abyssal-dome'
  | 'crystal-cavern'
  | 'sky-citadel'
  | 'mars-outpost'
  | 'bioluminescent-forest'
  | 'quantum-nexus'
  | 'arctic-aurora'
  | 'synthwave-horizon';

/** Доступные режимы пространственной раскладки окон. */
export type WorkspaceLayoutMode = 'arc' | 'grid' | 'wall-pinned' | 'ring360';

/** Доступные визуальные темы пространственного UI XR Blocks. */
export type WorkspaceThemePreset =
  | 'grayGlass'
  | 'glimmer'
  | 'glimmerGreen'
  | 'colorful';

/** Профиль оптики и отображения очков Rokid Max / стандартного WebXR. */
export type RokidOpticsMode = 'standard-xr' | 'rokid-max-ar' | 'rokid-max-sbs';

/** Уровни отладочного логирования. */
export type DebugLogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'PERF';

/** Подсистемы-источники отладочных событий. */
export type DebugSubsystem =
  | 'CORE'
  | 'WINDOW'
  | 'SURFACE'
  | 'PLACE'
  | 'GESTURE'
  | 'VOICE'
  | 'INPUT'
  | 'ROKID'
  | 'STUDIO'
  | 'RENDER'
  | 'LAYOUT'
  | 'AUDIO'
  | 'LIGHTING'
  | 'DEPTH'
  | 'PERSIST'
  | 'EYETRACK'
  | 'CAMHAND'
  | 'VRHEADSET'
  | 'SBS'
  | 'ANDROIDCAM';

/** Режим камеры для отслеживания движений и жестов рук. */
export type CameraHandFacingMode = 'user' | 'environment';

/** Данные одной отслеженной руки с камеры (21 сустав + жест + щипок). */
export interface CameraHandFrameData {
  readonly side: 'left' | 'right';
  readonly palmNormalized: [number, number, number];
  readonly indexTipNormalized: [number, number];
  readonly pinching: boolean;
  readonly pinchStrength: number;
  readonly gesture: string;
  readonly confidence: number;
  readonly worldJoints: THREE.Vector3[];
}

/** Снимок состояния модуля камерного трекинга рук и жестов. */
export interface CameraHandTrackingSnapshot {
  running: boolean;
  simStubActive: boolean;
  status: string;
  cameraLabel: string;
  facingMode: CameraHandFacingMode;
  mirrored: boolean;
  fps: number;
  handsDetected: number;
  activeGesture: string;
  pinching: boolean;
  pinchStrength: number;
  pointerNdcX: number;
  pointerNdcY: number;
}

/** Режим адаптивного освещения от камеры Android/устройства. */
export type CameraLightingPreset = 'auto' | 'daylight' | 'warm' | 'night';

/** Снимок оценки освещения с камеры и окружения. */
export interface LightingEstimationSnapshot {
  enabled: boolean;
  preset: CameraLightingPreset;
  source: 'android-camera' | 'webxr-light' | 'stub-estimator';
  luminance: number;
  ambientHex: number;
  kelvinApprox: number;
}

/** Снимок состояния Z-маскировки глубины и перекрытия виртуальных окон. */
export interface DepthMaskStatusSnapshot {
  enabled: boolean;
  depthMeshActive: boolean;
  simulatedOccluderVisible: boolean;
  maskedWindowsCount: number;
  occludedWindowIds: SpatialAppId[];
}

/** Снимок состояния отслеживания взгляда и фокусного оверлея. */
export interface EyeFocusSnapshot {
  enabled: boolean;
  source: 'webxr-eye-gaze' | 'stub-center-fovea';
  gazedWindowId: SpatialAppId | null;
  gazedWindowTitle: string | null;
  dwellProgress: number;
  dwellAutoFocus: boolean;
}

/** Предпочтительный режим WebXR-сессии для AR-очков и VR-гарнитур. */
export type VrHeadsetPreferredMode = 'auto' | 'immersive-vr' | 'immersive-ar';

/** Снимок состояния поддержки VR-гарнитур и активной WebXR-сессии. */
export interface VrHeadsetSnapshot {
  preferredMode: VrHeadsetPreferredMode;
  configuredSessionMode: 'immersive-vr' | 'immersive-ar';
  activeSessionMode: 'simulator' | 'immersive-vr' | 'immersive-ar';
  xrSupportedVr: boolean;
  xrSupportedAr: boolean;
  isPresenting: boolean;
  controllerCount: number;
  hasThumbstickAxes: boolean;
  headsetLabel: string;
}

/** Режим кадрирования Side-by-Side (SBS) стереорендеринга. */
export type SbsAspectMode = 'half-sbs' | 'full-sbs';

/** Снимок состояния Side-by-Side (SBS) стереорендерера. */
export interface SbsStereoSnapshot {
  enabled: boolean;
  aspectMode: SbsAspectMode;
  ipdMm: number;
  deferredToWebXrStereo: boolean;
}

/** Источник потока камеры Android / устройства. */
export type AndroidCameraBackend =
  | 'webxr-camera-access'
  | 'getusermedia-rear'
  | 'getusermedia-front'
  | 'simulator-camera'
  | 'stub-unavailable';

/** Снимок состояния подсистемы камеры Android. */
export interface AndroidCameraSnapshot {
  backend: AndroidCameraBackend;
  streamState: string;
  deviceLabel: string;
  deviceCount: number;
  deviceIndex: number;
  width: number;
  height: number;
  panelVisible: boolean;
  lastSnapshotAtIso: string | null;
}

/** Одна запись в кольцевом буфере журнала отладки. */
export interface DebugLogEntry {
  readonly id: number;
  readonly timestampMs: number;
  readonly timeLabel: string;
  readonly level: DebugLogLevel;
  readonly subsystem: DebugSubsystem;
  readonly message: string;
}

/** Снимок производительности рендеринга в реальном времени (Zero-GC структура). */
export interface PerformanceSnapshot {
  fps: number;
  frameTimeMs: number;
  avgFrameTimeMs: number;
  maxFrameTimeMs: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  inputLatencyMs: number;
  heapUsedMb: number | null;
  heapLimitMb: number | null;
}

/** Описание виртуальной стены, 360°-панели или рабочей поверхности для привязки окон. */
export interface VirtualSurfaceDescriptor {
  readonly id: string;
  readonly title: string;
  readonly kind: 'wall' | 'desk' | 'depth' | 'panoramic360';
  readonly widthMeters: number;
  readonly heightMeters: number;
  readonly center: THREE.Vector3;
  readonly normal: THREE.Vector3;
  readonly quaternion: THREE.Quaternion;
}

/** Спецификация одного из 10 невероятных пространственных мест. */
export interface SpatialPlaceSpec {
  readonly id: SpatialPlaceId;
  readonly index: number;
  readonly title: string;
  readonly subtitle: string;
  readonly skyTopHex: number;
  readonly skyHorizonHex: number;
  readonly skyBottomHex: number;
  readonly accentHex: number;
  readonly secondaryHex: number;
  readonly fogDensity: number;
  readonly particleKind:
    | 'rain'
    | 'stars'
    | 'bubbles'
    | 'spores'
    | 'embers'
    | 'snow'
    | 'data';
  readonly screenCount360: number;
  readonly screenRadiusMeters: number;
  readonly screenThemes: readonly string[];
}

/** Выходной результат расчёта магнитного примагничивания окна к поверхности. */
export interface SurfaceSnapResult {
  readonly surfaceId: string;
  readonly surfaceTitle: string;
  readonly kind: 'wall' | 'desk' | 'depth' | 'panoramic360';
  readonly position: THREE.Vector3;
  readonly quaternion: THREE.Quaternion;
  readonly distanceMeters: number;
}

/** Входные параметры создания пространственного окна. */
export interface SpatialWindowCreateInput {
  readonly id: SpatialAppId;
  readonly title: string;
  readonly icon: string;
  readonly widthMeters: number;
  readonly heightMeters: number | 'auto';
  readonly initialPosition: THREE.Vector3;
  readonly initialRotationY?: number;
}

/** Реактивные ссылки на элементы управления внутри окна (обновление без пересоздания дерева). */
export interface WindowDynamicBindings {
  onStatusUpdate?: (text: string) => void;
  onLogUpdate?: (formattedLog: string) => void;
  onTelemetryUpdate?: (snapshot: PerformanceSnapshot) => void;
  onRokidStateUpdate?: (statusText: string) => void;
  onSyncNoteText?: (text: string) => void;
  onPlaceChanged?: (place: SpatialPlaceSpec, skyDomeEnabled: boolean) => void;
  onSpatialAudioTelemetry?: (summary: string) => void;
  onEnvironmentTelemetry?: (summary: string) => void;
}

/** Управляемая сущность пространственного окна в 3D-сцене. */
export interface ManagedSpatialWindow {
  readonly id: SpatialAppId;
  readonly title: string;
  readonly card: xb.UICard;
  readonly pinBadge: xb.UIText;
  readonly pinButton: xb.UIButton;
  pinnedSurfaceId: string | null;
  minimized: boolean;
  lastActiveTimestamp: number;
  bindings: WindowDynamicBindings;
}

/** Конфигурация оптики Rokid Max (Birdbath AR / 50° FOV / 1080p per eye). */
export interface RokidOpticsProfile {
  readonly mode: RokidOpticsMode;
  readonly label: string;
  readonly diagonalFovDeg: number;
  readonly perEyeWidth: number;
  readonly perEyeHeight: number;
  readonly simulateAdditiveDisplay: boolean;
  readonly dimmingLevel: number;
  readonly stereoBaselineMm: number;
}

/** Сообщение обмена с внешним хостом `rokid-spatial-host`. */
export interface RokidHostPacket {
  readonly protocol: 'rokid-spatial-host/v1';
  readonly type:
    | 'HANDSHAKE'
    | 'IMU_POSE'
    | 'WINDOW_COMMAND'
    | 'OPTICS_PROFILE'
    | 'PLACE_SWITCH'
    | 'TELEMETRY_PING';
  readonly timestampMs: number;
  readonly payload: Record<string, unknown>;
}

/** Сериализованный манифест сцены для экосистемы `rokid-spatial-studio-xr`. */
export interface StudioSceneManifest {
  readonly schema: 'rokid-spatial-studio-xr/v1';
  readonly savedAtIso: string;
  readonly layoutMode: WorkspaceLayoutMode;
  readonly theme: WorkspaceThemePreset;
  readonly rokidMode: RokidOpticsMode;
  readonly placeId: SpatialPlaceId;
  readonly skyDomeEnabled: boolean;
  readonly screens360Visible: boolean;
  readonly wallsVisible: boolean;
  readonly hudVisible?: boolean;
  readonly gestureGuideVisible?: boolean;
  readonly sceneSelectorVisible?: boolean;
  readonly layoutEditorVisible?: boolean;
  readonly activeLayoutPresetId?: string;
  readonly spatialAudioEnabled?: boolean;
  readonly windows: Array<{
    id: SpatialAppId;
    visible: boolean;
    pinnedSurfaceId: string | null;
    position: [number, number, number];
    quaternion: [number, number, number, number];
    scale: number;
  }>;
}

/** Локальное автосохранение позиций, масштабов и конфигурации окон. */
export interface PersistedWorkspaceState {
  readonly schema: 'rokid-spatial-local-workspace/v2';
  readonly savedAtIso: string;
  readonly activeWindowId: SpatialAppId;
  readonly layoutMode: WorkspaceLayoutMode;
  readonly theme: WorkspaceThemePreset;
  readonly rokidMode: RokidOpticsMode;
  readonly placeId: SpatialPlaceId;
  readonly skyDomeEnabled: boolean;
  readonly screens360Visible: boolean;
  readonly wallsVisible: boolean;
  readonly hudVisible: boolean;
  readonly gestureGuideVisible: boolean;
  readonly sceneSelectorVisible: boolean;
  readonly layoutEditorVisible: boolean;
  readonly activeLayoutPresetId: string;
  readonly spatialAudioEnabled: boolean;
  readonly spatialAudioVolume: number;
  readonly cameraLightingEnabled: boolean;
  readonly lightingPreset: CameraLightingPreset;
  readonly depthMaskEnabled: boolean;
  readonly depthOccluderSimVisible: boolean;
  readonly eyeTrackingEnabled: boolean;
  readonly cameraHandTrackingEnabled?: boolean;
  readonly cameraHandFacingMode?: CameraHandFacingMode;
  readonly sbsEnabled?: boolean;
  readonly sbsIpdMm?: number;
  readonly sbsAspectMode?: SbsAspectMode;
  readonly vrPreferredMode?: VrHeadsetPreferredMode;
  readonly androidCameraPanelVisible?: boolean;
  readonly windows: SavedWindowTransform[];
}

/** Тип рабочего профиля для редактора раскладок. */
export type WorkflowPresetKind =
  | 'development'
  | 'media'
  | 'communication'
  | 'custom';

/** Снимок трансформации одного 3D-окна для сохранения и загрузки раскладок. */
export interface SavedWindowTransform {
  readonly id: SpatialAppId;
  readonly visible: boolean;
  readonly pinnedSurfaceId: string | null;
  readonly position: [number, number, number];
  readonly quaternion: [number, number, number, number];
  readonly scale: number;
}

/** Сохранённый пресет раскладки рабочих окон (встроенный или пользовательский). */
export interface SavedLayoutPreset {
  readonly id: string;
  readonly name: string;
  readonly workflowKind: WorkflowPresetKind;
  readonly isBuiltIn: boolean;
  readonly layoutMode: WorkspaceLayoutMode;
  readonly savedAtIso: string;
  readonly windows: readonly SavedWindowTransform[];
}

/** Телеметрия пространственного звука для одного 3D-окна. */
export interface WindowSpatialAudioTelemetry {
  appId: SpatialAppId;
  title: string;
  enabled: boolean;
  distanceMeters: number;
  pan: number;
  gain: number;
}

/** Распознанная голосовая команда и её параметры. */
export interface VoiceCommandAction {
  readonly rawTranscript: string;
  readonly action:
    | 'LAYOUT_ARC'
    | 'LAYOUT_GRID'
    | 'LAYOUT_WALL'
    | 'LAYOUT_360'
    | 'OPEN_LAYOUT_EDITOR'
    | 'CLOSE_LAYOUT_EDITOR'
    | 'WORKFLOW_DEV'
    | 'WORKFLOW_MEDIA'
    | 'WORKFLOW_COMMS'
    | 'SAVE_CUSTOM_LAYOUT'
    | 'TOGGLE_SPATIAL_AUDIO'
    | 'TOGGLE_CAMERA_LIGHTING'
    | 'CYCLE_LIGHTING_PRESET'
    | 'TOGGLE_DEPTH_MASK'
    | 'TOGGLE_DEPTH_OCCLUDER'
    | 'TOGGLE_EYE_TRACKING'
    | 'TOGGLE_CAMERA_HANDS'
    | 'FLIP_HAND_CAMERA'
    | 'TOGGLE_SBS'
    | 'SBS_FULL'
    | 'SBS_HALF'
    | 'ENTER_VR_HEADSET'
    | 'TOGGLE_ANDROID_CAMERA'
    | 'CAPTURE_ANDROID_SNAPSHOT'
    | 'PIN_ACTIVE'
    | 'UNPIN_ALL'
    | 'TOGGLE_WALLS'
    | 'TOGGLE_360_SCREENS'
    | 'TOGGLE_SKYDOME'
    | 'THEME_GLASS'
    | 'THEME_GLIMMER'
    | 'THEME_COLORFUL'
    | 'TOGGLE_ROKID'
    | 'TOGGLE_XR_MODE'
    | 'TOGGLE_DEBUG'
    | 'TOGGLE_HUD'
    | 'TOGGLE_GESTURE_GUIDE'
    | 'OPEN_APP'
    | 'PLACE_NEXT'
    | 'PLACE_PREV'
    | 'PLACE_SELECT'
    | 'OPEN_SCENE_SELECTOR'
    | 'CLOSE_SCENE_SELECTOR'
    | 'RESET_WORKSPACE'
    | 'UNKNOWN';
  readonly appId?: SpatialAppId;
  readonly placeId?: SpatialPlaceId;
}

/** Вид 3D-манипуляции окном для визуального отклика hand-ghost и ретикла. */
export type SpatialManipulationKind =
  | 'move'
  | 'scale'
  | 'resize'
  | 'rotate'
  | 'pin';

/** Общее состояние среды рабочего стола для синхронизации между модулями. */
export interface WorkspaceEnvironmentState {
  layoutMode: WorkspaceLayoutMode;
  theme: WorkspaceThemePreset;
  rokidMode: RokidOpticsMode;
  placeId: SpatialPlaceId;
  skyDomeEnabled: boolean;
  screens360Visible: boolean;
  wallsVisible: boolean;
  debugVisible: boolean;
  hudVisible: boolean;
  gestureGuideVisible: boolean;
  sceneSelectorVisible: boolean;
  layoutEditorVisible: boolean;
  activeLayoutPresetId: string;
  spatialAudioEnabled: boolean;
  spatialAudioVolume: number;
  cameraLightingEnabled: boolean;
  lightingPreset: CameraLightingPreset;
  depthMaskEnabled: boolean;
  depthOccluderSimVisible: boolean;
  eyeTrackingEnabled: boolean;
  gazeWindowId: SpatialAppId | null;
  cameraHandTrackingEnabled: boolean;
  cameraHandFacingMode: CameraHandFacingMode;
  sbsEnabled: boolean;
  sbsIpdMm: number;
  sbsAspectMode: SbsAspectMode;
  vrPreferredMode: VrHeadsetPreferredMode;
  androidCameraPanelVisible: boolean;
  voiceListening: boolean;
  xrMode: 'AR' | 'VR';
  activeWindowId: SpatialAppId;
}
