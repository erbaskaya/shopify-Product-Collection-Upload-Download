export type ImportMode =
  | "upsert"
  | "create_only"
  | "update_only";

export type ProductMatchMethod =
  | "handle_then_sku"
  | "handle"
  | "sku";

export type ProductStatusMode =
  | "from_file"
  | "active"
  | "draft";

export type InventoryMode =
  | "from_file"
  | "default_quantity"
  | "skip";

export type InventoryTargetMode =
  | "selected_location"
  | "all_locations";

export interface StoreLocationOption {
  id: string;
  name: string;
}

export interface ImportTransferSettings {
  importMode: ImportMode;
  matchMethod: ProductMatchMethod;
  productStatus: ProductStatusMode;
  inventoryMode: InventoryMode;
  inventoryTarget: InventoryTargetMode;
  locationId: string;
  defaultQuantity: number;
  preserveExistingMedia: boolean;
  createMetafieldDefinitions: boolean;
  continueOnError: boolean;
  publishToSalesChannels: boolean;
  batchSize: number;
}

export function createDefaultTransferSettings(
  locations: StoreLocationOption[],
  savedDefaults?: Partial<ImportTransferSettings>,
): ImportTransferSettings {
  const fallbackLocationId = locations[0]?.id ?? "";

  const requestedLocationId =
    savedDefaults?.locationId || fallbackLocationId;

  const locationId = locations.some(
    (location) => location.id === requestedLocationId,
  )
    ? requestedLocationId
    : fallbackLocationId;

  const defaults: ImportTransferSettings = {
    importMode: "upsert",
    matchMethod: "handle_then_sku",
    productStatus: "from_file",
    inventoryMode:
      locations.length > 0
        ? "from_file"
        : "skip",
    inventoryTarget: "selected_location",
    locationId,
    defaultQuantity: 0,
    preserveExistingMedia: true,
    createMetafieldDefinitions: true,
    continueOnError: true,
    publishToSalesChannels: false,
    batchSize: 10,
  };

  return {
    ...defaults,
    ...savedDefaults,
    locationId,
    inventoryMode:
      locations.length === 0
        ? "skip"
        : savedDefaults?.inventoryMode || defaults.inventoryMode,
    batchSize: Math.max(
      1,
      Math.min(25, Number(savedDefaults?.batchSize || defaults.batchSize)),
    ),
    defaultQuantity: Math.max(
      0,
      Number(savedDefaults?.defaultQuantity || 0),
    ),
  };
}
