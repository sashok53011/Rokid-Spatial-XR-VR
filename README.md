# Rokid Spatial Desktop XR

Модульный 3D-пространственный рабочий стол для дополненной реальности (WebXR / Android XR / **Rokid Max**) на базе **XR Blocks** и **Three.js**.  
Архитектура вдохновлена проектами [`rokid-spatial-host`](https://github.com/sashok53011/rokid-spatial-host) и [`rokid-spatial-studio-xr`](https://github.com/sashok53011/rokid-spatial-studio-xr).

---

## Возможности

- **Организация 3D-окон приложений**: 6 независимых пространственных окон (`Spatial Host Terminal`, `Spatial Notes`, `Debug & Perf Monitor`, `Rokid Spatial Studio`, `3D Spatial Node`, `10 Мест & 360° Экраны`), которые можно перемещать, масштабировать, фокусировать, скрывать и перестраивать по 4 раскладкам (`Arc`, `Grid`, `Wall-Pinned`, `360° Ring`).
- **10 невероятных 360°-мест и панорамные экраны**: пользователь окружён настраиваемым 360-градусным кольцом изогнутых голографических экранов с живыми телеметрическими дисплеями, атмосферными частицами (`InstancedMesh`), 3D-архитектурой по периметру и шейдерным куполом неба (с мгновенным отключением купола для прозрачного AR в очках Rokid Max).
  1. **Кибер-Неон Токио 2099** (`cyber-tokyo`) — 8 экранов, мегаполис и цифровой дождь
  2. **Орбитальная Станция «Горизонт»** (`orbital-station`) — 6 экранов, низкая орбита и звёздный купол
  3. **Подводный Купол «Бездна»** (`abyssal-dome`) — 8 экранов, глубина 3400 м, сонар и пузыри
  4. **Кристальная Пещера Эфира** (`crystal-cavern`) — 6 экранов, резонансные кварцевые шпили
  5. **Небесная Цитадель в Облаках** (`sky-citadel`) — 6 экранов, золотой рассвет на высоте 12 км
  6. **Марсианский Купол «Арес-7»** (`mars-outpost`) — 8 экранов, красный каньон и орбитальный маяк
  7. **Био-Лес Пандоры** (`bioluminescent-forest`) — 8 экранов, светящиеся деревья и парящие споры
  8. **Квантовая Сингулярность** (`quantum-nexus`) — 10 экранов, кольцо горизонта событий и потоки данных
  9. **Северное Сияние Арктики** (`arctic-aurora`) — 6 экранов, полярная ночь, аврора и ледники
  10. **Синтвейв-Каньон 1984** (`synthwave-horizon`) — 8 экранов, ретро-солнце и неоновая сетка
- **Привязка к виртуальным стенам, 360°-панелям и реальным поверхностям (AR Pinning)**: 4 базовые виртуальные поверхности (Центральная, Левая, Правая стены и Рабочий стол) + 8 круговых панорамных панелей на 360° (`ring360-0` .. `ring360-7`) с магнитным примагничиванием, подсветкой и поддержкой реального `DepthMesh` в AR.
- **Жестовое управление руками**: распознавание жестов `open-palm` / `spread`, `fist`, `thumbs-up`, `thumbs-down`, `point` через `xb.core.gestureRecognition`, плюс нативный захват и масштабирование двумя руками.
- **Голосовые команды**: управление раскладкой, переключением всех 10 локаций, 360°-экранами, куполом, привязкой окон, темой, профилем Rokid Max, режимами AR/VR и отладкой через `xb.core.sound.speechRecognizer` (Web Speech API) и резервный текстовый ввод команд (`voice ...` в терминале).
- **Клавиатура и мышь**: полная поддержка стандартного ввода и горячих клавиш.
- **Совместимость с Rokid Max**: оптические профили `Standard WebXR`, `Rokid Max Birdbath AR (50° FOV)` (тема `glimmer` и аддитивное диммирование) и `Rokid Max 3D SBS (3840×1080)`, плюс протокольный мост `rokid-spatial-host/v1` и синхронизация манифестов `rokid-spatial-studio-xr/v1`.
- **Переключаемый ненавязчивый HUD производительности**: лёгкий `UIOverlay` в правом верхнем углу (`pointerEvents: 'none'` на метриках) в реальном времени показывает FPS, время кадра (`frame/avg/max`), задержку ввода (`inputLatencyMs`), память JS Heap и счётчики GPU-ресурсов (`drawCalls`, `triangles`, `geometries`, `textures`). Переключается клавишей `M`, кнопкой `HUD` в доке, голосом или в терминале.
- **Интерактивный гид по жестам (онбординг)**: пошаговый оверлей в левом верхнем углу обучает новых пользователей захвату и перемещению окон, двухручному масштабированию (`Two-Hand Pinch`), привязке к стенам/360°-панелям жестом «кулак» и навигации жестами; автоматически проверяет реальные действия пользователя (`✓ Выполнено`) и позволяет протестировать сдвиг/масштаб кнопками прямо из оверлея.
- **Голосовой селектор 10 сцен на естественном языке**: компактный оверлей `VoiceSceneSelector` (`C` или команда «выбор сцен») и NLU-словарь синонимов позволяют переключать все 10 миров естественными фразами на английском и русском (`"switch to space station"`, `"Office"`, `"Mountain"`, `"Ocean"`, `"переключи на горы"`, `"открой сцену 6"`).
- **3D-ретикл и голографический «Hand-Ghost» обратной связи**: при каждом жесте руки или манипуляции окном (перемещение, масштабирование, изменение размера, привязка к стене) в точке воздействия появляется многослойный голографический ретикл и полупрозрачный 21-суставный силуэт руки (или две руки со шкалой расстояния при масштабировании).
- **Редактор раскладок (Layout Editor) и рабочие профили**: сохраняйте пользовательские 3D-раскладки (позиции, повороты, масштабы, видимость и пины всех окон) и мгновенно переключайтесь между готовыми сценариями **`Development`**, **`Media Consumption`** и **`Communication`** (`K` или кнопка `Макеты (K)`).
- **Пространственное 3D-аудио (Web Audio API HRTF)**: каждое 3D-окно имеет собственный источник `PannerNode` (`HRTF` + `inverse` attenuation). Громкость и бинауральное панорамирование L/R динамически подстраиваются под расстояние и угол между пользователем и каждым окном, а скрытые окна плавно заглушаются (`U` или кнопка `Аудио (U)`).
- **Адаптивное освещение по камере Android XR**: анализирует яркость и цветовую температуру потока с задней камеры устройства (`xb.core.deviceCamera`) и WebXR Light Estimation (`xb.core.lighting`), плавно подстраивая ambient/hemisphere/directional свет сцены под реальное окружение (`I` / `Alt+I`).
- **Z-маскировка глубины и окклюзия 3D-окон**: обеспечивает корректное перекрытие виртуальных окон (`depthTest = true` + `OcclusionUtils` + чистый Z-Mask для `DepthMesh`) за реальными 3D-объектами в XR и включает тестовый физический 3D-окклюдер для проверки на десктопе (`X` / `Alt+X`).
- **Автосохранение позиций и масштабов окон в LocalStorage**: выделенный менеджер `WorkspaceLocalStorageManager` запоминает координаты XYZ, повороты, масштаб, открытость и привязку каждого окна в `localStorage` (включая синхронный сброс перед закрытием вкладки) и автоматически восстанавливает сцену при следующем запуске.
- **Оверлей отслеживания взгляда (`Eye-Tracking Focus`)**: отслеживает взгляд пользователя (WebXR `targetRayMode === 'gaze'` или фовеальный луч в симуляторе), подсвечивает целевое окно 3D-рамкой фокуса и отображает индикатор `👁 FOCUS` для голосовых команд и жестов (`F`).
- **Камерный трекинг движений и жестов рук (`Camera Hand Tracking`)**: использует живой видеопоток камеры (`getUserMedia` — фронтальной `user` или тыловой `environment`) и MediaPipe Tasks Vision (`GestureRecognizer`, 21 сустав, до 2 рук), чтобы в реальном времени двигать 3D-силуэт Hand-Ghost, наводиться на окна, перетаскивать окно щипком (`pinch`), масштабировать двумя руками и вызывать жесты (`open-palm`, `fist`, `thumbs-up`, `thumbs-down`, `victory`, `point`) (`J` / `Alt+J`).
- **Поддержка VR-гарнитур (`immersive-vr`) и контроллеров**: автоматическое определение `navigator.xr` (`immersive-vr` / `immersive-ar`), безопасное отключение обязательного `depth-sensing` на чистых VR-шлемах (Meta Quest, Pico, Valve Index, Google Cardboard VR), лучи контроллеров, управление стиками (thumbsticks) для сдвига и масштаба активного окна и мгновенный запуск VR-сессии (`Z` или кнопка `VR Шлем (Z)`).
- **Режим Side-by-Side 3D Stereo (`SBS`)**: одновременный рендеринг левого и правого глаза (`THREE.StereoCamera` + `renderSceneOverride`) в форматах `Half-SBS` (16:9 экраны и Cardboard) и `Full-SBS` (Rokid Max `3840×1080`), с настройкой IPD (`52–76 мм`, по умолчанию `64 мм`), совместимостью со слоями `layer 1 / 2` и автоматической передачей стерео нативному WebXR (`Y` / `Alt+Y`).
- **Функционал камеры Android XR (`Android Camera`)**: полнофункциональная работа с `xb.core.deviceCamera` (`facingMode: 'environment' | 'user'`, переключение нескольких объективов Android — Main/Ultrawide/Front, и нативный WebXR Raw Camera Access API `camera-access`), пространственное окно предпросмотра (`O`) и захват фото-снимков (`captureSnapshot()`, `Alt+O`), также питающие модуль адаптивного освещения.
- **Низколатентный рендер и отладка в реальном времени**: предвыделенные буферы без GC-нагрузки в цикле `update()`, живой счётчик FPS / времени кадра / draw calls / задержки ввода и глобальный перехват ошибок.

---

## Модульная архитектура (по функциям и действиям)

Каждый модуль изолирован и общается с остальными только через чётко типизированные входные и выходные контракты (`/src/types/spatial_contracts.ts`). Модули можно переставлять, заменять или переиспользовать независимо.

| Модуль | Назначение | Входные параметры | Выходные данные |
| --- | --- | --- | --- |
| `src/types/spatial_contracts.ts` | Единые контракты и типы данных всех модулей | — | Интерфейсы (`ManagedSpatialWindow`, `SpatialPlaceSpec`, `SurfaceSnapResult`, `RokidHostPacket`, `StudioSceneManifest` и др.) |
| `src/modules/handle_runtime_errors.ts` | Безопасное выполнение кода и глобальный перехват сбоев | `subsystem`, `actionName`, `fn`, `fallbackValue` | Результат `fn()` или `fallbackValue` + запись в лог |
| `src/modules/monitor_performance_and_logs.ts` | Кольцевой буфер логов и Zero-GC телеметрия FPS/латентности | `log()`, `recordFrame(nowMs, renderer)`, `beginInputLatencyMark()` | `PerformanceSnapshot`, `getFormattedLogs()`, события подписчикам |
| `src/modules/interpolate_transforms.ts` | Плавная низколатентная интерполяция позиций и поворотов | `animateTo(object, pose, lambda)`, `step(deltaSeconds)` | Число активных переходов; плавно обновлённый `Object3D` |
| `src/modules/configure_xr_workspace.ts` | Конфигурация `xb.Options` и оптических профилей Rokid Max | `createWorkspaceOptions(config)`, `applyRokidOpticsProfile(mode)` | Настроенный `xb.Options`, `RokidOpticsProfile` |
| `src/modules/build_360_screens_and_panels.ts` | Генерация изогнутых 360°-экранов и 8 круговых панелей привязки | `place: SpatialPlaceSpec`, `panelRadiusMeters`, `panelCount` | `Screens360Bundle` (`screensGroup`, `panoramicSurfaces`, `animate`, `setVisible`, `dispose`) |
| `src/modules/generate_incredible_places.ts` | Каталог 10 невероятных миров, GLSL-купол неба, 3D-декор и частицы | `selectPlace(id)`, `nextPlace()`, `prevPlace()`, `setSkyDomeEnabled()`, `setScreens360Visible()` | `SpatialPlaceSpec`, обновлённая 360°-сцена + события `onPlaceReady` |
| `src/modules/snap_to_virtual_surfaces.ts` | Виртуальные стены, стол, 360°-панели, подсветка и магнитная привязка | `findBestSnapTarget(worldPos, maxDist)`, `setDynamic360Surfaces()`, `setWallsVisible(bool)` | `SurfaceSnapResult \| null` (позиция + кватернион по нормали) |
| `src/modules/build_app_window_content.ts` | Фабрика UI-наполнения 6 приложений и процедурного 3D-узла | `appId`, `AppContentBuildActions` | `{ children, bindings, companionModel }` |
| `src/modules/manage_spatial_windows.ts` | Жизненный цикл окон, фокус, 4 раскладки (включая `ring360`), пин к поверхностям | `surfaceManager`, `interpolator`, `contentActions` | Управляемые `xb.UICard`, события изменения рабочего стола |
| `src/modules/handle_gesture_navigation.ts` | Преобразование жестов рук XR Blocks в команды среды | `GestureNavigationActions`, события `gesturestart`/`gestureend` | Вызовы действий раскладки, пина, стен и синхронизации |
| `src/modules/recognize_voice_commands.ts` | Голосовой распознаватель и чистый парсер команд RU/EN | Аудиопоток Web Speech API или `processCommandText(text)` | Структура `VoiceCommandAction` |
| `src/modules/handle_keyboard_mouse_input.ts` | Горячие клавиши и точное 3D-перемещение активного окна | `KeyboardMouseCallbacks` | Вызовы навигации и `attach()` / `detach()` |
| `src/modules/bridge_rokid_spatial_host.ts` | Мост протокола `rokid-spatial-host/v1` и IMU-телеметрия | `endpointUrl`, `sendPacket()`, `executeHostCommand()` | `RokidHostStatus`, ответы CLI-команд терминала |
| `src/modules/sync_spatial_studio_ecosystem.ts` | Экспорт/импорт и шина синхронизации `rokid-spatial-studio-xr/v1` | `WorkspaceEnvironmentState`, `ManagedSpatialWindow[]` | `StudioSceneManifest`, сохранение/загрузка состояния |
| `src/modules/render_performance_hud.ts` | Переключаемый ненавязчивый HUD (FPS, задержка, память, GPU) | `PerformanceSnapshot`, `WorkspaceEnvironmentState`, `initialVisible` | `UIOverlay` верхний-правый + `setVisible()` / `toggleVisible()` |
| `src/modules/guide_gesture_controls.ts` | Интерактивный 5-шаговый гид по жестам перемещения и масштаба | `GestureGuideActions`, `reportManipulation()`, `reportGesture()` | `UIOverlay` обучения с авто-зачётом шагов и демо-кнопками |
| `src/modules/select_voice_scene.ts` | NLU-разбор естественных фраз и голосовой селектор 10 сцен | `transcript`, `VoiceSceneSelectorActions` | `SceneVoiceMatchResult`, верхний-центральный `UIOverlay` выбора миров |
| `src/modules/render_gesture_hand_ghost.ts` | 3D-ретикл и голографический 21-суставный «Hand-Ghost» при жестах | `onManipulationEvent()`, `triggerGestureGhost()`, `XRHand` | Zero-GC 3D-ретикл + левый/правый `InstancedMesh` силуэты рук |
| `src/modules/edit_spatial_layouts.ts` | Редактор раскладок: сохранение/загрузка и профили `Development`/`Media`/`Comms` | `getWindows()`, `saveCurrentArrangement()`, `applyPresetById()` | `SavedLayoutPreset[]`, переключаемый `UIOverlay` редактора |
| `src/modules/synthesize_spatial_audio.ts` | 3D-аудиосистема на Web Audio API (`HRTF PannerNode` на окно) | `getWindows()`, `playSpatialPing()`, `setEnabled()`, `adjustVolume()` | Бинауральное L/R панорамирование, дистанционное затухание и телеметрия |
| `src/modules/adapt_camera_lighting.ts` | Адаптивное освещение сцены по потоку камеры Android и WebXR | `toggleEnabled()`, `cyclePreset()`, `setPlaceContext(place)` | Плавный ambient/key свет + `LightingEstimationSnapshot` (яркость, Кельвины) |
| `src/modules/mask_window_depth.ts` | Z-маскировка глубины и окклюзия 3D-окон за физическими объектами | `getWindows()`, `toggleDepthMask()`, `toggleSimulatedOccluder()` | `depthTest = true`, Z-препасс `DepthMesh` + список перекрытых окон |
| `src/modules/persist_window_workspace.ts` | Локальное автосохранение позиций, масштаба и открытых окон | `scheduleSave()`, `saveNow()`, `load()`, `clear()` | Автовосстановление `PersistedWorkspaceState` из `localStorage` |
| `src/modules/track_eye_focus_overlay.ts` | Оверлей отслеживания взгляда с 3D-рамкой фокуса и dwell-выбором | `getWindows()`, `onGazeDwellFocus(id)`, `toggle()` | 3D-уголки подсветки, `UIOverlay` `FOCUS` + `EyeFocusSnapshot` |
| `src/modules/track_camera_hands.ts` | Трекинг 21 сустава руки, щипков и жестов с веб-камеры (MediaPipe Vision) | `startCamera()`, `flipFacingMode()`, `cycleCameraDevice()`, `toggleSimStub()` | Живое 3D-превью `UICard`, мировые координаты 21 сустава, перемещение/масштаб/жесты |
| `src/modules/render_sbs_stereo.ts` | Одновременный Side-by-Side (L \| R) 3D стереорендеринг для Rokid SBS / Cardboard | `toggleSbs()`, `setAspectMode('half-sbs'\|'full-sbs')`, `setIpdMm(mm)` | Разделённый стерео-вьюпорт `THREE.StereoCamera` + оверлей-разделитель и `SbsStereoSnapshot` |
| `src/modules/manage_vr_headset.ts` | Поддержка VR-гарнитур (`immersive-vr`), контроллеры и стики | `enterVrHeadset()`, `setPreferredMode()`, `resolveHeadsetOptions()` | Запуск нативного `immersive-vr` (или VR-студии + SBS), управление окнами со стиков |
| `src/modules/manage_android_camera.ts` | Функционал камеры Android (`environment`/`user`/`camera-access`), линзы и снимки | `togglePanel()`, `flipFacingMode()`, `cycleCameraLens()`, `capturePhotoSnapshot()` | Spatial `xb.UICard` живого видео с камеры Android + `AndroidCameraSnapshot` |
| `src/modules/render_spatial_dock.ts` | Нижний 3D-док запуска приложений и view-space HUD | `SpatialDockActions`, `updateState(state, detail)` | Интерактивный `UICard` док + `UIOverlay` статуса |
| `src/modules/orchestrate_spatial_desktop.ts` | Главный оркестратор и связывание потоков данных между модулями | `options: xb.Options`, `headsetCaps?: HeadsetCapabilityReport` | Готовый `xb.Script` узел для `xb.add()` |

---

## Управление

### Клавиатура и мышь
- **Мышь / контроллер**: наведите на край любого 3D-окна, чтобы переместить его; потяните ближе к виртуальной стене, столу или любой из 8 круговых 360°-панелей — окно автоматически подсветит плоскость и примагнитится при отпускании.
- `1` – `6` — фокус на окне (`1`: Terminal, `2`: Notes, `3`: Debug Monitor, `4`: Studio, `5`: 3D Node, `6`: 10 Мест & 360° Экраны)
- `[` / `]` — предыдущее / следующее из 10 невероятных 360°-мест
- `B` — включить / отключить 360°-купол неба (оставляет прозрачный AR-фон с парящими 360°-экранами)
- `N` — показать / скрыть кольцо 360°-экранов
- `P` — прикрепить / открепить активное окно к ближайшей стене или 360°-панели
- `G` — показать / скрыть направляющие сетки виртуальных стен
- `L` — переключить раскладку (`Arc` → `Grid` → `Wall-Pinned` → `360° Ring`)
- `T` — переключить тему (`grayGlass` → `glimmer` → `glimmerGreen` → `colorful`)
- `V` — включить / выключить голосовой ввод
- `D` — показать / скрыть окно отладки и телеметрии
- `R` — переключить оптический профиль (`Standard WebXR` → `Rokid Max AR` → `Rokid Max 3D SBS`)
- `M` — показать / скрыть ненавязчивый HUD производительности (FPS, задержка, память)
- `K` — открыть / скрыть редактор раскладок (Workflow-профили + Save/Load)
- `U` — включить / выключить пространственное 3D-аудио (Web Audio API HRTF)
- `I` / `Alt + I` — включить / выключить адаптивное освещение камеры / переключить тон (`auto`, `daylight`, `warm`, `night`)
- `X` / `Alt + X` — включить / выключить Z-маскировку глубины окон / показать тестовый 3D-окклюдер
- `F` — включить / выключить оверлей отслеживания взгляда (`Eye-Tracking Focus`)
- `J` / `Alt + J` — старт/стоп камерного трекинга рук и жестов / переключить Фронт ↔ Тыл камеру
- `Y` / `Alt + Y` — включить / выключить Side-by-Side 3D (`SBS`) / переключить `Half-SBS ↔ Full-SBS` и IPD
- `Z` — запустить нативную сессию VR-гарнитуры (`immersive-vr`) или VR-студию + SBS 3D
- `O` / `Alt + O` — открыть / скрыть панель камеры Android XR / сделать снимок кадра
- `C` — открыть / скрыть голосовой селектор 10 виртуальных сцен
- `?` (`/`) — открыть / скрыть интерактивный гид по жестам и управлению окнами
- `H` — скрыть / показать нижний док (Zen Mode)
- `Alt + Стрелки` (и `Alt + Shift + Вверх/Вниз` или `Alt + Колесо мыши`) — точный сдвиг активного окна по осям X/Y/Z
- `Alt + +` / `Alt + -` — изменить масштаб активного окна с клавиатуры

### Жесты рук (XR / Pose Simulator / Камера рук)
- `open-palm` / `spread` — выстроить окна в эргономичную дугу (`Arc`)
- `fist` — закрепить / открепить активное окно на поверхности
- `thumbs-up` — сохранить и синхронизировать сцену в `rokid-spatial-studio-xr`
- `thumbs-down` — показать / скрыть виртуальные стены
- `victory` — перейти к следующему из 10 невероятных 360°-мест
- `point` + щипок (`pinch`) — наведение, перетаскивание окон и двухручное масштабирование

### Голосовые команды (RU / EN)
Скажите в микрофон (кнопка `Голос (V)`) или введите в окне **Terminal** через префикс `voice <фраза>` (например, `voice 360` или `voice марс`):
- `arc` / `дуга` — раскладка дугой
- `grid` / `сетка` — раскладка сеткой
- `wall layout` / `на стены` — прикрепить все окна к стенам
- `360` / `круг` / `вокруг` — раскладка `360° Ring` (все окна по окружности)
- `следующее место` / `next place` и `предыдущее место` / `prev place` — листание 10 локаций
- Названия мест на естественном языке (EN / RU): `Office` / `офис` / `токио`, `Space Station` / `космос` / `орбита`, `Ocean` / `подводный` / `бездна`, `Cave` / `пещера` / `кристалл`, `Mountain` / `горы` / `облака`, `Mars` / `марс`, `Forest` / `лес` / `пандора`, `Quantum` / `квант`, `Arctic` / `арктика` / `сияние`, `Synthwave` / `синтвейв` / `ретро`, либо по номеру (`"switch to scene 5"`, `"включи место два"`)
- `scene selector` / `выбор сцен` и `close scene selector` / `закрой сцены` — открыть или закрыть голосовой селектор 10 сцен
- `layout editor` / `редактор раскладок` / `макеты` — открыть или закрыть редактор раскладок
- `development` / `разработка`, `media` / `медиа`, `communication` / `общение` — переключить рабочий профиль окон
- `save layout` / `сохрани раскладку` — сохранить текущее 3D-расположение окон
- `audio` / `звук` / `аудио` — включить / выключить пространственное 3D-аудио
- `lighting` / `освещение` и `light preset` / `тон света` — адаптивный свет с камеры и переключение пресетов
- `depth mask` / `маска глубины` / `окклюзия` и `occluder` / `преграда` — Z-маскировка и тестовый физический 3D-окклюдер
- `eye track` / `gaze` / `взгляд` — включить / выключить оверлей отслеживания взгляда
- `sbs` / `стерео` / `3d mode`, `full sbs` / `полный sbs`, `half sbs` / `половина sbs` — управление Side-by-Side 3D режимом
- `vr headset` / `вр шлем` / `очки vr` — запуск режима VR-гарнитуры (`immersive-vr`)
- `android camera` / `камера android` и `snapshot` / `сделай фото` / `снимок` — открыть панель камеры Android и сделать фото-снимок
- `купол` / `sky` — вкл/выкл 360°-купола неба
- `экраны` / `360 screens` — вкл/выкл кольца 360°-экранов
- `pin` / `закрепи` / `unpin` / `открепи` — привязка или отвязка (к окну под взглядом или активному)
- `walls` / `стены` — переключить видимость виртуальных стен
- `glimmer` / `glass` / `colorful` — переключение темы
- `rokid` — смена профиля оптики Rokid Max
- `ar` / `vr` — переключение режима фона AR ↔ VR
- `debug` / `отладка` — показать / скрыть окно логов и FPS
- `hud` / `метрики` / `фпс` / `память` — переключить HUD производительности
- `guide` / `гид` / `помощь` / `обучение` — открыть / скрыть гид по жестам
- `terminal`, `notes`, `telemetry`, `studio`, `3d`, `places` / `места` — фокус на соответствующем приложении
- `reset` / `сброс` — сброс рабочего пространства

### Команды терминала (`Spatial Host Terminal`)
Помимо CLI-команд моста (`help`, `status`, `imu`, `optics ar|sbs|std`, `studio sync`, `voice <фраза>`), поддерживаются команды мест и оверлеев:
- `places` — вывести каталог всех 10 локаций с индексами
- `place <1..10 | id>` — мгновенно перейти в указанное место (например, `place 6` или `place quantum-nexus`)
- `scenes` — открыть / закрыть голосовой селектор 10 виртуальных сцен
- `layouts` — открыть / закрыть редактор раскладок
- `workflow <dev | media | comms>` — мгновенно активировать рабочий профиль
- `save layout <имя>` — сохранить текущую 3D-раскладку окон
- `audio` — включить / выключить пространственное 3D-аудио
- `light` / `light preset` — адаптивное освещение камеры и перебор тона (`auto`, `daylight`, `warm`, `night`)
- `depth` / `occluder` — Z-маскировка глубины окон / показать тестовый 3D-окклюдер
- `gaze` — включить / выключить оверлей отслеживания взгляда (`Eye-Tracking Focus`)
- `camhand` / `camhand start` / `camhand stop` / `camhand flip` / `camhand sim` / `camhand panel` — управление трекингом рук с камеры и режимом симуляции
- `sbs` / `sbs full` / `sbs half` / `sbs ipd <52..76>` — включение и настройка Side-by-Side 3D рендера
- `vr` / `vr enter` / `vr ar` / `vr auto` — запуск VR-гарнитуры и выбор предпочтительного WebXR режима
- `cam` / `cam flip` / `cam next` / `cam snap` — панель камеры Android, смена Тыл/Фронт, перебор линз и снимок
- `save state` / `clear state` — вручную сохранить или сбросить локальную конфигурацию позиций окон
- `hud` — показать / скрыть HUD метрик (FPS, Latency, Memory)
- `guide` — открыть / скрыть интерактивный гид по жестам

---

## Заглушки (Stubs) и замена в продакшне

В коде явно отмечены комментарием `ЗАГЛУШКА (STUB)` следующие места, обеспечивающие автономную работу в браузере без физического оборудования:

1. **`src/modules/bridge_rokid_spatial_host.ts` (`connect` и `sampleImuFromCameraYawPitch`)**:
   - *Что заглушает*: транспорт к нативному демону `rokid-spatial-host` (`ws://127.0.0.1:8765`) и чтение 3DoF IMU-датчиков очков Rokid Max по USB-HID (VID `0x04D2`). Сейчас используется `BroadcastChannel('rokid-spatial-host-bus')` и углы активной камеры WebXR.
   - *Чем заменить в продакшне*: запустите локальный демон `rokid-spatial-host` и вызовите `rokidBridge.connect(true)`, либо подключите WebHID API (`navigator.hid.requestDevice({ filters: [{ vendorId: 0x04d2 }] })`) для прямого чтения 64-байтных IMU-пакетов на 200–1000 Гц.

2. **`src/modules/configure_xr_workspace.ts` (`ROKID_OPTICS_PROFILES['rokid-max-sbs']`)**:
   - *Что заглушает*: аппаратное переключение контроллера дисплея Rokid Max в режим `3840×1080` Side-by-Side 3D по кабелю DisplayPort Alt-Mode. В браузере используется симуляция стерео и диммирования XR Blocks.
   - *Чем заменить в продакшне*: отправляйте команду переключения EDID/SBS в `rokid-spatial-host` при выборе режима `rokid-max-sbs`.

3. **`src/modules/sync_spatial_studio_ecosystem.ts` (`saveAndPublish`)**:
   - *Что заглушает*: серверное API экосистемы `rokid-spatial-studio-xr`. Сейчас манифест сцены сохраняется в `localStorage` и рассылается локально через `BroadcastChannel`.
   - *Чем заменить в продакшне*: добавьте `fetch('/api/studio/scenes/sync', { method: 'POST', ... })` или WebSocket-синхронизацию с бэкендом Spatial Studio.

4. **`src/modules/recognize_voice_commands.ts`**:
   - *Что заглушает*: офлайн-модель распознавания речи при отсутствии браузерного `SpeechRecognition`.
   - *Чем заменить в продакшне*: подключите локальный WASM-движок (Whisper / Sherpa-ONNX) и передавайте итоговую строку в `parseVoiceTranscript()`.

5. **`src/modules/build_app_window_content.ts` (`notes` и `viewport3d`)**:
   - *Что заглушает*: облачное/файловое хранилище заметок (сейчас `localStorage`) и внешний каталог `.glb`-моделей (сейчас процедурная PBR-модель Rokid Spatial Node для исключения 404-ошибок).
   - *Чем заменить в продакшне*: подключите чтение/запись файлов через `rokid-spatial-host` и загрузчик `modelViewer.load({ url })` для пользовательских 3D-ассетов.

6. **`src/modules/build_360_screens_and_panels.ts` (`build360ScreensAndPanels`)**:
   - *Что заглушает*: видеопотоки и внешние дисплеи на изогнутых 360°-экранах (сейчас процедурные высокочёткие Canvas2D-текстуры с радарами, спектрами, орбитами, осциллограммами и сонарами без внешних запросов).
   - *Чем заменить в продакшне*: подавайте на материалы экранов `THREE.VideoTexture`, WebRTC / HLS-потоки панорамных камер, или захваты реальных окон/мониторов из `rokid-spatial-host` и `navigator.mediaDevices.getDisplayMedia()`.

7. **`src/modules/generate_incredible_places.ts` (`IncrediblePlacesManager`)**:
   - *Что заглушает*: фотореалистичные 360°-панорамы и Gaussian Splats (сейчас процедурный GLSL-шейдер неба, `InstancedMesh`-частицы и композитная 3D-геометрия).
   - *Чем заменить в продакшне*: загружайте 8K эквиректангулярные карты (`.exr` / `.webp`) через `RGBELoader` / `TextureLoader` или сцены `.spz` через встроенный `@sparkjsdev/spark`.

8. **`src/modules/monitor_performance_and_logs.ts` и `src/modules/render_performance_hud.ts`**:
   - *Что заглушает*: системную телеметрию памяти и VRAM (в браузерах без `performance.memory` JS-куча недоступна и отображаются счётчики WebGL `geometries`/`textures`).
   - *Чем заменить в продакшне*: получайте точные данные RSS-памяти процесса, VRAM и температуры очков от демона `rokid-spatial-host` через пакеты `TELEMETRY_PING`.

9. **`src/modules/guide_gesture_controls.ts`**:
   - *Что заглушает*: локальное хранение статуса прохождения онбординга (`localStorage`).
   - *Чем заменить в продакшне*: сохраняйте прогресс обучения в профиле пользователя `rokid-spatial-studio-xr`.

10. **`src/modules/select_voice_scene.ts` (`matchNaturalLanguageScene`)**:
    - *Что заглушает*: облачный LLM-маршрутизатор естественного языка (NLU). Сейчас сопоставление фраз работает локально по словарю синонимов `SCENE_VOICE_ALIASES` и номерам сцен с нулевой задержкой.
    - *Чем заменить в продакшне*: для сложных описательных запросов («хочу тихое место с полярным сиянием») подключите `xb.ai.query` / Gemini Function Calling с фоллбеком на `matchNaturalLanguageScene()`.

11. **`src/modules/render_gesture_hand_ghost.ts` (`populateProceduralHandPose`)**:
    - *Что заглушает*: скелетные координаты 21 сустава руки, когда приложение запущено на десктопе или с контроллерами без активного WebXR Hand Tracking (`xb.core.user.hands.getJoint`).
    - *Чем заменить в продакшне*: на устройствах Android XR / Rokid Max с оптическим трекингом рук модуль автоматически считывает реальные `XRJointSpace` суставы, либо может принимать 6DoF-поток из OpenXR Hand Tracking через `rokid-spatial-host`.

12. **`src/modules/edit_spatial_layouts.ts` (`loadCustomPresetsFromStorage` / `persistCustomPresetsToStorage`)**:
    - *Что заглушает*: серверное хранилище пользовательских раскладок. Сейчас пользовательские композиции сохраняются в `localStorage` под ключом `rokid_spatial_custom_layouts_v1`.
    - *Чем заменить в продакшне*: синхронизируйте массив `SavedLayoutPreset[]` с REST/WebSocket API сервера `rokid-spatial-studio-xr` (`/api/studio/layouts`).

13. **`src/modules/synthesize_spatial_audio.ts` (`buildAllWindowChannels`)**:
    - *Что заглушает*: реальные медиапотоки и системный звук приложений (без внешних `.mp3`/`.wav` файлов). Для каждого окна генерируется индивидуальный процедурный тембр через `OscillatorNode` + `BiquadFilterNode` + LFO, подаваемый на реальный 3D `PannerNode` (`HRTF`).
    - *Чем заменить в продакшне*: подключайте к тем же `PannerNode` узлам реальные потоки через `audioCtx.createMediaElementSource(videoEl)` (для `Media Consumption`), `audioCtx.createMediaStreamSource(rtcStream)` (для звонков в `Communication`) или системный аудиопоток от `rokid-spatial-host`.

14. **`src/modules/adapt_camera_lighting.ts` (`applyStubEstimatorFromPlace`)**:
    - *Что заглушает*: аппаратный сенсор освещённости и камеру Android, когда приложение запущено в браузере без камеры (`no_devices_found` / запрещён доступ к камере). В таком режиме тон и яркость рассчитываются от активной 360°-сцены или пресетов `daylight`/`warm`/`night`.
    - *Чем заменить в продакшне*: при наличии реальной камеры Android (`facingMode: 'environment'`) модуль автоматически анализирует живые кадры `xb.core.deviceCamera.getSnapshot()` и WebXR Spherical Harmonics (`xb.core.lighting`).

15. **`src/modules/mask_window_depth.ts` (`buildSimulatedPhysicalOccluder`)**:
    - *Что заглушает*: физические препятствия реальной комнаты на десктопе без активного AR-сенсора глубины. Симулированный 3D-окклюдер (колонна и подставка) позволяет сразу увидеть, как окна заходят за реальные объекты и перекрываются ими.
    - *Чем заменить в продакшне*: на Android XR с WebXR Depth API модуль автоматически настраивает реальный `xb.core.depth.depthMesh` в режим Z-Mask и подключает `xb.OcclusionUtils.addOcclusionToMaterial` к материалам окон.

16. **`src/modules/persist_window_workspace.ts` (`WorkspaceLocalStorageManager`)**:
    - *Что заглушает*: облачный профиль рабочего пространства пользователя. Текущие координаты, кватернионы, масштаб, видимость и пины всех окон сохраняются локально в `localStorage` (`rokid_spatial_workspace_state_v2`).
    - *Чем заменить в продакшне*: замените реализацию `saveNow` / `load` на IndexedDB или серверное сохранение профилей `rokid-spatial-studio-xr` / локальную БД через `rokid-spatial-host`.

17. **`src/modules/track_eye_focus_overlay.ts` (`resolveGazeRay`)**:
    - *Что заглушает*: аппаратный айтрекер (Eye Tracker) на десктопе или в симуляторе, где отсутствует WebXR `targetRayMode === 'gaze'` — в этом случае используется фовеальный луч центра камеры (`xb.core.camera`).
    - *Чем заменить в продакшне*: при наличии WebXR Eye Gaze сессии модуль автоматически переключается на `source.targetRaySpace`, либо может принимать 3D-вектор взгляда от нативного SDK гарнитуры через `rokid-spatial-host`.

18. **`src/modules/track_camera_hands.ts` (`stepSimulationStub` и CDN-пути WASM/модели)**:
    - *Что заглушает*: отсутствие физической веб-камеры / запрещённые права `getUserMedia` (режим `Демо-рука (Stub)` рисует процедурную анимацию 21 сустава руки, щипков и жестов прямо на превью-холсте и в 3D Hand-Ghost), а также удалённую загрузку WASM и `.task`-модели MediaPipe с CDN.
    - *Чем заменить в продакшне*: разрешите доступ к физической веб-камере (фронтальной `user` или тыловой `environment`), а для полностью офлайн-окружения разместите локальные файлы MediaPipe (`wasm/` и `gesture_recognizer.task`) в `public/mediapipe/` и передайте их URL в параметры `wasmBasePath` и `modelAssetPath`.

19. **`src/modules/render_sbs_stereo.ts` (`renderSceneCallback`)**:
    - *Что заглушает*: аппаратную предисторсию линз Брауна–Конради (k1, k2) для дешёвых пластиковых держателей без собственного системного композитора; сейчас рендерится чистое прямоугольное деление L | R (`setViewport` / `setScissor`), оптимальное для Rokid Max 3D SBS и Cardboard-профилей с коррекцией на уровне оптической матрицы.
    - *Чем заменить в продакшне*: добавьте постобработку с шейдером бочкообразной дисторсии для левой/правой половин рендер-таргета и триггер EDID `3840×1080` через `rokid-spatial-host`.

20. **`src/modules/manage_vr_headset.ts` (`enterVrHeadset`)**:
    - *Что заглушает*: поведение на десктопе или в браузере без активного драйвера VR-гарнитуры (`immersive-vr` не поддерживается) — вместо сбоя или `window.alert` сцена переходит в VR-студию с 360°-куполом и автоматически включает режим SBS 3D.
    - *Чем заменить в продакшне*: при открытии в Meta Quest Browser, PICO Browser, SteamVR или Android XR модуль автоматически вызывает `navigator.xr.requestSession('immersive-vr', ...)` и считывает оси стиков реальных 6DoF-контроллеров.

21. **`src/modules/manage_android_camera.ts` (`drawStubFeed`)**:
    - *Что заглушает*: видеопоток камеры на десктопе/headless-среде без камеры (`no_devices_found` / отказ в доступе): рисует диагностический радарный тест-паттерн пастру Android XR, чтобы интерфейс предпросмотра и снимков оставался проверяемым.
    - *Чем заменить в продакшне*: на Android-устройстве или в Android XR разрешите доступ к камере — `xb.core.deviceCamera` автоматически подключит тыловую/фронтальную камеру (`environment`/`user`) или WebXR Raw Camera Access (`camera-access`).
