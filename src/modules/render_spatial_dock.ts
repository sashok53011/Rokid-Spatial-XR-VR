import * as THREE from 'three';
import * as xb from 'xrblocks';

import type {
  SpatialAppId,
  WorkspaceEnvironmentState,
} from '../types/spatial_contracts.ts';

/**
 * ============================================================================
 * МОДУЛЬ: render_spatial_dock.ts (Пространственный док и компактный HUD)
 * ============================================================================
 * НАЗНАЧЕНИЕ:
 *   Создаёт:
 *   1. Нижний пространственный док быстрого запуска (`xb.UICard` с `edge: true`,
 *      опционально следующий за взглядом или свободно перемещаемый) с кнопками
 *      5 приложений, раскладки, стен, голоса, Rokid Max и AR/VR.
 *   2. Компактный view-space HUD (`xb.UIOverlay`) внизу экрана со строкой
 *      состояния активного профиля/жеста/голоса и кнопкой выхода `UIExitButton`.
 *
 * ВХОДНЫЕ ДАННЫЕ:
 *   - Коллбеки `SpatialDockActions` (открыть окно, переключить голос, Rokid Max,
 *     AR/VR, привязать к стене, сбросить).
 *
 * ВЫХОДНЫЕ ДАННЫЕ:
 *   - Методы обновления состояния `updateState(envState, statusLine)` и
 *     переключения видимости дока `toggleDockVisible()`.
 *
 * КАК ПОЛЬЗОВАТЬСЯ:
 *   const dock = new SpatialDockController({ ...actions });
 *   this.add(dock);
 *   dock.updateState(envState, 'Голос: ожидание');
 * ============================================================================
 */

export interface SpatialDockActions {
  readonly onToggleWindow: (id: SpatialAppId) => void;
  readonly onCycleLayout: () => void;
  readonly onToggleWalls: () => void;
  readonly onToggleVoice: () => void;
  readonly onCycleRokidMode: () => void;
  readonly onToggleXRMode: () => void;
  readonly onPinActive: () => void;
  readonly onNextPlace: () => void;
  readonly onPrevPlace: () => void;
  readonly onLayout360: () => void;
  readonly onToggleHud: () => void;
  readonly onToggleGestureGuide: () => void;
  readonly onToggleSceneSelector: () => void;
  readonly onToggleLayoutEditor: () => void;
  readonly onToggleSpatialAudio: () => void;
  readonly onToggleCameraLighting: () => void;
  readonly onCycleLightingPreset: () => void;
  readonly onToggleDepthMask: () => void;
  readonly onToggleDepthOccluder: () => void;
  readonly onToggleEyeTracking: () => void;
  readonly onToggleCameraHands: () => void;
  readonly onToggleSbs: () => void;
  readonly onEnterVrHeadset: () => void;
  readonly onToggleAndroidCamera: () => void;
}

export class SpatialDockController extends xb.Script {
  private readonly actions: SpatialDockActions;
  private dockCard!: xb.UICard;
  private overlay!: xb.UIOverlay;
  private statusText!: xb.UIText;
  private voiceButton!: xb.UIButton;
  private rokidButton!: xb.UIButton;
  private wallsButton!: xb.UIButton;
  private xrModeButton!: xb.UIButton;
  private hudButton!: xb.UIButton;
  private audioButton!: xb.UIButton;
  private lightingButton!: xb.UIButton;
  private lightingPresetButton!: xb.UIButton;
  private depthMaskButton!: xb.UIButton;
  private depthOccluderButton!: xb.UIButton;
  private eyeFocusButton!: xb.UIButton;
  private cameraHandsButton!: xb.UIButton;
  private sbsButton!: xb.UIButton;
  private vrHeadsetButton!: xb.UIButton;
  private androidCamButton!: xb.UIButton;
  private followHead!: xb.FollowHead;
  private followEnabled = false;
  private followToggleBtn!: xb.UIButton;

  constructor(actions: SpatialDockActions) {
    super();
    this.actions = actions;
  }

  override init(): void {
    this.buildDockCard();
    this.buildCompactOverlay();
  }

