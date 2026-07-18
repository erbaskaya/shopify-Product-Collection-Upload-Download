import type { ColumnMapping } from "./shopifyFields";

export const METAFIELD_MAPPING_VALUE = "__CUSTOM_METAFIELD__";

export type MetafieldOwnerType =
  | "PRODUCT"
  | "PRODUCTVARIANT"
  | "COLLECTION";

export type ShopifyMetafieldType =
  | "single_line_text_field"
  | "multi_line_text_field"
  | "rich_text_field"
  | "number_integer"
  | "number_decimal"
  | "boolean"
  | "date"
  | "date_time"
  | "url"
  | "json"
  | "color"
  | "money"
  | "weight"
  | "volume"
  | "dimension"
  | "list.single_line_text_field"
  | "list.number_integer"
  | "list.number_decimal"
  | "list.url";

export interface MetafieldMappingConfig {
  ownerType: MetafieldOwnerType;
  namespace: string;
  key: string;
  type: ShopifyMetafieldType;
  createDefinition: boolean;
}

export type MetafieldMappingMap = Record<
  string,
  MetafieldMappingConfig
>;

export interface MetafieldAwareMappingResult {
  mapping: ColumnMapping;
  metafieldMappings: MetafieldMappingMap;
}

export const METAFIELD_OWNER_OPTIONS: Array<{
  value: MetafieldOwnerType;
  label: string;
}> = [
  {
    value: "PRODUCT",
    label: "Product",
  },
  {
    value: "PRODUCTVARIANT",
    label: "Variant",
  },
  {
    value: "COLLECTION",
    label: "Collection",
  },
];

export const METAFIELD_TYPE_OPTIONS: Array<{
  value: ShopifyMetafieldType;
  label: string;
}> = [
  {
    value: "single_line_text_field",
    label: "Single-line text",
  },
  {
    value: "multi_line_text_field",
    label: "Multi-line text",
  },
  {
    value: "rich_text_field",
    label: "Rich text",
  },
  {
    value: "number_integer",
    label: "Integer",
  },
  {
    value: "number_decimal",
    label: "Decimal",
  },
  {
    value: "boolean",
    label: "True / False",
  },
  {
    value: "date",
    label: "Date",
  },
  {
    value: "date_time",
    label: "Date and time",
  },
  {
    value: "url",
    label: "URL",
  },
  {
    value: "json",
    label: "JSON",
  },
  {
    value: "color",
    label: "Color",
  },
  {
    value: "money",
    label: "Money",
  },
  {
    value: "weight",
    label: "Weight",
  },
  {
    value: "volume",
    label: "Volume",
  },
  {
    value: "dimension",
    label: "Dimension",
  },
  {
    value: "list.single_line_text_field",
    label: "Text list",
  },
  {
    value: "list.number_integer",
    label: "Integer list",
  },
  {
    value: "list.number_decimal",
    label: "Decimal list",
  },
  {
    value: "list.url",
    label: "URL list",
  },
];

const METAFIELD_TYPES = new Set<string>(
  METAFIELD_TYPE_OPTIONS.map((option) => option.value),
);

function normalizeIdentifier(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/\[[^\]]+\]\s*$/g, "")
    .replace(/^metafield\s*:\s*/i, "")
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

function parseHeaderParts(header: string): {
  namespace?: string;
  key?: string;
  type?: ShopifyMetafieldType;
} {
  const trimmedHeader = header.trim();

  const typeMatch = trimmedHeader.match(
    /\[([a-z0-9_.]+)\]\s*$/i,
  );

  const rawType = typeMatch?.[1] ?? "";

  const type = METAFIELD_TYPES.has(rawType)
    ? (rawType as ShopifyMetafieldType)
    : undefined;

  const headerWithoutType = trimmedHeader
    .replace(/\[[^\]]+\]\s*$/i, "")
    .replace(/^metafield\s*:\s*/i, "")
    .trim();

  const pathMatch = headerWithoutType.match(
    /^([a-z0-9_-]+)\.([a-z0-9_-]+)$/i,
  );

  if (!pathMatch) {
    return {
      type,
    };
  }

  return {
    namespace: pathMatch[1],
    key: pathMatch[2],
    type,
  };
}

export function isLikelyMetafieldHeader(
  header: string,
): boolean {
  const trimmedHeader = header.trim();

  if (/^metafield\s*:/i.test(trimmedHeader)) {
    return true;
  }

  if (
    /^[a-z0-9_-]+\.[a-z0-9_-]+(?:\s*\[[a-z0-9_.]+\])?$/i.test(
      trimmedHeader,
    )
  ) {
    return true;
  }

  return /\[(?:single_line_text_field|multi_line_text_field|rich_text_field|number_integer|number_decimal|boolean|date|date_time|url|json|color|money|weight|volume|dimension|list\.[a-z0-9_]+)\]\s*$/i.test(
    trimmedHeader,
  );
}

export function createDefaultMetafieldConfig(
  header: string,
): MetafieldMappingConfig {
  const parsedHeader = parseHeaderParts(header);

  const fallbackKey =
    normalizeIdentifier(header) || "custom_field";

  return {
    ownerType: "PRODUCT",
    namespace: parsedHeader.namespace ?? "custom",
    key: parsedHeader.key ?? fallbackKey,
    type:
      parsedHeader.type ?? "single_line_text_field",
    createDefinition: true,
  };
}

export function isMetafieldConfigValid(
  config: MetafieldMappingConfig | undefined,
): boolean {
  if (!config) {
    return false;
  }

  const identifierPattern = /^[a-zA-Z0-9_-]+$/;

  return (
    identifierPattern.test(config.namespace.trim()) &&
    identifierPattern.test(config.key.trim()) &&
    METAFIELD_TYPES.has(config.type)
  );
}

export function formatMetafieldPath(
  config: MetafieldMappingConfig | undefined,
): string {
  if (!config) {
    return "Metafield information is incomplete";
  }

  return `${config.namespace}.${config.key} [${config.type}]`;
}

export function createMetafieldAwareMapping(
  headers: string[],
  standardMapping: ColumnMapping,
): MetafieldAwareMappingResult {
  const mapping: ColumnMapping = {
    ...standardMapping,
  };

  const metafieldMappings: MetafieldMappingMap = {};

  headers.forEach((header) => {
    if (mapping[header]) {
      return;
    }

    if (!isLikelyMetafieldHeader(header)) {
      return;
    }

    mapping[header] = METAFIELD_MAPPING_VALUE;
    metafieldMappings[header] =
      createDefaultMetafieldConfig(header);
  });

  return {
    mapping,
    metafieldMappings,
  };
}
