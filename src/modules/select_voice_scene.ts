import * as xb from 'xrblocks';

import type {
  SpatialPlaceId,
  SpatialPlaceSpec,
} from '../types/spatial_contracts.ts';
import {SPATIAL_PLACES_CATALOG} from './generate_incredible_places.ts';

/**
 * ============================================================================
 * МОДУЛЬ: select_voice_scene.ts (Голосовой селектор 10 виртуальных миров)
 * ============================================================================
 * НАЗНАНИЕ:
 *   Предоставляет интеллектуальный разбор естественных голосовых команд на
 *   английском и русском языках для переключения между 10 виртуальными
 *   окружениями (например: «Office», «Mountain», «Space Station», «Ocean»,
 *   «switch to mars», «переключи на горы», «открой сцену 5»), а также
 *   интерактивный оверлей выбора сцен (`xb.UIOverlay`).
 *
 * ВХОДНЫЕ ДАННЫЕ:
 *   - `matchNaturalLanguageScene(transcript, catalog)`: строка распознанной речи.
 *   - `VoiceSceneSelectorActions`: коллбеки выбора места (`onSelectPlace`),
 *     перелистывания (`onNextPlace`, `onPrevPlace`), запуска микрофона
 *     (`onToggleVoice`) и ввода текстовой фразы (`onSubmitPhrase`).
 *
 * ВЫХОДНЫЕ ДАННЫЕ:
 *   - `SceneVoiceMatchResult`: найденный объект `SpatialPlaceSpec | null`,
 *     навигационное действие (`NEXT` | `PREV` | `OPEN` | `CLOSE`) и ключевое слово.
 *   - Интерактивный `xb.UIOverlay` с быстрыми чипами 10 локаций и строкой
 *     естественного языка.
 *
 * КАК ПОЛЬЗОВАТЬСЯ:
 *   const match = matchNaturalLanguageScene('switch to space station', SPATIAL_PLACES_CATALOG);
 *   if (match.place) placesManager.selectPlace(match.place.id);
 *
 *   const selector = new VoiceSceneSelector({
 *     onSelectPlace: (id) => orchestrator.selectPlace(id),
 *     onToggleVoice: () => voiceController.toggleListening(),
 *   });
 *   this.add(selector);
 *
 * ЗАГЛУШКИ (STUB) И ЗАМЕНА В ПРОДАКШНЕ:
 *   - NLU-сопоставление выполнено на локальном словаре синонимов и взвешенном
 *     поиске подстрок/номеров (работает мгновенно, 0 мс задержки, без API).
 *   - КАК ЗАМЕНИТЬ В ПРОДАКШНЕ: для сложных контекстных запросов можно
 *     подключить LLM-маршрутизатор (`xb.ai.query` / Gemini Function Calling)
 *     с фоллбеком на `matchNaturalLanguageScene()`.
 * ============================================================================
 */

export interface SceneAliasDescriptor {
  readonly placeId: SpatialPlaceId;
  readonly shortLabel: string;
  readonly keywords: readonly string[];
}

