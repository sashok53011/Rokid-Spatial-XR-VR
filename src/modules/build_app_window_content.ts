import * as THREE from 'three';
import * as xb from 'xrblocks';

import type {
  PerformanceSnapshot,
  SpatialAppId,
  SpatialPlaceId,
  SpatialPlaceSpec,
  WindowDynamicBindings,
  WorkspaceLayoutMode,
  WorkspaceThemePreset,
} from '../types/spatial_contracts.ts';
import {SPATIAL_PLACES_CATALOG} from './generate_incredible_places.ts';

/**
 * ============================================================================
 * МОДУЛЬ: build_app_window_content.ts (Фабрика UI-контента приложений в окнах)
 * ============================================================================
 * НАЗНАЧЕНИЕ:
 *   Изолированный строитель содержимого для всех пространственных приложений
 *   рабочего стола (`terminal`, `notes`, `telemetry`, `studio`, `viewport3d`).
 *   Возвращает готовые дочерние элементы XR Blocks (`UIPanel`, `UIText`,
 *   `UITextInput`, `UIButton`, `UISlider`, `UIScrollView`, `ModelViewer`) и
 *   реактивные привязки `WindowDynamicBindings` для обновления значений без
 *   пересоздания UI-дерева.
 *
 * ВХОДНЫЕ ДАННЫЕ:
 *   - `appId`: идентификатор приложения (`SpatialAppId`).
 *   - `actions`: коллбеки взаимодействия с внешними модулями (терминал, заметки,
 *     раскладка, Rokid Max, отладочный лог).
 *
 * ВЫХОДНЫЕ ДАННЫЕ:
 *   - `{ children: THREE.Object3D[], bindings: WindowDynamicBindings }`
 *
 * КАК ПОЛЬЗОВАТЬСЯ:
 *   const built = buildAppWindowContent('terminal', actions);
 *   card.add(...built.children);
 *   // Обновление из внешнего монитора:
 *   built.bindings.onTelemetryUpdate?.(snapshot);
 *
 * ЗАГЛУШКИ (STUB) И ЗАМЕНА В ПРОДАКШНЕ:
 *   - В приложении `notes` текст сохраняется в `localStorage` браузера.
 *     В продакшне замените на синхронизацию с облачным хранилищем или локальным
 *     файлом через `rokid-spatial-host` IPC.
 *   - В приложении `viewport3d` рендерится процедурная 3D-модель пространственного
 *     узла Rokid из 9 PBR-деталей (Zero-404). В продакшне можно загружать
 *     реальные `.glb` сцены пользователя через `modelViewer.load({ url })`.
 * ============================================================================
 */

export interface AppContentBuildActions {
  readonly onRunTerminalCommand: (cmd: string) => string;
  readonly onRunVoiceText: (phrase: string) => void;
  readonly onSelectLayout: (mode: WorkspaceLayoutMode) => void;
  readonly onSelectTheme: (theme: WorkspaceThemePreset) => void;
  readonly onCycleRokidMode: () => void;
  readonly onToggleWalls: () => void;
  readonly onPinAllToWalls: () => void;
  readonly onUnpinAll: () => void;
  readonly onClearLogs: () => void;
  readonly onToggleLogPause: () => boolean;
  readonly onSyncStudio: () => void;
  readonly onResetWorkspace: () => void;
  readonly onSelectPlace: (placeId: SpatialPlaceId) => void;
  readonly onNextPlace: () => void;
  readonly onPrevPlace: () => void;
  readonly onToggleSkyDome: () => boolean;
  readonly onToggleScreens360: () => boolean;
}

export interface CompanionModelAttachment {
  readonly viewer: xb.ModelViewer;
  readonly assembly: THREE.Group;
  readonly localOffset: THREE.Vector3;
}

export interface BuiltAppContent {
  readonly children: THREE.Object3D[];
  readonly bindings: WindowDynamicBindings;
  readonly companionModel?: CompanionModelAttachment;
}

const NOTES_STORAGE_KEY = 'rokid_spatial_notes_content_v1';

export function buildAppWindowContent(
  appId: SpatialAppId,
  actions: AppContentBuildActions
): BuiltAppContent {
  switch (appId) {
    case 'terminal':
      return buildTerminalContent(actions);
    case 'notes':
      return buildNotesContent();
    case 'telemetry':
      return buildTelemetryContent(actions);
    case 'studio':
      return buildStudioContent(actions);
    case 'viewport3d':
      return buildViewport3DContent();
    case 'places':
      return buildPlacesGalleryContent(actions);
  }
}

