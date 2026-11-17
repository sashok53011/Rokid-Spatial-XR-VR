import * as THREE from 'three';

import type {
  SpatialPlaceSpec,
  VirtualSurfaceDescriptor,
} from '../types/spatial_contracts.ts';

/**
 * ============================================================================
 * МОДУЛЬ: build_360_screens_and_panels.ts (360° экраны и панорамные панели)
 * ============================================================================
 * НАЗНАЧЕНИЕ:
 *   Генерирует изогнутые 360-градусные панорамные экраны вокруг пользователя
 *   с процедурными дисплеями высокой чёткости (Zero-404 CanvasTexture), а также
 *   формирует набор 360-градусных виртуальных панелей для привязки окон
 *   рабочего стола по всей окружности (0°..360°).
 *
 * ВХОДНЫЕ ДАННЫЕ:
 *   - `place`: спецификация текущей локации `SpatialPlaceSpec` (количество
 *     экранов `screenCount360`, радиус `screenRadiusMeters`, цвета, темы).
 *   - `panelRadiusMeters`: радиус кольца привязки окон (по умолчанию 1.95 м).
 *   - `panelCount`: число панелей по кругу (по умолчанию 8 — каждые 45°).
 *
 * ВЫХОДНЫЕ ДАННЫЕ:
 *   - `screensGroup`: `THREE.Group` с изогнутыми 360°-экранами для добавления в сцену.
 *   - `panoramicSurfaces`: массив `VirtualSurfaceDescriptor[]` для передачи в
 *     `VirtualSurfaceManager`.
 *   - `dispose()`: освобождение всех геометрий, материалов и CanvasTexture.
 *
 * КАК ПОЛЬЗОВАТЬСЯ:
 *   const ring = build360ScreensAndPanels(placeSpec);
 *   sceneGroup.add(ring.screensGroup);
 *   surfaceManager.setDynamic360Surfaces(ring.panoramicSurfaces);
 *   // В цикле update(elapsed):
 *   ring.animate(elapsed);
 *   // При смене локации:
 *   ring.dispose();
 *
 * ЗАГЛУШКИ (STUB) И ЗАМЕНА В ПРОДАКШНЕ:
 *   - Изображения на 360°-экранах генерируются процедурно на Canvas2D
 *     (радары, спектры, карты орбит, осциллограммы, сонары, метрики).
 *   - КАК ЗАМЕНИТЬ В ПРОДАКШНЕ: подавайте на материал `THREE.VideoTexture`
 *     или `WebRTC` / HLS-поток реальных панорамных камер, потоковых экранов
 *     `rokid-spatial-host` или рабочих мониторов пользователя (Desktop Capture API).
 * ============================================================================
 */

export interface Screens360Bundle {
  readonly screensGroup: THREE.Group;
  readonly panoramicSurfaces: readonly VirtualSurfaceDescriptor[];
  readonly animate: (elapsedSeconds: number) => void;
  readonly setVisible: (visible: boolean) => void;
  readonly dispose: () => void;
}

const SCREEN_Y_CENTER = 1.92;
const PANEL_Y_CENTER = 1.48;

