import * as THREE from 'three';
import * as xb from 'xrblocks';

import type {
  CameraHandFrameData,
  SpatialManipulationKind,
} from '../types/spatial_contracts.ts';

/**
 * ============================================================================
 * МОДУЛЬ: render_gesture_hand_ghost.ts (Голографический Hand-Ghost и ретикл)
 * ============================================================================
 * НАЗНАНИЕ:
 *   Обеспечивает мгновенную 3D-обратную связь при выполнении жестов рук и
 *   манипуляциях с окнами (перемещение, масштабирование, поворот, привязка):
 *   1. **Пространственный ретикл (`Spatial Gesture Reticle`)**: многослойное
 *      голографическое кольцо с вращающейся шкалой, прицельными рисками и
 *      индикатором типа действия (бирюзовый — перемещение, янтарный — масштаб,
 *      изумрудный — привязка/кулак, фиолетовый — ладонь/раскладка).
 *   2. **Голографический «Hand-Ghost» (21 сустав + костные связи)**:
 *      полупрозрачный силуэт руки из `InstancedMesh` узлов и сегментов костей
 *      + ядро ладони. При активном двухручном масштабировании отображаются
 *      сразу ДВА «призрака» рук и связующий вектор масштаба!
 *   - Весь корень отмечен `xb = { pointerEvents: 'none' }`, `depthWrite: false`,
 *     поэтому эффект никогда не перехватывает клики и лучи окон.
 *   - Все обновления в `update()` выполняются без аллокаций памяти (Zero-GC).
 *
 * ВХОДНЫЕ ДАННЫЕ:
 *   - `onManipulationEvent(phase, kind, targetObj, anchorWorldPos)`: живой вызов
 *     из менеджера окон во время перетаскивания или масштабирования.
 *   - `triggerGestureGhost(hand, gestureName, anchorWorldPos?)`: визуализация
 *     распознанного или симулированного жеста руки.
 *   - `setEnabled(enabled)`: включение/выключение эффекта.
 *
 * ВЫХОДНЫЕ ДАННЫЕ:
 *   - `xb.Script` узел с синхронизированной 3D-визуализацией в пространстве.
 *
 * КАК ПОЛЬЗОВАТЬСЯ:
 *   const handGhost = new GestureHandGhostController({
 *     onLog: (msg) => monitor.log('DEBUG', 'GESTURE', msg),
 *   });
 *   this.add(handGhost);
 *   // При манипуляции окном:
 *   handGhost.onManipulationEvent('update', 'scale', card, worldPoint);
 *
 * ЗАГЛУШКИ (STUB) И ЗАМЕНА В ПРОДАКШНЕ:
 *   - В среде WebXR с активным трекингом рук `xb.core.user.hands` считываются
 *     реальные мировые координаты 21 сустава руки.
 *   - ЗАГЛУШКА ДЛЯ ДЕСКТОПА / КОНТРОЛЛЕРА: когда реальные суставы `XRHand`
 *     отсутствуют (мышь, контроллер или симуляция жестов), модуль строит
 *     процедурную кинематическую позу 21 сустава (`pinch`, `fist`, `open-palm`,
 *     `thumbs-up`, `thumbs-down`, `scale`) рядом с точкой манипуляции окна.
 *   - КАК ЗАМЕНИТЬ В ПРОДАКШНЕ: подключайте реальные скелетные данные
 *     `XRHandSpace.joints` на Android XR / Rokid Max или поток OpenXR Hand Tracking.
 * ============================================================================
 */

export type GhostPoseName =
  | 'pinch'
  | 'open-palm'
  | 'fist'
  | 'thumbs-up'
  | 'thumbs-down'
  | 'point'
  | 'victory'
  | 'scale';

export interface GestureHandGhostConfig {
  readonly enabled?: boolean;
  readonly onLog?: (message: string) => void;
}

const JOINT_COUNT = 21;