function buildTerminalContent(actions: AppContentBuildActions): BuiltAppContent {
  const historyLines = [
    'Rokid Spatial Host Console v1.0',
    'Введите команду (help, rokid status, rokid imu, rokid ping) или voice-фразу.',
  ];

  const outputText = new xb.UIText({
    text: historyLines.join('\n'),
    style: {
      width: '100%',
      fontSize: 15,
      lineHeight: 1.35,
      whiteSpace: 'pre-line',
    },
  });

  const scrollBox = new xb.UIScrollView({
    ariaLabel: 'Вывод терминала',
    style: {
      width: '100%',
      height: 175,
      padding: 12,
      backgroundColor: 'rgba(6, 10, 18, 0.78)',
      borderRadius: 14,
    },
    children: [outputText],
  });

  const commandInput = new xb.UITextInput({
    ariaLabel: 'Команда терминала',
    placeholder: 'help | rokid status | voice grid ...',
    style: {
      flexGrow: 1,
      minHeight: 46,
      fontSize: 16,
    },
    onSubmit: (value) => submitCommand(value),
  });

  const submitCommand = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    if (trimmed.toLowerCase() === 'clear') {
      historyLines.length = 0;
      outputText.text = 'Консоль очищена.';
      commandInput.value = '';
      return;
    }

    if (trimmed.toLowerCase().startsWith('voice ')) {
      const phrase = trimmed.slice(6);
      actions.onRunVoiceText(phrase);
      historyLines.push(`$ ${trimmed}\n[VOICE] Выполнена фраза: "${phrase}"`);
    } else {
      const result = actions.onRunTerminalCommand(trimmed);
      historyLines.push(`$ ${trimmed}\n${result}`);
    }

    while (historyLines.length > 12) historyLines.shift();
    outputText.text = historyLines.join('\n\n');
    commandInput.value = '';
  };

  const quickRow = new xb.UIPanel({
    style: {width: '100%', flexDirection: 'row', gap: 8},
    children: [
      new xb.UIButton({
        label: 'Status',
        icon: 'terminal',
        style: {flexGrow: 1},
        onClick: () => submitCommand('rokid status'),
      }),
      new xb.UIButton({
        label: 'IMU',
        icon: 'sensors',
        style: {flexGrow: 1},
        onClick: () => submitCommand('rokid imu'),
      }),
      new xb.UIButton({
        label: 'Ping',
        icon: 'network_check',
        style: {flexGrow: 1},
        onClick: () => submitCommand('rokid ping'),
      }),
      new xb.UIButton({
        label: 'Clear',
        icon: 'delete_sweep',
        style: {flexGrow: 1},
        onClick: () => submitCommand('clear'),
      }),
    ],
  });

  const inputRow = new xb.UIPanel({
    style: {width: '100%', flexDirection: 'row', gap: 8, alignItems: 'center'},
    children: [
      commandInput,
      new xb.UIButton({
        label: 'Run',
        icon: 'send',
        onClick: () => submitCommand(commandInput.value),
      }),
    ],
  });

  const hostBadge = new xb.UIText({
    text: 'Мост: Loopback Bus Ready',
    style: {fontSize: 14, opacity: 0.78},
  });

  return {
    children: [hostBadge, scrollBox, quickRow, inputRow],
    bindings: {
      onRokidStateUpdate: (statusText) => {
        hostBadge.text = statusText;
      },
    },
  };
}

