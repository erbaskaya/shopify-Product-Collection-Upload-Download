import type { ImportTransferSettings } from "./product-import/transferSettings";
import type { CollectionImportSettings } from "./collection-import/collectionImport.shared";

export interface AppSettings {
  product: ImportTransferSettings & { requireTest: boolean };
  collection: CollectionImportSettings & { requireTest: boolean };
  export: {
    defaultFormat: "csv" | "xlsx" | "json";
    csvDelimiter: "comma" | "semicolon" | "tab";
    csvEncoding: "utf8" | "utf8-bom";
  };
  historyRetentionDays: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  product: {
    importMode: "upsert",
    matchMethod: "handle_then_sku",
    productStatus: "from_file",
    inventoryMode: "from_file",
    inventoryTarget: "selected_location",
    locationId: "",
    defaultQuantity: 0,
    preserveExistingMedia: true,
    createMetafieldDefinitions: true,
    continueOnError: true,
    publishToSalesChannels: false,
    batchSize: 10,
    requireTest: true,
  },
  collection: {
    mode: "upsert",
    batchSize: 5,
    replaceSources: true,
    includeImage: true,
    imageFailurePolicy: "skip-image",
    includeMetafields: true,
    continueOnError: true,
    requireTest: true,
  },
  export: {
    defaultFormat: "csv",
    csvDelimiter: "comma",
    csvEncoding: "utf8-bom",
  },
  historyRetentionDays: 90,
};

export function normalizeSettings(value: Record<string, unknown> | null | undefined): AppSettings {
  const product = (value?.product ?? {}) as Partial<AppSettings["product"]>;
  const collection = (value?.collection ?? {}) as Partial<AppSettings["collection"]>;
  const exportSettings = (value?.export ?? {}) as Partial<AppSettings["export"]>;

  return {
    product: { ...DEFAULT_SETTINGS.product, ...product },
    collection: { ...DEFAULT_SETTINGS.collection, ...collection },
    export: { ...DEFAULT_SETTINGS.export, ...exportSettings },
    historyRetentionDays: Number(value?.historyRetentionDays ?? DEFAULT_SETTINGS.historyRetentionDays),
  };
}
