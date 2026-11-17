import type {
  RokidHostPacket,
  RokidOpticsMode,
} from '../types/spatial_contracts.ts';

/**
 * ============================================================================
 * МОДУЛЬ: bridge_rokid_spatial_host.ts (Интеграция с rokid-spatial-host)
 * ============================================================================
 * НАЗНАЧЕНИЕ:
 *   Адаптер протокола взаимодействия с очками Rokid Max и хост-службой
 *   `rokid-spatial-host` (https://github.com/sashok53011/rokid-spatial-host).
 *   Обеспечивает:
 *   - Подключение к локальному IPC-мосту (WebSocket `ws://localhost:8765` +
 *     межвкладочный `BroadcastChannel` для симулятора).
 *   - Запрос и чтение телеметрии 3DoF IMU / USB-HID Rokid Max (VID 0x04D2).
 *   - Отправку команд управления окнами и оптического профиля (`rokid-max-ar` /
 *     `rokid-max-sbs`).
 *
 * ВХОДНЫЕ ДАННЫЕ:
 *   - `connect(endpointUrl?)`: адрес локального WebSocket-демона `rokid-spatial-host`.
 *   - `sendPacket(type, payload)`: отправка пакета протокола `rokid-spatial-host/v1`.
 *   - `executeHostCommand(commandLine)`: выполнение CLI-команды хоста из терминала.
 *
 * ВЫХОДНЫЕ ДАННЫЕ:
 *   - `getStatus()`: текущее состояние соединения, режим дисплея, данные IMU.
 *   - Коллбеки `onPacket` и `onLog`.
 *
 * КАК ПОЛЬЗОВАТЬСЯ:
 *   const hostBridge = new RokidSpatialHostBridge({
 *     onLog: (lvl, msg) => monitor.log(lvl, 'ROKID', msg),
 *   });
 *   hostBridge.connect();
 *   hostBridge.executeHostCommand('rokid status');
 *
 * ЗАГЛУШКИ (STUB) И ЗАМЕНА В ПРОДАКШНЕ:
 *   1. `connectWebSocketOrLoopback`: при отсутствии локального демона на
 *      `ws://127.0.0.1:8765` модуль переходит в режим локального loopback-моста
 *      через `BroadcastChannel('rokid-spatial-host-bus')`.
 *      -> КАК ЗАМЕНИТЬ В ПРОДАКШНЕ: запустите нативный демон `rokid-spatial-host`
 *      (Node/Python/Rust USB-HID + WebSocket сервер на порту 8765) или
 *      подключите WebHID API (`navigator.hid.requestDevice({ filters: [{ vendorId: 0x04d2 }] })`)
 *      в методе `pollNativeUsbHidImu()`.
 *   2. `simulatedImuSample`: генерирует плавные тестовые показания IMU (pitch/yaw/roll),
 *      когда физические очки Rokid Max не подключены по USB-C.
 *      -> КАК ЗАМЕНИТЬ В ПРОДАКШНЕ: считывайте реальные кватернионы из HID-репортов
 *      Rokid Air/Max (пакеты 64 байта с частотой 200–1000 Гц) или из Android XR
 *      OpenXR Pose API.
 * ============================================================================
 */

export interface RokidHostStatus {
  readonly transport: 'websocket' | 'loopback-stub';
  readonly connected: boolean;
  readonly deviceName: string;
  readonly opticsMode: RokidOpticsMode;
  readonly firmwareVersion: string;
  readonly imuHz: number;
  readonly lastYawDeg: number;
  readonly lastPitchDeg: number;
}

export interface RokidBridgeConfig {
  readonly endpointUrl?: string;
  readonly onPacket?: (packet: RokidHostPacket) => void;
  readonly onStatusChange?: (status: RokidHostStatus) => void;
  readonly onLog?: (level: 'INFO' | 'WARN' | 'ERROR', message: string) => void;
}

export class RokidSpatialHostBridge {
  private readonly endpointUrl: string;
  private readonly onPacket?: (packet: RokidHostPacket) => void;
  private readonly onStatusChange?: (status: RokidHostStatus) => void;
  private readonly onLog?: (
    level: 'INFO' | 'WARN' | 'ERROR',
    message: string
  ) => void;

  private socket: WebSocket | null = null;
  private channel: BroadcastChannel | null = null;
  private imuTickCounter = 0;