function buildNotesContent(): BuiltAppContent {
  let savedNote =
    'План рабочей сессии AR:\n- Закрепить терминал на рабочем столе\n- Поместить телеметрию на левую стену\n- Проверить профиль оптики Rokid Max (50° FOV)';
  try {
    const stored = localStorage.getItem(NOTES_STORAGE_KEY);
    if (stored) savedNote = stored;
  } catch {
    // Игнорируем в приватном режиме.
  }

  const saveIndicator = new xb.UIText({
    text: 'Локальное хранение активно',
    style: {fontSize: 14, opacity: 0.72},
  });

  const editor = new xb.UITextInput({
    ariaLabel: 'Редактор пространственных заметок',
    multiline: true,
    value: savedNote,
    placeholder: 'Введите заметку...',
    style: {
      width: '100%',
      minHeight: 190,
      fontSize: 16,
      lineHeight: 1.35,
    },
    onInput: (val) => {
      try {
        localStorage.setItem(NOTES_STORAGE_KEY, val);
        saveIndicator.text = `Сохранено (${val.length} симв.)`;
      } catch {
        saveIndicator.text = 'Только в оперативной памяти';
      }
    },
  });

  const footer = new xb.UIPanel({
    style: {
      width: '100%',
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 8,
    },
    children: [
      saveIndicator,
      new xb.UIButton({
        label: '+ Отметка времени',
        icon: 'schedule',
        onClick: () => {
          const stamp = new Date().toLocaleTimeString();
          editor.value = `${editor.value}\n[${stamp}] Зафиксировано в пространстве`;
          editor.onInput?.(editor.value);
        },
      }),
    ],
  });

  return {
    children: [editor, footer],
    bindings: {
      onSyncNoteText: (text) => {
        editor.value = text;
      },
    },
  };
}

function buildTelemetryContent(actions: AppContentBuildActions): BuiltAppContent {
  const metricsText = new xb.UIText({
    text: 'FPS: -- | Frame: -- ms | Calls: -- | Latency: -- ms',
    style: {
      width: '100%',
      fontSize: 16,
      fontWeight: 'bold',
      padding: 10,
      backgroundColor: 'rgba(14, 165, 233, 0.16)',
      borderRadius: 12,
    },
  });

  const audioMetricsText = new xb.UIText({
    text: '3D-Аудио: инициализация HRTF PannerNode...',
    style: {
      width: '100%',
      fontSize: 13,
      padding: 8,
      color: '#a5f3fc',
      backgroundColor: 'rgba(15, 23, 42, 0.72)',
      borderRadius: 10,
    },
  });

  const envTelemetryText = new xb.UIText({
    text: 'Свет: -- | Z-Маска: -- | Взгляд: -- | Сохранение: --',
    style: {
      width: '100%',
      fontSize: 12,
      padding: 7,
      color: '#fde68a',
      backgroundColor: 'rgba(15, 23, 42, 0.72)',
      borderRadius: 10,
    },
  });

  const logText = new xb.UIText({
    text: 'Инициализация журнала потоков...',
    style: {
      width: '100%',
      fontSize: 13,
      lineHeight: 1.3,
      whiteSpace: 'pre-line',
    },
  });

  const logScroll = new xb.UIScrollView({
    ariaLabel: 'Журнал отладки в реальном времени',
    style: {
      width: '100%',
      height: 170,
      padding: 10,
      backgroundColor: 'rgba(4, 7, 15, 0.84)',
      borderRadius: 14,
    },
    children: [logText],
  });

  let pauseBtn: xb.UIButton;
  pauseBtn = new xb.UIButton({
    label: 'Пауза лога',
    icon: 'pause',
    style: {flexGrow: 1},
    onClick: () => {
      const paused = actions.onToggleLogPause();
      pauseBtn.label = paused ? 'Возобновить' : 'Пауза лога';
      pauseBtn.icon = paused ? 'play_arrow' : 'pause';
    },
  });

  const controls = new xb.UIPanel({
    style: {width: '100%', flexDirection: 'row', gap: 8},
    children: [
      pauseBtn,
      new xb.UIButton({
        label: 'Очистить лог',
        icon: 'cleaning_services',
        style: {flexGrow: 1},
        onClick: () => actions.onClearLogs(),
      }),
    ],
  });

  return {
    children: [
      metricsText,
      audioMetricsText,
      envTelemetryText,
      logScroll,
      controls,
    ],
    bindings: {
      onTelemetryUpdate: (snap: PerformanceSnapshot) => {
        const heap = snap.heapUsedMb !== null ? ` | Heap: ${snap.heapUsedMb}MB` : '';
        metricsText.text =
          `FPS: ${snap.fps} | Frame: ${snap.avgFrameTimeMs.toFixed(1)}ms ` +
          `(max ${snap.maxFrameTimeMs.toFixed(1)}) | Calls: ${snap.drawCalls} | ` +
          `Input: ${snap.inputLatencyMs}ms${heap}`;
      },
      onSpatialAudioTelemetry: (summary: string) => {
        audioMetricsText.text = summary;
      },
      onEnvironmentTelemetry: (summary: string) => {
        envTelemetryText.text = summary;
      },
      onLogUpdate: (formatted: string) => {
        logText.text = formatted;
      },
    },
  };
}

