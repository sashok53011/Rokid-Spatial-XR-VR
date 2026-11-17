import type * as THREE from 'three';

import type {
  DebugLogEntry,
  DebugLogLevel,
  DebugSubsystem,
  PerformanceSnapshot,
} from '../types/spatial_contracts.ts';

/**
 * ============================================================================
 * МОДУЛЬ: monitor_performance_and_logs.ts (Отладка потоков и мониторинг FPS)
 * ============================================================================
 * НАЗНАЧЕНИЕ:
 *   Ведет кольцевой буфер отладочных логов по всем подсистемам в реальном времени
 *   и измеряет низколатентные показатели рендеринга (FPS, время кадра, draw calls,
 *   задержка ввода) без выделения лишней памяти в критическом цикле `update()`.
 *
 * ВХОДНЫЕ ДАННЫЕ:
 *   - `log(level, subsystem, message)`: добавление события потока управления.
 *   - `beginInputLatencyMark()` / `endInputLatencyMark()`: замер отклика ввода.
 *   - `recordFrame(nowMs, renderer)`: обновление метрик кадра.
 *
 * ВЫХОДНЫЕ ДАННЫЕ:
 *   - `getSnapshot()`: текущий снимок `PerformanceSnapshot` (переиспользуемый объект).
 *   - `getFormattedLogs(filterSubsystem?, maxLines?)`: готовый текст для 3D-консоли.
 *   - `subscribe(listener)`: подписка UI-виджетов на обновления с регулируемой частотой.
 *
 * КАК ПОЛЬЗОВАТЬСЯ:
 *   const monitor = new PerformanceAndLogMonitor({ maxEntries: 120 });
 *   monitor.log('INFO', 'WINDOW', 'Окно закреплено на стене');
 *   // В цикле render/update:
 *   monitor.recordFrame(performance.now(), xb.core.renderer);
 *
 * ЗАГЛУШКИ (STUB) И ЗАМЕНА В ПРОДАКШНЕ:
 *   - Чтение памяти JS-кучи использует `performance.memory` (доступно в
 *     Chromium-браузерах; в других браузерах `heapUsedMb` возвращает `null`,
 *     а индикатор опирается на счётчики WebGL `geometries` / `textures`).
 *   - КАК ЗАМЕНИТЬ В ПРОДАКШНЕ: получайте точный RSS-объём процесса и VRAM
 *     очков от нативного демона `rokid-spatial-host` через пакет `TELEMETRY_PING`.
 * ============================================================================
 */

export interface PerformanceMonitorConfig {
  readonly maxEntries?: number;
  readonly uiPublishIntervalMs?: number;
}

export type MonitorListener = (
  snapshot: PerformanceSnapshot,
  logs: readonly DebugLogEntry[]
) => void;

const LEVEL_WEIGHT: Record<DebugLogLevel, number> = {
  DEBUG: 0,
  PERF: 1,
  INFO: 2,
  WARN: 3,
  ERROR: 4,
};

export class PerformanceAndLogMonitor {
  private readonly maxEntries: number;
  private readonly uiPublishIntervalMs: number;
  private readonly entries: DebugLogEntry[] = [];
  private readonly listeners = new Set<MonitorListener>();

  // Предвыделенный кольцевой массив длительностей кадров (Zero-GC в цикле).
  private readonly frameHistory = new Float32Array(60);
  private frameHistoryCursor = 0;
  private frameHistoryCount = 0;
  private lastFrameTimestampMs = 0;
  private lastPublishTimestampMs = 0;
  private inputMarkTimestampMs = 0;
  private nextLogId = 1;
  private paused = false;
  private minLevel: DebugLogLevel = 'DEBUG';

  private readonly snapshot: PerformanceSnapshot = {
    fps: 0,
    frameTimeMs: 0,
    avgFrameTimeMs: 0,
    maxFrameTimeMs: 0,
    drawCalls: 0,
    triangles: 0,
    geometries: 0,
    textures: 0,
    inputLatencyMs: 0,
    heapUsedMb: null,
    heapLimitMb: null,
  };

  constructor(config: PerformanceMonitorConfig = {}) {
    this.maxEntries = config.maxEntries ?? 140;
    this.uiPublishIntervalMs = config.uiPublishIntervalMs ?? 250;
  }

  /**
   * Записывает событие потока управления в кольцевой буфер.
   */
  log(level: DebugLogLevel, subsystem: DebugSubsystem, message: string): void {
    if (this.paused && level !== 'ERROR') return;
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[this.minLevel]) return;

    const now = performance.now();
    const date = new Date();
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    const ms = String(date.getMilliseconds()).padStart(3, '0');

