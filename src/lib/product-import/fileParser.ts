import * as XLSX from "xlsx";

export type ImportCell = string | number | boolean | null;

export interface ParsedSheet {
  name: string;
  headers: string[];
  rows: Record<string, ImportCell>[];
  totalRows: number;
}

export interface ParsedImportFile {
  fileName: string;
  extension: string;
  size: number;
  sheets: ParsedSheet[];
}

const SUPPORTED_EXTENSIONS = [".csv", ".xlsx", ".xls", ".json"];

export function getFileExtension(fileName: string): string {
  const lastDotIndex = fileName.lastIndexOf(".");

  if (lastDotIndex === -1) {
    return "";
  }

  return fileName.slice(lastDotIndex).toLowerCase();
}

export function isSupportedImportFile(file: File): boolean {
  return SUPPORTED_EXTENSIONS.includes(getFileExtension(file.name));
}

function normalizeCell(value: unknown): ImportCell {
  if (value === undefined || value === null) {
    return null;
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function createUniqueHeaders(values: unknown[]): string[] {
  const usedHeaders = new Map<string, number>();

  return values.map((value, index) => {
    const originalHeader = String(value ?? "").trim();
    const baseHeader = originalHeader || `Column ${index + 1}`;

    const currentCount = usedHeaders.get(baseHeader) ?? 0;
    const nextCount = currentCount + 1;

    usedHeaders.set(baseHeader, nextCount);

    if (nextCount === 1) {
      return baseHeader;
    }

    return `${baseHeader}_${nextCount}`;
  });
}

function parseWorksheet(
  sheetName: string,
  worksheet: XLSX.WorkSheet,
): ParsedSheet {
  const rawRows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    defval: "",
    raw: false,
    blankrows: false,
  });

  if (rawRows.length === 0) {
    return {
      name: sheetName,
      headers: [],
      rows: [],
      totalRows: 0,
    };
  }

  const headerValues = Array.isArray(rawRows[0]) ? rawRows[0] : [];
  const headers = createUniqueHeaders(headerValues);

  const rows = rawRows
    .slice(1)
    .filter((row) => {
      if (!Array.isArray(row)) {
        return false;
      }

      return row.some((cell) => String(cell ?? "").trim() !== "");
    })
    .map((row) => {
      const record: Record<string, ImportCell> = {};

      headers.forEach((header, columnIndex) => {
        record[header] = normalizeCell(
          Array.isArray(row) ? row[columnIndex] : null,
        );
      });

      return record;
    });

  return {
    name: sheetName,
    headers,
    rows,
    totalRows: rows.length,
  };
}

function parseJsonData(fileName: string, jsonValue: unknown): ParsedSheet {
  let sourceRows: unknown[];

  if (Array.isArray(jsonValue)) {
    sourceRows = jsonValue;
  } else if (
    jsonValue &&
    typeof jsonValue === "object" &&
    "products" in jsonValue &&
    Array.isArray((jsonValue as { products?: unknown[] }).products)
  ) {
    sourceRows = (jsonValue as { products: unknown[] }).products;
  } else {
    sourceRows = [jsonValue];
  }

  const objectRows = sourceRows.map((item) => {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      return item as Record<string, unknown>;
    }

    return {
      value: item,
    };
  });

  const headerSet = new Set<string>();

  objectRows.forEach((row) => {
    Object.keys(row).forEach((key) => headerSet.add(key));
  });

  const headers = Array.from(headerSet);

  const rows = objectRows.map((row) => {
    const record: Record<string, ImportCell> = {};

    headers.forEach((header) => {
      record[header] = normalizeCell(row[header]);
    });

    return record;
  });

  return {
    name: fileName.replace(/\.json$/i, "") || "JSON",
    headers,
    rows,
    totalRows: rows.length,
  };
}

export async function parseImportFile(
  file: File,
): Promise<ParsedImportFile> {
  if (!isSupportedImportFile(file)) {
    throw new Error(
      "Unsupported file type. Select a CSV, XLSX, XLS, or JSON file.",
    );
  }

  const extension = getFileExtension(file.name);

  if (extension === ".json") {
    const fileText = await file.text();

    let parsedJson: unknown;

    try {
      parsedJson = JSON.parse(fileText);
    } catch {
      throw new Error("The JSON file could not be read. Its structure is invalid.");
    }

    return {
      fileName: file.name,
      extension,
      size: file.size,
      sheets: [parseJsonData(file.name, parsedJson)],
    };
  }

  const arrayBuffer = await file.arrayBuffer();

  let workbook: XLSX.WorkBook;

  try {
    workbook = XLSX.read(arrayBuffer, {
      type: "array",
      cellDates: true,
    });
  } catch {
    throw new Error(
      "The file could not be read. The Excel or CSV file may be damaged.",
    );
  }

  const sheets = workbook.SheetNames.map((sheetName) => {
    const worksheet = workbook.Sheets[sheetName];

    return parseWorksheet(sheetName, worksheet);
  });

  return {
    fileName: file.name,
    extension,
    size: file.size,
    sheets,
  };
}