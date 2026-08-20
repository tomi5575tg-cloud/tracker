import { describe, it, expect } from 'vitest';
import { OfflineTelemetryMeshBuffer } from '../../src/mesh/offlineMeshBuffer.js';
import { MeshMessagePriority } from '../../src/mesh/types.js';

describe('OfflineTelemetryMeshBuffer (Store-and-Forward Mesh Replay)', () => {
  it('should enqueue and sort messages strictly by priority (EMERGENCY_CRITICAL first)', () => {
    const buffer = new OfflineTelemetryMeshBuffer();

    buffer.enqueue('telemetry.gps', { lat: 52.2, lon: 21.0 }, MeshMessagePriority.TELEMETRY_HIGH);
    buffer.enqueue('diag.metrics', { cpu: 12 }, MeshMessagePriority.DIAGNOSTIC_LOW);
    buffer.enqueue('poi.visit', { id: 'poi-1' }, MeshMessagePriority.POI_MEDIUM);
    buffer.enqueue('security.panic', { drain: true }, MeshMessagePriority.EMERGENCY_CRITICAL);

    expect(buffer.size()).toBe(4);

    const first = buffer.peek();
    expect(first?.priority).toBe(MeshMessagePriority.EMERGENCY_CRITICAL);
    expect(first?.topic).toBe('security.panic');
  });

  it('should flush messages in priority order to an async dispatcher', async () => {
    const buffer = new OfflineTelemetryMeshBuffer();
    buffer.enqueue('msg.high', { data: 1 }, MeshMessagePriority.TELEMETRY_HIGH);
    buffer.enqueue('msg.crit', { data: 2 }, MeshMessagePriority.EMERGENCY_CRITICAL);

    const dispatchedTopics: string[] = [];

    const flushedCount = await buffer.flush(async (msg) => {
      dispatchedTopics.push(msg.topic);
      return true;
    });

    expect(flushedCount).toBe(2);
    expect(buffer.isEmpty()).toBe(true);
    expect(dispatchedTopics).toEqual(['msg.crit', 'msg.high']);
  });

  it('should keep failed messages in buffer with incremented attempt count', async () => {
    const buffer = new OfflineTelemetryMeshBuffer();
    buffer.enqueue('msg.failing', { data: 1 }, MeshMessagePriority.TELEMETRY_HIGH);

    const flushedCount = await buffer.flush(async () => {
      return false; // Discard/failure
    });

    expect(flushedCount).toBe(0);
    expect(buffer.size()).toBe(1);
    expect(buffer.peek()?.attempts).toBe(1);
  });

  it('should compact buffer by downsampling older telemetry while retaining critical messages', () => {
    const buffer = new OfflineTelemetryMeshBuffer({ compactionEnabled: true });

    buffer.enqueue('panic', { alert: 'SOS' }, MeshMessagePriority.EMERGENCY_CRITICAL);

    for (let i = 0; i < 40; i++) {
      buffer.enqueue(`telemetry.${i}`, { seq: i }, MeshMessagePriority.TELEMETRY_HIGH);
    }

    const initialSize = buffer.size(); // 41
    const removedCount = buffer.compact();

    expect(removedCount).toBeGreaterThan(0);
    expect(buffer.size()).toBeLessThan(initialSize);

    // Critical message must still be at the top
    expect(buffer.peek()?.priority).toBe(MeshMessagePriority.EMERGENCY_CRITICAL);
  });

  it('should serialize and deserialize to JSON cleanly', () => {
    const buffer = new OfflineTelemetryMeshBuffer();
    buffer.enqueue('sync.route', { id: 'r1' }, MeshMessagePriority.TELEMETRY_HIGH);

    const json = buffer.exportJson();
    const newBuffer = new OfflineTelemetryMeshBuffer();
    const importedCount = newBuffer.importJson(json);

    expect(importedCount).toBe(1);
    expect(newBuffer.peek()?.topic).toBe('sync.route');
  });
});