  toggleDockVisible(): boolean {
    this.dockCard.visible = !this.dockCard.visible;
    return this.dockCard.visible;
  }

  updateState(state: WorkspaceEnvironmentState, detailMessage?: string): void {
    this.voiceButton.label = state.voiceListening ? 'Listening' : 'Голос (V)';
    this.voiceButton.icon = state.voiceListening ? 'graphic_eq' : 'mic';

    const rokidShort =
      state.rokidMode === 'rokid-max-ar'
        ? 'Rokid AR'
        : state.rokidMode === 'rokid-max-sbs'
          ? 'Rokid SBS'
          : 'WebXR';
    this.rokidButton.label = rokidShort;
    this.wallsButton.label = state.wallsVisible ? 'Стены: ON' : 'Стены: OFF';
    this.xrModeButton.label = state.xrMode === 'AR' ? 'AR Mode' : 'VR Studio';
    this.hudButton.label = state.hudVisible ? 'HUD: ON' : 'HUD: OFF';
    if (this.audioButton) {
      this.audioButton.label = state.spatialAudioEnabled
        ? 'Аудио (U)'
        : 'Муть (U)';
      this.audioButton.icon = state.spatialAudioEnabled
        ? 'volume_up'
        : 'volume_off';
    }
    if (this.lightingButton) {
      this.lightingButton.label = state.cameraLightingEnabled
        ? 'Свет: ON (I)'
        : 'Свет: OFF (I)';
      this.lightingPresetButton.label = `Тон: ${state.lightingPreset}`;
      this.depthMaskButton.label = state.depthMaskEnabled
        ? 'Z-Маска: ON (X)'
        : 'Z-Маска: OFF (X)';
      this.depthOccluderButton.label = state.depthOccluderSimVisible
        ? '3D-Преграда: ON'
        : '3D-Преграда: OFF';
      this.eyeFocusButton.label = state.eyeTrackingEnabled
        ? 'Взгляд: ON (F)'
        : 'Взгляд: OFF (F)';
      this.cameraHandsButton.label = state.cameraHandTrackingEnabled
        ? `Руки-Кам: ON (J)`
        : `Руки-Кам: OFF (J)`;
      this.sbsButton.label = state.sbsEnabled
        ? `SBS 3D: ON (Y)`
        : `SBS 3D: OFF (Y)`;
      this.vrHeadsetButton.label =
        state.vrPreferredMode === 'immersive-vr'
          ? 'VR Шлем: ON (Z)'
          : 'VR Шлем (Z)';
      this.androidCamButton.label = state.androidCameraPanelVisible
        ? 'Android Cam: ON (O)'
        : 'Android Cam (O)';
    }

    const sbsTag = state.sbsEnabled ? ` | SBS(${state.sbsIpdMm}mm)` : '';
    const suffix = detailMessage ? ` | ${detailMessage}` : '';
    this.statusText.text =
      `Активно: ${state.activeWindowId} | Раскладка: ${state.layoutMode} | ` +
      `Профиль: ${rokidShort}${sbsTag}${suffix}`;
  }

