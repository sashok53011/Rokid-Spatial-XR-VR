import type {SpatialAppId} from '../types/spatial_contracts.ts';

/**
 * ============================================================================
 * МОДУЛЬ: handle_keyboard_mouse_input.ts (Клавиатура и мышь)
 * ============================================================================
 * НАЗНАЧЕНИЕ:
 *   Обеспечивает полную совместимость пространственного рабочего стола со
 *   стандартными клавиатурой и мышью: горячие клавиши переключения окон,
 *   привязки к стенам, смены раскладки, профиля Rokid Max, а также точное
 *   перемещение активного окна по XYZ (`WASD` / стрелки + `Shift`).
 *
 * ВХОДНЫЕ ДАННЫЕ:
 *   - Коллбеки `KeyboardMouseCallbacks` для связи с менеджером окон и оркестратором.
 *
 * ВЫХОДНЫЕ ДАННЫЕ:
 *   - Метод `attach()` и функция отписки `detach()`.
 *
 * ГОРЯЧИЕ КЛАВИШИ:
 *   - `1`..`5`: фокус/открытие окон (`terminal`, `notes`, `telemetry`, `studio`, `viewport3d`)
 *   - `P`: прикрепить / открепить активное окно к ближайшей стене
 *   - `G`: показать / скрыть виртуальные стены и сетку
 *   - `L`: переключить раскладку (Arc -> Grid -> Wall-Pinned)
 *   - `T`: переключить тему оформления
 *   - `V`: включить / выключить голосовой ввод
 *   - `D`: открыть / скрыть окно телеметрии и логов
 *   - `R`: переключить оптический профиль Rokid Max
 *   - `H`: показать / скрыть панель дока
 *   - `M`: показать / скрыть HUD производительности (FPS, задержка, память)
 *   - `K`: открыть / скрыть редактор раскладок (Workflow-профили + Save/Load)
 *   - `U`: включить / выключить пространственное 3D-аудио (Web Audio API HRTF)
 *   - `I` (`Alt+I`): вкл/выкл адаптивное освещение камеры (смена пресета)
 *   - `X` (`Alt+X`): вкл/выкл Z-маскировку глубины (показать тестовый 3D-окклюдер)
 *   - `F`: вкл/выкл оверлей отслеживания взгляда (Eye-Tracking Focus)
 *   - `J` (`Alt+J`): старт/стоп камеры рук и жестов (переключить Фронт/Тыл)
 *   - `Y` (`Alt+Y`): вкл/выкл Side-by-Side (SBS 3D) (переключить IPD и формат Full/Half)
 *   - `Z`: запуск / переключение режима VR-гарнитуры (`immersive-vr` + 360° VR)
 *   - `O` (`Alt+O`): показать / скрыть панель камеры Android XR (сделать снимок)
 *   - `Alt + Стрелки` / `Alt + Колесо мыши`: сдвинуть активное окно в 3D-пространстве
 *
 * КАК ПОЛЬЗОВАТЬСЯ:
 *   const kbController = new KeyboardMouseController({ ...callbacks });
 *   kbController.attach();
 *   // При завершении: kbController.detach();
 * ============================================================================
 */

export interface KeyboardMouseCallbacks {
  readonly onFocusWindow: (id: SpatialAppId) => void;
  readonly onTogglePinActive: () => void;
  readonly onToggleWalls: () => void;
  readonly onCycleLayout: () => void;
  readonly onCycleTheme: () => void;
  readonly onToggleVoice: () => void;
  readonly onToggleDebug: () => void;
  readonly onToggleRokid?: () => void;
  readonly onCycleRokidMode: () => void;
  readonly onToggleDock: () => void;
  readonly onNextPlace: () => void;
  readonly onPrevPlace: () => void;
  readonly onToggleSkyDome: () => void;
  readonly onToggleScreens360: () => void;
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
  readonly onFlipHandCamera: () => void;
  readonly onToggleSbs: () => void;
  readonly onCycleSbsSettings: () => void;
  readonly onEnterVrHeadset: () => void;
  readonly onToggleAndroidCamera: () => void;
  readonly onCaptureAndroidSnapshot: () => void;
  readonly onNudgeActiveWindow: (dx: number, dy: number, dz: number) => void;
  readonly onScaleActiveWindow: (deltaScale: number) => void;
  readonly onInputMark?: () => void;
  readonly onLog?: (message: string) => void;
}

const APP_HOTKEYS: Record<string, SpatialAppId> = {
  Digit1: 'terminal',
  Digit2: 'notes',
  Digit3: 'telemetry',
  Digit4: 'studio',
  Digit5: 'viewport3d',
  Digit6: 'places',
};

export class KeyboardMouseController {
  private readonly callbacks: KeyboardMouseCallbacks;
  private attached = false;

  constructor(callbacks: KeyboardMouseCallbacks) {
    this.callbacks = callbacks;
  }

  attach(): void {
    if (this.attached) return;
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('wheel', this.handleWheel, {passive: true});
    this.attached = true;
    this.callbacks.onLog?.('Клавиатурное и мышиное управление активно');
  }

