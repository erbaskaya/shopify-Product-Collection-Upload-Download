import type {
  ImportCell,
} from "./fileParser";

import {
  METAFIELD_MAPPING_VALUE,
} from "./metafieldMapping";

import type {
  MetafieldMappingConfig,
  MetafieldMappingMap,
  ShopifyMetafieldType,
} from "./metafieldMapping";

import type {
  ColumnMapping,
} from "./shopifyFields";

export interface PreparedMetafield {
  namespace: string;
  key: string;
  type: ShopifyMetafieldType;
  value: string;
  ownerType: "PRODUCT" | "PRODUCTVARIANT";
}

export interface PreparedProductOption {
  name: string;
  position: number;
  values: string[];
}

export interface PreparedVariantOptionValue {
  optionName: string;
  name: string;
}

export interface PreparedVariant {
  sourceRow: number;
  sku: string;
  barcode: string;
  price: number | null;
  compareAtPrice: number | null;
  taxable: boolean | null;
  requiresShipping: boolean | null;
  inventoryPolicy: "DENY" | "CONTINUE";
  inventoryTracked: boolean;
  inventoryQuantity: number | null;
  cost: number | null;
  optionValues: PreparedVariantOptionValue[];
  imageUrl: string;
  imageAlt: string;
  metafields: PreparedMetafield[];
}

export interface PreparedProductFile {
  originalSource: string;
  alt: string;
  position: number;
}

export interface PreparedProduct {
  sourceKey: string;
  sourceRows: number[];
  handle: string;
  title: string;
  descriptionHtml: string;
  vendor: string;
  productType: string;
  categoryId: string;
  tags: string[];
  sourceStatus: string;
  seoTitle: string;
  seoDescription: string;
  productOptions: PreparedProductOption[];
  variants: PreparedVariant[];
  files: PreparedProductFile[];
  metafields: PreparedMetafield[];
  warnings: string[];
}

interface GroupedRow {
  row: Record<string, ImportCell>;
  sourceRow: number;
}

interface ProductGroup {
  key: string;
  rows: GroupedRow[];
}

function toText(value: ImportCell | undefined): string {
  return String(value ?? "").trim();
}

function normalizeText(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase("tr-TR");
}

function getHeaderForTarget(
  mapping: ColumnMapping,
  targetFieldId: string,
): string | undefined {
  return Object.keys(mapping).find(
    (header) =>
      mapping[header] === targetFieldId,
  );
}

function getMappedValue(
  row: Record<string, ImportCell>,
  mapping: ColumnMapping,
  targetFieldId: string,
): string {
  const header = getHeaderForTarget(
    mapping,
    targetFieldId,
  );

  if (!header) {
    return "";
  }

  return toText(row[header]);
}

function firstNonEmptyMappedValue(
  rows: GroupedRow[],
  mapping: ColumnMapping,
  targetFieldId: string,
): string {
  for (const item of rows) {
    const value = getMappedValue(
      item.row,
      mapping,
      targetFieldId,
    );

    if (value) {
      return value;
    }
  }

  return "";
}

function parseLocalizedNumber(
  value: string,
): number | null {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  let normalized = trimmed
    .replace(/\s+/g, "")
    .replace(/[^\d,.-]/g, "");

  const hasComma = normalized.includes(",");
  const hasDot = normalized.includes(".");

  if (hasComma && hasDot) {
    const lastComma = normalized.lastIndexOf(",");
    const lastDot = normalized.lastIndexOf(".");

    if (lastComma > lastDot) {
      normalized = normalized
        .replace(/\./g, "")
        .replace(",", ".");
    } else {
      normalized = normalized.replace(/,/g, "");
    }
  } else if (hasComma) {
    normalized = normalized.replace(",", ".");
  }

  const parsed = Number(normalized);

  return Number.isFinite(parsed)
    ? parsed
    : null;
}

function parseInteger(value: string): number | null {
  const parsed = parseLocalizedNumber(value);

  if (
    parsed === null ||
    !Number.isInteger(parsed)
  ) {
    return null;
  }

  return parsed;
}

