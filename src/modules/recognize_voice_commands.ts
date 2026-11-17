import * as xb from 'xrblocks';

import type {VoiceCommandAction} from '../types/spatial_contracts.ts';
import {matchNaturalLanguageScene} from './select_voice_scene.ts';

/**
 * ============================================================================
 * МОДУЛЬ: recognize_voice_commands.ts (Голосовое управление настройками среды)
 * ============================================================================
 * НАЗНАЧЕНИЕ:
 *   Слушает голосовые команды через встроенный `xb.core.sound.speechRecognizer`
 *   (Web Speech API), распознаёт намерения на русском и английском языках и
 *   передаёт структурированный объект `VoiceCommandAction` оркестратору.
 *   Также предоставляет метод `processCommandText(text)` для тестового/текстового
 *   ввода команд без микрофона.
 *
 * ВХОДНЫЕ ДАННЫЕ:
 *   - `onCommand(action)`: обработчик распознанного действия.
 *   - `onStatusChange(listening, lastText)`: обновление индикатора микрофона.
 *   - `processCommandText(text)`: прямой разбор текстовой фразы.
 *
 * ВЫХОДНЫЕ ДАННЫЕ:
 *   - `VoiceCommandAction` (`action`, `appId`, `rawTranscript`).
 *
 * КАК ПОЛЬЗОВАТЬСЯ:
 *   const voice = new VoiceCommandController({
 *     onCommand: (cmd) => orchestrator.applyVoiceCommand(cmd),
 *     onLog: (lvl, msg) => monitor.log(lvl, 'VOICE', msg),
 *   });
 *   this.add(voice);
 *   voice.toggleListening();
 *
 * ЗАГЛУШКИ (STUB) И ЗАМЕНА В ПРОДАКШНЕ:
 *   - Если браузер не поддерживает Web Speech API (или микрофон не выдан),
 *     модуль не падает, а сообщает об ограничении в отладочный лог и остаётся
 *     доступным через `processCommandText()` в терминале/настройках.
 *   - КАК ЗАМЕНИТЬ В ПРОДАКШНЕ: подключите потоковый офлайн-распознаватель
 *     (например, Whisper / Sherpa-ONNX WASM или Gemini Live Audio) и передавайте
 *     итоговую строку транскрипции в `parseVoiceTranscript()`.
 * ============================================================================
 */

export interface VoiceControllerConfig {
  readonly onCommand?: (action: VoiceCommandAction) => void;
  readonly onListeningChange?: (listening: boolean, statusText: string) => void;
  readonly onLog?: (level: 'INFO' | 'WARN' | 'ERROR', message: string) => void;
}

/**
 * Чистая функция разбора голосовой/текстовой фразы в действие рабочего стола.
 * Можно переиспользовать отдельно от SpeechRecognizer.
 */
