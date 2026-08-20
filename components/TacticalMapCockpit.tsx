import {
  TacticalMapCockpitController,
  TACTICAL_COCKPIT_TAILWIND_CLASSES,
  type TacticalCockpitConfig,
  type TacticalCockpitViewModel,
} from './TacticalMapCockpit.js';

export interface TacticalMapCockpitProps extends TacticalCockpitConfig {
  readonly controller?: TacticalMapCockpitController;
  readonly onActionClick?: (action: string) => void;
}

/**
 * TacticalMapCockpit React / JSX Functional Component
 * Provides complete binding of MapLibre GL JS, Single-Booth Session, Golden Thread Glow,
 * POI Radar, Dynamic Moon/Sun Lighting, and Tactical Bottom Sheet HUD.
 */
export function TacticalMapCockpit(props: TacticalMapCockpitProps): {
  readonly controller: TacticalMapCockpitController;
  readonly renderHtml: () => string;
  readonly getViewModel: () => TacticalCockpitViewModel;
  readonly classes: typeof TACTICAL_COCKPIT_TAILWIND_CLASSES;
} {
  const controller = props.controller ?? new TacticalMapCockpitController(props);

  return {
    controller,
    renderHtml: () => controller.renderHtml(),
    getViewModel: () => controller.getViewModel(),
    classes: TACTICAL_COCKPIT_TAILWIND_CLASSES,
  };
}

export * from './TacticalMapCockpit.js';