function parseBoolean(value: string): boolean | null {
  const normalized = normalizeText(value);

  if (!normalized) {
    return null;
  }

  if (
    ["true", "1", "yes", "evet"].includes(
      normalized,
    )
  ) {
    return true;
  }

  if (
    [
      "false",
      "0",
      "no",
      "hayır",
      "hayir",
    ].includes(normalized)
  ) {
    return false;
  }

  return null;
}

function parseTags(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  );
}

function isVariantDataRow(
  row: Record<string, ImportCell>,
  mapping: ColumnMapping,
): boolean {
  const variantFieldIds = [
    "variantSku",
    "variantBarcode",
    "variantPrice",
    "variantCompareAtPrice",
    "variantInventoryQty",
    "option1Value",
    "option2Value",
    "option3Value",
  ];

  return variantFieldIds.some(
    (fieldId) =>
      Boolean(
        getMappedValue(
          row,
          mapping,
          fieldId,
        ),
      ),
  );
}

function groupRows(
  rows: Record<string, ImportCell>[],
  mapping: ColumnMapping,
): ProductGroup[] {
  const groups = new Map<string, ProductGroup>();
  let currentGroupKey = "";

  rows.forEach((row, index) => {
    const sourceRow = index + 2;

    const handle = getMappedValue(
      row,
      mapping,
      "handle",
    );

    const title = getMappedValue(
      row,
      mapping,
      "title",
    );

    const sku = getMappedValue(
      row,
      mapping,
      "variantSku",
    );

    let groupKey = "";

    if (handle) {
      groupKey = `handle:${normalizeText(handle)}`;
      currentGroupKey = groupKey;
    } else if (currentGroupKey) {
      groupKey = currentGroupKey;
    } else if (title) {
      groupKey = `title:${normalizeText(title)}`;
      currentGroupKey = groupKey;
    } else if (sku) {
      groupKey = `sku:${normalizeText(sku)}`;
      currentGroupKey = groupKey;
    } else {
      groupKey = `row:${sourceRow}`;
      currentGroupKey = groupKey;
    }

    const existing = groups.get(groupKey);

    if (existing) {
      existing.rows.push({
        row,
        sourceRow,
      });
    } else {
      groups.set(groupKey, {
        key: groupKey,
        rows: [
          {
            row,
            sourceRow,
          },
        ],
      });
    }
  });

  return Array.from(groups.values());
}

function normalizeMetafieldValue(
  rawValue: string,
  config: MetafieldMappingConfig,
): string {
  const value = rawValue.trim();

  if (!value) {
    return "";
  }

  if (config.type === "boolean") {
    const parsed = parseBoolean(value);
    return parsed === null
      ? value.toLocaleLowerCase("en-US")
      : String(parsed);
  }

  if (
    config.type === "number_integer"
  ) {
    const parsed = parseInteger(value);
    return parsed === null
      ? value
      : String(parsed);
  }

  if (
    config.type === "number_decimal"
  ) {
    const parsed = parseLocalizedNumber(value);
    return parsed === null
      ? value
      : String(parsed);
  }

  if (
    config.type.startsWith("list.")
  ) {
    try {
      const parsed = JSON.parse(value);

      if (Array.isArray(parsed)) {
        return JSON.stringify(parsed);
      }
    } catch {
      // Comma-separated values are converted below.
    }

    return JSON.stringify(
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    );
  }

  if (config.type === "rich_text_field") {
    try {
      const parsed = JSON.parse(value);

      if (
        parsed &&
        typeof parsed === "object"
      ) {
        return JSON.stringify(parsed);
      }
    } catch {
      // Plain text is converted into Shopify rich text JSON below.
    }

    return JSON.stringify({
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [
            {
              type: "text",
              value,
            },
          ],
        },
      ],
    });
  }

  return value;
}

function collectMetafields(
  row: Record<string, ImportCell>,
  mapping: ColumnMapping,
  metafieldMappings: MetafieldMappingMap,
  ownerType: "PRODUCT" | "PRODUCTVARIANT",
): PreparedMetafield[] {
  const metafields: PreparedMetafield[] = [];

  Object.entries(mapping).forEach(
    ([header, targetFieldId]) => {
      if (
        targetFieldId !==
        METAFIELD_MAPPING_VALUE
      ) {
        return;
      }

      const config =
        metafieldMappings[header];

      if (
        !config ||
        config.ownerType !== ownerType
      ) {
        return;
      }

      const rawValue = toText(row[header]);

      if (!rawValue) {
        return;
      }

      metafields.push({
        namespace: config.namespace,
        key: config.key,
        type: config.type,
        value: normalizeMetafieldValue(
          rawValue,
          config,
        ),
        ownerType,
      });
    },
  );

  return metafields;
}