function buildStudioContent(actions: AppContentBuildActions): BuiltAppContent {
  const statusText = new xb.UIText({
    text: 'Готово к синхронизации с rokid-spatial-studio-xr',
    style: {fontSize: 15, opacity: 0.82},
  });

  const layoutRow = new xb.UIPanel({
    style: {width: '100%', flexDirection: 'row', gap: 8},
    children: [
      new xb.UIButton({
        label: 'Дуга (Arc)',
        icon: 'panorama_wide_angle',
        style: {flexGrow: 1},
        onClick: () => actions.onSelectLayout('arc'),
      }),
      new xb.UIButton({
        label: 'Сетка',
        icon: 'grid_view',
        style: {flexGrow: 1},
        onClick: () => actions.onSelectLayout('grid'),
      }),
      new xb.UIButton({
        label: 'На стены',
        icon: 'wallpaper',
        style: {flexGrow: 1},
        onClick: () => actions.onSelectLayout('wall-pinned'),
      }),
      new xb.UIButton({
        label: '360° Круг',
        icon: '360',
        style: {flexGrow: 1},
        onClick: () => actions.onSelectLayout('ring360'),
      }),
    ],
  });

  const surfaceRow = new xb.UIPanel({
    style: {width: '100%', flexDirection: 'row', gap: 8},
    children: [
      new xb.UIButton({
        label: 'Стены On/Off',
        icon: 'layers',
        style: {flexGrow: 1},
        onClick: () => actions.onToggleWalls(),
      }),
      new xb.UIButton({
        label: 'Закрепить все',
        icon: 'push_pin',
        style: {flexGrow: 1},
        onClick: () => actions.onPinAllToWalls(),
      }),
      new xb.UIButton({
        label: 'Открепить все',
        icon: 'pin_off',
        style: {flexGrow: 1},
        onClick: () => actions.onUnpinAll(),
      }),
    ],
  });

  const themeRow = new xb.UIPanel({
    style: {width: '100%', flexDirection: 'row', gap: 8},
    children: [
      new xb.UIButton({
        label: 'Glass',
        style: {flexGrow: 1},
        onClick: () => actions.onSelectTheme('grayGlass'),
      }),
      new xb.UIButton({
        label: 'Glimmer',
        style: {flexGrow: 1},
        onClick: () => actions.onSelectTheme('glimmer'),
      }),
      new xb.UIButton({
        label: 'Rokid Green',
        style: {flexGrow: 1},
        onClick: () => actions.onSelectTheme('glimmerGreen'),
      }),
    ],
  });

  const ecosystemRow = new xb.UIPanel({
    style: {width: '100%', flexDirection: 'row', gap: 8},
    children: [
      new xb.UIButton({
        label: 'Оптика Rokid',
        icon: 'eyeglasses',
        style: {flexGrow: 1},
        onClick: () => actions.onCycleRokidMode(),
      }),
      new xb.UIButton({
        label: 'Sync Studio',
        icon: 'cloud_sync',
        style: {flexGrow: 1},
        onClick: () => actions.onSyncStudio(),
      }),
      new xb.UIButton({
        label: 'Сброс',
        icon: 'restart_alt',
        style: {flexGrow: 1},
        onClick: () => actions.onResetWorkspace(),
      }),
    ],
  });

  return {
    children: [
      statusText,
      new xb.UIText({
        text: 'Раскладка окон',
        style: {fontSize: 14, opacity: 0.7},
      }),
      layoutRow,
      new xb.UIText({
        text: 'Виртуальные поверхности',
        style: {fontSize: 14, opacity: 0.7},
      }),
      surfaceRow,
      new xb.UIText({
        text: 'Тема и оптика Rokid Max',
        style: {fontSize: 14, opacity: 0.7},
      }),
      themeRow,
      ecosystemRow,
    ],
    bindings: {
      onStatusUpdate: (txt) => {
        statusText.text = txt;
      },
    },
  };
}