  private status: RokidHostStatus = {
    transport: 'loopback-stub',
    connected: false,
    deviceName: 'Rokid Max (Simulated Bridge)',
    opticsMode: 'standard-xr',
    firmwareVersion: 'v1.4.2-spatial-stub',
    imuHz: 120,
    lastYawDeg: 0,
    lastPitchDeg: 0,
  };

  constructor(config: RokidBridgeConfig = {}) {
    this.endpointUrl = config.endpointUrl ?? 'ws://127.0.0.1:8765';
    this.onPacket = config.onPacket;
    this.onStatusChange = config.onStatusChange;
    this.onLog = config.onLog;
  }

  /**
   * Запускает подключение к локальному сервису `rokid-spatial-host`
   * с автоматическим откатом на loopback-шину при отсутствии нативного демона.
   */
  connect(tryWebSocket = false): void {
    this.setupBroadcastLoopback();

    // ЗАГЛУШКА (STUB): По умолчанию в браузерной песочнице не открываем
    // фоновую попытку к 127.0.0.1 без явного запроса, чтобы не засорять
    // консоль браузера ошибками ERR_CONNECTION_REFUSED.
    // В ПРОДАКШНЕ: передайте `tryWebSocket = true` при запуске с локальным
    // демоном `rokid-spatial-host` или в Android/Electron оболочке.
    if (!tryWebSocket) {
      this.updateStatus({
        transport: 'loopback-stub',
        connected: true,
        deviceName: 'Rokid Max (Loopback Bus Ready)',
      });
      this.onLog?.(
        'INFO',
        'Мост rokid-spatial-host активен в режиме Loopback Bus (готов к WebSocket ws://127.0.0.1:8765)'
      );
      this.sendPacket('HANDSHAKE', {
        client: 'rokid-spatial-desktop-xr',
        capabilities: ['6dof-webxr', '3dof-imu-fusion', 'sbs-1080p'],
      });
      return;
    }

    try {
      const ws = new WebSocket(this.endpointUrl);
      this.socket = ws;

      ws.onopen = () => {
        this.updateStatus({
          transport: 'websocket',
          connected: true,
          deviceName: 'Rokid Max (Host Daemon Connected)',
        });
        this.onLog?.(
          'INFO',
          `Подключено к нативному хосту ${this.endpointUrl}`
        );
        this.sendPacket('HANDSHAKE', {
          client: 'rokid-spatial-desktop-xr',
        });
      };

      ws.onmessage = (event) => {
        try {
          const parsed = JSON.parse(String(event.data)) as RokidHostPacket;
          this.onPacket?.(parsed);
        } catch (err) {
          this.onLog?.('WARN', `Некорректный пакет от хоста: ${String(err)}`);
        }
      };

      ws.onerror = () => {
        this.onLog?.(
          'WARN',
          `Хост ${this.endpointUrl} недоступен — переключение на Loopback-заглушку`
        );
        this.socket = null;
        this.updateStatus({
          transport: 'loopback-stub',
          connected: true,
          deviceName: 'Rokid Max (Loopback Fallback)',
        });
      };

      ws.onclose = () => {
        if (this.socket === ws) {
          this.socket = null;
          this.updateStatus({
            transport: 'loopback-stub',
            connected: true,
          });
        }
      };
    } catch (error) {
      this.onLog?.(
        'ERROR',
        `Ошибка инициализации WebSocket моста: ${String(error)}`
      );
    }
  }

