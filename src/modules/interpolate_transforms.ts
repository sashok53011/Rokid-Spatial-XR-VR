import * as THREE from 'three';

/**
 * ============================================================================
 * МОДУЛЬ: interpolate_transforms.ts (Низколатентная интерполяция трансформаций)
 * ============================================================================
 * НАЗНАЧЕНИЕ:
 *   Обеспечивает плавные, физически сглаженные переходы (exponential damping)
 *   для позиций, поворотов и масштабов пространственных окон при примагничивании
 *   к виртуальным стенам, смене раскладки или навигации без рывков и без создания
 *   временных объектов (Zero-GC) в кадре.
 *
 * ВХОДНЫЕ ДАННЫЕ:
 *   - `animateTo(object, targetPose, options)`: объект `THREE.Object3D` и целевой
 *     трансформ (`position`, `quaternion`, `scale`).
 *   - `step(deltaSeconds)`: шаг времени кадра в секундах.
 *
 * ВЫХОДНЫЕ ДАННЫЕ:
 *   - Количество активных незавершённых анимаций (число).
 *
 * КАК ПОЛЬЗОВАТЬСЯ:
 *   const interpolator = new TransformInterpolator();
 *   interpolator.animateTo(windowCard, { position: wallPos, quaternion: wallQuat });
 *   // В методе update() скрипта:
 *   interpolator.step(xb.getDeltaTime());
 * ============================================================================
 */

export interface TargetTransformPose {
  readonly position?: THREE.Vector3;
  readonly quaternion?: THREE.Quaternion;
  readonly scale?: number;
  readonly onComplete?: () => void;
}

interface ActiveInterpolationTask {
  object: THREE.Object3D;
  hasPosition: boolean;
  targetPosition: THREE.Vector3;
  hasQuaternion: boolean;
  targetQuaternion: THREE.Quaternion;
  hasScale: boolean;
  targetScale: number;
  lambda: number;
  onComplete?: () => void;
}

const POSITION_EPSILON_SQ = 0.00001;
const QUATERNION_DOT_THRESHOLD = 0.99995;
const SCALE_EPSILON = 0.0005;

export class TransformInterpolator {
  private readonly tasks = new Map<string, ActiveInterpolationTask>();

  /**
   * Запускает или обновляет плавное движение объекта к целевой позе.
   */
  animateTo(
    object: THREE.Object3D,
    pose: TargetTransformPose,
    lambda = 14
  ): void {
    const existing = this.tasks.get(object.uuid);
    if (existing) {
      if (pose.position) {
        existing.hasPosition = true;
        existing.targetPosition.copy(pose.position);
      } else {
        existing.hasPosition = false;
      }
      if (pose.quaternion) {
        existing.hasQuaternion = true;
        existing.targetQuaternion.copy(pose.quaternion);
      } else {
        existing.hasQuaternion = false;
      }
      if (pose.scale !== undefined) {
        existing.hasScale = true;
        existing.targetScale = pose.scale;
      } else {
        existing.hasScale = false;
      }
      existing.lambda = lambda;
      existing.onComplete = pose.onComplete;
      return;
    }

    this.tasks.set(object.uuid, {
      object,
      hasPosition: Boolean(pose.position),
      targetPosition: pose.position
        ? pose.position.clone()
        : new THREE.Vector3(),
      hasQuaternion: Boolean(pose.quaternion),
      targetQuaternion: pose.quaternion
        ? pose.quaternion.clone()
        : new THREE.Quaternion(),
      hasScale: pose.scale !== undefined,
      targetScale: pose.scale ?? 1,
      lambda,
      onComplete: pose.onComplete,
    });
  }

  /**
   * Немедленно отменяет анимацию объекта (например, когда пользователь схватил окно рукой).
   */
  cancelFor(object: THREE.Object3D): void {
    this.tasks.delete(object.uuid);
  }

  /**
   * Продвигает все активные переходы на один кадр с независимым от FPS затуханием.
   * Возвращает число ещё активных переходов.
   */
  step(deltaSeconds: number): number {
    if (this.tasks.size === 0) return 0;

    const clampedDelta = Math.min(Math.max(deltaSeconds, 0.001), 0.1);

    for (const [uuid, task] of this.tasks.entries()) {
      const factor = 1 - Math.exp(-task.lambda * clampedDelta);
      let settled = true;

      if (task.hasPosition) {
        task.object.position.lerp(task.targetPosition, factor);
        if (
          task.object.position.distanceToSquared(task.targetPosition) >
          POSITION_EPSILON_SQ
        ) {
          settled = false;
        } else {
          task.object.position.copy(task.targetPosition);
        }
      }

      if (task.hasQuaternion) {
        task.object.quaternion.slerp(task.targetQuaternion, factor);
        if (
          Math.abs(task.object.quaternion.dot(task.targetQuaternion)) <
          QUATERNION_DOT_THRESHOLD
        ) {
          settled = false;
        } else {
          task.object.quaternion.copy(task.targetQuaternion);
        }
      }

      if (task.hasScale) {
        const nextScale = THREE.MathUtils.lerp(
          task.object.scale.x,
          task.targetScale,
          factor
        );
        task.object.scale.setScalar(nextScale);
        if (Math.abs(nextScale - task.targetScale) > SCALE_EPSILON) {
          settled = false;
        } else {
          task.object.scale.setScalar(task.targetScale);
        }
      }

      if (settled) {
        this.tasks.delete(uuid);
        task.onComplete?.();
      }
    }

    return this.tasks.size;
  }

  clear(): void {
    this.tasks.clear();
  }
}
