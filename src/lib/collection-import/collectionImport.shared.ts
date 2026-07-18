import * as XLSX from "xlsx";

export type CollectionImportRow = Record<string, string>;

export interface ParsedCollectionFile {
  filename: string;
  sheetName: string;
  headers: string[];
  rows: CollectionImportRow[];
}

export interface CollectionImportIssue {
  level: "error" | "warning";
  message: string;
}

export interface CollectionImportValidation {
  rowIndex: number;
  handle: string;
  title: string;
  sourceCount: number;
  conditionCount: number;
  manualSelectionCount: number;
  exclusionCount: number;
  subCollectionCount: number;
  issues: CollectionImportIssue[];
  status: "ready" | "warning" | "error";
}

export interface CollectionImportSettings {
  mode: "upsert" | "create-only" | "update-only";
  batchSize: number;
  replaceSources: boolean;
  includeImage: boolean;
  imageFailurePolicy: "skip-image" | "fail";
  includeMetafields: boolean;
  continueOnError: boolean;
}

export interface CollectionImportResult {
  ok: boolean;
  action?: "created" | "updated" | "skipped" | "test-created";
  collectionId?: string;
  collectionLegacyId?: string;
  collectionTitle?: string;
  collectionHandle?: string;
  adminUrl?: string;
  warnings?: string[];
  error?: string;
}

const REQUIRED_COLUMNS = [
  "Handle",
  "Title",
  "Sources JSON",
];

function cleanCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

function normalizeRows(
  inputRows: Record<string, unknown>[],
): CollectionImportRow[] {
  return inputRows
    .map((row) => {
      const normalized: CollectionImportRow = {};

      for (const [key, value] of Object.entries(row)) {
        normalized[String(key).trim()] = cleanCell(value);
      }

      return normalized;
    })
    .filter((row) => Object.values(row).some(Boolean));
}

function parseCsvText(text: string): ParsedCollectionFile {
  const workbook = XLSX.read(text, {
    type: "string",
    raw: false,
  });

  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = normalizeRows(
    XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: "",
      raw: false,
    }),
  );

  return {
    filename: "",
    sheetName,
    headers: rows.length > 0 ? Object.keys(rows[0]) : [],
    rows,
  };
}

function parseWorkbookBuffer(buffer: ArrayBuffer): ParsedCollectionFile {
  const workbook = XLSX.read(buffer, {
    type: "array",
    cellDates: true,
    raw: false,
  });

  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = normalizeRows(
    XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: "",
      raw: false,
    }),
  );

  return {
    filename: "",
    sheetName,
    headers: rows.length > 0 ? Object.keys(rows[0]) : [],
    rows,
  };
}

function parseJsonText(text: string): ParsedCollectionFile {
  const parsed = JSON.parse(text) as unknown;

  let sourceRows: Record<string, unknown>[];

  if (Array.isArray(parsed)) {
    sourceRows = parsed as Record<string, unknown>[];
  } else if (
    parsed &&
    typeof parsed === "object" &&
    Array.isArray((parsed as { rows?: unknown[] }).rows)
  ) {
    sourceRows = (parsed as { rows: Record<string, unknown>[] }).rows;
  } else {
    throw new Error(
      "The JSON file must contain an array of rows directly or a rows property.",
    );
  }

  const rows = normalizeRows(sourceRows);

  return {
    filename: "",
    sheetName: "JSON",
    headers: rows.length > 0 ? Object.keys(rows[0]) : [],
    rows,
  };
}

export async function parseCollectionImportFile(
  file: File,
): Promise<ParsedCollectionFile> {
  const extension = file.name.split(".").pop()?.toLowerCase();

  let result: ParsedCollectionFile;

  if (extension === "json") {
    result = parseJsonText(await file.text());
  } else if (extension === "csv") {
    result = parseCsvText(await file.text());
  } else if (extension === "xlsx" || extension === "xls") {
    result = parseWorkbookBuffer(await file.arrayBuffer());
  } else {
    throw new Error("Only CSV, XLSX, XLS, and JSON files are supported.");
  }

  return {
    ...result,
    filename: file.name,
  };
}

export function missingRequiredColumns(headers: string[]): string[] {
  const headerSet = new Set(headers.map((header) => header.trim()));
  return REQUIRED_COLUMNS.filter((column) => !headerSet.has(column));
}

function parseJsonArray(value: string, column: string): unknown[] {
  if (!value.trim()) return [];

  const parsed = JSON.parse(value) as unknown;

  if (!Array.isArray(parsed)) {
    throw new Error(`${column} must be a JSON array.`);
  }

  return parsed;
}

function getConditionType(condition: unknown): string {
  if (!condition || typeof condition !== "object") return "Unknown";
  const value = condition as Record<string, unknown>;
  return String(value.__typename || value.type || "Unknown");
}

const PORTABLE_CONDITION_TYPES = new Set([
  "CollectionSourceInclusionConditionProductTag",
  "CollectionSourceInclusionConditionProductTitle",
  "CollectionSourceInclusionConditionProductType",
  "CollectionSourceInclusionConditionProductVendor",
  "CollectionSourceInclusionConditionProductStatus",
  "CollectionSourceInclusionConditionProductCategory",
  "CollectionSourceInclusionConditionVariantTitle",
  "CollectionSourceInclusionConditionVariantInventory",
  "CollectionSourceInclusionConditionVariantPrice",
  "CollectionSourceInclusionConditionVariantCompareAtPrice",
  "CollectionSourceInclusionConditionVariantWeight",
  "CollectionSourceExclusionConditionCollection",
  "CollectionSourceExclusionConditionProductTag",
  "CollectionSourceExclusionConditionProductType",
  "CollectionSourceExclusionConditionProductVendor",
  "CollectionSourceExclusionConditionProductCategory",
]);

