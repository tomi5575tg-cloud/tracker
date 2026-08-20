import {
  MeshMessagePriority,
  type MeshBufferMessage,
  type MeshBufferConfig,
} from './types.js';

export class OfflineTelemetryMeshBuffer {
  private messages: MeshBufferMessage[] = [];
  private readonly config: Required<MeshBufferConfig>;
  private totalEnqueued = 0;
  private totalFlushed = 0;
  private totalCompacted = 0;

  constructor(config: Partial<MeshBufferConfig> = {}) {
    this.config = {
      maxBufferSize: config.maxBufferSize ?? 1000,
      emergencyReserveSlots: config.emergencyReserveSlots ?? 100,
      compactionEnabled: config.compactionEnabled ?? true,
    };
  }

  public size(): number {
    return this.messages.length;
  }

  public isEmpty(): boolean {
    return this.messages.length === 0;
  }

  /**
   * Enqueues a message with specified priority.
   */
  public enqueue<T>(
    topic: string,
    payload: T,
    priority: MeshMessagePriority = MeshMessagePriority.TELEMETRY_HIGH,
    id?: string
  ): MeshBufferMessage<T> {
    const message: MeshBufferMessage<T> = {
      id: id ?? `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      timestamp: Date.now(),
      priority,
      topic,
      payload,
      attempts: 0,
    };

    this.ensureCapacity(priority);
    this.messages.push(message as MeshBufferMessage<unknown>);
    this.sortMessages();
    this.totalEnqueued++;

    return message;
  }

  /**
   * Peek highest priority message without removing
   */
  public peek(): MeshBufferMessage | undefined {
    return this.messages[0];
  }

  /**
   * Flushes queued messages using provided async dispatcher.
   * Returns number of successfully dispatched messages.
   */
  public async flush(
    dispatcher: (message: MeshBufferMessage) => Promise<boolean>
  ): Promise<number> {
    if (this.messages.length === 0) return 0;

    let successCount = 0;
    const remaining: MeshBufferMessage[] = [];

    for (const msg of this.messages) {
      try {
        const success = await dispatcher(msg);
        if (success) {
          successCount++;
          this.totalFlushed++;
        } else {
          // Increment attempt count
          const updated: MeshBufferMessage = {
            ...msg,
            attempts: msg.attempts + 1,
          };
          remaining.push(updated);
        }
      } catch {
        const updated: MeshBufferMessage = {
          ...msg,
          attempts: msg.attempts + 1,
        };
        remaining.push(updated);
      }
    }

    this.messages = remaining;
    this.sortMessages();
    return successCount;
  }

  /**
   * Compacts buffer by keeping critical messages and reducing frequency of intermediate telemetry breadcrumbs
   */
  public compact(): number {
    if (!this.config.compactionEnabled || this.messages.length <= 10) {
      return 0;
    }

    const initialCount = this.messages.length;
    const criticalMessages: MeshBufferMessage[] = [];
    const telemetryMessages: MeshBufferMessage[] = [];
    const otherMessages: MeshBufferMessage[] = [];

    for (const msg of this.messages) {
      if (msg.priority === MeshMessagePriority.EMERGENCY_CRITICAL) {
        criticalMessages.push(msg);
      } else if (msg.priority === MeshMessagePriority.TELEMETRY_HIGH) {
        telemetryMessages.push(msg);
      } else {
        otherMessages.push(msg);
      }
    }

    // Keep newest 20% of telemetry, and downsample the older 80% (keep 1 in 4)
    const splitIndex = Math.floor(telemetryMessages.length * 0.8);
    const older = telemetryMessages.slice(0, splitIndex);
    const newer = telemetryMessages.slice(splitIndex);

    const downsampledOlder = older.filter((_, idx) => idx % 4 === 0);
    const compactedTelemetry = [...downsampledOlder, ...newer];

    this.messages = [...criticalMessages, ...compactedTelemetry, ...otherMessages];
    this.sortMessages();

    const removed = initialCount - this.messages.length;
    this.totalCompacted += removed;
    return removed;
  }

  private ensureCapacity(incomingPriority: MeshMessagePriority): void {
    if (this.messages.length < this.config.maxBufferSize) {
      return;
    }

    // Try compaction first
    this.compact();
    if (this.messages.length < this.config.maxBufferSize) {
      return;
    }

    // If still at capacity:
    // If incoming is EMERGENCY_CRITICAL, drop lowest priority (DIAGNOSTIC_LOW or POI_MEDIUM)
    if (incomingPriority === MeshMessagePriority.EMERGENCY_CRITICAL) {
      const dropIndex = this.findLowestPriorityIndex();
      if (dropIndex >= 0) {
        this.messages.splice(dropIndex, 1);
        return;
      }
    }

    // If non-critical, drop lowest priority message
    const dropIndex = this.findLowestPriorityIndex();
    if (dropIndex >= 0) {
      this.messages.splice(dropIndex, 1);
    }
  }

  private findLowestPriorityIndex(): number {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const msg = this.messages[i];
      if (msg && msg.priority !== MeshMessagePriority.EMERGENCY_CRITICAL) {
        return i;
      }
    }
    return -1;
  }

  private sortMessages(): void {
    // Sort by priority ASC (0 = highest), then timestamp ASC (FIFO within priority)
    this.messages.sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      return a.timestamp - b.timestamp;
    });
  }

  public clear(): void {
    this.messages = [];
  }

  public getMessages(): readonly MeshBufferMessage[] {
    return this.messages;
  }

  public exportJson(): string {
    return JSON.stringify(this.messages);
  }

  public importJson(json: string): number {
    try {
      const parsed = JSON.parse(json) as MeshBufferMessage[];
      if (Array.isArray(parsed)) {
        this.messages = parsed;
        this.sortMessages();
        return parsed.length;
      }
    } catch {
      // Invalid JSON
    }
    return 0;
  }

  public getMetrics(): {
    currentSize: number;
    totalEnqueued: number;
    totalFlushed: number;
    totalCompacted: number;
  } {
    return {
      currentSize: this.messages.length,
      totalEnqueued: this.totalEnqueued,
      totalFlushed: this.totalFlushed,
      totalCompacted: this.totalCompacted,
    };
  }
}
