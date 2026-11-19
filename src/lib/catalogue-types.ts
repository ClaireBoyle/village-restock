import type { DefrostItem } from './defrost';
import type { PrepTask } from './prep';
// The catalogue is the permanent configuration a device needs to run a
// restock: departments, areas, storerooms, categories, products and par levels.
// It is downloaded whole (it is small) and kept on the device for offline use.

export type RestockMethod = 'par' | 'manual' | 'routine';
export type DepartmentTheme = 'village' | 'gold';
export type DepartmentIcon = 'bar' | 'kitchen' | 'candy' | 'box';

export interface CatDepartment {
  id: string; name: string; shortName: string; groupLabel: string;
  theme: DepartmentTheme; icon: DepartmentIcon; description: string; sortOrder: number;
  /** Each area is restocked on its own (Candy Bar), instead of one full restock of every area. */
  restockByArea?: boolean;
  /** Collecting less than needed is Low stock, even at zero; "None on display" makes it Out of stock (Candy Bar). */
  noneOnDisplay?: boolean;
}
export interface CatArea {
  id: string; departmentId: string; name: string; guideText: string;
  guidePhotoPath: string | null; sortOrder: number;
  /** Shown as a section inside this area's screen (null = an area of its own). */
  parentAreaId?: string | null;
  /** open: shown expanded · collapsed: tap to show · optional: collapsed and never required. */
  sectionMode?: 'open' | 'collapsed' | 'optional';
}
export interface CatLocation {
  id: string; name: string; sortOrder: number;
  /** Shown once under this storeroom's heading on collection lists (e.g. "Use opened boxes first"). */
  collectNote?: string;
}
export interface CatCategory { id: string; departmentId: string; name: string; sortOrder: number }
export interface CatProduct {
  id: string; departmentId: string; categoryId: string | null; name: string;
  unitSingular: string; unitPlural: string; method: RestockMethod; allowDecimal: boolean;
  instructions: string; defaultLocationId: string | null; sortOrder: number;
  /** Menu items to mark as sold out if this runs out. */
  affects: string[];
  /** Reference photo (e.g. /api/photos/<id>), or null. */
  photoPath: string | null;
  /** Credit line for openly licensed photos (e.g. Open Food Facts, CC BY-SA). */
  photoCredit?: string | null;
}
export interface CatPlacement {
  id: string; productId: string; checkAreaId: string; parLevel: number | null;
  locationId: string | null; instructions: string | null; sortOrder: number;
  /** A small subheading shown above this product in its area (e.g. "Beer, Cider & Hard Soda"). */
  heading?: string | null;
  /** Grabbed from this upstairs area for front of house (listed on "Refill FOH", not the downstairs list). */
  pickupAreaId?: string | null;
  /** Also suggest the same amount for this product in the pickup area, to replace it from downstairs. */
  pickupSuggest?: boolean;
  /** Counted in a different unit in this area (e.g. single bottles here, packs in the BOH fridge). */
  unitSingular?: string | null;
  unitPlural?: string | null;
  /** Defrost rows: where to grab it, where to look if that's empty, and where it goes. */
  grabNote?: string | null;
  fallbackNote?: string | null;
  putNote?: string | null;
  /** Defrost rows: the unit staff count what's already ready in (e.g. portions), if not the pulled unit. */
  readyUnitSingular?: string | null;
  readyUnitPlural?: string | null;
  /** How many ready units one pulled unit makes (e.g. 8 portions per bag). */
  readyPer?: number | null;
  /** Ready-stock targets by tomorrow's forecast admits, in the ready unit. */
  readyTargets?: ReadyTarget[];
  /** Made or portioned in morning prep (e.g. cut carrot, vodka sauce): not on the downstairs list. */
  prepTaskId?: string | null;
  /** A working drawer or tub refilled from stock already upstairs (Refilled / Already full / Needs stock). */
  refillSource?: string | null;
  /** This row shows and edits another row's requirement (e.g. a dessert already planned in Defrost). */
  linkedPlacementId?: string | null;
}

/** A ready-stock target for a range of forecast admits (max null = and above). */
export interface ReadyTarget { min: number; max: number | null; qty: number }

export interface Catalogue {
  version: number;
  generatedAt: string;
  /** Restocks finished after midnight but before cutoffHour count as the previous day's close. */
  settings: { timeZone: string; cutoffHour: number; defrostServiceTime: string };
  departments: CatDepartment[];
  areas: CatArea[];
  locations: CatLocation[];
  categories: CatCategory[];
  products: CatProduct[];
  placements: CatPlacement[];
  /** Defrost Planner items (Gold Class Kitchen). Empty until a manager sets them up. */
  defrostItems: DefrostItem[];
  /** Morning prep checklist (Gold Class Kitchen). Empty until migration 017 and its data have run. */
  prepTasks?: PrepTask[];
}

export type CatalogueResponse = { unchanged: true; version: number } | ({ unchanged: false } & Catalogue);