export const SCENE_VOICE_ALIASES: readonly SceneAliasDescriptor[] = [
  {
    placeId: 'cyber-tokyo',
    shortLabel: '1. Office / Токио',
    keywords: [
      'office',
      'офис',
      'кабинет',
      'workspace',
      'work',
      'рабоч',
      'tokyo',
      'токио',
      'кибер',
      'cyber',
      'city',
      'город',
      'мегаполис',
      'неон',
      'neon',
    ],
  },
  {
    placeId: 'orbital-station',
    shortLabel: '2. Space Station',
    keywords: [
      'space station',
      'космическая станция',
      'космос',
      'space',
      'station',
      'станция',
      'орбит',
      'orbit',
      'orbital',
      'звезд',
      'звёзд',
      'горизонт',
    ],
  },
  {
    placeId: 'abyssal-dome',
    shortLabel: '3. Ocean / Бездна',
    keywords: [
      'ocean',
      'океан',
      'underwater',
      'подвод',
      'глубин',
      'deep sea',
      'sea',
      'море',
      'water',
      'вода',
      'abyss',
      'бездна',
    ],
  },
  {
    placeId: 'crystal-cavern',
    shortLabel: '4. Cave / Кристалл',
    keywords: [
      'cave',
      'cavern',
      'пещер',
      'crystal',
      'кристалл',
      'грот',
      'эфир',
      'подземел',
      'кварц',
    ],
  },
  {
    placeId: 'sky-citadel',
    shortLabel: '5. Mountain / Облака',
    keywords: [
      'mountain',
      'mountains',
      'гора',
      'горы',
      'горн',
      'вершин',
      'peak',
      'summit',
      'альп',
      'облак',
      'clouds',
      'sky',
      'небо',
      'небес',
      'цитадел',
      'citadel',
    ],
  },
  {
    placeId: 'mars-outpost',
    shortLabel: '6. Mars / Арес-7',
    keywords: [
      'mars',
      'марс',
      'красная планета',
      'desert',
      'пустын',
      'каньон',
      'canyon',
      'арес',
      'ares',
      'outpost',
      'база',
    ],
  },
  {
    placeId: 'bioluminescent-forest',
    shortLabel: '7. Forest / Пандора',
    keywords: [
      'forest',
      'лес',
      'jungle',
      'джунгл',
      'woods',
      'nature',
      'природ',
      'пандор',
      'pandora',
      'био',
      'дерев',
      'trees',
    ],
  },
  {
    placeId: 'quantum-nexus',
    shortLabel: '8. Quantum Lab',
    keywords: [
      'quantum',
      'квант',
      'lab',
      'лаборатор',
      'сингуляр',
      'nexus',
      'нексус',
      'matrix',
      'матриц',
      'симуляц',
      'кубит',
    ],
  },
  {
    placeId: 'arctic-aurora',
    shortLabel: '9. Arctic / Сияние',
    keywords: [
      'arctic',
      'арктик',
      'север',
      'north',
      'snow',
      'снег',
      'ice',
      'лед',
      'лёд',
      'ледник',
      'glacier',
      'aurora',
      'сияни',
      'зима',
      'winter',
      'поляр',
    ],
  },
  {
    placeId: 'synthwave-horizon',
    shortLabel: '10. Synthwave 84',
    keywords: [
      'synthwave',
      'synth',
      'синт',
      'retro',
      'ретро',
      '1984',
      'sunset',
      'закат',
      'outrun',
      'wave',
      'волна',
    ],
  },
];

const ORDINAL_MAP: ReadonlyArray<{
  readonly words: readonly string[];
  readonly index: number;
}> = [
  {words: ['перв', 'first', 'one', 'один'], index: 1},
  {words: ['втор', 'second', 'two', 'два'], index: 2},
  {words: ['трет', 'third', 'three', 'три'], index: 3},
  {words: ['четвер', 'четвёр', 'fourth', 'four', 'четыре'], index: 4},
  {words: ['пят', 'fifth', 'five', 'пять'], index: 5},
  {words: ['шест', 'sixth', 'six', 'шесть'], index: 6},
  {words: ['седьм', 'seventh', 'seven', 'семь'], index: 7},
  {words: ['восьм', 'eighth', 'eight', 'восемь'], index: 8},
  {words: ['девят', 'ninth', 'nine', 'девять'], index: 9},
  {words: ['десят', 'tenth', 'ten', 'десять'], index: 10},
];

export interface SceneVoiceMatchResult {
  readonly place: SpatialPlaceSpec | null;
  readonly navAction: 'NEXT' | 'PREV' | 'OPEN' | 'CLOSE' | null;
  readonly matchedKeyword: string;
}

/**
 * Чистая функция NLU-разбора естественной фразы для выбора одной из 10 сцен.
 */
