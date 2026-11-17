import * as xb from 'xrblocks';

import type {
  SpatialAppId,
  WorkspaceLayoutMode,
} from '../types/spatial_contracts.ts';

/**
 * ============================================================================
 * МОДУЛЬ: handle_gesture_navigation.ts (Жестовая навигация и управление)
 * ============================================================================
 * НАЗНАНИЕ:
 *   Преобразует распознанные жесты рук XR Blocks (`xb.core.gestureRecognition`)
 *   в высокоуровневые команды пространственного рабочего стола с защитой от
 *   дребезга (cooldown).
 *
 * ПОДДЕРЖИВАЕМЫЕ ЖЕСТЫ:
 *   - `open-palm` / `spread`: показать/призвать док управления и перестроить в Arc.
 *   - `fist`: закрепить/открепить активное окно на ближайшей поверхности.
 *   - `thumbs-up`: сохранить и синхронизировать сцену в Rokid Spatial Studio.
 *   - `thumbs-down`: переключить видимость виртуальных стен.
 *   - `victory`: переключить следующее из 10 360°-мест.
 *   - `point`: зафиксировать фокус навигации (логируется с рукой left/right).
 *
 * ВХОДНЫЕ ДАННЫЕ:
 *   - Коллбеки действий `GestureNavigationActions` (легко переназначаются).
 *   - `cooldownMs`: минимальный интервал между повторными срабатываниями жеста.
 *
 * ВЫХОДНЫЕ ДАННЫЕ:
 *   - Вызовы коллбеков `onLayoutChange`, `onPinToggle`, `onSyncWorkspace`,
 *     `onToggleWalls`, `onGestureDetected`.
 *
 * КАК ПОЛЬЗОВАТЬСЯ:
 *   const gestures = new GestureNavigationController({
 *     onLayoutChange: (mode) => windowManager.applyLayout(mode),
 *     onPinToggle: () => windowManager.togglePinActiveWindow(),
 *     onLog: (msg) => monitor.log('INFO', 'GESTURE', msg),
 *   });
 *   this.add(gestures);
 * ============================================================================
 */

export interface GestureNavigationActions {
  readonly cooldownMs?: number;
  readonly onLayoutChange?: (mode: WorkspaceLayoutMode) => void;
  readonly onPinToggle?: () => void;
  readonly onSyncWorkspace?: () => void;
  readonly onToggleWalls?: () => void;
  readonly onNextPlace?: () => void;
  readonly onFocusApp?: (appId: SpatialAppId) => void;
  readonly onGestureDetected?: (
    hand: 'left' | 'right',
    gestureName: string,
    confidence: number
  ) => void;
  readonly onLog?: (message: string) => void;
}

export class GestureNavigationController extends xb.Script {
  private readonly actions: GestureNavigationActions;
  private readonly cooldownMs: number;
  private readonly lastTriggerTime = new Map<string, number>();

  private onGestureStartHandler?: (event: xb.GestureEvent) => void;
  private onGestureEndHandler?: (event: xb.GestureEvent) => void;

  constructor(actions: GestureNavigationActions = {}) {
    super();
    this.actions = actions;
    this.cooldownMs = actions.cooldownMs ?? 1100;
  }

  override init(): void {
    const recognition = xb.core?.gestureRecognition;
    if (!recognition) {
      this.actions.onLog?.(
        'Модуль gestureRecognition недоступен (жесты рук не включены в Options)'
      );
      return;
    }

    this.onGestureStartHandler = (event: xb.GestureEvent) => {
      const {hand, name, confidence} = event.detail;
      this.handleGesture(hand, name, confidence);
    };

    this.onGestureEndHandler = (event: xb.GestureEvent) => {
      const {hand, name} = event.detail;
      this.actions.onLog?.(`Жест завершён: ${hand} -> ${name}`);
    };

    recognition.addEventListener('gesturestart', this.onGestureStartHandler);
    recognition.addEventListener('gestureend', this.onGestureEndHandler);
    this.actions.onLog?.('Контроллер жестовой навигации подключён');
  }

  /**
   * Обрабатывает событие жеста (также может вызываться вручную для тестов).
   */
  handleGesture(
    hand: 'left' | 'right',
    gestureName: string,
    confidence = 1
  ): void {
    const now = performance.now();
    const key = `${hand}:${gestureName}`;
    const prev = this.lastTriggerTime.get(key) ?? 0;
    if (now - prev < this.cooldownMs) return;
    this.lastTriggerTime.set(key, now);

    this.actions.onGestureDetected?.(hand, gestureName, confidence);
    this.actions.onLog?.(
      `Распознан жест [${hand}]: ${gestureName} (${Math.round(confidence * 100)}%)`
    );

    switch (gestureName) {
      case 'spread':
      case 'open-palm':
        this.actions.onLayoutChange?.('arc');
        break;
      case 'fist':
        this.actions.onPinToggle?.();
        break;
      case 'thumbs-up':
        this.actions.onSyncWorkspace?.();
        break;
      case 'thumbs-down':
        this.actions.onToggleWalls?.();
        break;
      case 'victory':
        this.actions.onNextPlace?.();
        break;
      case 'point':
        // Жест указания работает нативно через лучи ретикла XR Blocks.
        break;
      default:
        break;
    }
  }

  override dispose(): void {
    const recognition = xb.core?.gestureRecognition;
    if (!recognition) return;
    if (this.onGestureStartHandler) {
      recognition.removeEventListener(
        'gesturestart',
        this.onGestureStartHandler
      );
    }
    if (this.onGestureEndHandler) {
      recognition.removeEventListener('gestureend', this.onGestureEndHandler);
    }
  }
}