export function validateCollectionRows(
  rows: CollectionImportRow[],
): CollectionImportValidation[] {
  const handles = new Map<string, number>();

  return rows.map((row, index) => {
    const issues: CollectionImportIssue[] = [];
    const handle = row.Handle?.trim() || "";
    const title = row.Title?.trim() || "";

    if (!handle) {
      issues.push({
        level: "error",
        message: "Handle cannot be empty.",
      });
    }

    if (!title) {
      issues.push({
        level: "error",
        message: "Title cannot be empty.",
      });
    }

    if (handle) {
      const previous = handles.get(handle);
      if (previous !== undefined) {
        issues.push({
          level: "error",
          message: `The same Handle is used more than once in the file: row ${previous + 2}.`,
        });
      } else {
        handles.set(handle, index);
      }
    }

    let sources: unknown[] = [];
    let inclusionConditions: unknown[] = [];
    let inclusionSelections: unknown[] = [];
    let exclusionConditions: unknown[] = [];
    let exclusionSelections: unknown[] = [];
    let subCollections: unknown[] = [];

    try {
      sources = parseJsonArray(row["Sources JSON"] || "", "Sources JSON");
    } catch (error) {
      issues.push({
        level: "error",
        message: error instanceof Error ? error.message : "Sources JSON could not be parsed.",
      });
    }

    try {
      inclusionConditions = parseJsonArray(
        row["Inclusion Conditions JSON"] || "",
        "Inclusion Conditions JSON",
      );
    } catch (error) {
      issues.push({
        level: "error",
        message:
          error instanceof Error
            ? error.message
            : "Inclusion Conditions JSON could not be parsed.",
      });
    }

    try {
      inclusionSelections = parseJsonArray(
        row["Inclusion Selections JSON"] || "",
        "Inclusion Selections JSON",
      );
    } catch (error) {
      issues.push({
        level: "error",
        message:
          error instanceof Error
            ? error.message
            : "Inclusion Selections JSON could not be parsed.",
      });
    }

    try {
      exclusionConditions = parseJsonArray(
        row["Exclusion Conditions JSON"] || "",
        "Exclusion Conditions JSON",
      );
    } catch (error) {
      issues.push({
        level: "error",
        message:
          error instanceof Error
            ? error.message
            : "Exclusion Conditions JSON could not be parsed.",
      });
    }

    try {
      exclusionSelections = parseJsonArray(
        row["Exclusion Selections JSON"] || "",
        "Exclusion Selections JSON",
      );
    } catch (error) {
      issues.push({
        level: "error",
        message:
          error instanceof Error
            ? error.message
            : "Exclusion Selections JSON could not be parsed.",
      });
    }

    try {
      subCollections = parseJsonArray(
        row["Sub-Collections JSON"] || "",
        "Sub-Collections JSON",
      );
    } catch (error) {
      issues.push({
        level: "error",
        message:
          error instanceof Error
            ? error.message
            : "Sub-Collections JSON could not be parsed.",
      });
    }

    const allConditions = [
      ...inclusionConditions,
      ...exclusionConditions,
    ];

    const unsupportedTypes = Array.from(
      new Set(
        allConditions
          .map(getConditionType)
          .filter(
            (type) =>
              type !== "Unknown" && !PORTABLE_CONDITION_TYPES.has(type),
          ),
      ),
    );

    if (unsupportedTypes.length > 0) {
      issues.push({
        level: "warning",
        message: `Unsupported condition types will be skipped in this version: ${unsupportedTypes.join(
          ", ",
        )}.`,
      });
    }

    const hasVariantSelections = inclusionSelections.some((selection) => {
      if (!selection || typeof selection !== "object") return false;
      const ids = (selection as { variantIds?: unknown }).variantIds;
      return Array.isArray(ids) && ids.length > 0;
    });

    if (hasVariantSelections) {
      issues.push({
        level: "warning",
        message:
          "Variant IDs are store-specific. Variant selections are imported at product level in this version.",
      });
    }

    if (sources.length === 0) {
      issues.push({
        level: "warning",
        message:
          "No source was found. The collection can still be created or updated with an empty source structure.",
      });
    }

    if (row["Has App Sources"] === "TRUE") {
      issues.push({
        level: "warning",
        message:
          "A source owned by another app is recreated as a normal collection source in the destination store.",
      });
    }

    const status: CollectionImportValidation["status"] = issues.some(
      (issue) => issue.level === "error",
    )
      ? "error"
      : issues.some((issue) => issue.level === "warning")
        ? "warning"
        : "ready";

    return {
      rowIndex: index,
      handle,
      title,
      sourceCount: sources.length,
      conditionCount: inclusionConditions.length,
      manualSelectionCount: inclusionSelections.length,
      exclusionCount:
        exclusionConditions.length + exclusionSelections.length,
      subCollectionCount: subCollections.length,
      issues,
      status,
    };
  });
}
