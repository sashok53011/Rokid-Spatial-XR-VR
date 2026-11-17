import * as xb from 'xrblocks';

import type {
  RokidOpticsMode,
  RokidOpticsProfile,
  VrHeadsetPreferredMode,
} from '../types/spatial_contracts.ts';

/**
 * ============================================================================
 * МОДУЛЬ: configure_xr_workspace.ts (Конфигурация XR/VR-среды и Rokid Max)
 * ============================================================================
 * НАЗНАЧЕНИЕ:
 *   Инкапсулирует настройку `xb.Options` для пространственного рабочего стола:
 *   - AR-режим (`immersive-ar`, камера Android `environment`, DepthMesh)
 *   - VR-режим для VR-гарнитур (`immersive-vr`, безопасное отключение
 *     обязательного `depth-sensing`, включение лучей контроллеров и 6DoF/3DoF)
 *   - Переключение оптических профилей очков Rokid Max (Birdbath AR, 50° FOV,
 *     1080p на глаз, аддитивная прозрачность и режим 3D SBS).
 *
 * ВХОДНЫЕ ДАННЫЕ:
 *   - `createWorkspaceOptions(config)`: параметры запуска (`appTitle`,
 *     `enableSpeech`, `enableDepth`, `xrSessionMode`).
 *   - `resolveHeadsetOptions(options)`: асинхронная проверка `navigator.xr`
 *     для автоматического выбора `immersive-vr` на VR-гарнитурах.
 *   - `applyRokidOpticsProfile(mode, options)`: выбор оптического профиля.
 *
 * ВЫХОДНЫЕ ДАННЫЕ:
 *   - Настроенный экземпляр `xb.Options`, `HeadsetCapabilityReport` и
 *     активный профиль `RokidOpticsProfile`.
 *
 * ЗАГЛУШКИ (STUB):
 *   - Режим `rokid-max-sbs` включает реальный split-screen стереорендер в
 *     браузере через модуль `render_sbs_stereo.ts`, а аппаратное переключение
 *     EDID 3840x1080 на кабеле USB-C DP Alt-Mode выполняется внешним демоном
 *     `rokid-spatial-host` (см. `bridge_rokid_spatial_host.ts`).
 * ============================================================================
 */

const VR_SESSION_PREF_STORAGE_KEY = 'rokid_spatial_vr_session_pref_v1';

export interface WorkspaceOptionsInput {
  readonly appTitle?: string;
  readonly appDescription?: string;
  readonly enableDepth?: boolean;
  readonly enableSpeech?: boolean;
}

export interface HeadsetCapabilityReport {
  readonly supportsAr: boolean;
  readonly supportsVr: boolean;
  readonly preferredMode: VrHeadsetPreferredMode;
  readonly configuredSessionMode: 'immersive-vr' | 'immersive-ar';
}

export const ROKID_OPTICS_PROFILES: Record<RokidOpticsMode, RokidOpticsProfile> =
  {
    'standard-xr': {
      mode: 'standard-xr',
      label: 'Standard WebXR',
      diagonalFovDeg: 90,
      perEyeWidth: 1920,
      perEyeHeight: 1080,
      simulateAdditiveDisplay: false,
      dimmingLevel: 0,
      stereoBaselineMm: 63,
    },
    'rokid-max-ar': {
      mode: 'rokid-max-ar',
      label: 'Rokid Max Birdbath AR (50° FOV)',
      diagonalFovDeg: 50,
      perEyeWidth: 1920,
      perEyeHeight: 1080,
      simulateAdditiveDisplay: true,
      dimmingLevel: 0.35,
      stereoBaselineMm: 64,
    },
    'rokid-max-sbs': {
      mode: 'rokid-max-sbs',
      label: 'Rokid Max 3D SBS (3840×1080)',
      diagonalFovDeg: 50,
      perEyeWidth: 1920,
      perEyeHeight: 1080,
      simulateAdditiveDisplay: true,
      dimmingLevel: 0.65,
      stereoBaselineMm: 64,
    },
  };

export function getSavedVrPreferredMode(): VrHeadsetPreferredMode {
  try {
    const raw = localStorage.getItem(VR_SESSION_PREF_STORAGE_KEY);
    if (raw === 'immersive-vr' || raw === 'immersive-ar' || raw === 'auto') {
      return raw;
    }
  } catch {
    // Игнорируем ошибку в приватном режиме.
  }
  return 'auto';
}

export function setSavedVrPreferredMode(mode: VrHeadsetPreferredMode): void {
  try {
    localStorage.setItem(VR_SESSION_PREF_STORAGE_KEY, mode);
  } catch {
    // Игнорируем ошибку в приватном режиме.
  }
}

/**
 * Создаёт и настраивает `xb.Options` для пространственного рабочего стола.
 */
