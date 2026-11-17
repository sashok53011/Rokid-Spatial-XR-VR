import * as xb from 'xrblocks';

/**
 * ============================================================================
 * МОДУЛЬ: guide_gesture_controls.ts (Интерактивный гид по жестам и управлению)
 * ============================================================================
 * НАЗНАНИЕ:
 *   Предоставляет интерактивный оверлей (`xb.UIOverlay` в левом верхнем углу),
 *   который пошагово обучает новых пользователей жестам рук, манипуляциям
 *   контроллером и мыши/клавиатуры для перемещения, масштабирования, привязки
 *   к стенам и навигации в пространственном рабочем столе.
 *
 * ОСОБЕННОСТИ:
 *   - Автоматически открывается для новых пользователей (флаг в `localStorage`),
 *     но легко скрывается/открывается по клавише `?`, кнопке `Гид (?)` в доке,
 *     голосом (`гид`, `помощь`) или через терминал (`guide`).
 *   - Отслеживает реальные действия пользователя (перемещение окна, изменение
 *     масштаба, привязку к стене, распознанные жесты рук) и автоматически
 *     отмечает шаги как выполненные!
 *   - Содержит интерактивные кнопки «Попробовать» прямо внутри оверлея, чтобы
 *     протестировать сдвиг, масштаб или симуляцию жеста на десктопе.
 *
 * ВХОДНЫЕ ДАННЫЕ:
 *   - `GestureGuideActions`: коллбеки демонстрации сдвига, масштаба, привязки и
 *     симуляции жестов, а также уведомления о видимости.
 *   - `reportManipulation(kind, detail)`: фиксация реального перетаскивания/масштаба.
 *   - `reportGesture(hand, gestureName)`: фиксация реального жеста рук XR Blocks.
 *
 * ВЫХОДНЫЕ ДАННЫЕ:
 *   - Методы `open()`, `close(markSeen)`, `toggle()`, `isVisible()`.
 *
 * КАК ПОЛЬЗОВАТЬСЯ:
 *   const guide = new GestureOnboardingGuide({
 *     onDemoMove: () => windowManager.nudgeActiveWindow(0.1, 0.04, 0),
 *     onDemoScale: (delta) => windowManager.scaleActiveWindow(delta),
 *     onResetScale: () => windowManager.scaleActiveWindow(0, true),
 *     onSimulateGesture: (name) => gestureController.handleGesture('right', name, 1),
 *   });
 *   this.add(guide);
 *
 * ЗАГЛУШКИ (STUB) И ЗАМЕНА В ПРОДАКШНЕ:
 *   - Прогресс прохождения обучения сохраняется локально в `localStorage` под
 *     ключом `rokid_spatial_gesture_guide_seen_v1`.
 *   - КАК ЗАМЕНИТЬ В ПРОДАКШНЕ: синхронизируйте статус онбординга с профилем
 *     пользователя на сервере `rokid-spatial-studio-xr`.
 * ============================================================================
 */

const GUIDE_SEEN_STORAGE_KEY = 'rokid_spatial_gesture_guide_seen_v1';

export type GuideStepKey = 'move' | 'scale' | 'pin' | 'navigate' | 'finish';

interface GuideStepSpec {
  readonly key: GuideStepKey;
  readonly icon: string;
  readonly title: string;
  readonly gestureHint: string;
  readonly desktopHint: string;
  readonly primaryDemoLabel: string;
  readonly secondaryDemoLabel?: string;
}

