import * as xb from 'xrblocks';

import type {
  PerformanceSnapshot,
  WorkspaceEnvironmentState,
} from '../types/spatial_contracts.ts';

/**
 * ============================================================================
 * МОДУЛЬ: render_performance_hud.ts (Ненавязчивый HUD метрик производительности)
 * ============================================================================
 * НАЗНАНИЕ:
 *   Отображает компактный, переключаемый и не перехватывающий ввод HUD
 *   (`xb.UIOverlay` в правом верхнем углу) с показателями среды в реальном
 *   времени:
 *   - Частота кадров (`FPS`) и время кадра (`frameTimeMs` / `avg` / `max`)
 *   - Задержка отклика (`inputLatencyMs`) и нагрузка рендера (`drawCalls`, `triangles`)
 *   - Использование памяти (JS Heap в МБ при наличии API + счётчики GPU `geometries`/`textures`)
 *
 * ВХОДНЫЕ ДАННЫЕ:
 *   - `initialVisible`: начальная видимость HUD (по умолчанию `true`).
 *   - `onVisibilityChange(visible)`: коллбек уведомления при скрытии/показе.
 *   - `onLog(message)`: запись событий переключения в отладочный журнал.
 *   - `updateMetrics(snapshot, envState)`: обновление смонтированных `UIText`
 *     без пересоздания UI-элементов.
 *
 * ВЫХОДНЫЕ ДАННЫЕ:
 *   - Методы `setVisible(visible)`, `toggleVisible()`, `isVisible()`.
 *
 * КАК ПОЛЬЗОВАТЬСЯ:
 *   const perfHud = new PerformanceHudController({
 *     initialVisible: true,
 *     onVisibilityChange: (visible) => monitor.log('INFO', 'RENDER', `HUD: ${visible}`),
 *   });
 *   this.add(perfHud);
 *   // В подписчике monitor.subscribe(...):
 *   perfHud.updateMetrics(snapshot, envState);
 *
 * ЗАГЛУШКИ (STUB) И ЗАМЕНА В ПРОДАКШНЕ:
 *   - Панель метрик использует `performance.memory` (Chromium) и WebGL `renderer.info`
 *     как прокси памяти браузера.
 *   - КАК ЗАМЕНИТЬ В ПРОДАКШНЕ: передавайте реальные значения RAM/VRAM/температуры
 *     очков от демона `rokid-spatial-host` через `updateMetrics()`.
 * ============================================================================
 */

export interface PerformanceHudConfig {
  readonly initialVisible?: boolean;
  readonly onVisibilityChange?: (visible: boolean) => void;
  readonly onLog?: (message: string) => void;
}

export class PerformanceHudController extends xb.Script {
  private readonly config: PerformanceHudConfig;
  private overlay!: xb.UIOverlay;
  private fpsValueText!: xb.UIText;
  private frameTimingText!: xb.UIText;
  private latencyText!: xb.UIText;
  private memoryText!: xb.UIText;
  private gpuResourcesText!: xb.UIText;
  private contextLineText!: xb.UIText;
  private visibleState: boolean;

  constructor(config: PerformanceHudConfig = {}) {
    super();
    this.config = config;
    this.visibleState = config.initialVisible ?? true;
  }

  override init(): void {
    this.fpsValueText = new xb.UIText({
      text: '-- FPS',
      pointerEvents: 'none',
      style: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#4ade80',
      },
    });

    this.frameTimingText = new xb.UIText({
      text: 'Кадр: --.- мс | ср. --.- | макс --.-',
      pointerEvents: 'none',
      style: {
        fontSize: 12,
        color: '#cbd5e1',
      },
    });

    this.latencyText = new xb.UIText({
      text: 'Задержка ввода: 0.00 мс',
      pointerEvents: 'none',
      style: {
        fontSize: 13,
        color: '#38bdf8',
      },
    });

    this.memoryText = new xb.UIText({
      text: 'Память JS: -- МБ',
      pointerEvents: 'none',
      style: {
        fontSize: 13,
        color: '#e2e8f0',
      },
    });

    this.gpuResourcesText = new xb.UIText({
      text: 'GPU: 0 draws | 0 геом. | 0 текст.',
      pointerEvents: 'none',
      style: {
        fontSize: 12,
        color: '#94a3b8',
      },
    });

    this.contextLineText = new xb.UIText({
      text: 'M — скрыть HUD | ? — гид жестов',
      pointerEvents: 'none',
      style: {
        fontSize: 11,
        color: '#94a3b8',
        opacity: 0.85,
      },
    });