export function createWorkspaceOptions(
  config: WorkspaceOptionsInput = {}
): xb.Options {
  const options = new xb.Options();

  options.setAppTitle(config.appTitle ?? 'Rokid Spatial Desktop XR');
  options.setAppDescription(
    config.appDescription ??
      '3D-рабочий стол для AR/VR-гарнитур и Rokid Max: привязка окон к стенам, жесты, SBS 3D, камера Android и голос.'
  );

  // Включаем руки и встроенные эвристические жесты XR Blocks.
  // Настройки симулятора оставляем по умолчанию согласно правилам XR Blocks.
  options.enableHands();
  options.hands.visualization = true;
  options.enableGestures();
  options.gestures.setGestureEnabled('point', true);
  options.gestures.setGestureEnabled('spread', true);
  options.gestures.setGestureEnabled('open-palm', true);
  options.gestures.setGestureEnabled('fist', true);
  options.gestures.setGestureEnabled('thumbs-up', true);
  options.gestures.setGestureEnabled('thumbs-down', true);

  // Включаем ретикл, полную глубину и окклюзию для Z-маскировки виртуальных окон реальными объектами.
  options.enableReticles();
  if (config.enableDepth !== false) {
    options.depth = new xb.DepthOptions(xb.xrDepthMeshOptions);
    options.depth.depthMesh.updateFullResolutionGeometry = true;
    options.depth.depthMesh.renderShadow = true;
    options.depth.depthTexture.enabled = true;
    options.depth.occlusion.enabled = true;
    options.reticles.projectOnDepthMesh = true;
  }

  // Камера окружения Android/устройства для панорамного анализа, фото и освещения + WebXR Light Estimation.
  options.enableCamera('environment');
  options.deviceCamera.videoConstraints = {
    facingMode: {ideal: 'environment'},
    width: {ideal: 1280},
    height: {ideal: 720},
  };
  options.lighting.enabled = true;

  // Переходы AR <-> VR для тестирования в темном студийном режиме или прозрачном AR.
  options.enableXRTransitions();

  // Встроенный распознаватель речи (Web Speech API) для голосовых команд.
  if (config.enableSpeech !== false) {
    options.sound.speechRecognizer.enabled = true;
    options.sound.speechRecognizer.continuous = false;
    options.sound.speechRecognizer.interimResults = true;
    options.sound.speechRecognizer.playSimulatorActivationSounds = true;
  }

  options.xrButton.showEnterSimulatorButton = true;
  options.catchScriptExceptions = true;

  return options;
}

/**
 * Определяет поддержку VR/AR-гарнитуры до запуска `xb.init()` и адаптирует
 * WebXR-фичи так, чтобы `immersive-vr` гарнитуры не отклоняли сессию из-за
 * обязательного `depth-sensing`.
 */
export async function resolveHeadsetOptions(
  options: xb.Options
): Promise<HeadsetCapabilityReport> {
  const params =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search)
      : null;
  const vrParam = params?.get('vr');
  const xrModeParam = params?.get('xrMode');

  let preferredMode = getSavedVrPreferredMode();
  if (vrParam === '1' || vrParam === 'true' || xrModeParam === 'vr') {
    preferredMode = 'immersive-vr';
  } else if (xrModeParam === 'ar') {
    preferredMode = 'immersive-ar';
  }

  let supportsAr = false;
  let supportsVr = false;
  if (typeof navigator !== 'undefined' && 'xr' in navigator && navigator.xr) {
    try {
      supportsAr = await navigator.xr.isSessionSupported('immersive-ar');
    } catch {
      supportsAr = false;
    }
    try {
      supportsVr = await navigator.xr.isSessionSupported('immersive-vr');
    } catch {
      supportsVr = false;
    }
  }

  const useVrSession =
    options.xrSessionMode === 'immersive-vr' ||
    preferredMode === 'immersive-vr' ||
    (preferredMode === 'auto' && supportsVr && !supportsAr);

  if (useVrSession) {
    options.enableVR();
    // На чистых VR-гарнитурах (Quest without passthrough, Pico, Valve Index, Cardboard)
    // обязательный depth-sensing отсутствует и приводит к отклонению requestSession().
    options.depth = new xb.DepthOptions();
    options.depth.enabled = false;
    options.reticles.projectOnDepthMesh = false;
    options.controllers.visualization = true;
    options.controllers.visualizeRays = true;
    options.xrButton.startText = 'Enter VR';
    options.xrButton.endText = 'Exit VR';
  } else {
    options.xrSessionMode = 'immersive-ar';
    options.xrButton.startText = 'Enter XR';
    options.xrButton.endText = 'Exit XR';
  }

  return {
    supportsAr,
    supportsVr,
    preferredMode,
    configuredSessionMode:
      options.xrSessionMode === 'immersive-vr' ? 'immersive-vr' : 'immersive-ar',
  };
}

/**
 * Применяет выбранный оптический профиль Rokid Max к активной сессии XR Blocks.
 */
export function applyRokidOpticsProfile(
  mode: RokidOpticsMode,
  options?: xb.Options
): RokidOpticsProfile {
  const profile = ROKID_OPTICS_PROFILES[mode];

  if (options) {
    options.simulateAdditiveDisplay = profile.simulateAdditiveDisplay;
    options.simulatedDimming = profile.dimmingLevel;
    options.simulator.stereo.enabled = mode === 'rokid-max-sbs';
  }

  // Настройка аддитивной темы UI для Birdbath-линз Rokid Max (высокий контраст).
  if (mode === 'rokid-max-ar' || mode === 'rokid-max-sbs') {
    xb.ui.theme = 'glimmer';
  } else {
    xb.ui.theme = 'grayGlass';
  }

  // Плавный переход фона через встроенный XRTransition при активной сессии.
  const transition = xb.core?.transition;
  if (transition) {
    if (mode === 'rokid-max-sbs') {
      transition.toVR({color: 0x050914, targetAlpha: 0.88});
    } else if (mode === 'rokid-max-ar') {
      transition.toAR();
    } else {
      transition.toAR();
    }
  }

  return profile;
}

/**
 * Переключает режим окружения XR Blocks между AR (прозрачный фон) и VR (тёмная студия).
 */
export function toggleXRDisplayMode(targetMode: 'AR' | 'VR'): 'AR' | 'VR' {
  const transition = xb.core?.transition;
  if (!transition) return targetMode;

  if (targetMode === 'VR') {
    transition.toVR({color: 0x070b16, targetAlpha: 0.96});
  } else {
    transition.toAR();
  }
  return targetMode;
}
