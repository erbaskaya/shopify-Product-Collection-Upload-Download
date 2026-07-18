import type { ImportCell } from "./fileParser";
import type { ColumnMapping } from "./shopifyFields";

export type ValidationSeverity =
  | "error"
  | "warning"
  | "info";

export interface ValidationIssue {
  id: string;
  severity: ValidationSeverity;
  code: string;
  message: string;
  fieldId?: string;
  sourceRows: number[];
}

export type ProductValidationStatus =
  | "ready"
  | "warning"
  | "error";

export interface ValidatedProduct {
  id: string;
  key: string;
  handle: string;
  title: string;
  firstSku: string;
  sourceRows: number[];
  variantCount: number;
  imageCount: number;
  errorCount: number;
  warningCount: number;
  status: ProductValidationStatus;
  issues: ValidationIssue[];
}

export interface ProductValidationSummary {
  totalRows: number;
  totalProducts: number;
  totalVariants: number;
  readyProducts: number;
  productsWithErrors: number;
  productsWithWarnings: number;
  errorCount: number;
  warningCount: number;
}

export interface ProductValidationResult {
  summary: ProductValidationSummary;
  products: ValidatedProduct[];
}

interface ProductGroup {
  key: string;
  rows: Array<{
    row: Record<string, ImportCell>;
    sourceRow: number;
  }>;
}

const TRUE_VALUES = new Set([
  "true",
  "1",
  "yes",
  "evet",
]);

const FALSE_VALUES = new Set([
  "false",
  "0",
  "no",
  "hayır",
  "hayir",
]);

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
    (header) => mapping[header] === targetFieldId,
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
  rows: ProductGroup["rows"],
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

function isValidBooleanValue(value: string): boolean {
  if (!value.trim()) {
    return true;
  }

  const normalized = normalizeText(value);

  return (
    TRUE_VALUES.has(normalized) ||
    FALSE_VALUES.has(normalized)
  );
}

function isValidHttpUrl(value: string): boolean {
  if (!value.trim()) {
    return true;
  }

  try {
    const url = new URL(value);

    return (
      url.protocol === "http:" ||
      url.protocol === "https:"
    );
  } catch {
    return false;
  }
}

function createIssue(
  severity: ValidationSeverity,
  code: string,
  message: string,
  sourceRows: number[],
  fieldId?: string,
): ValidationIssue {
  return {
    id: `${code}-${sourceRows.join("-")}-${message}`,
    severity,
    code,
    message,
    sourceRows,
    fieldId,
  };
}

