import type {
  PreparedProduct,
} from "./importPayload";

import type {
  ImportTransferSettings,
} from "./transferSettings";

export interface TestImportRequest {
  product: PreparedProduct;
  settings: ImportTransferSettings;
}

export interface TestImportResponse {
  ok: boolean;
  productId?: string;
  productLegacyId?: string;
  title?: string;
  handle?: string;
  status?: string;
  variantCount?: number;
  warnings: string[];
  errors: string[];
}