const GUIDE_STEPS: readonly GuideStepSpec[] = [
  {
    key: 'move',
    icon: 'open_with',
    title: '1. Перемещение окон (Grab & Move)',
    gestureHint:
      'Наведите луч или руку на ВНЕШНИЙ КРАЙ окна, выполните щипок (pinch) и перетащите окно в 3D-пространстве.',
    desktopHint:
      'Мышь: потяните за край карточки. Клавиатура: Alt + Стрелки (и Alt + Shift / Колесо для глубины Z).',
    primaryDemoLabel: 'Сдвинуть окно (Демо)',
    secondaryDemoLabel: 'Вернуть назад',
  },
  {
    key: 'scale',
    icon: 'pinch',
    title: '2. Масштабирование (Two-Hand Pinch)',
    gestureHint:
      'Захватите окно ДВУМЯ РУКАМИ (два щипка) и разведите ладони для увеличения или сведите для уменьшения. Либо потяните за угол.',
    desktopHint:
      'Клавиатура: Alt + "=" увеличить, Alt + "-" уменьшить, или перетащите угол карточки мышью.',
    primaryDemoLabel: 'Масштаб +15%',
    secondaryDemoLabel: 'Сброс 1.0x',
  },
  {
    key: 'pin',
    icon: 'push_pin',
    title: '3. Привязка к стенам и 360°-панелям',
    gestureHint:
      'Подтяните окно к виртуальной стене, столу или 360°-панели до подсветки и отпустите. Жест КУЛАК (fist) закрепляет активное окно.',
    desktopHint:
      'Клавиатура: клавиша P закрепляет/открепляет активное окно, G — сетка стен.',
    primaryDemoLabel: 'Жест: Кулак (Pin)',
    secondaryDemoLabel: 'Показать стены (G)',
  },
  {
    key: 'navigate',
    icon: 'pan_tool',
    title: '4. Жесты раскладки и синхронизации',
    gestureHint:
      'ОТКРЫТАЯ ЛАДОНЬ (open-palm / spread) строит окна дугой; ПАЛЕЦ ВВЕРХ (thumbs-up) сохраняет сцену; ПАЛЕЦ ВНИЗ (thumbs-down) переключает стены.',
    desktopHint:
      'Клавиатура: L — перебор раскладок (включая 360° Ring), V — голос, ? — этот гид.',
    primaryDemoLabel: 'Ладонь (Arc)',
    secondaryDemoLabel: '👍 Sync в Studio',
  },
  {
    key: 'finish',
    icon: 'check_circle',
    title: '5. Обучение завершено!',
    gestureHint:
      'Теперь вы умеете свободно двигать, масштабировать и привязывать окна к стенам и 360°-панелям в XR.',
    desktopHint:
      'Шпаргалка: ? — открыть гид снова, M — вкл/выкл HUD метрик, 1–6 — окна, [ / ] — 10 локаций.',
    primaryDemoLabel: 'Завершить и скрыть',
    secondaryDemoLabel: 'Пройти заново',
  },
];

export interface GestureGuideActions {
  readonly onDemoMoveForward?: () => void;
  readonly onDemoMoveBack?: () => void;
  readonly onDemoScale?: (deltaScale: number) => void;
  readonly onResetScale?: () => void;
  readonly onSimulateGesture?: (
    gestureName: 'fist' | 'spread' | 'thumbs-up' | 'thumbs-down'
  ) => void;
  readonly onToggleWalls?: () => void;
  readonly onVisibilityChange?: (visible: boolean) => void;
  readonly onLog?: (message: string) => void;
}

export class GestureOnboardingGuide extends xb.Script {
  private readonly actions: GestureGuideActions;
  private overlay!: xb.UIOverlay;

  private stepCounterText!: xb.UIText;
  private stepStatusBadge!: xb.UIText;
  private stepIcon!: xb.UIIcon;
  private stepTitleText!: xb.UIText;
  private gestureHintText!: xb.UIText;
  private desktopHintText!: xb.UIText;
  private liveFeedbackText!: xb.UIText;

  private primaryDemoBtn!: xb.UIButton;
  private secondaryDemoBtn!: xb.UIButton;
  private prevBtn!: xb.UIButton;
  private nextBtn!: xb.UIButton;
  private stepDots: xb.UIPanel[] = [];

  private currentStepIndex = 0;
  private visibleState = true;
  private readonly completedSteps = new Set<GuideStepKey>();

  constructor(actions: GestureGuideActions = {}) {
    super();
    this.actions = actions;
    this.visibleState = !this.hasSeenOnboarding();
  }

