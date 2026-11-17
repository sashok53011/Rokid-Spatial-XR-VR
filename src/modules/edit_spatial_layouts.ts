import * as THREE from 'three';
import * as xb from 'xrblocks';

import type {
  ManagedSpatialWindow,
  SavedLayoutPreset,
  SavedWindowTransform,
  SpatialAppId,
  WorkflowPresetKind,
} from '../types/spatial_contracts.ts';

/**
 * ============================================================================
 * МОДУЛЬ: edit_spatial_layouts.ts (Редактор раскладок и рабочих профилей)
 * ============================================================================
 * НАЗНАЧЕНИЕ:
 *   Позволяет сохранять текущую 3D-композицию всех окон рабочего стола,
 *   загружать пользовательские раскладки и мгновенно переключаться между
 *   предустановленными сценариями рабочих процессов:
 *   - `Development` (разработка: Terminal + Studio + Telemetry + Notes)
 *   - `Media Consumption` (медиа-просмотр: 10 Мест & 360° + 3D Node в фокусе)
 *   - `Communication` (коммуникация: Notes/встречи + Studio + Terminal)
 *   Также включает быструю панель управления пространственным аудио (вкл/выкл,
 *   тест 3D-позиционирования и телеметрию панорамирования активного окна).
 *
 * ВХОДНЫЕ ДАННЫЕ:
 *   - `getWindows()`: текущий массив `ManagedSpatialWindow[]` для снятия снимка.
 *   - `onApplyPreset(preset)`: коллбек плавного применения раскладки к окнам.
 *   - `onToggleSpatialAudio()`, `onTestSpatialAudio()`: управление 3D-звуком.
 *
 * ВЫХОДНЫЕ ДАННЫЕ:
 *   - `SavedLayoutPreset[]`: список встроенных и сохранённых раскладок.
 *   - `xb.UIOverlay` («Редактор раскладок», горячая клавиша `K`).
 *
 * КАК ПОЛЬЗОВАТЬСЯ:
 *   const layoutEditor = new SpatialLayoutEditor({
 *     getWindows: () => windowManager.getWindows(),
 *     getActiveLayoutMode: () => state.layoutMode,
 *     onApplyPreset: (preset) => { ... },
 *   });
 *   this.add(layoutEditor);
 *   layoutEditor.applyWorkflowPreset('workflow-dev');
 *
 * ЗАГЛУШКИ (STUB) И ЗАМЕНА В ПРОДАКШНЕ:
 *   - Пользовательские раскладки сохраняются локально в `localStorage` под
 *     ключом `rokid_spatial_custom_layouts_v1` (максимум 6 слотов в UI).
 *   - КАК ЗАМЕНИТЬ В ПРОДАКШНЕ: синхронизируйте массив `SavedLayoutPreset[]` с
 *     облачным профилем пользователя или REST/WebSocket API сервера
 *     `rokid-spatial-studio-xr` (`/api/studio/layouts`).
 * ============================================================================
 */

const CUSTOM_LAYOUTS_STORAGE_KEY = 'rokid_spatial_custom_layouts_v1';
const MAX_CUSTOM_SLOTS = 6;

const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _quat = new THREE.Quaternion();

function quatFromY(degY: number, degX = 0): [number, number, number, number] {
  _euler.set(THREE.MathUtils.degToRad(degX), THREE.MathUtils.degToRad(degY), 0);
  _quat.setFromEuler(_euler);
  return [
    Number(_quat.x.toFixed(4)),
    Number(_quat.y.toFixed(4)),
    Number(_quat.z.toFixed(4)),
    Number(_quat.w.toFixed(4)),
  ];
}

/**
 * 3 предустановленных профессиональных рабочих процесса.
 */
