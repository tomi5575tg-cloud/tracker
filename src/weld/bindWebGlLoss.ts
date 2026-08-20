import type { HardwareToPixelPipeline } from './hardwareToPixelPipeline.js';

/**
 * Binds the real MapLibre/WebGL canvas to the weld.
 * preventDefault on context lost is required so the browser can restore.
 */
export function bindWebGlContextLoss(
  canvas: HTMLCanvasElement,
  pipeline: HardwareToPixelPipeline
): () => void {
  const onLost = (event: Event): void => {
    if ('preventDefault' in event) {
      event.preventDefault();
    }
    pipeline.notifyWebGlContextLost('WEBGL_CONTEXT_LOST');
  };
  const onRestored = (): void => {
    pipeline.notifyWebGlContextRestored();
  };

  canvas.addEventListener('webglcontextlost', onLost, false);
  canvas.addEventListener('webglcontextrestored', onRestored, false);

  return () => {
    canvas.removeEventListener('webglcontextlost', onLost, false);
    canvas.removeEventListener('webglcontextrestored', onRestored, false);
  };
}
