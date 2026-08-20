import { describe, it, expect } from 'vitest';
import { AuthLockBooth } from '../../src/auth/authBooth.js';
import { InMemoryStorageProvider } from '../../src/auth/storage.js';
import { FaultTolerantMeshSupervisor } from '../../src/resilience/faultTolerantMesh.js';
import { EmergencyRenderer } from '../../src/resilience/emergencyRenderer.js';
import { HardwareToPixelPipeline } from '../../src/weld/hardwareToPixelPipeline.js';
import { bindWebGlContextLoss } from '../../src/weld/bindWebGlLoss.js';

describe('bindWebGlContextLoss', () => {
  it('prevents default and notifies the weld on a real canvas event name', async () => {
    const booth = new AuthLockBooth({ storage: new InMemoryStorageProvider() });
    const renderer = new EmergencyRenderer();
    const mesh = new FaultTolerantMeshSupervisor({ emergencyRenderer: renderer });
    const pipeline = new HardwareToPixelPipeline({ booth, mesh, renderer });
    await booth.enterBooth({
      sessionId: 's1',
      userId: 'driver-demo',
      username: 'OPERATOR.DEMO',
      token: 't',
      role: 'DRIVER',
    });
    pipeline.ingestFix({
      timestamp: Date.now(),
      coordinate: [21.0122, 52.2297],
      source: 'LIVE_GNSS',
    });

    const canvas = new EventTarget() as unknown as HTMLCanvasElement;
    const unbind = bindWebGlContextLoss(canvas, pipeline);
    const lost = new Event('webglcontextlost', { cancelable: true });
    canvas.dispatchEvent(lost);

    expect(lost.defaultPrevented).toBe(true);
    expect(pipeline.getLastAudit()?.degradationLevel).toBe('LEVEL_3_MAP_RENDER_LOST');
    expect(pipeline.getLastAudit()?.screenFilled).toBe(true);
    unbind();
  });
});