export const BUILTIN_WORKFLOW_PRESETS: readonly SavedLayoutPreset[] = [
  {
    id: 'workflow-dev',
    name: 'Development',
    workflowKind: 'development',
    isBuiltIn: true,
    layoutMode: 'arc',
    savedAtIso: '2026-01-01T00:00:00.000Z',
    windows: [
      {
        id: 'terminal',
        visible: true,
        pinnedSurfaceId: 'wall-left',
        position: [-0.78, 1.46, -1.24],
        quaternion: quatFromY(24),
        scale: 1.08,
      },
      {
        id: 'studio',
        visible: true,
        pinnedSurfaceId: 'wall-center',
        position: [0.0, 1.48, -1.42],
        quaternion: quatFromY(0),
        scale: 1.02,
      },
      {
        id: 'telemetry',
        visible: true,
        pinnedSurfaceId: 'wall-right',
        position: [0.78, 1.46, -1.24],
        quaternion: quatFromY(-24),
        scale: 1.06,
      },
      {
        id: 'notes',
        visible: true,
        pinnedSurfaceId: 'desk-surface',
        position: [-0.46, 0.96, -0.95],
        quaternion: quatFromY(14, -14),
        scale: 0.96,
      },
      {
        id: 'viewport3d',
        visible: true,
        pinnedSurfaceId: null,
        position: [0.54, 0.96, -0.98],
        quaternion: quatFromY(-18, -10),
        scale: 0.92,
      },
      {
        id: 'places',
        visible: false,
        pinnedSurfaceId: null,
        position: [-1.45, 1.44, -0.82],
        quaternion: quatFromY(45),
        scale: 0.9,
      },
    ],
  },
  {
    id: 'workflow-media',
    name: 'Media Consumption',
    workflowKind: 'media',
    isBuiltIn: true,
    layoutMode: 'ring360',
    savedAtIso: '2026-01-01T00:00:00.000Z',
    windows: [
      {
        id: 'places',
        visible: true,
        pinnedSurfaceId: 'ring360-0',
        position: [0.0, 1.52, -1.62],
        quaternion: quatFromY(0),
        scale: 1.24,
      },
      {
        id: 'viewport3d',
        visible: true,
        pinnedSurfaceId: 'ring360-1',
        position: [0.88, 1.4, -1.32],
        quaternion: quatFromY(-28),
        scale: 1.08,
      },
      {
        id: 'studio',
        visible: true,
        pinnedSurfaceId: null,
        position: [-0.88, 1.38, -1.32],
        quaternion: quatFromY(28),
        scale: 0.88,
      },
      {
        id: 'terminal',
        visible: false,
        pinnedSurfaceId: null,
        position: [-1.35, 1.35, -0.75],
        quaternion: quatFromY(52),
        scale: 0.85,
      },
      {
        id: 'telemetry',
        visible: false,
        pinnedSurfaceId: null,
        position: [1.35, 1.35, -0.75],
        quaternion: quatFromY(-52),
        scale: 0.85,
      },
      {
        id: 'notes',
        visible: false,
        pinnedSurfaceId: null,
        position: [-0.55, 0.95, -1.0],
        quaternion: quatFromY(18),
        scale: 0.85,
      },
    ],
  },
  {
    id: 'workflow-comms',
    name: 'Communication',
    workflowKind: 'communication',
    isBuiltIn: true,
    layoutMode: 'arc',
    savedAtIso: '2026-01-01T00:00:00.000Z',
    windows: [
      {
        id: 'notes',
        visible: true,
        pinnedSurfaceId: null,
        position: [-0.46, 1.46, -1.16],
        quaternion: quatFromY(18),
        scale: 1.15,
      },
      {
        id: 'studio',
        visible: true,
        pinnedSurfaceId: null,
        position: [0.48, 1.46, -1.18],
        quaternion: quatFromY(-18),
        scale: 1.04,
      },
      {
        id: 'terminal',
        visible: true,
        pinnedSurfaceId: 'desk-surface',
        position: [0.0, 0.95, -0.96],
        quaternion: quatFromY(0, -16),
        scale: 0.94,
      },
      {
        id: 'telemetry',
        visible: false,
        pinnedSurfaceId: null,
        position: [1.18, 1.38, -1.08],
        quaternion: quatFromY(-38),
        scale: 0.85,
      },
      {
        id: 'viewport3d',
        visible: false,
        pinnedSurfaceId: null,
        position: [-1.18, 1.38, -1.08],
        quaternion: quatFromY(38),
        scale: 0.85,
      },
      {
        id: 'places',
        visible: true,
        pinnedSurfaceId: null,
        position: [-1.12, 1.44, -1.04],
        quaternion: quatFromY(36),
        scale: 0.92,
      },
    ],
  },
];