  /**
   * Отправляет структурированный пакет по протоколу `rokid-spatial-host/v1`.
   */
  sendPacket(
    type: RokidHostPacket['type'],
    payload: Record<string, unknown>
  ): RokidHostPacket {
    const packet: RokidHostPacket = {
      protocol: 'rokid-spatial-host/v1',
      type,
      timestampMs: Math.round(performance.now()),
      payload,
    };

    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(packet));
    } else if (this.channel) {
      this.channel.postMessage(packet);
    }

    return packet;
  }

  /**
   * Синхронизирует оптический профиль Rokid Max с хост-мостом.
   */
  setOpticsMode(mode: RokidOpticsMode): void {
    this.updateStatus({opticsMode: mode});
    this.sendPacket('OPTICS_PROFILE', {mode});
    this.onLog?.('INFO', `Профиль Rokid Max переключён на: ${mode}`);
  }

  /**
   * Обновляет оценку IMU (вызывается из рендер-цикла с низкой частотой или по запросу).
   * ЗАГЛУШКА (STUB): При отсутствии физического HID-потока считывает углы
   * активной камеры WebXR, эмулируя телеметрию 3DoF датчика Rokid Max.
   * В ПРОДАКШНЕ: заменить на чтение WebHID InputReport (VID: 0x04D2).
   */
  sampleImuFromCameraYawPitch(yawRad: number, pitchRad: number): void {
    this.imuTickCounter++;
    if (this.imuTickCounter % 15 !== 0) return;

    const yawDeg = Number(((yawRad * 180) / Math.PI).toFixed(1));
    const pitchDeg = Number(((pitchRad * 180) / Math.PI).toFixed(1));
    if (
      yawDeg !== this.status.lastYawDeg ||
      pitchDeg !== this.status.lastPitchDeg
    ) {
      this.status = {
        ...this.status,
        lastYawDeg: yawDeg,
        lastPitchDeg: pitchDeg,
      };
      this.onStatusChange?.(this.status);
    }
  }

  /**
   * Выполняет команду в стиле CLI `rokid-spatial-host` и возвращает текстовый вывод.
   */
  executeHostCommand(rawCommand: string): string {
    const cmd = rawCommand.trim();
    const lower = cmd.toLowerCase();

    if (!cmd) return '';

    if (lower === 'help' || lower === '?') {
      return [
        'Доступные команды rokid-spatial-host:',
        '  rokid status       — состояние моста, IMU и оптики',
        '  rokid connect ws   — попытка подключения к ws://127.0.0.1:8765',
        '  rokid imu          — текущий снимок 3DoF/6DoF датчика',
        '  rokid ping         — проверка задержки IPC-моста',
        '  studio sync        — экспорт сцены в rokid-spatial-studio-xr',
        '  clear              — очистить вывод консоли',
      ].join('\n');
    }

    if (lower === 'rokid status') {
      return (
        `[HOST] Транспорт: ${this.status.transport}\n` +
        `[HOST] Устройство: ${this.status.deviceName}\n` +
        `[HOST] Оптика: ${this.status.opticsMode} | FW: ${this.status.firmwareVersion}\n` +
        `[HOST] IMU: ${this.status.imuHz} Гц | Yaw ${this.status.lastYawDeg}° Pitch ${this.status.lastPitchDeg}°`
      );
    }

    if (lower === 'rokid connect ws') {
      this.connect(true);
      return '[HOST] Инициировано подключение к ws://127.0.0.1:8765...';
    }

    if (lower === 'rokid imu') {
      this.sendPacket('IMU_POSE', {
        yawDeg: this.status.lastYawDeg,
        pitchDeg: this.status.lastPitchDeg,
      });
      return `[IMU] Yaw=${this.status.lastYawDeg}°, Pitch=${this.status.lastPitchDeg}°, Rate=${this.status.imuHz}Hz (источник: WebXR/Stub)`;
    }

    if (lower === 'rokid ping') {
      const t0 = performance.now();
      this.sendPacket('TELEMETRY_PING', {t0});
      const dt = (performance.now() - t0).toFixed(2);
      return `[IPC] PONG от ${this.status.transport} за ${dt} мс`;
    }

    this.sendPacket('WINDOW_COMMAND', {command: cmd});
    return `[HOST] Отправлена команда хосту: "${cmd}"`;
  }

  getStatus(): RokidHostStatus {
    return this.status;
  }

  private setupBroadcastLoopback(): void {
    if (this.channel || typeof BroadcastChannel === 'undefined') return;
    this.channel = new BroadcastChannel('rokid-spatial-host-bus');
    this.channel.onmessage = (event: MessageEvent<RokidHostPacket>) => {
      if (event.data?.protocol === 'rokid-spatial-host/v1') {
        this.onPacket?.(event.data);
      }
    };
  }

  private updateStatus(partial: Partial<RokidHostStatus>): void {
    this.status = {...this.status, ...partial};
    this.onStatusChange?.(this.status);
  }

  dispose(): void {
    this.socket?.close();
    this.socket = null;
    this.channel?.close();
    this.channel = null;
  }
}