export function matchNaturalLanguageScene(
  transcript: string,
  places: readonly SpatialPlaceSpec[] = SPATIAL_PLACES_CATALOG
): SceneVoiceMatchResult {
  const normalized = transcript.trim().toLowerCase();
  if (!normalized) {
    return {place: null, navAction: null, matchedKeyword: ''};
  }

  // 1. Открытие / закрытие самого селектора сцен.
  if (
    (normalized.includes('close') ||
      normalized.includes('закр') ||
      normalized.includes('скр') ||
      normalized.includes('hide')) &&
    (normalized.includes('scene') ||
      normalized.includes('сцен') ||
      normalized.includes('selector') ||
      normalized.includes('выбор') ||
      normalized.includes('мест'))
  ) {
    return {place: null, navAction: 'CLOSE', matchedKeyword: 'close selector'};
  }
  if (
    normalized.includes('scene selector') ||
    normalized.includes('select scene') ||
    normalized.includes('list scenes') ||
    normalized.includes('выбор сцен') ||
    normalized.includes('список мест') ||
    normalized.includes('список сцен') ||
    normalized.includes('покажи сцены') ||
    normalized.includes('смени сцену')
  ) {
    return {place: null, navAction: 'OPEN', matchedKeyword: 'scene selector'};
  }

  // 2. Листание вперёд / назад.
  if (
    normalized.includes('следующ') ||
    normalized.includes('next place') ||
    normalized.includes('next scene') ||
    normalized.includes('next environment') ||
    normalized.includes('дальше')
  ) {
    return {place: null, navAction: 'NEXT', matchedKeyword: 'next'};
  }
  if (
    normalized.includes('предыдущ') ||
    normalized.includes('prev place') ||
    normalized.includes('previous scene') ||
    normalized.includes('previous environment') ||
    normalized.includes('prev scene') ||
    normalized.includes('назад')
  ) {
    return {place: null, navAction: 'PREV', matchedKeyword: 'prev'};
  }

  // 3. Проверка совпадения по словарю синонимов (выбираем самое длинное/точное совпадение).
  let bestPlaceId: SpatialPlaceId | null = null;
  let bestKeyword = '';
  let bestScore = 0;

  for (const alias of SCENE_VOICE_ALIASES) {
    for (const kw of alias.keywords) {
      if (normalized.includes(kw)) {
        const score = kw.length + (kw.includes(' ') ? 6 : 0);
        if (score > bestScore) {
          bestScore = score;
          bestPlaceId = alias.placeId;
          bestKeyword = kw;
        }
      }
    }
  }

  if (bestPlaceId) {
    const found = places.find((p) => p.id === bestPlaceId) ?? null;
    if (found) {
      return {place: found, navAction: null, matchedKeyword: bestKeyword};
    }
  }

  // 4. Поиск по номеру сцены в естественной речи ("сцена 5", "place number 2", "mountain #5").
  const sceneContext =
    normalized.includes('place') ||
    normalized.includes('scene') ||
    normalized.includes('env') ||
    normalized.includes('сцен') ||
    normalized.includes('мест') ||
    normalized.includes('мир') ||
    normalized.includes('локац');

  if (sceneContext) {
    const digitMatch = normalized.match(/\b(10|[1-9])\b/);
    if (digitMatch) {
      const idx = Number(digitMatch[1]);
      const found = places.find((p) => p.index === idx) ?? null;
      if (found) {
        return {place: found, navAction: null, matchedKeyword: `#${idx}`};
      }
    }
    for (const ord of ORDINAL_MAP) {
      if (ord.words.some((w) => normalized.includes(w))) {
        const found = places.find((p) => p.index === ord.index) ?? null;
        if (found) {
          return {
            place: found,
            navAction: null,
            matchedKeyword: `#${ord.index}`,
          };
        }
      }
    }
  }

  return {place: null, navAction: null, matchedKeyword: ''};
}

export interface VoiceSceneSelectorActions {
  readonly onSelectPlace: (placeId: SpatialPlaceId) => void;
  readonly onNextPlace: () => void;
  readonly onPrevPlace: () => void;
  readonly onToggleVoice: () => void;
  readonly onSubmitPhrase: (phrase: string) => void;
  readonly onVisibilityChange?: (visible: boolean) => void;
  readonly onLog?: (message: string) => void;
}

export class VoiceSceneSelector extends xb.Script {
  private readonly actions: VoiceSceneSelectorActions;
  private overlay!: xb.UIOverlay;
  private activeLabelText!: xb.UIText;
  private statusLineText!: xb.UIText;
  private micButton!: xb.UIButton;
  private phraseInput!: xb.UITextInput;
  private readonly chipButtons = new Map<SpatialPlaceId, xb.UIButton>();
  private visibleState = false;
  private activePlaceId: SpatialPlaceId = 'cyber-tokyo';

  constructor(actions: VoiceSceneSelectorActions) {
    super();
    this.actions = actions;
  }