function buildViewport3DContent(): BuiltAppContent {
  const viewer = new xb.ModelViewer({
    origin: 'center',
    manipulation: {
      actions: {
        rotate: {axis: 'y'},
        scale: {minScale: 0.6, maxScale: 1.8},
      },
      handle: {action: xb.ManipulationAction.Rotate},
    },
  });

  const assembly = createProceduralRokidSpatialAssembly();
  viewer.setContent(assembly);

  const scaleLabel = new xb.UIText({
    text: '100%',
    style: {fontSize: 16, fontWeight: 'bold'},
  });

  const scaleSlider = new xb.UISlider({
    ariaLabel: 'Масштаб 3D-узла',
    min: 60,
    max: 150,
    step: 5,
    value: 100,
    style: {width: '100%', height: 38},
    onInput: (val) => {
      scaleLabel.text = `${val}%`;
      assembly.scale.setScalar(val / 100);
    },
  });

  const header = new xb.UIPanel({
    style: {
      width: '100%',
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    children: [
      new xb.UIText({
        text: 'Прототип Rokid Spatial Node (PBR)',
        style: {fontSize: 15, opacity: 0.85},
      }),
      scaleLabel,
    ],
  });

  const stage = new xb.UIPanel({
    style: {
      width: '100%',
      height: 150,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: 'rgba(8, 13, 24, 0.55)',
      borderRadius: 16,
    },
    children: [
      new xb.UIText({
        text: '3D-сцена активна перед окном',
        style: {fontSize: 13, opacity: 0.65, textAlign: 'center'},
      }),
    ],
  });

  return {
    children: [
      header,
      stage,
      scaleSlider,
      new xb.UIText({
        text: 'Потяните 3D-узел перед окном для вращения по оси Y.',
        style: {fontSize: 13, opacity: 0.72, textAlign: 'center'},
      }),
    ],
    bindings: {},
    companionModel: {
      viewer,
      assembly,
      localOffset: new THREE.Vector3(0, 0.01, 0.14),
    },
  };
}

/**
 * Создаёт композитную процедурную 3D-модель пространственного вычислительного узла
 * из 9 PBR-частей (без внешних файлов, Zero-404, с контрастом roughness/metalness).
 */
function createProceduralRokidSpatialAssembly(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'RokidSpatialNodeAssembly';

  const titaniumMat = new THREE.MeshStandardMaterial({
    color: 0x94a3b8,
    metalness: 0.88,
    roughness: 0.24,
  });
  const matteBodyMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    metalness: 0.15,
    roughness: 0.72,
  });
  const opticGlassMat = new THREE.MeshPhysicalMaterial({
    color: 0x38bdf8,
    metalness: 0.1,
    roughness: 0.08,
    transparent: true,
    opacity: 0.75,
    clearcoat: 1.0,
  });
  const accentCoreMat = new THREE.MeshStandardMaterial({
    color: 0x22d3ee,
    emissive: 0x0284c7,
    emissiveIntensity: 0.9,
    metalness: 0.3,
    roughness: 0.35,
  });

  // 1. Основание узла (Bottom-center pivot).
  const basePlate = new THREE.Mesh(
    new THREE.CylinderGeometry(0.085, 0.095, 0.016, 32),
    matteBodyMat
  );
  basePlate.position.y = -0.055;

  // 2. Титановое кольцо стабилизатора.
  const gimbalRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.068, 0.008, 16, 48),
    titaniumMat
  );
  gimbalRing.rotation.x = Math.PI / 6;

  // 3. Внутренний оптический резонатор.
  const coreSphere = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.032, 1),
    accentCoreMat
  );

  // 4-5. Две призмы Birdbath-оптики (левый и правый канал).
  const lensGeo = new THREE.BoxGeometry(0.036, 0.022, 0.008);
  const leftLens = new THREE.Mesh(lensGeo, opticGlassMat);
  leftLens.position.set(-0.028, 0.025, 0.045);
  leftLens.rotation.y = 0.18;

  const rightLens = new THREE.Mesh(lensGeo, opticGlassMat);
  rightLens.position.set(0.028, 0.025, 0.045);
  rightLens.rotation.y = -0.18;

  // 6. Мост оправы.
  const bridge = new THREE.Mesh(
    new THREE.BoxGeometry(0.085, 0.008, 0.014),
    titaniumMat
  );
  bridge.position.set(0, 0.04, 0.042);

  // 7-8. Две дужки с сенсорами.
  const templeGeo = new THREE.BoxGeometry(0.008, 0.01, 0.075);
  const leftTemple = new THREE.Mesh(templeGeo, matteBodyMat);
  leftTemple.position.set(-0.045, 0.035, 0.006);

  const rightTemple = new THREE.Mesh(templeGeo, matteBodyMat);
  rightTemple.position.set(0.045, 0.035, 0.006);

  // 9. Верхний IMU-маяк.
  const beacon = new THREE.Mesh(
    new THREE.ConeGeometry(0.014, 0.024, 16),
    accentCoreMat
  );
  beacon.position.y = 0.072;

  root.add(
    basePlate,
    gimbalRing,
    coreSphere,
    leftLens,
    rightLens,
    bridge,
    leftTemple,
    rightTemple,
    beacon
  );

  return root;
}