  override init(): void {
    this.stepCounterText = new xb.UIText({
      text: 'ГИД ЖЕСТОВ · ШАГ 1/5',
      style: {fontSize: 12, fontWeight: 'bold', color: '#38bdf8'},
    });

    this.stepStatusBadge = new xb.UIText({
      text: 'Ожидается действие',
      style: {fontSize: 12, fontWeight: 'bold', color: '#facc15'},
    });

    this.stepIcon = new xb.UIIcon({
      icon: 'open_with',
      style: {width: 24, height: 24, color: '#38bdf8'},
    });

    this.stepTitleText = new xb.UIText({
      text: GUIDE_STEPS[0].title,
      style: {fontSize: 16, fontWeight: 'bold', color: '#ffffff'},
    });

    this.gestureHintText = new xb.UIText({
      text: GUIDE_STEPS[0].gestureHint,
      style: {fontSize: 13, lineHeight: 1.35, color: '#e2e8f0'},
    });

    this.desktopHintText = new xb.UIText({
      text: GUIDE_STEPS[0].desktopHint,
      style: {fontSize: 12, lineHeight: 1.3, color: '#94a3b8'},
    });

    this.liveFeedbackText = new xb.UIText({
      text: 'Живой отклик: потяните край окна или измените масштаб',
      style: {
        fontSize: 12,
        color: '#a5f3fc',
        padding: 8,
        borderRadius: 8,
        backgroundColor: 'rgba(15, 23, 42, 0.72)',
      },
    });

    this.primaryDemoBtn = new xb.UIButton({
      label: GUIDE_STEPS[0].primaryDemoLabel,
      icon: 'play_arrow',
      style: {flexGrow: 1},
      onClick: () => this.handlePrimaryDemo(),
    });

    this.secondaryDemoBtn = new xb.UIButton({
      label: GUIDE_STEPS[0].secondaryDemoLabel ?? 'Сброс',
      style: {flexGrow: 1},
      onClick: () => this.handleSecondaryDemo(),
    });

    this.prevBtn = new xb.UIButton({
      label: '◀ Назад',
      style: {flexGrow: 1},
      onClick: () => this.goToStep(this.currentStepIndex - 1),
    });

    this.nextBtn = new xb.UIButton({
      label: 'Далее ▶',
      style: {flexGrow: 1},
      onClick: () => {
        if (this.currentStepIndex >= GUIDE_STEPS.length - 1) {
          this.close(true);
        } else {
          this.goToStep(this.currentStepIndex + 1);
        }
      },
    });

    const closeBtn = new xb.UIButton({
      icon: 'close',
      ariaLabel: 'Закрыть гид по жестам (?)',
      style: {width: 28, height: 28, padding: 0, borderRadius: 14},
      onClick: () => this.close(true),
    });

    this.stepDots = GUIDE_STEPS.map(
      () =>
        new xb.UIPanel({
          pointerEvents: 'none',
          style: {
            flexGrow: 1,
            height: 5,
            borderRadius: 3,
            backgroundColor: 'rgba(148, 163, 184, 0.35)',
          },
        })
    );

    const progressRow = new xb.UIPanel({
      pointerEvents: 'none',
      style: {
        width: '100%',
        flexDirection: 'row',
        gap: 6,
      },
      children: this.stepDots,
    });

    const headerRow = new xb.UIPanel({
      style: {
        width: '100%',
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 8,
      },
      children: [this.stepCounterText, this.stepStatusBadge, closeBtn],
    });

    const titleRow = new xb.UIPanel({
      pointerEvents: 'none',
      style: {
        width: '100%',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
      },
      children: [this.stepIcon, this.stepTitleText],
    });

    const demoRow = new xb.UIPanel({
      style: {width: '100%', flexDirection: 'row', gap: 8},
      children: [this.primaryDemoBtn, this.secondaryDemoBtn],
    });

    const navRow = new xb.UIPanel({
      style: {width: '100%', flexDirection: 'row', gap: 8},
      children: [this.prevBtn, this.nextBtn],
    });

    this.overlay = new xb.UIOverlay({
      style: {
        width: 404,
        position: 'absolute',
        top: 16,
        left: 18,
        flexDirection: 'column',
        gap: 10,
        padding: 14,
        borderRadius: 16,
        backgroundColor: 'rgba(10, 15, 30, 0.84)',
      },
      children: [
        headerRow,
        progressRow,
        titleRow,
        this.gestureHintText,
        this.desktopHintText,
        this.liveFeedbackText,
        demoRow,
        navRow,
      ],
    });
    this.overlay.name = 'GestureOnboardingOverlay';
    this.overlay.visible = this.visibleState;
    this.add(this.overlay);

    this.renderCurrentStep();
  }

  isVisible(): boolean {
    return this.visibleState;
  }

  open(): void {
    this.visibleState = true;
    if (this.overlay) {
      this.overlay.visible = true;
    }
    this.actions.onLog?.('Интерактивный гид по жестам открыт');
    this.actions.onVisibilityChange?.(true);
  }

  close(markSeen = true): void {
    this.visibleState = false;
    if (this.overlay) {
      this.overlay.visible = false;
    }
    if (markSeen) {
      this.markOnboardingSeen();
    }
    this.actions.onLog?.('Гид по жестам скрыт (нажмите ? для повторного открытия)');
    this.actions.onVisibilityChange?.(false);
  }

  toggle(): boolean {
    if (this.visibleState) {
      this.close(true);
    } else {
      this.open();
    }
    return this.visibleState;
  }

  /**
   * Регистрирует реальное взаимодействие с окном (`move` | `scale` | `resize` | `pin`),
   * обновляя живой индикатор и прогресс обучения.
   */
  reportManipulation(
    kind: 'move' | 'scale' | 'resize' | 'rotate' | 'pin',
    detail: string
  ): void {
    this.liveFeedbackText.text = `Живой отклик: ${detail}`;

    if (kind === 'move') {
      this.markStepDone('move');
    } else if (kind === 'scale' || kind === 'resize') {
      this.markStepDone('scale');
    } else if (kind === 'pin') {
      this.markStepDone('pin');
    }
  }