  override init(): void {
    this.activeLabelText = new xb.UIText({
      text: 'Сцена: 1. Кибер-Неон Токио 2099 (Office)',
      style: {fontSize: 14, fontWeight: 'bold', color: '#ffffff'},
    });

    this.statusLineText = new xb.UIText({
      text: 'Скажите: «Space Station», «Mountain», «Office», «Ocean» или введите фразу',
      style: {fontSize: 12, color: '#a5f3fc', lineHeight: 1.3},
    });

    this.micButton = new xb.UIButton({
      label: 'Голос (V)',
      icon: 'mic',
      onClick: () => this.actions.onToggleVoice(),
    });

    const closeBtn = new xb.UIButton({
      icon: 'close',
      ariaLabel: 'Закрыть голосовой селектор сцен (C)',
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
              icon: 'record_voice_over',
              style: {width: 20, height: 20, color: '#38bdf8'},
            }),
            new xb.UIText({
              text: 'VOICE SCENE SELECTOR (10 МИРОВ)',
              style: {fontSize: 12, fontWeight: 'bold', color: '#38bdf8'},
            }),
          ],
        }),
        closeBtn,
      ],
    });

    this.phraseInput = new xb.UITextInput({
      ariaLabel: 'Голосовая команда смены сцены',
      placeholder: 'Напр.: Switch to Space Station / Горы / Марс...',
      style: {flexGrow: 1, minHeight: 38, fontSize: 13},
      onSubmit: (val) => {
        if (!val.trim()) return;
        this.actions.onSubmitPhrase(val);
        this.phraseInput.value = '';
      },
    });

    const voiceRow = new xb.UIPanel({
      style: {width: '100%', flexDirection: 'row', gap: 6, alignItems: 'center'},
      children: [
        this.phraseInput,
        new xb.UIButton({
          label: 'OK',
          onClick: () => {
            const val = this.phraseInput.value.trim();
            if (!val) return;
            this.actions.onSubmitPhrase(val);
            this.phraseInput.value = '';
          },
        }),
        this.micButton,
      ],
    });

    // 2 строки по 5 кнопок для мгновенного выбора любой из 10 сцен.
    const row1 = new xb.UIPanel({
      style: {width: '100%', flexDirection: 'row', gap: 5},
      children: SCENE_VOICE_ALIASES.slice(0, 5).map((item) =>
        this.createSceneChip(item)
      ),
    });
    const row2 = new xb.UIPanel({
      style: {width: '100%', flexDirection: 'row', gap: 5},
      children: SCENE_VOICE_ALIASES.slice(5, 10).map((item) =>
        this.createSceneChip(item)
      ),
    });

    const navRow = new xb.UIPanel({
      style: {width: '100%', flexDirection: 'row', gap: 8},
      children: [
        new xb.UIButton({
          label: '◀ Пред. место',
          style: {flexGrow: 1},
          onClick: () => this.actions.onPrevPlace(),
        }),
        new xb.UIButton({
          label: 'След. место ▶',
          style: {flexGrow: 1},
          onClick: () => this.actions.onNextPlace(),
        }),
      ],
    });

    this.overlay = new xb.UIOverlay({
      style: {
        width: 472,
        position: 'absolute',
        top: 16,
        left: '50%',
        transform: {translateX: '-50%'},
        flexDirection: 'column',
        gap: 8,
        padding: 12,
        borderRadius: 16,
        backgroundColor: 'rgba(9, 15, 30, 0.88)',
      },
      children: [
        headerRow,
        this.activeLabelText,
        this.statusLineText,
        voiceRow,
        row1,
        row2,
        navRow,
      ],
    });
    this.overlay.name = 'VoiceSceneSelectorOverlay';
    this.overlay.visible = this.visibleState;
    this.add(this.overlay);
    this.refreshChips();
  }

  private createSceneChip(item: SceneAliasDescriptor): xb.UIButton {
    const btn = new xb.UIButton({
      label: item.shortLabel,
      style: {flexGrow: 1, fontSize: 11, padding: 6},
      onClick: () => this.actions.onSelectPlace(item.placeId),
    });
    this.chipButtons.set(item.placeId, btn);
    return btn;
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
        ? 'Голосовой селектор 10 сцен открыт'
        : 'Голосовой селектор сцен скрыт'
    );
    this.actions.onVisibilityChange?.(visible);
    return this.visibleState;
  }

  toggle(): boolean {
    return this.setVisible(!this.visibleState);
  }

  setActivePlace(place: SpatialPlaceSpec): void {
    this.activePlaceId = place.id;
    if (this.activeLabelText) {
      this.activeLabelText.text = `Активно: #${place.index} ${place.title}`;
    }
    this.refreshChips();
  }

  setListening(listening: boolean, statusText?: string): void {
    if (this.micButton) {
      this.micButton.label = listening ? 'Слушаю...' : 'Голос (V)';
      this.micButton.icon = listening ? 'graphic_eq' : 'mic';
    }
    if (statusText && this.statusLineText) {
      this.statusLineText.text = statusText;
    }
  }

  showMatchedFeedback(phrase: string, matchedLabel: string): void {
    if (this.statusLineText) {
      this.statusLineText.text = `Фраза "${phrase}" → ${matchedLabel}`;
    }
  }

  private refreshChips(): void {
    for (const [placeId, btn] of this.chipButtons.entries()) {
      const active = placeId === this.activePlaceId;
      btn.style.borderColor = active
        ? '#38bdf8'
        : 'rgba(255, 255, 255, 0.16)';
      btn.style.backgroundColor = active
        ? 'rgba(56, 189, 248, 0.28)'
        : 'rgba(255, 255, 255, 0.08)';
    }
  }
}