export interface SpatialLayoutEditorActions {
  readonly getWindows: () => readonly ManagedSpatialWindow[];
  readonly onApplyPreset: (preset: SavedLayoutPreset) => void;
  readonly onToggleSpatialAudio: () => boolean;
  readonly onTestSpatialAudio: () => void;
  readonly onAdjustAudioVolume: (delta: number) => number;
  readonly onVisibilityChange?: (visible: boolean) => void;
  readonly onLog?: (message: string) => void;
}

interface CustomSlotWidgets {
  readonly row: xb.UIPanel;
  readonly loadBtn: xb.UIButton;
  readonly deleteBtn: xb.UIButton;
  presetId: string | null;
}

export class SpatialLayoutEditor extends xb.Script {
  private readonly actions: SpatialLayoutEditorActions;
  private customPresets: SavedLayoutPreset[] = [];
  private activePresetId = 'workflow-dev';
  private visibleState = false;

  private overlay!: xb.UIOverlay;
  private activeBadgeText!: xb.UIText;
  private audioSummaryText!: xb.UIText;
  private audioToggleBtn!: xb.UIButton;
  private nameInput!: xb.UITextInput;
  private readonly workflowButtons = new Map<string, xb.UIButton>();
  private readonly customSlots: CustomSlotWidgets[] = [];

  constructor(actions: SpatialLayoutEditorActions) {
    super();
    this.actions = actions;
    this.customPresets = this.loadCustomPresetsFromStorage();
  }