export function parseVoiceTranscript(transcript: string): VoiceCommandAction {
  const normalized = transcript.trim().toLowerCase();

  if (
    normalized.includes('360') &&
    (normalized.includes('экран') || normalized.includes('screen'))
  ) {
    return {rawTranscript: transcript, action: 'TOGGLE_360_SCREENS'};
  }
  if (
    normalized.includes('360') ||
    normalized.includes('вокруг') ||
    normalized.includes('панорам')
  ) {
    return {rawTranscript: transcript, action: 'LAYOUT_360'};
  }
  if (normalized.includes('купол') || normalized.includes('dome')) {
    return {rawTranscript: transcript, action: 'TOGGLE_SKYDOME'};
  }

  if (
    (normalized.includes('close') ||
      normalized.includes('закр') ||
      normalized.includes('скр')) &&
    (normalized.includes('layout') ||
      normalized.includes('editor') ||
      normalized.includes('расклад') ||
      normalized.includes('редактор'))
  ) {
    return {rawTranscript: transcript, action: 'CLOSE_LAYOUT_EDITOR'};
  }
  if (
    normalized.includes('layout editor') ||
    normalized.includes('редактор расклад') ||
    normalized.includes('макеты') ||
    normalized.includes('профили окон')
  ) {
    return {rawTranscript: transcript, action: 'OPEN_LAYOUT_EDITOR'};
  }
  if (
    normalized.includes('save layout') ||
    normalized.includes('сохрани расклад') ||
    normalized.includes('сохрани макет')
  ) {
    return {rawTranscript: transcript, action: 'SAVE_CUSTOM_LAYOUT'};
  }
  if (
    normalized.includes('development') ||
    normalized.includes('developer') ||
    normalized.includes('разработ') ||
    normalized.includes('кодинг')
  ) {
    return {rawTranscript: transcript, action: 'WORKFLOW_DEV'};
  }
  if (
    normalized.includes('media') ||
    normalized.includes('медиа') ||
    normalized.includes('кино') ||
    normalized.includes('cinema')
  ) {
    return {rawTranscript: transcript, action: 'WORKFLOW_MEDIA'};
  }
  if (
    normalized.includes('communication') ||
    normalized.includes('comms') ||
    normalized.includes('общен') ||
    normalized.includes('коммуник') ||
    normalized.includes('созвон')
  ) {
    return {rawTranscript: transcript, action: 'WORKFLOW_COMMS'};
  }
  if (
    normalized.includes('audio') ||
    normalized.includes('sound') ||
    normalized.includes('звук') ||
    normalized.includes('аудио') ||
    normalized.includes('mute')
  ) {
    return {rawTranscript: transcript, action: 'TOGGLE_SPATIAL_AUDIO'};
  }
  if (
    normalized.includes('light preset') ||
    normalized.includes('тон света') ||
    normalized.includes('пресет свет') ||
    normalized.includes('warm light')
  ) {
    return {rawTranscript: transcript, action: 'CYCLE_LIGHTING_PRESET'};
  }
  if (
    normalized.includes('lighting') ||
    normalized.includes('ambient light') ||
    normalized.includes('освещ') ||
    normalized.includes('свет камер') ||
    normalized.includes('адаптивный свет')
  ) {
    return {rawTranscript: transcript, action: 'TOGGLE_CAMERA_LIGHTING'};
  }
  if (
    normalized.includes('occluder') ||
    normalized.includes('преград') ||
    normalized.includes('колонн') ||
    normalized.includes('окклюдер')
  ) {
    return {rawTranscript: transcript, action: 'TOGGLE_DEPTH_OCCLUDER'};
  }
  if (
    normalized.includes('depth mask') ||
    normalized.includes('occlusion') ||
    normalized.includes('глубин') ||
    normalized.includes('окклюз') ||
    normalized.includes('маск')
  ) {
    return {rawTranscript: transcript, action: 'TOGGLE_DEPTH_MASK'};
  }
  if (
    normalized.includes('eye track') ||
    normalized.includes('gaze') ||
    normalized.includes('взгляд') ||
    normalized.includes('глаз') ||
    normalized.includes('отслеживан')
  ) {
    return {rawTranscript: transcript, action: 'TOGGLE_EYE_TRACKING'};
  }
  if (
    (normalized.includes('flip') ||
      normalized.includes('switch') ||
      normalized.includes('переключи') ||
      normalized.includes('смени')) &&
    (normalized.includes('camera') || normalized.includes('камер'))
  ) {
    return {rawTranscript: transcript, action: 'FLIP_HAND_CAMERA'};
  }
  if (
    normalized.includes('hand camera') ||
    normalized.includes('camera hand') ||
    normalized.includes('webcam') ||
    normalized.includes('камера рук') ||
    normalized.includes('трекинг рук') ||
    normalized.includes('вебкам')
  ) {
    return {rawTranscript: transcript, action: 'TOGGLE_CAMERA_HANDS'};
  }
  if (normalized.includes('full sbs') || normalized.includes('полный sbs')) {
    return {rawTranscript: transcript, action: 'SBS_FULL'};
  }
  if (normalized.includes('half sbs') || normalized.includes('половин')) {
    return {rawTranscript: transcript, action: 'SBS_HALF'};
  }
  if (
    normalized.includes('sbs') ||
    normalized.includes('side by side') ||
    normalized.includes('стерео') ||
    normalized.includes('сбс')
  ) {
    return {rawTranscript: transcript, action: 'TOGGLE_SBS'};
  }
  if (
    normalized.includes('vr headset') ||
    normalized.includes('enter vr') ||
    normalized.includes('vr шлем') ||
    normalized.includes('vr гарнитур') ||
    normalized.includes('включи vr')
  ) {
    return {rawTranscript: transcript, action: 'ENTER_VR_HEADSET'};
  }
  if (
    normalized.includes('snapshot') ||
    normalized.includes('снимок') ||
    normalized.includes('сфотк') ||
    normalized.includes('сделай фото')
  ) {
    return {rawTranscript: transcript, action: 'CAPTURE_ANDROID_SNAPSHOT'};
  }
  if (
    normalized.includes('android camera') ||
    normalized.includes('камера андроид') ||
    normalized.includes('задняя камера') ||
    normalized.includes('passthrough camera')
  ) {
    return {rawTranscript: transcript, action: 'TOGGLE_ANDROID_CAMERA'};
  }

  // Естественный выбор из 10 виртуальных сцен (Office, Mountain, Space Station и др.).
  const sceneMatch = matchNaturalLanguageScene(transcript);
  if (sceneMatch.navAction === 'OPEN') {
    return {rawTranscript: transcript, action: 'OPEN_SCENE_SELECTOR'};
  }
  if (sceneMatch.navAction === 'CLOSE') {
    return {rawTranscript: transcript, action: 'CLOSE_SCENE_SELECTOR'};
  }
  if (sceneMatch.navAction === 'NEXT') {
    return {rawTranscript: transcript, action: 'PLACE_NEXT'};
  }
  if (sceneMatch.navAction === 'PREV') {
    return {rawTranscript: transcript, action: 'PLACE_PREV'};
  }
  if (sceneMatch.place) {
    return {
      rawTranscript: transcript,
      action: 'PLACE_SELECT',
      placeId: sceneMatch.place.id,
    };
  }
  if (
    normalized.includes('arc') ||
    normalized.includes('дуга') ||
    normalized.includes('полукруг')
  ) {
    return {rawTranscript: transcript, action: 'LAYOUT_ARC'};
  }
  if (
    normalized.includes('grid') ||
    normalized.includes('сетка') ||
    normalized.includes('плитка') ||
    normalized.includes('tile')
  ) {
    return {rawTranscript: transcript, action: 'LAYOUT_GRID'};
  }
  if (
    normalized.includes('wall layout') ||
    normalized.includes('на стены') ||
    normalized.includes('раскладка стен')
  ) {
    return {rawTranscript: transcript, action: 'LAYOUT_WALL'};
  }
  if (
    normalized.includes('unpin') ||
    normalized.includes('открепи') ||
    normalized.includes('отвязать')
  ) {
    return {rawTranscript: transcript, action: 'UNPIN_ALL'};
  }
  if (
    normalized.includes('pin') ||
    normalized.includes('прикрепи') ||
    normalized.includes('закрепи')
  ) {
    return {rawTranscript: transcript, action: 'PIN_ACTIVE'};
  }
  if (
    normalized.includes('wall') ||
    normalized.includes('стен') ||
    normalized.includes('поверхност')
  ) {
    return {rawTranscript: transcript, action: 'TOGGLE_WALLS'};
  }
  if (normalized.includes('glimmer') || normalized.includes('глиммер')) {
    return {rawTranscript: transcript, action: 'THEME_GLIMMER'};
  }
  if (
    normalized.includes('colorful') ||
    normalized.includes('ярк') ||
    normalized.includes('цвет')
  ) {
    return {rawTranscript: transcript, action: 'THEME_COLORFUL'};
  }
  if (
    normalized.includes('glass') ||
    normalized.includes('стекло') ||
    normalized.includes('темн') ||
    normalized.includes('dark')
  ) {
    return {rawTranscript: transcript, action: 'THEME_GLASS'};
  }
  if (normalized.includes('rokid') || normalized.includes('рокид')) {
    return {rawTranscript: transcript, action: 'TOGGLE_ROKID'};
  }
  if (
    normalized.includes('vr') ||
    normalized.includes('ar') ||
    normalized.includes('режим')
  ) {
    return {rawTranscript: transcript, action: 'TOGGLE_XR_MODE'};
  }
  if (
    normalized.includes('hud') ||
    normalized.includes('хад') ||
    normalized.includes('метрик') ||
    normalized.includes('fps') ||
    normalized.includes('фпс') ||
    normalized.includes('памят') ||
    normalized.includes('memory')
  ) {
    return {rawTranscript: transcript, action: 'TOGGLE_HUD'};
  }
  if (
    normalized.includes('guide') ||
    normalized.includes('гид') ||
    normalized.includes('помощ') ||
    normalized.includes('обучен') ||
    normalized.includes('туториал') ||
    normalized.includes('help')
  ) {
    return {rawTranscript: transcript, action: 'TOGGLE_GESTURE_GUIDE'};
  }
  if (
    normalized.includes('debug') ||
    normalized.includes('отладк') ||
    normalized.includes('лог')
  ) {
    return {rawTranscript: transcript, action: 'TOGGLE_DEBUG'};
  }
  if (
    normalized.includes('terminal') ||
    normalized.includes('терминал') ||
    normalized.includes('консол')
  ) {
    return {
      rawTranscript: transcript,
      action: 'OPEN_APP',
      appId: 'terminal',
    };
  }
  if (normalized.includes('note') || normalized.includes('заметк')) {
    return {rawTranscript: transcript, action: 'OPEN_APP', appId: 'notes'};
  }
  if (
    normalized.includes('telemetry') ||
    normalized.includes('телеметр') ||
    normalized.includes('производитель')
  ) {
    return {
      rawTranscript: transcript,
      action: 'OPEN_APP',
      appId: 'telemetry',
    };
  }
  if (normalized.includes('studio') || normalized.includes('студи')) {
    return {rawTranscript: transcript, action: 'OPEN_APP', appId: 'studio'};
  }
  if (
    normalized.includes('3d') ||
    normalized.includes('модел') ||
    normalized.includes('viewer')
  ) {
    return {
      rawTranscript: transcript,
      action: 'OPEN_APP',
      appId: 'viewport3d',
    };
  }
  if (normalized.includes('мест') || normalized.includes('place')) {
    return {rawTranscript: transcript, action: 'OPEN_APP', appId: 'places'};
  }
  if (normalized.includes('reset') || normalized.includes('сброс')) {
    return {rawTranscript: transcript, action: 'RESET_WORKSPACE'};
  }

  return {rawTranscript: transcript, action: 'UNKNOWN'};
}