export function build360ScreensAndPanels(
  place: SpatialPlaceSpec,
  panelRadiusMeters = 1.95,
  panelCount = 8
): Screens360Bundle {
  const screensGroup = new THREE.Group();
  screensGroup.name = `Panoramic360Screens_${place.id}`;
  screensGroup.xb = {pointerEvents: 'none'};

  const disposables: Array<{dispose: () => void}> = [];
  const animatedMaterials: THREE.MeshBasicMaterial[] = [];

  const screenCount = Math.max(4, place.screenCount360);
  const radius = place.screenRadiusMeters;
  const arcGap = 0.09;
  const fullArc = (Math.PI * 2) / screenCount;
  const thetaLength = Math.max(0.25, fullArc - arcGap);
  const screenHeight = 1.32;

  // Верхнее и нижнее световое кольцо 360° панорамы.
  const ringGeo = new THREE.TorusGeometry(radius + 0.04, 0.014, 12, 96);
  const ringMat = new THREE.MeshStandardMaterial({
    color: place.accentHex,
    emissive: place.accentHex,
    emissiveIntensity: 0.75,
    metalness: 0.7,
    roughness: 0.25,
    transparent: true,
    opacity: 0.65,
  });
  disposables.push(ringGeo, ringMat);

  const topRing = new THREE.Mesh(ringGeo, ringMat);
  topRing.rotation.x = Math.PI / 2;
  topRing.position.y = SCREEN_Y_CENTER + screenHeight * 0.5 + 0.04;
  topRing.xb = {pointerEvents: 'none'};

  const bottomRing = new THREE.Mesh(ringGeo, ringMat);
  bottomRing.rotation.x = Math.PI / 2;
  bottomRing.position.y = SCREEN_Y_CENTER - screenHeight * 0.5 - 0.04;
  bottomRing.xb = {pointerEvents: 'none'};

  screensGroup.add(topRing, bottomRing);

  // Создаём изогнутые экраны по всей окружности 360°.
  for (let i = 0; i < screenCount; i++) {
    const thetaStart = i * fullArc + arcGap * 0.5;
    const screenGeo = new THREE.CylinderGeometry(
      radius,
      radius,
      screenHeight,
      20,
      1,
      true,
      thetaStart,
      thetaLength
    );
    // Инвертируем горизонтальную развёртку, чтобы текст читался изнутри 360°-кольца.
    screenGeo.scale(-1, 1, 1);

    const themeTitle =
      place.screenThemes[i % place.screenThemes.length] ??
      `360° PANEL ${i + 1}`;
    const texture = createProceduralScreenTexture(
      place,
      i,
      themeTitle
    );

    const screenMat = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0.86,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    const screenMesh = new THREE.Mesh(screenGeo, screenMat);
    screenMesh.position.y = SCREEN_Y_CENTER;
    screenMesh.xb = {pointerEvents: 'none'};

    // Внешняя тонкая рамка за экраном.
    const frameGeo = new THREE.CylinderGeometry(
      radius + 0.03,
      radius + 0.03,
      screenHeight + 0.04,
      16,
      1,
      true,
      thetaStart,
      thetaLength
    );
    const frameMat = new THREE.MeshBasicMaterial({
      color: i % 2 === 0 ? place.accentHex : place.secondaryHex,
      wireframe: true,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
    });
    const frameMesh = new THREE.Mesh(frameGeo, frameMat);
    frameMesh.position.y = SCREEN_Y_CENTER;
    frameMesh.xb = {pointerEvents: 'none'};

    screensGroup.add(screenMesh, frameMesh);
    animatedMaterials.push(screenMat);
    disposables.push(screenGeo, texture, screenMat, frameGeo, frameMat);
  }

  // Генерируем 8 (или N) виртуальных поверхностей привязки на 360° вокруг пользователя.
  const panoramicSurfaces: VirtualSurfaceDescriptor[] = [];
  const sectorNames = [
    'Передняя 360° панель (0°)',
    'Право-передняя 360° панель (45°)',
    'Правая 360° панель (90°)',
    'Право-задняя 360° панель (135°)',
    'Задняя 360° панель (180°)',
    'Лево-задняя 360° панель (225°)',
    'Левая 360° панель (270°)',
    'Лево-передняя 360° панель (315°)',
  ];

  for (let i = 0; i < panelCount; i++) {
    const angle = (i / panelCount) * Math.PI * 2;
    const x = Math.sin(angle) * panelRadiusMeters;
    const z = -Math.cos(angle) * panelRadiusMeters;
    const center = new THREE.Vector3(x, PANEL_Y_CENTER, z);
    const euler = new THREE.Euler(0, -angle, 0);
    const quaternion = new THREE.Quaternion().setFromEuler(euler);
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion);

    panoramicSurfaces.push({
      id: `ring360-${i}`,
      title: sectorNames[i] ?? `360° Панель #${i + 1}`,
      kind: 'panoramic360',
      widthMeters: 1.35,
      heightMeters: 1.25,
      center,
      normal,
      quaternion,
    });
  }

  return {
    screensGroup,
    panoramicSurfaces,
    animate: (elapsedSeconds: number) => {
      for (let i = 0; i < animatedMaterials.length; i++) {
        animatedMaterials[i].opacity =
          0.78 + 0.1 * Math.sin(elapsedSeconds * 1.4 + i * 0.9);
      }
      topRing.rotation.z = elapsedSeconds * 0.05;
      bottomRing.rotation.z = -elapsedSeconds * 0.05;
    },
    setVisible: (visible: boolean) => {
      screensGroup.visible = visible;
    },
    dispose: () => {
      screensGroup.removeFromParent();
      for (const item of disposables) {
        item.dispose();
      }
    },
  };
}