  private buildDockCard(): void {
    this.voiceButton = new xb.UIButton({
      label: 'Голос (V)',
      icon: 'mic',
      style: {flexGrow: 1},
      onClick: () => this.actions.onToggleVoice(),
    });

    this.rokidButton = new xb.UIButton({
      label: 'WebXR',
      icon: 'eyeglasses',
      style: {flexGrow: 1},
      onClick: () => this.actions.onCycleRokidMode(),
    });

    this.wallsButton = new xb.UIButton({
      label: 'Стены: ON',
      icon: 'wallpaper',
      style: {flexGrow: 1},
      onClick: () => this.actions.onToggleWalls(),
    });

    this.xrModeButton = new xb.UIButton({
      label: 'AR Mode',
      icon: 'view_in_ar',
      style: {flexGrow: 1},
      onClick: () => this.actions.onToggleXRMode(),
    });

    this.hudButton = new xb.UIButton({
      label: 'HUD: ON',
      icon: 'speed',
      style: {flexGrow: 1},
      onClick: () => this.actions.onToggleHud(),
    });

    this.audioButton = new xb.UIButton({
      label: 'Аудио (U)',
      icon: 'volume_up',
      style: {flexGrow: 1},
      onClick: () => this.actions.onToggleSpatialAudio(),
    });

    this.lightingButton = new xb.UIButton({
      label: 'Свет: ON (I)',
      icon: 'light_mode',
      style: {flexGrow: 1},
      onClick: () => this.actions.onToggleCameraLighting(),
    });

    this.lightingPresetButton = new xb.UIButton({
      label: 'Тон: auto',
      icon: 'wb_twilight',
      style: {flexGrow: 1},
      onClick: () => this.actions.onCycleLightingPreset(),
    });

    this.depthMaskButton = new xb.UIButton({
      label: 'Z-Маска: ON (X)',
      icon: 'layers',
      style: {flexGrow: 1},
      onClick: () => this.actions.onToggleDepthMask(),
    });

    this.depthOccluderButton = new xb.UIButton({
      label: '3D-Преграда: OFF',
      icon: 'view_column',
      style: {flexGrow: 1},
      onClick: () => this.actions.onToggleDepthOccluder(),
    });

    this.eyeFocusButton = new xb.UIButton({
      label: 'Взгляд: ON (F)',
      icon: 'visibility',
      style: {flexGrow: 1},
      onClick: () => this.actions.onToggleEyeTracking(),
    });

    this.cameraHandsButton = new xb.UIButton({
      label: 'Руки-Кам: OFF (J)',
      icon: 'front_hand',
      style: {flexGrow: 1},
      onClick: () => this.actions.onToggleCameraHands(),
    });

    this.sbsButton = new xb.UIButton({
      label: 'SBS 3D: OFF (Y)',
      icon: 'splitscreen',
      style: {flexGrow: 1},
      onClick: () => this.actions.onToggleSbs(),
    });

    this.vrHeadsetButton = new xb.UIButton({
      label: 'VR Шлем (Z)',
      icon: 'vrpano',
      style: {flexGrow: 1},
      onClick: () => this.actions.onEnterVrHeadset(),
    });

    this.androidCamButton = new xb.UIButton({
      label: 'Android Cam (O)',
      icon: 'photo_camera',
      style: {flexGrow: 1},
      onClick: () => this.actions.onToggleAndroidCamera(),
    });

    this.followToggleBtn = new xb.UIButton({
      icon: 'center_focus_strong',
      ariaLabel: 'Следовать за головой',
      style: {width: 44, height: 44, padding: 0},
      onClick: () => {
        this.followEnabled = !this.followEnabled;
        if (this.followEnabled) {
          this.followHead.resume();
        } else {
          this.followHead.suspend();
        }
      },
    });

    const appsRow = new xb.UIPanel({
      style: {width: '100%', flexDirection: 'row', gap: 8},
      children: [
        new xb.UIButton({
          label: 'Terminal (1)',
          icon: 'terminal',
          style: {flexGrow: 1},
          onClick: () => this.actions.onToggleWindow('terminal'),
        }),
        new xb.UIButton({
          label: 'Notes (2)',
          icon: 'edit_note',
          style: {flexGrow: 1},
          onClick: () => this.actions.onToggleWindow('notes'),
        }),
        new xb.UIButton({
          label: 'Debug (3)',
          icon: 'monitoring',
          style: {flexGrow: 1},
          onClick: () => this.actions.onToggleWindow('telemetry'),
        }),
        new xb.UIButton({
          label: 'Studio (4)',
          icon: 'dashboard_customize',
          style: {flexGrow: 1},
          onClick: () => this.actions.onToggleWindow('studio'),
        }),
        new xb.UIButton({
          label: '3D Node (5)',
          icon: 'deployed_code',
          style: {flexGrow: 1},
          onClick: () => this.actions.onToggleWindow('viewport3d'),
        }),
        new xb.UIButton({
          label: 'Места (6)',
          icon: 'public',
          style: {flexGrow: 1},
          onClick: () => this.actions.onToggleWindow('places'),
        }),
      ],
    });

    const toolsRow = new xb.UIPanel({
      style: {width: '100%', flexDirection: 'row', gap: 8, alignItems: 'center'},
      children: [
        new xb.UIButton({
          label: 'Pin (P)',
          icon: 'push_pin',
          style: {flexGrow: 1},
          onClick: () => this.actions.onPinActive(),
        }),
        new xb.UIButton({
          label: 'Layout (L)',
          icon: 'grid_view',
          style: {flexGrow: 1},
          onClick: () => this.actions.onCycleLayout(),
        }),
        new xb.UIButton({
          label: '360°',
          icon: '360',
          style: {flexGrow: 1},
          onClick: () => this.actions.onLayout360(),
        }),
        new xb.UIButton({
          label: '◀ Место',
          style: {flexGrow: 1},
          onClick: () => this.actions.onPrevPlace(),
        }),
        new xb.UIButton({
          label: 'Место ▶',
          style: {flexGrow: 1},
          onClick: () => this.actions.onNextPlace(),
        }),
        this.wallsButton,
        this.voiceButton,
        this.rokidButton,
        this.xrModeButton,
        this.hudButton,
        this.followToggleBtn,
      ],
    });

    const immersionRow = new xb.UIPanel({
      style: {width: '100%', flexDirection: 'row', gap: 8, alignItems: 'center'},
      children: [
        this.lightingButton,
        this.lightingPresetButton,
        this.depthMaskButton,
        this.depthOccluderButton,
        this.eyeFocusButton,
        this.cameraHandsButton,
        this.audioButton,
        new xb.UIButton({
          label: 'Макеты (K)',
          icon: 'space_dashboard',
          style: {flexGrow: 1},
          onClick: () => this.actions.onToggleLayoutEditor(),
        }),
        new xb.UIButton({
          label: 'Сцены (C)',
          icon: 'record_voice_over',
          style: {flexGrow: 1},
          onClick: () => this.actions.onToggleSceneSelector(),
        }),
        new xb.UIButton({
          label: 'Гид (?)',
          icon: 'help_outline',
          style: {flexGrow: 1},
          onClick: () => this.actions.onToggleGestureGuide(),
        }),
      ],
    });

    const hardwareRow = new xb.UIPanel({
      style: {width: '100%', flexDirection: 'row', gap: 8, alignItems: 'center'},
      children: [
        this.sbsButton,
        this.vrHeadsetButton,
        this.androidCamButton,
      ],
    });

    this.dockCard = new xb.UICard({
      size: {width: 1.94, height: 'auto'},
      manipulation: true,
      edge: true,
      style: {flexDirection: 'column', gap: 8, padding: 12},
      children: [appsRow, toolsRow, immersionRow, hardwareRow],
    });
    this.dockCard.name = 'SpatialDesktopDock';
    this.dockCard.position.set(0, 0.7, -1.14);
    this.dockCard.rotation.x = THREE.MathUtils.degToRad(-18);

    this.followHead = new xb.FollowHead({
      offset: new THREE.Vector3(0, -0.46, -1.14),
      smoothing: 0.08,
    });
    this.dockCard.add(this.followHead);
    // По умолчанию док закреплён внизу эргономичной зоны; пользователь может включить следование за головой.
    this.followHead.suspend();

    this.add(this.dockCard);
  }

  private buildCompactOverlay(): void {
    this.statusText = new xb.UIText({
      text: 'Rokid Spatial Desktop XR готов | Клавиши: 1-5, P, G, L, V, R, D, H',
      pointerEvents: 'none',
      style: {
        fontSize: 16,
        textAlign: 'center',
      },
    });

    this.overlay = new xb.UIOverlay({
      style: {
        width: 760,
        position: 'absolute',
        left: '50%',
        bottom: 18,
        transform: {translateX: '-50%'},
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: 10,
      },
      children: [new xb.UIExitButton(), this.statusText],
    });
    this.overlay.name = 'SpatialDesktopStatusOverlay';
    this.add(this.overlay);
  }
}