  override init(): void {
    this.activeBadgeText = new xb.UIText({
      text: 'Активный профиль: Стандарт (Arc)',
      style: {fontSize: 13, fontWeight: 'bold', color: '#e2e8f0'},
    });

    this.audioSummaryText = new xb.UIText({
      text: '3D-Аудио: ожидание активации | Pan: -- | Dist: --',
      style: {fontSize: 12, color: '#a5f3fc', lineHeight: 1.3},
    });

    const closeBtn = new xb.UIButton({
      icon: 'close',
      ariaLabel: 'Закрыть редактор раскладок (K)',
      style: {width: 28, height: 28, padding: 0, borderRadius: 14},
      onClick: () => this.setVisible(false),
    });

    const headerRow = new xb.UIPanel({
      style: {
        width: '100%',
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 8,
      },
      children: [
        new xb.UIPanel({
          style: {flexDirection: 'row', alignItems: 'center', gap: 8},
          children: [
            new xb.UIIcon({
              icon: 'space_dashboard',
              style: {width: 20, height: 20, color: '#38bdf8'},
            }),
            new xb.UIText({
              text: 'LAYOUT EDITOR & 3D AUDIO (K)',
              style: {fontSize: 12, fontWeight: 'bold', color: '#38bdf8'},
            }),
          ],
        }),
        closeBtn,
      ],
    });

    // Кнопки мгновенного переключения рабочих сценариев.
    const workflowRow = new xb.UIPanel({
      style: {width: '100%', flexDirection: 'row', gap: 6},
      children: BUILTIN_WORKFLOW_PRESETS.map((preset) => {
        const icon =
          preset.workflowKind === 'development'
            ? 'code'
            : preset.workflowKind === 'media'
              ? 'movie'
              : 'forum';
        const shortName =
          preset.workflowKind === 'development'
            ? 'Development'
            : preset.workflowKind === 'media'
              ? 'Media'
              : 'Comms';
        const btn = new xb.UIButton({
          label: shortName,
          icon,
          style: {flexGrow: 1, fontSize: 12},
          onClick: () => this.applyPresetById(preset.id),
        });
        this.workflowButtons.set(preset.id, btn);
        return btn;
      }),
    });

    // Строка сохранения текущей пользовательской раскладки.
    this.nameInput = new xb.UITextInput({
      ariaLabel: 'Название пользовательской раскладки',
      placeholder: 'Имя раскладки (напр. Focus Work)...',
      style: {flexGrow: 1, minHeight: 38, fontSize: 13},
      onSubmit: (val) => {
        this.saveCurrentArrangement(val);
        this.nameInput.value = '';
      },
    });

    const saveRow = new xb.UIPanel({
      style: {width: '100%', flexDirection: 'row', gap: 6, alignItems: 'center'},
      children: [
        this.nameInput,
        new xb.UIButton({
          label: 'Сохранить',
          icon: 'save',
          onClick: () => {
            this.saveCurrentArrangement(this.nameInput.value);
            this.nameInput.value = '';
          },
        }),
      ],
    });

    // 6 предвыделенных слотов пользовательских раскладок (Zero-GC UI).
    const slotChildren: xb.UIPanel[] = [];
    for (let i = 0; i < MAX_CUSTOM_SLOTS; i++) {
      const slotIndex = i;
      const loadBtn = new xb.UIButton({
        label: `Слот ${i + 1}`,
        icon: 'bookmark',
        style: {flexGrow: 1, fontSize: 12},
        onClick: () => {
          const slot = this.customSlots[slotIndex];
          if (slot.presetId) this.applyPresetById(slot.presetId);
        },
      });
      const deleteBtn = new xb.UIButton({
        icon: 'delete',
        ariaLabel: `Удалить раскладку ${i + 1}`,
        style: {width: 34, height: 34, padding: 0},
        onClick: () => {
          const slot = this.customSlots[slotIndex];
          if (slot.presetId) this.deleteCustomPreset(slot.presetId);
        },
      });
      const row = new xb.UIPanel({
        style: {width: '100%', flexDirection: 'row', gap: 6, alignItems: 'center'},
        children: [loadBtn, deleteBtn],
      });
      row.visible = false;
      this.customSlots.push({row, loadBtn, deleteBtn, presetId: null});
      slotChildren.push(row);
    }

    const customListPanel = new xb.UIScrollView({
      ariaLabel: 'Сохранённые пользовательские раскладки',
      style: {
        width: '100%',
        height: 120,
        padding: 6,
        gap: 6,
        backgroundColor: 'rgba(6, 10, 22, 0.72)',
        borderRadius: 12,
      },
      children: slotChildren,
    });

    // Быстрая панель пространственного аудио (Web Audio API HRTF 3D).
    this.audioToggleBtn = new xb.UIButton({
      label: '3D Аудио: ON',
      icon: 'volume_up',
      style: {flexGrow: 1, fontSize: 12},
      onClick: () => {
        const active = this.actions.onToggleSpatialAudio();
        this.setAudioEnabledVisual(active);
      },
    });

    const audioRow = new xb.UIPanel({
      style: {width: '100%', flexDirection: 'row', gap: 6, alignItems: 'center'},
      children: [
        this.audioToggleBtn,
        new xb.UIButton({
          label: 'Тест 3D',
          icon: 'spatial_audio',
          style: {flexGrow: 1, fontSize: 12},
          onClick: () => this.actions.onTestSpatialAudio(),
        }),
        new xb.UIButton({
          label: 'Vol -',
          style: {padding: 6, fontSize: 12},
          onClick: () => this.actions.onAdjustAudioVolume(-0.15),
        }),
        new xb.UIButton({
          label: 'Vol +',
          style: {padding: 6, fontSize: 12},
          onClick: () => this.actions.onAdjustAudioVolume(0.15),
        }),
      ],
    });

    this.overlay = new xb.UIOverlay({
      style: {
        width: 424,
        position: 'absolute',
        right: 18,
        bottom: 92,
        flexDirection: 'column',
        gap: 8,
        padding: 12,
        borderRadius: 16,
        backgroundColor: 'rgba(9, 15, 30, 0.90)',
      },
      children: [
        headerRow,
        this.activeBadgeText,
        new xb.UIText({
          text: 'Готовые рабочие профили (Workflows):',
          style: {fontSize: 11, opacity: 0.72},
        }),
        workflowRow,
        saveRow,
        new xb.UIText({
          text: 'Пользовательские раскладки:',
          style: {fontSize: 11, opacity: 0.72},
        }),
        customListPanel,
        this.audioSummaryText,
        audioRow,
      ],
    });
    this.overlay.name = 'SpatialLayoutEditorOverlay';
    this.overlay.visible = this.visibleState;
    this.add(this.overlay);

    this.refreshCustomSlots();
    this.refreshWorkflowHighlights();
  }