export class VoiceCommandController extends xb.Script {
  private readonly config: VoiceControllerConfig;
  private listening = false;
  private supported = false;

  private onStartHandler?: () => void;
  private onEndHandler?: () => void;
  private onErrorHandler?: (event: {error: string}) => void;
  private onResultHandler?: (event: {
    transcript: string;
    isFinal: boolean;
  }) => void;

  constructor(config: VoiceControllerConfig = {}) {
    super();
    this.config = config;
  }

  override init(): void {
    const recognizer = xb.core?.sound?.speechRecognizer;
    if (!recognizer || !recognizer.recognition) {
      this.supported = false;
      this.config.onLog?.(
        'WARN',
        'Web Speech API недоступен в текущем окружении — используйте текстовый ввод голосовых команд в Terminal/Studio'
      );
      this.config.onListeningChange?.(false, 'Микрофон недоступен (Text Mode)');
      return;
    }

    this.supported = true;

    this.onStartHandler = () => {
      this.listening = true;
      this.config.onListeningChange?.(true, 'Слушаю голосовую команду...');
      this.config.onLog?.('INFO', 'Голосовое прослушивание активировано');
    };

    this.onEndHandler = () => {
      this.listening = false;
      this.config.onListeningChange?.(false, 'Голос: ожидание');
    };

    this.onErrorHandler = (event) => {
      this.listening = false;
      this.config.onLog?.(
        'WARN',
        `Ошибка распознавания речи: ${event.error || 'unknown'}`
      );
      this.config.onListeningChange?.(
        false,
        `Голос: ${event.error || 'ошибка'}`
      );
    };

    this.onResultHandler = (event) => {
      if (!event.transcript) return;
      this.config.onListeningChange?.(
        this.listening,
        `Распознано: "${event.transcript}"`
      );
      if (event.isFinal) {
        this.processCommandText(event.transcript);
      }
    };

    recognizer.addEventListener('start', this.onStartHandler);
    recognizer.addEventListener('end', this.onEndHandler);
    recognizer.addEventListener('error', this.onErrorHandler);
    recognizer.addEventListener('result', this.onResultHandler);
  }