function hasVariantSignal(
  row: Record<string, ImportCell>,
  mapping: ColumnMapping,
): boolean {
  const variantFields = [
    "variantSku",
    "variantBarcode",
    "variantPrice",
    "variantInventoryQty",
    "option1Value",
    "option2Value",
    "option3Value",
  ];

  return variantFields.some(
    (fieldId) =>
      Boolean(
        getMappedValue(row, mapping, fieldId),
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

    const existingGroup = groups.get(groupKey);

    if (existingGroup) {
      existingGroup.rows.push({
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

function validateProductGroup(
  group: ProductGroup,
  mapping: ColumnMapping,
): ValidatedProduct {
  const issues: ValidationIssue[] = [];

  const handle = firstNonEmptyMappedValue(
    group.rows,
    mapping,
    "handle",
  );

  const title = firstNonEmptyMappedValue(
    group.rows,
    mapping,
    "title",
  );

  const firstSku = firstNonEmptyMappedValue(
    group.rows,
    mapping,
    "variantSku",
  );

  const sourceRows = group.rows.map(
    (item) => item.sourceRow,
  );

  if (!title) {
    issues.push(
      createIssue(
        "error",
        "MISSING_TITLE",
        "Product title is missing.",
        sourceRows,
        "title",
      ),
    );
  }

  if (!handle) {
    issues.push(
      createIssue(
        "warning",
        "MISSING_HANDLE",
        "The product Handle is empty. A Handle must be generated automatically during import.",
        sourceRows,
        "handle",
      ),
    );
  }

  const variantRows = group.rows.filter(
    (item) =>
      hasVariantSignal(item.row, mapping),
  );

  const optionNames = [
    firstNonEmptyMappedValue(
      group.rows,
      mapping,
      "option1Name",
    ),
    firstNonEmptyMappedValue(
      group.rows,
      mapping,
      "option2Name",
    ),
    firstNonEmptyMappedValue(
      group.rows,
      mapping,
      "option3Name",
    ),
  ];

  const optionCombinationRows =
    new Map<string, number[]>();

  const uniqueImages = new Set<string>();

  group.rows.forEach(({ row, sourceRow }) => {
    const sku = getMappedValue(
      row,
      mapping,
      "variantSku",
    );

    const priceText = getMappedValue(
      row,
      mapping,
      "variantPrice",
    );

    const compareAtPriceText = getMappedValue(
      row,
      mapping,
      "variantCompareAtPrice",
    );

    const inventoryText = getMappedValue(
      row,
      mapping,
      "variantInventoryQty",
    );

    const imageSrc = getMappedValue(
      row,
      mapping,
      "imageSrc",
    );

    const variantImage = getMappedValue(
      row,
      mapping,
      "variantImage",
    );

    const optionValues = [
      getMappedValue(
        row,
        mapping,
        "option1Value",
      ),
      getMappedValue(
        row,
        mapping,
        "option2Value",
      ),
      getMappedValue(
        row,
        mapping,
        "option3Value",
      ),
    ];

    const isVariantRow = hasVariantSignal(
      row,
      mapping,
    );

    if (isVariantRow && !sku) {
      issues.push(
        createIssue(
          "warning",
          "MISSING_SKU",
          `Source row ${sourceRow}: Variant SKU is empty.`,
          [sourceRow],
          "variantSku",
        ),
      );
    }

    if (priceText) {
      const price = parseLocalizedNumber(
        priceText,
      );

      if (price === null) {
        issues.push(
          createIssue(
            "error",
            "INVALID_PRICE",
            `Source row ${sourceRow}: "${priceText}" is not a valid price.`,
            [sourceRow],
            "variantPrice",
          ),
        );
      } else if (price < 0) {
        issues.push(
          createIssue(
            "error",
            "NEGATIVE_PRICE",
            `Source row ${sourceRow}: Price cannot be negative.`,
            [sourceRow],
            "variantPrice",
          ),
        );
      }

      if (compareAtPriceText) {
        const compareAtPrice =
          parseLocalizedNumber(
            compareAtPriceText,
          );

        if (compareAtPrice === null) {
          issues.push(
            createIssue(
              "error",
              "INVALID_COMPARE_AT_PRICE",
              `Source row ${sourceRow}: "${compareAtPriceText}" is not a valid compare-at price.`,
              [sourceRow],
              "variantCompareAtPrice",
            ),
          );
        } else if (
          price !== null &&
          compareAtPrice < price
        ) {
          issues.push(
            createIssue(
              "warning",
              "COMPARE_AT_BELOW_PRICE",
              `Source row ${sourceRow}: Compare-at price is lower than the selling price.`,
              [sourceRow],
              "variantCompareAtPrice",
            ),
          );
        }
      }
    } else if (isVariantRow) {
      issues.push(
        createIssue(
          "warning",
          "MISSING_PRICE",
          `Source row ${sourceRow}: Variant price is empty.`,
          [sourceRow],
          "variantPrice",
        ),
      );
    }

    if (inventoryText) {
      const inventory =
        parseLocalizedNumber(
          inventoryText,
        );

      if (
        inventory === null ||
        !Number.isInteger(inventory)
      ) {
        issues.push(
          createIssue(
            "error",
            "INVALID_INVENTORY",
            `Source row ${sourceRow}: Inventory quantity must be an integer.`,
            [sourceRow],
            "variantInventoryQty",
          ),
        );
      } else if (inventory < 0) {
        issues.push(
          createIssue(
            "warning",
            "NEGATIVE_INVENTORY",
            `Source row ${sourceRow}: Inventory quantity is negative.`,
            [sourceRow],
            "variantInventoryQty",
          ),
        );
      }
    }

    [
      {
        fieldId: "published",
        label: "Published",
      },
      {
        fieldId: "variantTaxable",
        label: "Variant Taxable",
      },
      {
        fieldId: "variantRequiresShipping",
        label: "Variant Requires Shipping",
      },
    ].forEach(({ fieldId, label }) => {
      const value = getMappedValue(
        row,
        mapping,
        fieldId,
      );

      if (
        value &&
        !isValidBooleanValue(value)
      ) {
        issues.push(
          createIssue(
            "warning",
            "INVALID_BOOLEAN",
            `Source row ${sourceRow}: ${label} must be TRUE or FALSE.`,
            [sourceRow],
            fieldId,
          ),
        );
      }
    });

    [
      {
        fieldId: "imageSrc",
        value: imageSrc,
        label: "Product image",
      },
      {
        fieldId: "variantImage",
        value: variantImage,
        label: "Variant image",
      },
    ].forEach(
      ({ fieldId, value, label }) => {
        if (
          value &&
          !isValidHttpUrl(value)
        ) {
          issues.push(
            createIssue(
              "warning",
              "INVALID_IMAGE_URL",
              `Source row ${sourceRow}: ${label} contains an invalid URL.`,
              [sourceRow],
              fieldId,
            ),
          );
        }
      },
    );

    if (imageSrc) {
      uniqueImages.add(imageSrc);
    }

    if (variantImage) {
      uniqueImages.add(variantImage);
    }

    optionValues.forEach(
      (optionValue, optionIndex) => {
        if (
          optionValue &&
          !optionNames[optionIndex]
        ) {
          issues.push(
            createIssue(
              "error",
              "OPTION_NAME_MISSING",
              `Source row ${sourceRow}: Option${optionIndex + 1} Value is present, but the option name is missing.`,
              [sourceRow],
              `option${optionIndex + 1}Name`,
            ),
          );
        }

        if (
          isVariantRow &&
          optionNames[optionIndex] &&
          !optionValue
        ) {
          issues.push(
            createIssue(
              "warning",
              "OPTION_VALUE_MISSING",
              `Source row ${sourceRow}: The value for option "${optionNames[optionIndex]}" is empty.`,
              [sourceRow],
              `option${optionIndex + 1}Value`,
            ),
          );
        }
      },
    );

    const activeOptionValues =
      optionValues.filter(
        (value, index) =>
          Boolean(optionNames[index]) ||
          Boolean(value),
      );

    if (
      isVariantRow &&
      activeOptionValues.length > 0
    ) {
      const combinationKey =
        activeOptionValues
          .map((value) =>
            normalizeText(value),
          )
          .join("||");

      if (combinationKey) {
        const existingRows =
          optionCombinationRows.get(
            combinationKey,
          ) ?? [];

        existingRows.push(sourceRow);

        optionCombinationRows.set(
          combinationKey,
          existingRows,
        );
      }
    }
  });

  optionCombinationRows.forEach(
    (rowsWithCombination) => {
      if (
        rowsWithCombination.length > 1
      ) {
        issues.push(
          createIssue(
            "error",
            "DUPLICATE_OPTION_COMBINATION",
            `The same variant option combination is used more than once: rows ${rowsWithCombination.join(", ")}.`,
            rowsWithCombination,
          ),
        );
      }
    },
  );

  const uniqueIssues = Array.from(
    new Map(
      issues.map((issue) => [
        issue.id,
        issue,
      ]),
    ).values(),
  );

  const errorCount = uniqueIssues.filter(
    (issue) =>
      issue.severity === "error",
  ).length;

  const warningCount = uniqueIssues.filter(
    (issue) =>
      issue.severity === "warning",
  ).length;

  const status: ProductValidationStatus =
    errorCount > 0
      ? "error"
      : warningCount > 0
        ? "warning"
        : "ready";

  return {
    id: group.key,
    key: group.key,
    handle,
    title,
    firstSku,
    sourceRows,
    variantCount: Math.max(
      variantRows.length,
      1,
    ),
    imageCount: uniqueImages.size,
    errorCount,
    warningCount,
    status,
    issues: uniqueIssues,
  };
}

function addDuplicateSkuIssues(
  products: ValidatedProduct[],
  groups: ProductGroup[],
  mapping: ColumnMapping,
): ValidatedProduct[] {
  const skuMap = new Map<
    string,
    Array<{
      productKey: string;
      sourceRow: number;
      originalSku: string;
    }>
  >();

  groups.forEach((group) => {
    group.rows.forEach(
      ({ row, sourceRow }) => {
        const sku = getMappedValue(
          row,
          mapping,
          "variantSku",
        );

        if (!sku) {
          return;
        }

        const normalizedSku =
          normalizeText(sku);

        const entries =
          skuMap.get(normalizedSku) ?? [];

        entries.push({
          productKey: group.key,
          sourceRow,
          originalSku: sku,
        });

        skuMap.set(
          normalizedSku,
          entries,
        );
      },
    );
  });

  const duplicateSkuMap = new Map<
    string,
    typeof skuMap extends Map<
      string,
      infer TValue
    >
      ? TValue
      : never
  >();

  skuMap.forEach((entries, sku) => {
    if (entries.length > 1) {
      duplicateSkuMap.set(sku, entries);
    }
  });

  return products.map((product) => {
    const nextIssues = [
      ...product.issues,
    ];

    duplicateSkuMap.forEach(
      (entries) => {
        const currentEntries =
          entries.filter(
            (entry) =>
              entry.productKey ===
              product.key,
          );

        if (
          currentEntries.length === 0
        ) {
          return;
        }

        const allRows = entries.map(
          (entry) => entry.sourceRow,
        );

        const skuLabel =
          entries[0]?.originalSku ?? "";

        nextIssues.push(
          createIssue(
            "error",
            "DUPLICATE_SKU",
            `SKU "${skuLabel}" is used on multiple rows: ${allRows.join(", ")}.`,
            allRows,
            "variantSku",
          ),
        );
      },
    );

    const uniqueIssues = Array.from(
      new Map(
        nextIssues.map((issue) => [
          issue.id,
          issue,
        ]),
      ).values(),
    );

    const errorCount =
      uniqueIssues.filter(
        (issue) =>
          issue.severity === "error",
      ).length;

    const warningCount =
      uniqueIssues.filter(
        (issue) =>
          issue.severity ===
          "warning",
      ).length;

    const status: ProductValidationStatus =
      errorCount > 0
        ? "error"
        : warningCount > 0
          ? "warning"
          : "ready";

    return {
      ...product,
      issues: uniqueIssues,
      errorCount,
      warningCount,
      status,
    };
  });
}

export function validateProductImport(
  rows: Record<string, ImportCell>[],
  mapping: ColumnMapping,
): ProductValidationResult {
  const groups = groupRows(
    rows,
    mapping,
  );

  const initiallyValidatedProducts =
    groups.map((group) =>
      validateProductGroup(
        group,
        mapping,
      ),
    );

  const products =
    addDuplicateSkuIssues(
      initiallyValidatedProducts,
      groups,
      mapping,
    );

  const readyProducts = products.filter(
    (product) =>
      product.status === "ready",
  ).length;

  const productsWithErrors =
    products.filter(
      (product) =>
        product.status === "error",
    ).length;

  const productsWithWarnings =
    products.filter(
      (product) =>
        product.warningCount > 0,
    ).length;

  const errorCount = products.reduce(
    (total, product) =>
      total + product.errorCount,
    0,
  );

  const warningCount =
    products.reduce(
      (total, product) =>
        total +
        product.warningCount,
      0,
    );

  const totalVariants =
    products.reduce(
      (total, product) =>
        total +
        product.variantCount,
      0,
    );

  return {
    summary: {
      totalRows: rows.length,
      totalProducts: products.length,
      totalVariants,
      readyProducts,
      productsWithErrors,
      productsWithWarnings,
      errorCount,
      warningCount,
    },
    products,
  };
}
