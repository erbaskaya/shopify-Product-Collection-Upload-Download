import type {
  PreparedProduct,
} from "./importPayload";

import type {
  ImportTransferSettings,
} from "./transferSettings";

export type BulkImportItemStatus =
  | "created"
  | "updated"
  | "skipped"
  | "error";

export interface BulkImportItemResult {
  sourceKey: string;
  title: string;
  handle: string;
  status: BulkImportItemStatus;
  matchedBy?: "handle" | "sku";
  productId?: string;
  productLegacyId?: string;
  variantCount: number;
  warnings: string[];
  errors: string[];
}

export interface BulkImportBatchRequest {
  requestId: string;
  offset: number;
  products: PreparedProduct[];
  settings: ImportTransferSettings;
}

export interface BulkImportBatchResponse {
  ok: boolean;
  requestId: string;
  offset: number;
  processedCount: number;
  stoppedOnError: boolean;
  results: BulkImportItemResult[];
  fatalErrors: string[];
}
