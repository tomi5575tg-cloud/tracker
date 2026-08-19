import type { PoiItem, PoiCategory } from '../src/poi/types.js';
import type { RouteData } from '../src/types.js';
import {
  TacticalBottomSheetController,
  TACTICAL_HUD_TAILWIND_CLASSES,
  type TacticalSnapPoint,
  type TacticalSheetTab,
  type TacticalBottomSheetOptions,
} from './TacticalBottomSheet.js';

export interface TacticalBottomSheetProps extends TacticalBottomSheetOptions {
  readonly controller?: TacticalBottomSheetController;
  readonly selectedPoi?: PoiItem | null;
  readonly selectedPoiCategory?: PoiCategory | null;
  readonly activeRoute?: RouteData | null;
  readonly onNavigateClick?: () => void;
  readonly onScanRadiusClick?: () => void;
  readonly onDrainClick?: () => void;
}

/**
 * TacticalBottomSheet TSX/JSX Compatible Component Template
 * Can be rendered directly in React / Next.js / React Native Web or used via TacticalBottomSheetController.
 */
export function TacticalBottomSheet(props: TacticalBottomSheetProps): {
  readonly controller: TacticalBottomSheetController;
  readonly renderHtml: () => string;
  readonly classes: typeof TACTICAL_HUD_TAILWIND_CLASSES;
} {
  const controller = props.controller ?? new TacticalBottomSheetController(props);

  if (props.selectedPoi !== undefined) {
    controller.selectPoi(props.selectedPoi, props.selectedPoiCategory ?? null);
  }

  if (props.activeRoute !== undefined) {
    controller.setRoute(props.activeRoute);
  }

  return {
    controller,
    renderHtml: () => controller.renderHtml(),
    classes: TACTICAL_HUD_TAILWIND_CLASSES,
  };
}

export * from './TacticalBottomSheet.js';