function collectProductMetafields(
  rows: GroupedRow[],
  mapping: ColumnMapping,
  metafieldMappings: MetafieldMappingMap,
): PreparedMetafield[] {
  for (const item of rows) {
    const metafields = collectMetafields(
      item.row,
      mapping,
      metafieldMappings,
      "PRODUCT",
    );

    if (metafields.length > 0) {
      return metafields;
    }
  }

  return [];
}

function buildProductOptions(
  variantRows: GroupedRow[],
  allRows: GroupedRow[],
  mapping: ColumnMapping,
): PreparedProductOption[] {
  const optionNames = [1, 2, 3].map(
    (optionIndex) =>
      firstNonEmptyMappedValue(
        allRows,
        mapping,
        `option${optionIndex}Name`,
      ),
  );

  const options: PreparedProductOption[] = [];

  optionNames.forEach(
    (optionName, optionIndex) => {
      if (!optionName) {
        return;
      }

      const values = Array.from(
        new Set(
          variantRows
            .map((item) =>
              getMappedValue(
                item.row,
                mapping,
                `option${optionIndex + 1}Value`,
              ),
            )
            .filter(Boolean),
        ),
      );

      if (values.length === 0) {
        return;
      }

      options.push({
        name: optionName,
        position: optionIndex + 1,
        values,
      });
    },
  );

  if (options.length === 0) {
    return [
      {
        name: "Title",
        position: 1,
        values: ["Default Title"],
      },
    ];
  }

  return options;
}

function buildVariantOptionValues(
  row: Record<string, ImportCell>,
  options: PreparedProductOption[],
  mapping: ColumnMapping,
): PreparedVariantOptionValue[] {
  if (
    options.length === 1 &&
    options[0].name === "Title" &&
    options[0].values[0] ===
      "Default Title"
  ) {
    return [
      {
        optionName: "Title",
        name: "Default Title",
      },
    ];
  }

  return options.map((option, index) => ({
    optionName: option.name,
    name:
      getMappedValue(
        row,
        mapping,
        `option${index + 1}Value`,
      ) || option.values[0],
  }));
}

function buildFiles(
  rows: GroupedRow[],
  mapping: ColumnMapping,
): PreparedProductFile[] {
  const byUrl = new Map<
    string,
    PreparedProductFile
  >();

  rows.forEach(({ row }) => {
    const imageUrl = getMappedValue(
      row,
      mapping,
      "imageSrc",
    );

    const variantImageUrl = getMappedValue(
      row,
      mapping,
      "variantImage",
    );

    const alt = getMappedValue(
      row,
      mapping,
      "imageAltText",
    );

    const position =
      parseInteger(
        getMappedValue(
          row,
          mapping,
          "imagePosition",
        ),
      ) ?? 9999;

    [imageUrl, variantImageUrl]
      .filter(Boolean)
      .forEach((url) => {
        if (!byUrl.has(url)) {
          byUrl.set(url, {
            originalSource: url,
            alt,
            position,
          });
        }
      });
  });

  return Array.from(byUrl.values()).sort(
    (left, right) =>
      left.position - right.position,
  );
}