  detach(): void {
    if (!this.attached) return;
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('wheel', this.handleWheel);
    this.attached = false;
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    // Не перехватываем горячие клавиши, если пользователь печатает внутри UITextInput или input/textarea.
    const activeEl = document.activeElement;
    if (
      activeEl &&
      (activeEl.tagName === 'INPUT' ||
        activeEl.tagName === 'TEXTAREA' ||
        (activeEl as HTMLElement).isContentEditable)
    ) {
      return;
    }

    this.callbacks.onInputMark?.();

    const appId = APP_HOTKEYS[event.code];
    if (appId) {
      this.callbacks.onFocusWindow(appId);
      return;
    }

    // Точное перемещение активного окна с модификатором Alt + Стрелки (не конфликтует с WASD симулятора).
    if (event.altKey) {
      const step = event.shiftKey ? 0.14 : 0.06;
      if (event.code === 'ArrowLeft') {
        event.preventDefault();
        this.callbacks.onNudgeActiveWindow(-step, 0, 0);
        return;
      }
      if (event.code === 'ArrowRight') {
        event.preventDefault();
        this.callbacks.onNudgeActiveWindow(step, 0, 0);
        return;
      }
      if (event.code === 'ArrowUp') {
        event.preventDefault();
        this.callbacks.onNudgeActiveWindow(
          0,
          event.shiftKey ? 0 : step,
          event.shiftKey ? -step : 0
        );
        return;
      }
      if (event.code === 'ArrowDown') {
        event.preventDefault();
        this.callbacks.onNudgeActiveWindow(
          0,
          event.shiftKey ? 0 : -step,
          event.shiftKey ? step : 0
        );
        return;
      }
      if (event.code === 'Equal' || event.code === 'NumpadAdd') {
        event.preventDefault();
        this.callbacks.onScaleActiveWindow(0.12);
        return;
      }
      if (event.code === 'Minus' || event.code === 'NumpadSubtract') {
        event.preventDefault();
        this.callbacks.onScaleActiveWindow(-0.12);
        return;
      }
      if (event.code === 'KeyI') {
        event.preventDefault();
        this.callbacks.onCycleLightingPreset();
        return;
      }
      if (event.code === 'KeyX') {
        event.preventDefault();
        this.callbacks.onToggleDepthOccluder();
        return;
      }
      if (event.code === 'KeyJ') {
        event.preventDefault();
        this.callbacks.onFlipHandCamera();
        return;
      }
      if (event.code === 'KeyY') {
        event.preventDefault();
        this.callbacks.onCycleSbsSettings();
        return;
      }
      if (event.code === 'KeyO') {
        event.preventDefault();
        this.callbacks.onCaptureAndroidSnapshot();
        return;
      }
    }

    switch (event.code) {
      case 'KeyP':
        this.callbacks.onTogglePinActive();
        break;
      case 'KeyG':
        this.callbacks.onToggleWalls();
        break;
      case 'KeyL':
        this.callbacks.onCycleLayout();
        break;
      case 'KeyT':
        this.callbacks.onCycleTheme();
        break;
      case 'KeyV':
        this.callbacks.onToggleVoice();
        break;
      case 'KeyD':
        this.callbacks.onToggleDebug();
        break;
      case 'KeyR':
        this.callbacks.onCycleRokidMode();
        break;
      case 'KeyH':
        this.callbacks.onToggleDock();
        break;
      case 'BracketRight':
        this.callbacks.onNextPlace();
        break;
      case 'BracketLeft':
        this.callbacks.onPrevPlace();
        break;
      case 'KeyB':
        this.callbacks.onToggleSkyDome();
        break;
      case 'KeyN':
        this.callbacks.onToggleScreens360();
        break;
      case 'KeyM':
        this.callbacks.onToggleHud();
        break;
      case 'Slash':
        this.callbacks.onToggleGestureGuide();
        break;
      case 'KeyC':
        this.callbacks.onToggleSceneSelector();
        break;
      case 'KeyK':
        this.callbacks.onToggleLayoutEditor();
        break;
      case 'KeyU':
        this.callbacks.onToggleSpatialAudio();
        break;
      case 'KeyI':
        this.callbacks.onToggleCameraLighting();
        break;
      case 'KeyX':
        this.callbacks.onToggleDepthMask();
        break;
      case 'KeyF':
        this.callbacks.onToggleEyeTracking();
        break;
      case 'KeyJ':
        this.callbacks.onToggleCameraHands();
        break;
      case 'KeyY':
        this.callbacks.onToggleSbs();
        break;
      case 'KeyZ':
        this.callbacks.onEnterVrHeadset();
        break;
      case 'KeyO':
        this.callbacks.onToggleAndroidCamera();
        break;
      default:
        break;
    }
  };

  private readonly handleWheel = (event: WheelEvent): void => {
    // С Alt + колесо мыши удобно приближать/отдалять активное окно по оси Z.
    if (!event.altKey) return;
    this.callbacks.onInputMark?.();
    const deltaZ = event.deltaY > 0 ? 0.08 : -0.08;
    this.callbacks.onNudgeActiveWindow(0, 0, deltaZ);
  };
}