  isVisible(): boolean {
    return this.visibleState;
  }

  setVisible(visible: boolean): boolean {
    this.visibleState = visible;
    if (this.overlay) {
      this.overlay.visible = visible;
    }
    this.actions.onLog?.(
      visible
        ? 'Редактор раскладок окон открыт'
        : 'Редактор раскладок окон скрыт'
    );
    this.actions.onVisibilityChange?.(visible);
    return this.visibleState;
  }

  toggle(): boolean {
    return this.setVisible(!this.visibleState);
  }

  getAllPresets(): readonly SavedLayoutPreset[] {
    return [...BUILTIN_WORKFLOW_PRESETS, ...this.customPresets];
  }

  getActivePresetId(): string {
    return this.activePresetId;
  }

  setActivePresetId(presetId: string): void {
    this.activePresetId = presetId;
    const found = this.getAllPresets().find((p) => p.id === presetId);
    if (this.activeBadgeText) {
      this.activeBadgeText.text = found
        ? `Активный профиль: ${found.name}`
        : `Активный профиль: ${presetId}`;
    }
    this.refreshWorkflowHighlights();
    this.refreshCustomSlots();
  }

  /**
   * Применяет встроенный или пользовательский пресет по ID.
   */
  applyPresetById(presetId: string): SavedLayoutPreset | null {
    const preset = this.getAllPresets().find((p) => p.id === presetId) ?? null;
    if (!preset) return null;
    this.setActivePresetId(preset.id);
    this.actions.onApplyPreset(preset);
    this.actions.onLog?.(
      `Загружена раскладка "${preset.name}" (${preset.windows.length} окон)`
    );
    return preset;
  }

  /**
   * Сохраняет текущее 3D-расположение всех окон как пользовательский пресет.
   */
  saveCurrentArrangement(rawName: string): SavedLayoutPreset {
    const cleanName =
      rawName.trim() || `Custom #${this.customPresets.length + 1}`;
    const currentWindows = this.actions.getWindows();
    const transforms: SavedWindowTransform[] = currentWindows.map((win) => ({
      id: win.id,
      visible: win.card.visible,
      pinnedSurfaceId: win.pinnedSurfaceId,
      position: [
        Number(win.card.position.x.toFixed(3)),
        Number(win.card.position.y.toFixed(3)),
        Number(win.card.position.z.toFixed(3)),
      ],
      quaternion: [
        Number(win.card.quaternion.x.toFixed(4)),
        Number(win.card.quaternion.y.toFixed(4)),
        Number(win.card.quaternion.z.toFixed(4)),
        Number(win.card.quaternion.w.toFixed(4)),
      ],
      scale: Number(win.card.scale.x.toFixed(3)),
    }));

    const existingIndex = this.customPresets.findIndex(
      (p) => p.name.toLowerCase() === cleanName.toLowerCase()
    );
    const id: string =
      existingIndex >= 0
        ? this.customPresets[existingIndex].id
        : `custom-${Date.now()}`;

    const preset: SavedLayoutPreset = {
      id,
      name: cleanName,
      workflowKind: 'custom',
      isBuiltIn: false,
      layoutMode: 'arc',
      savedAtIso: new Date().toISOString(),
      windows: transforms,
    };

    if (existingIndex >= 0) {
      this.customPresets[existingIndex] = preset;
    } else {
      if (this.customPresets.length >= MAX_CUSTOM_SLOTS) {
        this.customPresets.shift();
      }
      this.customPresets.push(preset);
    }

    this.persistCustomPresetsToStorage();
    this.setActivePresetId(preset.id);
    this.actions.onLog?.(
      `Пользовательская раскладка "${preset.name}" сохранена (${transforms.length} окон)`
    );
    return preset;
  }