  isSupported(): boolean {
    return this.supported;
  }

  isListening(): boolean {
    return this.listening;
  }

  toggleListening(): boolean {
    const recognizer = xb.core?.sound?.speechRecognizer;
    if (!this.supported || !recognizer) {
      this.config.onLog?.(
        'WARN',
        'Микрофон не поддерживается; выполните команду через строку в Terminal (например: "voice grid")'
      );
      return false;
    }

    if (this.listening) {
      recognizer.stop();
      this.listening = false;
      return false;
    }

    recognizer.start();
    return true;
  }

  /**
   * Разбирает и исполняет команду из текста (работает и с микрофоном, и в симуляторе).
   */
  processCommandText(text: string): VoiceCommandAction {
    const parsed = parseVoiceTranscript(text);
    this.config.onLog?.(
      parsed.action === 'UNKNOWN' ? 'WARN' : 'INFO',
      `Голосовая команда "${text}" -> ${parsed.action}`
    );
    this.config.onCommand?.(parsed);
    return parsed;
  }

  override dispose(): void {
    const recognizer = xb.core?.sound?.speechRecognizer;
    if (!recognizer) return;
    if (this.onStartHandler)
      recognizer.removeEventListener('start', this.onStartHandler);
    if (this.onEndHandler)
      recognizer.removeEventListener('end', this.onEndHandler);
    if (this.onErrorHandler)
      recognizer.removeEventListener('error', this.onErrorHandler);
    if (this.onResultHandler)
      recognizer.removeEventListener('result', this.onResultHandler);
  }
}