    const closeBtn = new xb.UIButton({
      icon: 'close',
      ariaLabel: 'Скрыть HUD метрик (M)',
      style: {
        width: 26,
        height: 26,
        padding: 0,
        borderRadius: 13,
      },
      onClick: () => {
        this.setVisible(false);
      },
    });

    const headerRow = new xb.UIPanel({
      style: {
        width: '100%',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
      },
      children: [
        new xb.UIPanel({
          pointerEvents: 'none',
          style: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
          },
          children: [
            new xb.UIIcon({
              icon: 'speed',
              pointerEvents: 'none',
              style: {width: 18, height: 18, color: '#38bdf8'},
            }),
            new xb.UIText({
              text: 'PERF HUD',
              pointerEvents: 'none',
              style: {
                fontSize: 12,
                fontWeight: 'bold',
                color: '#94a3b8',
              },
            }),
            this.fpsValueText,
          ],
        }),
        closeBtn,
      ],
    });

    // Блок телеметрии имеет pointerEvents: 'none', чтобы не мешать кликам и захвату окон за ним.
    const metricsBody = new xb.UIPanel({
      pointerEvents: 'none',
      style: {
        width: '100%',
        flexDirection: 'column',
        gap: 4,
      },
      children: [
        this.frameTimingText,
        this.latencyText,
        this.memoryText,
        this.gpuResourcesText,
        this.contextLineText,
      ],
    });

    this.overlay = new xb.UIOverlay({
      style: {
        width: 316,
        position: 'absolute',
        top: 16,
        right: 18,
        flexDirection: 'column',
        gap: 6,
        padding: 12,
        borderRadius: 14,
        backgroundColor: 'rgba(9, 14, 28, 0.72)',
      },
      children: [headerRow, metricsBody],
    });
    this.overlay.name = 'PerformanceHudOverlay';
    this.overlay.visible = this.visibleState;
    this.add(this.overlay);
  }

  isVisible(): boolean {
    return this.visibleState;
  }

  setVisible(visible: boolean): boolean {
    this.visibleState = visible;
    if (this.overlay) {
      this.overlay.visible = visible;
    }
    this.config.onLog?.(
      visible ? 'HUD производительности включён' : 'HUD производительности скрыт'
    );
    this.config.onVisibilityChange?.(visible);
    return this.visibleState;
  }

  toggleVisible(): boolean {
    return this.setVisible(!this.visibleState);
  }

  /**
   * Прямое обновление смонтированных текстовых полей без пересоздания элементов UI.
   */
  updateMetrics(
    snapshot: PerformanceSnapshot,
    envState?: Readonly<WorkspaceEnvironmentState>
  ): void {
    if (!this.overlay || !this.visibleState) return;

    this.fpsValueText.text = `${snapshot.fps} FPS`;
    this.fpsValueText.style.color =
      snapshot.fps >= 55
        ? '#4ade80'
        : snapshot.fps >= 35
          ? '#facc15'
          : '#fb7185';

    this.frameTimingText.text =
      `Кадр: ${snapshot.frameTimeMs.toFixed(1)} мс | ` +
      `ср. ${snapshot.avgFrameTimeMs.toFixed(1)} | макс ${snapshot.maxFrameTimeMs.toFixed(1)}`;

    this.latencyText.text = `Задержка ввода: ${snapshot.inputLatencyMs.toFixed(2)} мс`;
    this.latencyText.style.color =
      snapshot.inputLatencyMs <= 16 ? '#38bdf8' : '#facc15';

    if (snapshot.heapUsedMb !== null) {
      const limitStr =
        snapshot.heapLimitMb !== null ? ` / ${snapshot.heapLimitMb}` : '';
      this.memoryText.text = `Память JS: ${snapshot.heapUsedMb}${limitStr} МБ`;
    } else {
      this.memoryText.text = 'Память JS: API недоступен (см. GPU)';
    }

    const trisLabel =
      snapshot.triangles >= 1000
        ? `${(snapshot.triangles / 1000).toFixed(1)}k`
        : `${snapshot.triangles}`;
    this.gpuResourcesText.text =
      `GPU: ${snapshot.drawCalls} draws · ${trisLabel} tris · ` +
      `${snapshot.geometries} геом. · ${snapshot.textures} текст.`;

    if (envState) {
      this.contextLineText.text = `Режим: ${envState.xrMode} · ${envState.layoutMode} | M — HUD`;
    }
  }
}