  deleteCustomPreset(presetId: string): boolean {
    const prevLen = this.customPresets.length;
    this.customPresets = this.customPresets.filter((p) => p.id !== presetId);
    if (this.customPresets.length === prevLen) return false;
    this.persistCustomPresetsToStorage();
    this.refreshCustomSlots();
    this.actions.onLog?.(`Пользовательская раскладка удалена (${presetId})`);
    return true;
  }

  setAudioEnabledVisual(enabled: boolean): void {
    if (this.audioToggleBtn) {
      this.audioToggleBtn.label = enabled ? '3D Аудио: ON' : '3D Аудио: OFF';
      this.audioToggleBtn.icon = enabled ? 'volume_up' : 'volume_off';
    }
  }

  updateSpatialAudioSummary(summary: string): void {
    if (this.audioSummaryText) {
      this.audioSummaryText.text = summary;
    }
  }

  private refreshWorkflowHighlights(): void {
    for (const [presetId, btn] of this.workflowButtons.entries()) {
      const active = presetId === this.activePresetId;
      btn.style.borderColor = active
        ? '#38bdf8'
        : 'rgba(255, 255, 255, 0.16)';
      btn.style.backgroundColor = active
        ? 'rgba(56, 189, 248, 0.28)'
        : 'rgba(255, 255, 255, 0.08)';
    }
  }

  private refreshCustomSlots(): void {
    for (let i = 0; i < MAX_CUSTOM_SLOTS; i++) {
      const slot = this.customSlots[i];
      if (!slot) continue;
      const preset = this.customPresets[i];
      if (!preset) {
        slot.row.visible = false;
        slot.presetId = null;
        continue;
      }
      slot.row.visible = true;
      slot.presetId = preset.id;
      const visibleCount = preset.windows.filter((w) => w.visible).length;
      slot.loadBtn.label = `${preset.name} (${visibleCount} ок.)`;
      const active = preset.id === this.activePresetId;
      slot.loadBtn.style.borderColor = active
        ? '#4ade80'
        : 'rgba(255, 255, 255, 0.16)';
    }
  }

  private loadCustomPresetsFromStorage(): SavedLayoutPreset[] {
    try {
      const raw = localStorage.getItem(CUSTOM_LAYOUTS_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (item): item is SavedLayoutPreset =>
          Boolean(item) &&
          typeof item === 'object' &&
          typeof (item as SavedLayoutPreset).id === 'string' &&
          typeof (item as SavedLayoutPreset).name === 'string' &&
          Array.isArray((item as SavedLayoutPreset).windows)
      );
    } catch {
      return [];
    }
  }

  private persistCustomPresetsToStorage(): void {
    try {
      localStorage.setItem(
        CUSTOM_LAYOUTS_STORAGE_KEY,
        JSON.stringify(this.customPresets)
      );
    } catch {
      // Игнорируем в приватном режиме.
    }
  }
}

export type WorkflowPresetId =
  | 'workflow-dev'
  | 'workflow-media'
  | 'workflow-comms';

export function resolveWorkflowIdFromKind(
  kind: Exclude<WorkflowPresetKind, 'custom'>
): WorkflowPresetId {
  if (kind === 'development') return 'workflow-dev';
  if (kind === 'media') return 'workflow-media';
  return 'workflow-comms';
}

export function getWindowTransformMap(
  preset: SavedLayoutPreset
): Map<SpatialAppId, SavedWindowTransform> {
  const map = new Map<SpatialAppId, SavedWindowTransform>();
  for (const w of preset.windows) {
    map.set(w.id, w);
  }
  return map;
}