function buildPlacesGalleryContent(
  actions: AppContentBuildActions
): BuiltAppContent {
  const activePlaceTitle = new xb.UIText({
    text: `1/10: ${SPATIAL_PLACES_CATALOG[0].title}`,
    style: {fontSize: 18, fontWeight: 'bold'},
  });

  const activePlaceSubtitle = new xb.UIText({
    text: SPATIAL_PLACES_CATALOG[0].subtitle,
    style: {fontSize: 14, opacity: 0.78, lineHeight: 1.3},
  });

  let skyBtn: xb.UIButton;
  skyBtn = new xb.UIButton({
    label: 'Купол 360°: ON',
    icon: 'panorama_photosphere',
    style: {flexGrow: 1},
    onClick: () => {
      const enabled = actions.onToggleSkyDome();
      skyBtn.label = enabled ? 'Купол 360°: ON' : 'AR Прозрачный';
    },
  });

  let screensBtn: xb.UIButton;
  screensBtn = new xb.UIButton({
    label: '360° Экраны: ON',
    icon: 'surround_sound',
    style: {flexGrow: 1},
    onClick: () => {
      const visible = actions.onToggleScreens360();
      screensBtn.label = visible ? '360° Экраны: ON' : '360° Экраны: OFF';
    },
  });

  const navRow = new xb.UIPanel({
    style: {width: '100%', flexDirection: 'row', gap: 8},
    children: [
      new xb.UIButton({
        label: 'Пред. место',
        icon: 'chevron_left',
        style: {flexGrow: 1},
        onClick: () => actions.onPrevPlace(),
      }),
      new xb.UIButton({
        label: 'След. место',
        icon: 'chevron_right',
        style: {flexGrow: 1},
        onClick: () => actions.onNextPlace(),
      }),
      new xb.UIButton({
        label: 'Окна на 360°',
        icon: '360',
        style: {flexGrow: 1},
        onClick: () => actions.onSelectLayout('ring360'),
      }),
    ],
  });

  const modeRow = new xb.UIPanel({
    style: {width: '100%', flexDirection: 'row', gap: 8},
    children: [skyBtn, screensBtn],
  });

  const placeButtons = SPATIAL_PLACES_CATALOG.map(
    (place) =>
      new xb.UIButton({
        label: `${place.index}. ${place.title} (${place.screenCount360} экр.)`,
        icon: 'travel_explore',
        style: {width: '100%'},
        onClick: () => actions.onSelectPlace(place.id),
      })
  );

  const listScroll = new xb.UIScrollView({
    ariaLabel: 'Каталог 10 невероятных мест',
    style: {
      width: '100%',
      height: 185,
      padding: 8,
      gap: 6,
      backgroundColor: 'rgba(6, 10, 20, 0.72)',
      borderRadius: 14,
    },
    children: placeButtons,
  });

  return {
    children: [
      activePlaceTitle,
      activePlaceSubtitle,
      navRow,
      modeRow,
      listScroll,
    ],
    bindings: {
      onPlaceChanged: (place: SpatialPlaceSpec, skyEnabled: boolean) => {
        activePlaceTitle.text = `${place.index}/10: ${place.title}`;
        activePlaceSubtitle.text = `${place.subtitle} | Экранов 360°: ${place.screenCount360}`;
        skyBtn.label = skyEnabled ? 'Купол 360°: ON' : 'AR Прозрачный';
      },
    },
  };
}