    const entry: DebugLogEntry = {
      id: this.nextLogId++,
      timestampMs: now,
      timeLabel: `${hh}:${mm}:${ss}.${ms}`,
      level,
      subsystem,
      message,
    };

    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }

    if (level === 'ERROR') {
      console.error(`[${subsystem}] ${message}`);
    } else if (level === 'WARN') {
      console.warn(`[${subsystem}] ${message}`);
    }
  }

  /**
   * Ставит временную метку начала обработки пользовательского ввода (для замера задержки).
   */
  beginInputLatencyMark(): void {
    this.inputMarkTimestampMs = performance.now();
  }

  /**
   * Фиксирует задержку от получения ввода до завершения реакции системы.
   */
  endInputLatencyMark(): void {
    if (this.inputMarkTimestampMs <= 0) return;
    const latency = performance.now() - this.inputMarkTimestampMs;
    this.snapshot.inputLatencyMs = Number(latency.toFixed(2));
    this.inputMarkTimestampMs = 0;
  }

  /**
   * Обновляет метрики кадра без аллокаций и уведомляет подписчиков раз в `uiPublishIntervalMs`.
   * Вход: `nowMs` (`performance.now()`), `renderer` (`THREE.WebGLRenderer` или совместимый).
   */
  recordFrame(
    nowMs: number,
    renderer?: {
      info?: {
        render?: {calls?: number; triangles?: number};
        memory?: {geometries?: number; textures?: number};
      };
    } | null
  ): void {
    if (this.lastFrameTimestampMs > 0) {
      const deltaMs = Math.max(0.1, nowMs - this.lastFrameTimestampMs);
      this.frameHistory[this.frameHistoryCursor] = deltaMs;
      this.frameHistoryCursor =
        (this.frameHistoryCursor + 1) % this.frameHistory.length;
      if (this.frameHistoryCount < this.frameHistory.length) {
        this.frameHistoryCount++;
      }

      let sum = 0;
      let max = 0;
      for (let i = 0; i < this.frameHistoryCount; i++) {
        const sample = this.frameHistory[i];
        sum += sample;
        if (sample > max) max = sample;
      }

      const avg = sum / this.frameHistoryCount;
      this.snapshot.frameTimeMs = deltaMs;
      this.snapshot.avgFrameTimeMs = avg;
      this.snapshot.maxFrameTimeMs = max;
      this.snapshot.fps = avg > 0 ? Math.round(1000 / avg) : 0;
    }
    this.lastFrameTimestampMs = nowMs;

    if (renderer?.info) {
      this.snapshot.drawCalls = renderer.info.render?.calls ?? 0;
      this.snapshot.triangles = renderer.info.render?.triangles ?? 0;
      this.snapshot.geometries = renderer.info.memory?.geometries ?? 0;
      this.snapshot.textures = renderer.info.memory?.textures ?? 0;
    }

    // ЗАГЛУШКА (STUB): В браузерах без `performance.memory` (не Chromium)
    // размер JS-кучи недоступен (null); в продакшне заменяется телеметрией `rokid-spatial-host`.
    const perfMemory = (
      performance as Performance & {
        memory?: {usedJSHeapSize?: number; jsHeapSizeLimit?: number};
      }
    ).memory;
    if (perfMemory?.usedJSHeapSize) {
      this.snapshot.heapUsedMb = Number(
        (perfMemory.usedJSHeapSize / (1024 * 1024)).toFixed(1)
      );
      this.snapshot.heapLimitMb = perfMemory.jsHeapSizeLimit
        ? Math.round(perfMemory.jsHeapSizeLimit / (1024 * 1024))
        : null;
    }

    if (nowMs - this.lastPublishTimestampMs >= this.uiPublishIntervalMs) {
      this.lastPublishTimestampMs = nowMs;
      this.notifyListeners();
    }
  }

  /** Приостанавливает/возобновляет запись обычных логов (ошибки пишутся всегда). */
  setPaused(paused: boolean): void {
    this.paused = paused;
    this.log(
      'INFO',
      'CORE',
      paused ? 'Лог отладки поставлен на паузу' : 'Лог отладки возобновлён'
    );
    this.notifyListeners();
  }

  isPaused(): boolean {
    return this.paused;
  }

  /** Устанавливает минимальный порог логирования (`DEBUG` | `INFO` | `WARN` | `ERROR`). */
  setMinLevel(level: DebugLogLevel): void {
    this.minLevel = level;
  }

  /** Очищает буфер сообщений. */
  clearLogs(): void {
    this.entries.length = 0;
    this.log('INFO', 'CORE', 'Журнал отладки очищен');
    this.notifyListeners();
  }

  getSnapshot(): Readonly<PerformanceSnapshot> {
    return this.snapshot;
  }

  getEntries(
    filterSubsystem: DebugSubsystem | 'ALL' = 'ALL',
    limit = 24
  ): readonly DebugLogEntry[] {
    const filtered =
      filterSubsystem === 'ALL'
        ? this.entries
        : this.entries.filter((entry) => entry.subsystem === filterSubsystem);
    return filtered.slice(-limit);
  }

  /** Формирует компактный текст лога для вывода в 3D-окно отладки. */
  getFormattedLogs(
    filterSubsystem: DebugSubsystem | 'ALL' = 'ALL',
    limit = 14
  ): string {
    const slice = this.getEntries(filterSubsystem, limit);
    if (slice.length === 0) {
      return 'Нет записей в журнале.';
    }
    return slice
      .map(
        (entry) =>
          `[${entry.timeLabel}] [${entry.level}] [${entry.subsystem}] ${entry.message}`
      )
      .join('\n');
  }

  /** Подписывает UI-компонент на периодические обновления телеметрии и логов. */
  subscribe(listener: MonitorListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot, this.entries);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener(this.snapshot, this.entries);
    }
  }
}