function createProceduralScreenTexture(
  place: SpatialPlaceSpec,
  index: number,
  themeTitle: string
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 768;
  canvas.height = 384;
  const ctx = canvas.getContext('2d')!;

  const accentColor = `#${place.accentHex.toString(16).padStart(6, '0')}`;
  const secondaryColor = `#${place.secondaryHex.toString(16).padStart(6, '0')}`;

  // Полупрозрачный градиентный фон дисплея.
  const bg = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  bg.addColorStop(0, 'rgba(7, 12, 24, 0.88)');
  bg.addColorStop(0.5, 'rgba(13, 22, 42, 0.78)');
  bg.addColorStop(1, 'rgba(7, 12, 24, 0.88)');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Сетка телеметрии.
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= canvas.width; x += 48) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }
  for (let y = 0; y <= canvas.height; y += 48) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }

  // Рамка и уголки HUD.
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 4;
  ctx.strokeRect(10, 10, canvas.width - 20, canvas.height - 20);

  // Заголовок панели.
  ctx.fillStyle = accentColor;
  ctx.font = 'bold 26px "Segoe UI", Roboto, sans-serif';
  ctx.fillText(themeTitle.toUpperCase(), 32, 54);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.font = '18px monospace';
  ctx.fillText(
    `${place.title}  |  CH-${String(index + 1).padStart(2, '0')}  |  360° STREAM`,
    32,
    84
  );

  // Разные типы визуализации в зависимости от номера экрана (радар, спектр, орбита, график).
  const mode = index % 4;
  if (mode === 0) {
    // Спектральный эквалайзер.
    const barCount = 26;
    const barW = 20;
    for (let b = 0; b < barCount; b++) {
      const h =
        40 +
        Math.abs(Math.sin(b * 0.55 + index)) * 155 +
        Math.cos(b * 0.3) * 30;
      ctx.fillStyle = b % 2 === 0 ? accentColor : secondaryColor;
      ctx.fillRect(36 + b * 27, 330 - h, barW, h);
    }
  } else if (mode === 1) {
    // Круговой радар / орбитальная карта.
    const cx = 210;
    const cy = 225;
    for (let r = 34; r <= 112; r += 26) {
      ctx.strokeStyle = r === 112 ? accentColor : 'rgba(255,255,255,0.28)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = secondaryColor;
    for (let p = 0; p < 6; p++) {
      const ang = p * 1.1 + index;
      const dist = 35 + p * 13;
      ctx.beginPath();
      ctx.arc(
        cx + Math.cos(ang) * dist,
        cy + Math.sin(ang) * dist,
        6,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '20px monospace';
    ctx.fillText(`SECTOR AZIMUTH: ${index * 45}°`, 370, 175);
    ctx.fillText(`SYNC RATE: 90.0 Hz`, 370, 215);
    ctx.fillText(`SIGNAL: OPTIMAL`, 370, 255);
    ctx.fillStyle = accentColor;
    ctx.fillText(`ROKID SPATIAL BUS: OK`, 370, 295);
  } else if (mode === 2) {
    // Многоканальная осциллограмма.
    ctx.lineWidth = 3;
    for (let wave = 0; wave < 3; wave++) {
      ctx.strokeStyle = wave === 1 ? secondaryColor : accentColor;
      ctx.beginPath();
      for (let x = 32; x <= canvas.width - 32; x += 8) {
        const y =
          185 +
          wave * 42 +
          Math.sin(x * 0.025 + wave * 1.4 + index) * 32 * Math.cos(x * 0.008);
        if (x === 32) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  } else {
    // Карточки пространственной телеметрии.
    for (let card = 0; card < 3; card++) {
      const x = 32 + card * 238;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
      ctx.fillRect(x, 120, 218, 200);
      ctx.strokeStyle = card === 1 ? secondaryColor : accentColor;
      ctx.lineWidth = 2;
      ctx.strokeRect(x, 120, 218, 200);

      ctx.fillStyle = accentColor;
      ctx.font = 'bold 42px sans-serif';
      ctx.fillText(`${72 + ((index * 7 + card * 13) % 27)}%`, x + 22, 195);

      ctx.fillStyle = '#f8fafc';
      ctx.font = '18px sans-serif';
      ctx.fillText(`NODE 0${card + 1} ACTIVE`, x + 22, 245);
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillText(`360° ANCHOR READY`, x + 22, 280);
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}