function prepareProduct(
  group: ProductGroup,
  mapping: ColumnMapping,
  metafieldMappings: MetafieldMappingMap,
): PreparedProduct {
  const warnings: string[] = [];

  let variantRows = group.rows.filter(
    ({ row }) =>
      isVariantDataRow(row, mapping),
  );

  if (variantRows.length === 0) {
    variantRows = [group.rows[0]];
  }

  const productOptions = buildProductOptions(
    variantRows,
    group.rows,
    mapping,
  );

  const files = buildFiles(
    group.rows,
    mapping,
  );

  const variants = variantRows.map(
    ({ row, sourceRow }) => {
      const inventoryTracker =
        normalizeText(
          getMappedValue(
            row,
            mapping,
            "variantInventoryTracker",
          ),
        );

      const inventoryPolicy =
        normalizeText(
          getMappedValue(
            row,
            mapping,
            "variantInventoryPolicy",
          ),
        ) === "continue"
          ? "CONTINUE"
          : "DENY";

      return {
        sourceRow,
        sku: getMappedValue(
          row,
          mapping,
          "variantSku",
        ),
        barcode: getMappedValue(
          row,
          mapping,
          "variantBarcode",
        ),
        price: parseLocalizedNumber(
          getMappedValue(
            row,
            mapping,
            "variantPrice",
          ),
        ),
        compareAtPrice:
          parseLocalizedNumber(
            getMappedValue(
              row,
              mapping,
              "variantCompareAtPrice",
            ),
          ),
        taxable: parseBoolean(
          getMappedValue(
            row,
            mapping,
            "variantTaxable",
          ),
        ),
        requiresShipping: parseBoolean(
          getMappedValue(
            row,
            mapping,
            "variantRequiresShipping",
          ),
        ),
        inventoryPolicy,
        inventoryTracked:
          inventoryTracker === "shopify" ||
          inventoryTracker === "true" ||
          Boolean(
            getMappedValue(
              row,
              mapping,
              "variantInventoryQty",
            ),
          ),
        inventoryQuantity: parseInteger(
          getMappedValue(
            row,
            mapping,
            "variantInventoryQty",
          ),
        ),
        cost: parseLocalizedNumber(
          getMappedValue(
            row,
            mapping,
            "costPerItem",
          ),
        ),
        optionValues:
          buildVariantOptionValues(
            row,
            productOptions,
            mapping,
          ),
        imageUrl:
          getMappedValue(
            row,
            mapping,
            "variantImage",
          ) ||
          getMappedValue(
            row,
            mapping,
            "imageSrc",
          ),
        imageAlt: getMappedValue(
          row,
          mapping,
          "imageAltText",
        ),
        metafields: collectMetafields(
          row,
          mapping,
          metafieldMappings,
          "PRODUCTVARIANT",
        ),
      } satisfies PreparedVariant;
    },
  );

  // Product Category intentionally isn't sent. Shopify can suggest a
  // standard category after import and the merchant can approve it.
  const categoryId = "";

  if (
    firstNonEmptyMappedValue(
      group.rows,
      mapping,
      "collections",
    )
  ) {
    warnings.push(
      "The Collections field is not processed during the initial safe test; collection assignment is handled separately.",
    );
  }

  return {
    sourceKey: group.key,
    sourceRows: group.rows.map(
      (item) => item.sourceRow,
    ),
    handle: firstNonEmptyMappedValue(
      group.rows,
      mapping,
      "handle",
    ),
    title: firstNonEmptyMappedValue(
      group.rows,
      mapping,
      "title",
    ),
    descriptionHtml:
      firstNonEmptyMappedValue(
        group.rows,
        mapping,
        "bodyHtml",
      ),
    vendor: firstNonEmptyMappedValue(
      group.rows,
      mapping,
      "vendor",
    ),
    productType:
      firstNonEmptyMappedValue(
        group.rows,
        mapping,
        "productType",
      ),
    categoryId,
    tags: parseTags(
      firstNonEmptyMappedValue(
        group.rows,
        mapping,
        "tags",
      ),
    ),
    sourceStatus:
      firstNonEmptyMappedValue(
        group.rows,
        mapping,
        "status",
      ),
    seoTitle: firstNonEmptyMappedValue(
      group.rows,
      mapping,
      "seoTitle",
    ),
    seoDescription:
      firstNonEmptyMappedValue(
        group.rows,
        mapping,
        "seoDescription",
      ),
    productOptions,
    variants,
    files,
    metafields: collectProductMetafields(
      group.rows,
      mapping,
      metafieldMappings,
    ),
    warnings,
  };
}

export function prepareImportProducts(
  rows: Record<string, ImportCell>[],
  mapping: ColumnMapping,
  metafieldMappings: MetafieldMappingMap,
): PreparedProduct[] {
  return groupRows(rows, mapping).map(
    (group) =>
      prepareProduct(
        group,
        mapping,
        metafieldMappings,
      ),
  );
}
