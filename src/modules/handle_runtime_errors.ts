import type {DebugSubsystem} from '../types/spatial_contracts.ts';

/**
 * ============================================================================
 * МОДУЛЬ: handle_runtime_errors.ts (Обработка ошибок и отказоустойчивость)
 * ============================================================================
 * НАЗНАЧЕНИЕ:
 *   Изолирует выполнение синхронных и асинхронных функций модулей так, чтобы
 *   ошибка в одной подсистеме (например, микрофон, WebXR-датчик или IPC-мост)
 *   не остановила основной 60–90 FPS цикл рендеринга рабочего стола.
 *
 * ВХОДНЫЕ ДАННЫЕ:
 *   - `subsystem`: имя подсистемы (`DebugSubsystem`), где выполняется код.
 *   - `actionName`: понятное описание операции для журнала отладки.
 *   - `fn`: оборачиваемая функция.
 *   - `fallbackValue`: резервное значение при сбое.
 *
 * ВЫХОДНЫЕ ДАННЫЕ:
 *   - Результат выполнения `fn()` либо `fallbackValue` при возникновении исключения.
 *
 * КАК ПОЛЬЗОВАТЬСЯ:
 *   1. Зарегистрируйте обработчик записи ошибок `setRuntimeErrorSink(...)` на старте.
 *   2. Вызовите `installGlobalErrorBoundary()` один раз при инициализации сцены.
 *   3. Оборачивайте небезопасные вызовы через `executeSafely` или `executeAsyncSafely`.
 * ============================================================================
 */

export type ErrorLogSink = (
  subsystem: DebugSubsystem,
  message: string,
  error: unknown
) => void;

let activeErrorSink: ErrorLogSink | null = null;
let globalBoundaryInstalled = false;

/**
 * Подключает внешний приёмник ошибок (например, `monitor_performance_and_logs`).
 * Вход: функция-приёмник `sink`. Выход: функция отключения приёмника.
 */
export function setRuntimeErrorSink(sink: ErrorLogSink): () => void {
  activeErrorSink = sink;
  return () => {
    if (activeErrorSink === sink) {
      activeErrorSink = null;
    }
  };
}

/**
 * Преобразует любое перехваченное значение ошибки в читаемую строку.
 * Вход: `error: unknown`. Выход: строка описания.
 */
export function formatRuntimeError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  if (typeof error === 'string') {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/**
 * Безопасно выполняет синхронную операцию с перехватом и логированием ошибок.
 */
export function executeSafely<T>(
  subsystem: DebugSubsystem,
  actionName: string,
  fn: () => T,
  fallbackValue: T
): T {
  try {
    return fn();
  } catch (error) {
    reportError(subsystem, actionName, error);
    return fallbackValue;
  }
}

/**
 * Безопасно выполняет асинхронную операцию (Promise) без необработанных reject.
 */
export async function executeAsyncSafely<T>(
  subsystem: DebugSubsystem,
  actionName: string,
  fn: () => Promise<T>,
  fallbackValue: T
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    reportError(subsystem, actionName, error);
    return fallbackValue;
  }
}

/**
 * Устанавливает глобальные слушатели `window.error` и `unhandledrejection`.
 * Выход: функция снятия глобальных обработчиков при уничтожении сцены.
 */
export function installGlobalErrorBoundary(): () => void {
  if (globalBoundaryInstalled) {
    return () => {};
  }
  globalBoundaryInstalled = true;

  const onWindowError = (event: ErrorEvent) => {
    reportError(
      'CORE',
      `Неперехваченная ошибка (${event.filename || 'runtime'}:${event.lineno})`,
      event.error ?? event.message
    );
  };

  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    reportError('CORE', 'Необработанный Promise rejection', event.reason);
  };

  window.addEventListener('error', onWindowError);
  window.addEventListener('unhandledrejection', onUnhandledRejection);

  return () => {
    window.removeEventListener('error', onWindowError);
    window.removeEventListener('unhandledrejection', onUnhandledRejection);
    globalBoundaryInstalled = false;
  };
}

function reportError(
  subsystem: DebugSubsystem,
  actionName: string,
  error: unknown
): void {
  const details = formatRuntimeError(error);
  const fullMessage = `[Сбой: ${actionName}] ${details}`;
  if (activeErrorSink) {
    activeErrorSink(subsystem, fullMessage, error);
  } else {
    console.error(`[${subsystem}] ${fullMessage}`, error);
  }
}
