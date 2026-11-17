import * as xb from 'xrblocks';

import {
  createWorkspaceOptions,
  resolveHeadsetOptions,
} from './modules/configure_xr_workspace.ts';
import {
  executeAsyncSafely,
  installGlobalErrorBoundary,
} from './modules/handle_runtime_errors.ts';
import {SpatialDesktopOrchestrator} from './modules/orchestrate_spatial_desktop.ts';

/**
 * ============================================================================
 * ТОЧКА ВХОДА: src/index.ts
 * ============================================================================
 * НАЗНАЧЕНИЕ:
 *   Минимальный композиционный корень приложения. Устанавливает глобальную
 *   защиту от неперехваченных ошибок, проверяет возможности WebXR-гарнитуры
 *   (`resolveHeadsetOptions`), формирует `xb.Options` через
 *   `configure_xr_workspace.ts` и запускает `SpatialDesktopOrchestrator`.
 * ============================================================================
 */

async function bootstrapSpatialDesktop(): Promise<void> {
  installGlobalErrorBoundary();

  const options = createWorkspaceOptions({
    appTitle: 'Rokid Spatial Desktop XR',
    appDescription:
      'Пространственный рабочий стол AR/VR/Rokid Max: привязка окон к стенам, жесты, SBS 3D, камера Android, голос и телеметрия.',
    enableDepth: true,
    enableSpeech: true,
  });

  const headsetCaps = await resolveHeadsetOptions(options);

  const orchestrator = new SpatialDesktopOrchestrator(options, headsetCaps);
  xb.add(orchestrator);

  await executeAsyncSafely(
    'CORE',
    'Инициализация XR Blocks',
    () => xb.init(options),
    undefined
  );
}

document.addEventListener('DOMContentLoaded', () => {
  void bootstrapSpatialDesktop();
});
