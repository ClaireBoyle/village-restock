// The catalogue is the permanent configuration a device needs to run a
// restock: departments, areas, storerooms, categories, products and par levels.
// It is downloaded whole (it is small) and kept on the device for offline use.

export type RestockMethod = 'par' | 'manual' | 'routine';
export type DepartmentTheme = 'village' | 'gold';
export type DepartmentIcon = 'bar' | 'kitchen' | 'candy' | 'box';

export interface CatDepartment {
  id: string; name: string; shortName: string; groupLabel: string;
  theme: DepartmentTheme; icon: DepartmentIcon; description: string; sortOrder: number;
}
export interface CatArea {
  id: string; departmentId: string; name: string; guideText: string;
  guidePhotoPath: string | null; sortOrder: number;
}
export interface CatLocation { id: string; name: string; sortOrder: number }
export interface CatCategory { id: string; departmentId: string; name: string; sortOrder: number }
export interface CatProduct {
  id: string; departmentId: string; categoryId: string | null; name: string;
  unitSingular: string; unitPlural: string; method: RestockMethod; allowDecimal: boolean;
  instructions: string; defaultLocationId: string | null; sortOrder: number;
}
export interface CatPlacement {
  id: string; productId: string; checkAreaId: string; parLevel: number | null;
  locationId: string | null; instructions: string | null; sortOrder: number;
}

export interface Catalogue {
  version: number;
  generatedAt: string;
  departments: CatDepartment[];
  areas: CatArea[];
  locations: CatLocation[];
  categories: CatCategory[];
  products: CatProduct[];
  placements: CatPlacement[];
}

export type CatalogueResponse = { unchanged: true; version: number } | ({ unchanged: false } & Catalogue);