// 20 соединительных отрезков скелета кисти для InstancedMesh костей.
const BONE_PAIRS: readonly [number, number][] = [
  // Большой палец (0 -> 1 -> 2 -> 3 -> 4)
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  // Указательный (0 -> 5 -> 6 -> 7 -> 8)
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  // Средний (0 -> 9 -> 10 -> 11 -> 12)
  [0, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  // Безымянный (0 -> 13 -> 14 -> 15 -> 16)
  [0, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  // Мизинец (0 -> 17 -> 18 -> 19 -> 20)
  [0, 17],
  [17, 18],
  [18, 19],
  [19, 20],
];

const XR_JOINT_NAMES: readonly XRHandJoint[] = [
  'wrist',
  'thumb-metacarpal',
  'thumb-phalanx-proximal',
  'thumb-phalanx-distal',
  'thumb-tip',
  'index-finger-metacarpal',
  'index-finger-phalanx-proximal',
  'index-finger-phalanx-intermediate',
  'index-finger-tip',
  'middle-finger-metacarpal',
  'middle-finger-phalanx-proximal',
  'middle-finger-phalanx-intermediate',
  'middle-finger-tip',
  'ring-finger-metacarpal',
  'ring-finger-phalanx-proximal',
  'ring-finger-phalanx-intermediate',
  'ring-finger-tip',
  'pinky-finger-metacarpal',
  'pinky-finger-phalanx-proximal',
  'pinky-finger-phalanx-intermediate',
  'pinky-finger-tip',
];

const COLOR_MOVE = new THREE.Color(0x38bdf8);
const COLOR_SCALE = new THREE.Color(0xfbbf24);
const COLOR_PIN = new THREE.Color(0x4ade80);
const COLOR_NAV = new THREE.Color(0xc084fc);

// Предвыделенные временные объекты для Zero-GC обновлений в цикле `update()`.
const _vecA = new THREE.Vector3();
const _vecB = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _upAxis = new THREE.Vector3(0, 1, 0);
const _quat = new THREE.Quaternion();
const _scaleVec = new THREE.Vector3(1, 1, 1);
const _mat4 = new THREE.Matrix4();
const _camForward = new THREE.Vector3();
const _targetColor = new THREE.Color(0x38bdf8);

interface HandGhostRig {
  readonly group: THREE.Group;
  readonly jointsMesh: THREE.InstancedMesh;
  readonly bonesMesh: THREE.InstancedMesh;
  readonly palmCore: THREE.Mesh;
  readonly palmHalo: THREE.Mesh;
  readonly jointMaterial: THREE.MeshBasicMaterial;
  readonly boneMaterial: THREE.MeshBasicMaterial;
  readonly palmMaterial: THREE.MeshBasicMaterial;
  readonly localJoints: THREE.Vector3[];
}

export class GestureHandGhostController extends xb.Script {
  private readonly config: GestureHandGhostConfig;
  private enabledState: boolean;

  private rootGroup!: THREE.Group;
  private reticleGroup!: THREE.Group;
  private reticleOuterRing!: THREE.Mesh;
  private reticlePulseTorus!: THREE.Mesh;
  private reticleCenterPip!: THREE.Mesh;
  private reticleMaterial!: THREE.MeshBasicMaterial;
  private reticleAccentMaterial!: THREE.MeshBasicMaterial;

  private caliperLine!: THREE.Line;
  private caliperLineGeo!: THREE.BufferGeometry;
  private caliperMaterial!: THREE.LineBasicMaterial;

  private leftHandRig!: HandGhostRig;
  private rightHandRig!: HandGhostRig;

  private targetOpacity = 0;
  private currentOpacity = 0;
  private dualHandActive = false;
  private activePose: GhostPoseName = 'pinch';
  private activeHandSide: 'left' | 'right' = 'right';
  private isActivelyManipulating = false;
  private holdTimerSeconds = 0;
  private pulsePhase = 0;

  private readonly reticleTargetPos = new THREE.Vector3(0, 1.4, -1.2);
  private readonly reticleCurrentPos = new THREE.Vector3(0, 1.4, -1.2);
  private readonly reticleTargetQuat = new THREE.Quaternion();
  private readonly leftGhostAnchor = new THREE.Vector3(-0.22, 1.38, -1.05);
  private readonly rightGhostAnchor = new THREE.Vector3(0.22, 1.38, -1.05);
  private reticleTargetScale = 1;
  private reticleCurrentScale = 1;
  private externalCameraHands: readonly CameraHandFrameData[] | null = null;
  private externalCameraActive = false;

  // Общие переиспользуемые геометрии для освобождения в dispose().
  private readonly sharedGeometries: THREE.BufferGeometry[] = [];
  private readonly sharedMaterials: THREE.Material[] = [];

  constructor(config: GestureHandGhostConfig = {}) {
    super();
    this.config = config;
    this.enabledState = config.enabled ?? true;
  }

  override init(): void {
    this.rootGroup = new THREE.Group();
    this.rootGroup.name = 'GestureHandGhostRoot';
    this.rootGroup.xb = {pointerEvents: 'none'};
    this.add(this.rootGroup);

    this.buildReticle();
    this.leftHandRig = this.buildHandRig('LeftHandGhost');
    this.rightHandRig = this.buildHandRig('RightHandGhost');
    this.rootGroup.add(this.leftHandRig.group, this.rightHandRig.group);
    this.buildCaliperLine();

    this.rootGroup.visible = false;
  }

  setEnabled(enabled: boolean): void {
    this.enabledState = enabled;
    this.config.onLog?.(
      enabled
        ? 'Hand-Ghost и 3D-ретикл включены'
        : 'Hand-Ghost и 3D-ретикл отключены'
    );
    if (!enabled && this.rootGroup) {
      this.rootGroup.visible = false;
      this.currentOpacity = 0;
      this.targetOpacity = 0;
    }
  }

  isEnabled(): boolean {
    return this.enabledState;
  }

  /**
   * Подаёт живые 21-суставные координаты рук из модуля камерного трекинга
   * (`track_camera_hands.ts`) в голографический 3D Hand-Ghost без аллокаций.
   */
  setExternalCameraHands(
    hands: readonly CameraHandFrameData[] | null
  ): void {
    this.externalCameraHands = hands && hands.length > 0 ? hands : null;
    this.externalCameraActive = Boolean(this.externalCameraHands);
    if (!this.enabledState || !this.externalCameraHands) return;

    const primary = this.externalCameraHands[0];
    this.activeHandSide = primary.side;
    this.dualHandActive = this.externalCameraHands.length >= 2;
    this.targetOpacity = 0.92;
    this.holdTimerSeconds = 0.25;

    if (primary.worldJoints[8]) {
      this.reticleTargetPos.copy(primary.worldJoints[8]);
    }
    if (xb.core?.camera) {
      this.reticleTargetQuat.copy(xb.core.camera.quaternion);
    }

    if (this.dualHandActive) {
      _targetColor.copy(COLOR_SCALE);
      this.reticleTargetScale = 1.25;
    } else if (primary.pinching) {
      _targetColor.copy(COLOR_PIN);
      this.reticleTargetScale = 0.88;
    } else {
      _targetColor.copy(COLOR_MOVE);
      this.reticleTargetScale = 1.05;
    }
  }

  /**
   * Живой обработчик манипуляций над 3D-окнами (`start` | `update` | `end` | `cancel`).
   */
  onManipulationEvent(
    phase: 'start' | 'update' | 'end' | 'cancel',
    kind: SpatialManipulationKind,
    targetObject: THREE.Object3D,
    anchorWorldPos?: THREE.Vector3
  ): void {
    if (!this.enabledState) return;

    if (phase === 'end' || phase === 'cancel') {
      this.isActivelyManipulating = false;
      this.holdTimerSeconds = Math.max(this.holdTimerSeconds, 0.55);
      return;
    }

    this.isActivelyManipulating = true;
    this.targetOpacity = 0.88;
    this.dualHandActive = kind === 'scale' || kind === 'resize';
    this.activePose = this.dualHandActive
      ? 'scale'
      : kind === 'pin'
        ? 'fist'
        : 'pinch';

    if (kind === 'scale' || kind === 'resize') {
      _targetColor.copy(COLOR_SCALE);
      this.reticleTargetScale = 1.38;
    } else if (kind === 'pin') {
      _targetColor.copy(COLOR_PIN);
      this.reticleTargetScale = 1.15;
    } else {
      _targetColor.copy(COLOR_MOVE);
      this.reticleTargetScale = 1.05;
    }

    if (anchorWorldPos) {
      this.reticleTargetPos.copy(anchorWorldPos);
    } else {
      targetObject.getWorldPosition(this.reticleTargetPos);
    }
    targetObject.getWorldQuaternion(this.reticleTargetQuat);

    // Смещаем прицел чуть вперёд по нормали окна, чтобы не утопал в плоскости карточки.
    _dir.set(0, 0, 0.025).applyQuaternion(this.reticleTargetQuat);
    this.reticleTargetPos.add(_dir);

    if (phase === 'start') {
      this.reticleCurrentPos.copy(this.reticleTargetPos);
      this.reticleGroup.quaternion.copy(this.reticleTargetQuat);
    }
  }

  /**
   * Запускает визуальную вспышку hand-ghost и ретикла при распознавании или симуляции жеста.
   */
  triggerGestureGhost(
    hand: 'left' | 'right',
    gestureName: string,
    anchorWorldPos?: THREE.Vector3
  ): void {
    if (!this.enabledState) return;

    this.activeHandSide = hand;
    this.dualHandActive = false;
    this.targetOpacity = 0.92;
    this.holdTimerSeconds = 1.45;

    switch (gestureName) {
      case 'fist':
        this.activePose = 'fist';
        _targetColor.copy(COLOR_PIN);
        this.reticleTargetScale = 0.92;
        break;
      case 'spread':
      case 'open-palm':
        this.activePose = 'open-palm';
        _targetColor.copy(COLOR_NAV);
        this.reticleTargetScale = 1.45;
        break;
      case 'thumbs-up':
        this.activePose = 'thumbs-up';
        _targetColor.copy(COLOR_PIN);
        this.reticleTargetScale = 1.25;
        break;
      case 'thumbs-down':
        this.activePose = 'thumbs-down';
        _targetColor.copy(COLOR_SCALE);
        this.reticleTargetScale = 1.1;
        break;
      case 'point':
        this.activePose = 'point';
        _targetColor.copy(COLOR_MOVE);
        this.reticleTargetScale = 0.95;
        break;
      case 'victory':
        this.activePose = 'victory';
        _targetColor.copy(COLOR_NAV);
        this.reticleTargetScale = 1.2;
        break;
      default:
        this.activePose = 'pinch';
        _targetColor.copy(COLOR_MOVE);
        this.reticleTargetScale = 1.05;
        break;
    }

    if (anchorWorldPos) {
      this.reticleTargetPos.copy(anchorWorldPos);
    } else if (xb.core?.camera) {
      _camForward.set(0, 0, -1.15).applyQuaternion(xb.core.camera.quaternion);
      this.reticleTargetPos.copy(xb.core.camera.position).add(_camForward);
      this.reticleTargetPos.y -= 0.08;
      this.reticleTargetQuat.copy(xb.core.camera.quaternion);
    }

    this.reticleCurrentPos.copy(this.reticleTargetPos);
  }

  override update(): void {
    if (!this.enabledState || !this.rootGroup) return;

    const dt = Math.min(xb.getDeltaTime() || 0.016, 0.05);
    this.pulsePhase += dt * 3.4;

    if (!this.isActivelyManipulating) {
      if (this.holdTimerSeconds > 0) {
        this.holdTimerSeconds -= dt;
      } else {
        this.targetOpacity = 0;
      }
    }

    this.currentOpacity = THREE.MathUtils.damp(
      this.currentOpacity,
      this.targetOpacity,
      10,
      dt
    );

    if (this.currentOpacity < 0.015 && this.targetOpacity === 0) {
      this.rootGroup.visible = false;
      return;
    }

    this.rootGroup.visible = true;

    // Плавное следование ретикла и смена цвета состояния.
    this.reticleCurrentPos.lerp(
      this.reticleTargetPos,
      1 - Math.exp(-18 * dt)
    );
    this.reticleCurrentScale = THREE.MathUtils.damp(
      this.reticleCurrentScale,
      this.reticleTargetScale,
      12,
      dt
    );

    this.reticleGroup.position.copy(this.reticleCurrentPos);
    this.reticleGroup.quaternion.slerp(
      this.reticleTargetQuat,
      1 - Math.exp(-14 * dt)
    );
    this.reticleGroup.scale.setScalar(this.reticleCurrentScale);

    this.reticleOuterRing.rotation.z += dt * 1.4;
    const pulseScale = 1 + Math.sin(this.pulsePhase) * 0.1;
    this.reticlePulseTorus.scale.setScalar(pulseScale);

    this.reticleMaterial.color.lerp(_targetColor, 1 - Math.exp(-12 * dt));
    this.reticleAccentMaterial.color.lerp(
      _targetColor,
      1 - Math.exp(-12 * dt)
    );
    this.reticleMaterial.opacity = this.currentOpacity * 0.9;
    this.reticleAccentMaterial.opacity = this.currentOpacity * 0.65;

    // Обновляем 3D Hand-Ghost (реальные суставы XRHand, камерный трекинг или процедурный силуэт).
    let showLeft = this.dualHandActive || this.activeHandSide === 'left';
    let showRight = this.dualHandActive || this.activeHandSide === 'right';
    if (this.externalCameraHands) {
      showLeft = this.externalCameraHands.some((h) => h.side === 'left');
      showRight = this.externalCameraHands.some((h) => h.side === 'right');
    }

    this.updateHandRig(this.leftHandRig, 'left', showLeft, dt);
    this.updateHandRig(this.rightHandRig, 'right', showRight, dt);

    // Связующий луч масштабирования между двумя руками.
    this.caliperLine.visible = this.dualHandActive;
    if (this.dualHandActive) {
      const posAttr = this.caliperLineGeo.attributes
        .position as THREE.BufferAttribute;
      posAttr.setXYZ(
        0,
        this.leftGhostAnchor.x,
        this.leftGhostAnchor.y,
        this.leftGhostAnchor.z
      );
      posAttr.setXYZ(
        1,
        this.rightGhostAnchor.x,
        this.rightGhostAnchor.y,
        this.rightGhostAnchor.z
      );
      posAttr.needsUpdate = true;
      this.caliperMaterial.color.copy(COLOR_SCALE);
      this.caliperMaterial.opacity = this.currentOpacity * 0.78;
    }
  }

  private buildReticle(): void {
    this.reticleGroup = new THREE.Group();
    this.reticleGroup.name = 'SpatialGestureReticle';
    this.reticleGroup.xb = {pointerEvents: 'none'};

    this.reticleMaterial = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: false,
    });
    this.reticleAccentMaterial = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: false,
    });
    this.sharedMaterials.push(this.reticleMaterial, this.reticleAccentMaterial);

    const pipGeo = new THREE.SphereGeometry(0.011, 14, 12);
    const ringGeo = new THREE.RingGeometry(0.036, 0.044, 32, 1, 0, Math.PI * 1.65);
    const torusGeo = new THREE.TorusGeometry(0.056, 0.0024, 8, 36);
    const tickGeo = new THREE.BoxGeometry(0.016, 0.0032, 0.002);
    this.sharedGeometries.push(pipGeo, ringGeo, torusGeo, tickGeo);

    this.reticleCenterPip = new THREE.Mesh(pipGeo, this.reticleMaterial);
    this.reticleCenterPip.renderOrder = 955;

    this.reticleOuterRing = new THREE.Mesh(ringGeo, this.reticleMaterial);
    this.reticleOuterRing.renderOrder = 954;

    this.reticlePulseTorus = new THREE.Mesh(
      torusGeo,
      this.reticleAccentMaterial
    );
    this.reticlePulseTorus.renderOrder = 953;

    this.reticleGroup.add(
      this.reticleCenterPip,
      this.reticleOuterRing,
      this.reticlePulseTorus
    );

    // 4 радиальные прицельные риски.
    for (let i = 0; i < 4; i++) {
      const tick = new THREE.Mesh(tickGeo, this.reticleMaterial);
      const angle = (i * Math.PI) / 2;
      tick.position.set(Math.cos(angle) * 0.058, Math.sin(angle) * 0.058, 0);
      tick.rotation.z = angle;
      tick.renderOrder = 954;
      this.reticleGroup.add(tick);
    }

    this.rootGroup.add(this.reticleGroup);
  }

  private buildCaliperLine(): void {
    const points = [new THREE.Vector3(), new THREE.Vector3(0.2, 0, 0)];
    this.caliperLineGeo = new THREE.BufferGeometry().setFromPoints(points);
    this.caliperMaterial = new THREE.LineBasicMaterial({
      color: 0xfbbf24,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      depthTest: false,
    });
    this.sharedGeometries.push(this.caliperLineGeo);
    this.sharedMaterials.push(this.caliperMaterial);

    this.caliperLine = new THREE.Line(this.caliperLineGeo, this.caliperMaterial);
    this.caliperLine.renderOrder = 952;
    this.caliperLine.visible = false;
    this.rootGroup.add(this.caliperLine);
  }

  private buildHandRig(name: string): HandGhostRig {
    const group = new THREE.Group();
    group.name = name;
    group.xb = {pointerEvents: 'none'};

    const jointGeo = new THREE.SphereGeometry(0.0085, 10, 8);
    const boneGeo = new THREE.CylinderGeometry(0.0032, 0.0032, 1, 6);
    const palmCoreGeo = new THREE.OctahedronGeometry(0.02, 0);
    const palmHaloGeo = new THREE.TorusGeometry(0.042, 0.0022, 8, 24);
    this.sharedGeometries.push(jointGeo, boneGeo, palmCoreGeo, palmHaloGeo);

    const jointMaterial = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    const boneMaterial = new THREE.MeshBasicMaterial({
      color: 0x7dd3fc,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    const palmMaterial = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      wireframe: true,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    this.sharedMaterials.push(jointMaterial, boneMaterial, palmMaterial);

    const jointsMesh = new THREE.InstancedMesh(
      jointGeo,
      jointMaterial,
      JOINT_COUNT
    );
    jointsMesh.frustumCulled = false;
    jointsMesh.renderOrder = 951;

    const bonesMesh = new THREE.InstancedMesh(
      boneGeo,
      boneMaterial,
      BONE_PAIRS.length
    );
    bonesMesh.frustumCulled = false;
    bonesMesh.renderOrder = 950;

    const palmCore = new THREE.Mesh(palmCoreGeo, palmMaterial);
    palmCore.renderOrder = 951;

    const palmHalo = new THREE.Mesh(palmHaloGeo, palmMaterial);
    palmHalo.renderOrder = 950;

    group.add(jointsMesh, bonesMesh, palmCore, palmHalo);

    const localJoints: THREE.Vector3[] = [];
    for (let i = 0; i < JOINT_COUNT; i++) {
      localJoints.push(new THREE.Vector3());
    }

    return {
      group,
      jointsMesh,
      bonesMesh,
      palmCore,
      palmHalo,
      jointMaterial,
      boneMaterial,
      palmMaterial,
      localJoints,
    };
  }

  private updateHandRig(
    rig: HandGhostRig,
    side: 'left' | 'right',
    visible: boolean,
    dt: number
  ): void {
    rig.group.visible = visible;
    if (!visible) return;

    rig.jointMaterial.color.lerp(_targetColor, 1 - Math.exp(-12 * dt));
    rig.boneMaterial.color.lerp(_targetColor, 1 - Math.exp(-12 * dt));
    rig.palmMaterial.color.lerp(_targetColor, 1 - Math.exp(-12 * dt));

    rig.jointMaterial.opacity = this.currentOpacity * 0.85;
    rig.boneMaterial.opacity = this.currentOpacity * 0.45;
    rig.palmMaterial.opacity = this.currentOpacity * 0.55;

    // 1. Пытаемся прочитать реальные суставы из WebXR Hands, затем с внешней камеры.
    const usedLiveXRHand =
      this.tryPopulateFromLiveXRHand(rig, side) ||
      this.tryPopulateFromExternalCamera(rig, side);

    if (!usedLiveXRHand && !this.externalCameraActive) {
      // 2. ЗАГЛУШКА (STUB) для десктопа / контроллера: процедурная 21-суставная
      // поза hand-ghost вокруг точки манипуляции окном.
      this.populateProceduralHandPose(rig, side);
    } else if (!usedLiveXRHand) {
      this.populateProceduralHandPose(rig, side);
    }

    // Обновляем инстансы 21 сустава.
    for (let i = 0; i < JOINT_COUNT; i++) {
      const p = rig.localJoints[i];
      const tipBonus = i % 4 === 0 && i > 0 ? 1.28 : 1.0;
      _scaleVec.setScalar(tipBonus);
      _quat.identity();
      _mat4.compose(p, _quat, _scaleVec);
      rig.jointsMesh.setMatrixAt(i, _mat4);
    }
    rig.jointsMesh.instanceMatrix.needsUpdate = true;

    // Обновляем инстансы 20 сегментов костей.
    for (let b = 0; b < BONE_PAIRS.length; b++) {
      const [i0, i1] = BONE_PAIRS[b];
      _vecA.copy(rig.localJoints[i0]);
      _vecB.copy(rig.localJoints[i1]);
      _mid.addVectors(_vecA, _vecB).multiplyScalar(0.5);
      _dir.subVectors(_vecB, _vecA);
      const len = Math.max(0.004, _dir.length());
      _dir.normalize();
      _quat.setFromUnitVectors(_upAxis, _dir);
      _scaleVec.set(1, len, 1);
      _mat4.compose(_mid, _quat, _scaleVec);
      rig.bonesMesh.setMatrixAt(b, _mat4);
    }
    rig.bonesMesh.instanceMatrix.needsUpdate = true;

    // Ядро ладони и вращающийся ореол.
    _mid.addVectors(rig.localJoints[0], rig.localJoints[9]).multiplyScalar(0.5);
    rig.palmCore.position.copy(_mid);
    rig.palmCore.rotation.y += dt * 1.8;
    rig.palmHalo.position.copy(_mid);
    rig.palmHalo.quaternion.copy(this.reticleGroup.quaternion);
    rig.palmHalo.rotation.z = this.pulsePhase * 0.5;

    if (side === 'left') {
      this.leftGhostAnchor.copy(_mid);
    } else {
      this.rightGhostAnchor.copy(_mid);
    }
  }

  private tryPopulateFromLiveXRHand(
    rig: HandGhostRig,
    side: 'left' | 'right'
  ): boolean {
    const handsMgr = xb.core?.user?.hands;
    if (!handsMgr) return false;
    const handedness =
      side === 'left' ? xb.Handedness.LEFT : xb.Handedness.RIGHT;
    const wrist = handsMgr.getJoint('wrist', handedness);
    if (!wrist) return false;

    for (let i = 0; i < XR_JOINT_NAMES.length; i++) {
      const jointObj = handsMgr.getJoint(XR_JOINT_NAMES[i], handedness);
      if (!jointObj) return false;
      jointObj.getWorldPosition(rig.localJoints[i]);
    }
    return true;
  }

  private tryPopulateFromExternalCamera(
    rig: HandGhostRig,
    side: 'left' | 'right'
  ): boolean {
    if (!this.externalCameraHands) return false;
    const match = this.externalCameraHands.find((h) => h.side === side);
    if (!match || match.worldJoints.length < JOINT_COUNT) return false;

    for (let i = 0; i < JOINT_COUNT; i++) {
      rig.localJoints[i].copy(match.worldJoints[i]);
    }
    return true;
  }

  private populateProceduralHandPose(
    rig: HandGhostRig,
    side: 'left' | 'right'
  ): void {
    const mirrorX = side === 'left' ? -1 : 1;
    const spreadOffset = this.dualHandActive
      ? (0.19 + Math.sin(this.pulsePhase) * 0.025) * mirrorX
      : 0.08 * mirrorX;

    // Базовый центр кисти рядом с ретиклом.
    _vecA.set(spreadOffset, -0.055, 0.05).applyQuaternion(
      this.reticleGroup.quaternion
    );
    _vecA.add(this.reticleCurrentPos);

    const curlFactor =
      this.activePose === 'fist'
        ? 0.88
        : this.activePose === 'pinch' || this.activePose === 'scale'
          ? 0.45
          : this.activePose === 'open-palm'
            ? 0.04
            : 0.65;

    // Запястье (0).
    rig.localJoints[0].set(0, -0.06, 0);

    // 4 основных пальца (индексы 5..20) + большой (1..4).
    const fingerX = [-0.036, -0.012, 0.012, 0.034];
    const fingerLens = [0.042, 0.047, 0.044, 0.036];

    // Большой палец (1..4).
    const thumbUp =
      this.activePose === 'thumbs-up'
        ? 1
        : this.activePose === 'thumbs-down'
          ? -1
          : 0.35;
    rig.localJoints[1].set(-0.028 * mirrorX, -0.035, 0.012);
    rig.localJoints[2].set(-0.044 * mirrorX, -0.012 * thumbUp, 0.018);
    rig.localJoints[3].set(-0.052 * mirrorX, 0.015 * thumbUp, 0.012);
    rig.localJoints[4].set(
      this.activePose === 'pinch' || this.activePose === 'scale'
        ? -0.016 * mirrorX
        : -0.056 * mirrorX,
      this.activePose === 'pinch' || this.activePose === 'scale'
        ? 0.036
        : 0.042 * thumbUp,
      -0.01
    );

    for (let f = 0; f < 4; f++) {
      const baseIndex = 5 + f * 4;
      const fx = fingerX[f] * mirrorX;
      const len = fingerLens[f];
      const fCurl =
        this.activePose === 'point' && f === 0
          ? 0.05
          : this.activePose === 'victory' && (f === 0 || f === 1)
            ? 0.06
            : this.activePose === 'pinch' && f === 0
              ? 0.38
              : curlFactor;

      rig.localJoints[baseIndex].set(fx, -0.008, 0.002);
      rig.localJoints[baseIndex + 1].set(
        fx * 1.12,
        len * (1 - fCurl * 0.25) * 0.45,
        -fCurl * 0.014
      );
      rig.localJoints[baseIndex + 2].set(
        fx * 1.16,
        len * (1 - fCurl * 0.55) * 0.85,
        -fCurl * 0.034
      );
      rig.localJoints[baseIndex + 3].set(
        this.activePose === 'pinch' && f === 0
          ? -0.012 * mirrorX
          : fx * 1.2,
        this.activePose === 'pinch' && f === 0
          ? 0.039
          : len * (1 - fCurl * 0.88) * 1.18,
        -fCurl * 0.052
      );
    }

    // Поворачиваем и переносим позу в мировые координаты вокруг ретикла.
    for (let i = 0; i < JOINT_COUNT; i++) {
      rig.localJoints[i].applyQuaternion(this.reticleGroup.quaternion).add(_vecA);
    }
  }

  override dispose(): void {
    for (const geo of this.sharedGeometries) geo.dispose();
    for (const mat of this.sharedMaterials) mat.dispose();
    this.sharedGeometries.length = 0;
    this.sharedMaterials.length = 0;
  }
}