  /**
   * Регистрирует распознанный жест руки (`fist`, `open-palm`, `spread`, `thumbs-up`, ...).
   */
  reportGesture(hand: 'left' | 'right', gestureName: string): void {
    this.liveFeedbackText.text = `Распознан жест [${hand}]: ${gestureName}`;
    if (gestureName === 'fist') {
      this.markStepDone('pin');
    } else if (
      gestureName === 'open-palm' ||
      gestureName === 'spread' ||
      gestureName === 'thumbs-up' ||
      gestureName === 'thumbs-down'
    ) {
      this.markStepDone('navigate');
    }
  }

  private markStepDone(key: GuideStepKey): void {
    const isNew = !this.completedSteps.has(key);
    this.completedSteps.add(key);
    if (this.completedSteps.size >= 4) {
      this.completedSteps.add('finish');
    }
    if (isNew) {
      this.actions.onLog?.(`Шаг обучения "${key}" выполнен пользователем`);
    }
    this.renderCurrentStep();
  }

  private goToStep(index: number): void {
    this.currentStepIndex = Math.max(
      0,
      Math.min(GUIDE_STEPS.length - 1, index)
    );
    this.renderCurrentStep();
  }

  private renderCurrentStep(): void {
    const step = GUIDE_STEPS[this.currentStepIndex];
    const done = this.completedSteps.has(step.key);

    this.stepCounterText.text = `ГИД ЖЕСТОВ · ШАГ ${this.currentStepIndex + 1}/${GUIDE_STEPS.length}`;
    this.stepStatusBadge.text = done ? '✓ Выполнено' : 'Попробуйте сейчас';
    this.stepStatusBadge.style.color = done ? '#4ade80' : '#facc15';
    this.stepIcon.icon = step.icon;
    this.stepTitleText.text = step.title;
    this.gestureHintText.text = step.gestureHint;
    this.desktopHintText.text = step.desktopHint;

    this.primaryDemoBtn.label = step.primaryDemoLabel;
    if (step.secondaryDemoLabel) {
      this.secondaryDemoBtn.visible = true;
      this.secondaryDemoBtn.label = step.secondaryDemoLabel;
    } else {
      this.secondaryDemoBtn.visible = false;
    }

    this.prevBtn.disabled = this.currentStepIndex === 0;
    this.nextBtn.label =
      this.currentStepIndex === GUIDE_STEPS.length - 1
        ? 'Закрыть ✓'
        : 'Далее ▶';

    this.stepDots.forEach((dot, idx) => {
      const sKey = GUIDE_STEPS[idx].key;
      if (idx === this.currentStepIndex) {
        dot.style.backgroundColor = '#38bdf8';
      } else if (this.completedSteps.has(sKey)) {
        dot.style.backgroundColor = '#4ade80';
      } else {
        dot.style.backgroundColor = 'rgba(148, 163, 184, 0.35)';
      }
    });
  }

  private handlePrimaryDemo(): void {
    const step = GUIDE_STEPS[this.currentStepIndex];
    switch (step.key) {
      case 'move':
        this.actions.onDemoMoveForward?.();
        break;
      case 'scale':
        this.actions.onDemoScale?.(0.15);
        break;
      case 'pin':
        this.actions.onSimulateGesture?.('fist');
        break;
      case 'navigate':
        this.actions.onSimulateGesture?.('spread');
        break;
      case 'finish':
        this.close(true);
        break;
    }
  }

  private handleSecondaryDemo(): void {
    const step = GUIDE_STEPS[this.currentStepIndex];
    switch (step.key) {
      case 'move':
        this.actions.onDemoMoveBack?.();
        break;
      case 'scale':
        this.actions.onResetScale?.();
        break;
      case 'pin':
        this.actions.onToggleWalls?.();
        break;
      case 'navigate':
        this.actions.onSimulateGesture?.('thumbs-up');
        break;
      case 'finish':
        this.completedSteps.clear();
        this.goToStep(0);
        this.liveFeedbackText.text = 'Живой отклик: прогресс гида сброшен';
        break;
    }
  }

  private hasSeenOnboarding(): boolean {
    try {
      return localStorage.getItem(GUIDE_SEEN_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  }

  private markOnboardingSeen(): void {
    try {
      localStorage.setItem(GUIDE_SEEN_STORAGE_KEY, '1');
    } catch {
      // Игнорируем ошибку доступа к storage в приватном режиме.
    }
  }
}
