import { externalText } from "../shopifyClient";
import * as XLSX from "xlsx";

type AdminClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

export type CollectionExportFormat = "csv" | "xlsx" | "json";

export interface CollectionExportOperation {
  id: string;
  status: string;
  objectCount: string;
  rootObjectCount: string;
  fileSize: string | null;
  url: string | null;
  partialDataUrl: string | null;
  errorCode: string | null;
  createdAt: string;
  completedAt: string | null;
}

export type SourceFilter =
  | "all"
  | "conditions"
  | "manual-selections"
  | "exclusions"
  | "subcollections"
  | "app-sources"
  | "hybrid"
  | "products"
  | "variants";

interface CollectionLine {
  __typename: "Collection";
  id: string;
  legacyResourceId: string;
  handle: string;
  title: string;
  descriptionHtml: string;
  sortOrder: string;
  templateSuffix: string | null;
  updatedAt: string;
  image: {
    url: string;
    altText: string | null;
  } | null;
  seo: {
    title: string | null;
    description: string | null;
  };
  productsCount: {
    count: number;
  };
  resourcePublicationsCount: {
    count: number;
  };
  availablePublicationsCount: {
    count: number;
  };
}

interface ProductLine {
  __typename: "Product";
  __parentId: string;
  id: string;
  handle: string;
  title: string;
}

interface MetafieldLine {
  __typename: "Metafield";
  __parentId: string;
  namespace: string;
  key: string;
  type: string;
  value: string;
}

interface CollectionRecord extends CollectionLine {
  products: ProductLine[];
  metafields: MetafieldLine[];
  sources: CollectionSource[];
}

interface ProductSelection {
  product: {
    id: string;
    handle: string;
    title: string;
  };
  variantIds?: string[];
}

interface SourceCondition {
  __typename: string;
  id: string;
  [key: string]: unknown;
}

interface CollectionConditionsSource {
  __typename: "CollectionConditionsSource";
  id: string;
  title: string;
  description: string | null;
  app: {
    id: string;
    title: string;
  } | null;
  targetType: "PRODUCTS" | "VARIANTS";
  shareable: boolean;
  inclusion: {
    matchType: string | null;
    conditions: SourceCondition[];
    selections: {
      nodes: ProductSelection[];
    };
  };
  exclusion: {
    matchType: string | null;
    conditions: SourceCondition[];
    selections: {
      nodes: ProductSelection[];
    };
  } | null;
}

interface CollectionSubCollectionsSource {
  __typename: "CollectionSubCollectionsSource";
  id: string;
  title: string;
  description: string | null;
  app: {
    id: string;
    title: string;
  } | null;
  collections: Array<{
    id: string;
    handle: string;
    title: string;
  }>;
}

type CollectionSource =
  | CollectionConditionsSource
  | CollectionSubCollectionsSource;

interface SourceSummary {
  sourceCount: number;
  sourceTypes: string[];
  targetTypes: string[];
  hasConditions: boolean;
  hasManualSelections: boolean;
  hasExclusions: boolean;
  hasSubCollections: boolean;
  hasAppSources: boolean;
  isHybrid: boolean;
  inclusionMatchTypes: string[];
  exclusionMatchTypes: string[];
  inclusionConditions: Array<Record<string, unknown>>;
  inclusionSelections: Array<Record<string, unknown>>;
  exclusionConditions: Array<Record<string, unknown>>;
  exclusionSelections: Array<Record<string, unknown>>;
  subCollections: Array<Record<string, unknown>>;
  sources: CollectionSource[];
}

type ExportRow = Record<string, string | number | boolean>;

const BASE_COLUMNS = [
  "ID",
  "Legacy Resource ID",
  "Handle",
  "Title",
  "Body (HTML)",
  "Sort Order",
  "Template Suffix",
  "Image Src",
  "Image Alt Text",
  "SEO Title",
  "SEO Description",
  "Products Count",
  "Product Handles",
  "Product IDs",
  "Source Count",
  "Source Types",
  "Target Types",
  "Has Conditions",
  "Has Manual Selections",
  "Has Exclusions",
  "Has Sub-Collections",
  "Has App Sources",
  "Is Hybrid",
  "Inclusion Match Types",
  "Exclusion Match Types",
  "Inclusion Conditions JSON",
  "Inclusion Selections JSON",
  "Exclusion Conditions JSON",
  "Exclusion Selections JSON",
  "Sub-Collections JSON",
  "Sources JSON",
  "Published Channels Count",
  "Available Publications Count",
  "Updated At",
];

function buildBulkQuery(
  query: string,
  includeProducts: boolean,
  includeMetafields: boolean,
): string {
  const argument = query.trim()
    ? `(query: ${JSON.stringify(query.trim())})`
    : "";

  const productsConnection = includeProducts
    ? `
      products {
        edges {
          node {
            __typename
            id
            handle
            title
          }
        }
      }
    `
    : "";

  const metafieldsConnection = includeMetafields
    ? `
      metafields(first: 250) {
        edges {
          node {
            __typename
            namespace
            key
            type
            value
          }
        }
      }
    `
    : "";

  return `{
    collections${argument} {
      edges {
        node {
          __typename
          id
          legacyResourceId
          handle
          title
          descriptionHtml
          sortOrder
          templateSuffix
          updatedAt

          image {
            url
            altText
          }

          seo {
            title
            description
          }

          productsCount {
            count
          }

          resourcePublicationsCount {
            count
          }

          availablePublicationsCount {
            count
          }

          ${productsConnection}
          ${metafieldsConnection}
        }
      }
    }
  }`;
}

const SOURCE_SELECTION = `
  sources {
    __typename
    id
    title
    description
    app {
      id
      title
    }

    ... on CollectionConditionsSource {
      targetType
      shareable

      inclusion {
        matchType

        conditions {
          __typename
          id

          ... on CollectionSourceInclusionConditionProductTag {
            tagRelation: relation
            tagValues: values
            tagMatchType: matchType
          }

          ... on CollectionSourceInclusionConditionProductTitle {
            productTitleRelation: relation
            productTitleValues: values
            productTitleMatchType: matchType
          }

          ... on CollectionSourceInclusionConditionProductType {
            productTypeRelation: relation
            productTypeValues: values
            productTypeMatchType: matchType
          }

          ... on CollectionSourceInclusionConditionProductVendor {
            productVendorRelation: relation
            productVendorValues: values
            productVendorMatchType: matchType
          }

          ... on CollectionSourceInclusionConditionProductStatus {
            productStatusRelation: relation
            productStatusValues: values
            productStatusMatchType: matchType
          }

          ... on CollectionSourceInclusionConditionProductCategory {
            productCategoryRelation: relation
            productCategoryMatchType: matchType
            productCategoryValues: values {
              includeDescendants
              category {
                id
                name
                fullName
              }
            }
          }

          ... on CollectionSourceInclusionConditionVariantTitle {
            variantTitleRelation: relation
            variantTitleValues: values
            variantTitleMatchType: matchType
          }

          ... on CollectionSourceInclusionConditionVariantInventory {
            variantInventoryRelation: relation
            variantInventoryValue: value
          }

          ... on CollectionSourceInclusionConditionVariantPrice {
            variantPriceRelation: relation
            variantPriceValue: value {
              amount
              currencyCode
            }
          }

          ... on CollectionSourceInclusionConditionVariantCompareAtPrice {
            compareAtPriceRelation: relation
            compareAtPriceValue: value {
              amount
              currencyCode
            }
          }

          ... on CollectionSourceInclusionConditionVariantWeight {
            variantWeightRelation: relation
            variantWeightValue: value {
              value
              unit
            }
          }

          ... on CollectionSourceInclusionConditionMetafieldBoolean {
            metafieldBooleanDefinition: definition {
              id
              namespace
              key
              name
            }
            metafieldBooleanRelation: relation
            metafieldBooleanValue: value
          }

          ... on CollectionSourceInclusionConditionMetafieldDecimal {
            metafieldDecimalDefinition: definition {
              id
              namespace
              key
              name
            }
            metafieldDecimalRelation: relation
            metafieldDecimalValue: value
          }

          ... on CollectionSourceInclusionConditionMetafieldInteger {
            metafieldIntegerDefinition: definition {
              id
              namespace
              key
              name
            }
            metafieldIntegerRelation: relation
            metafieldIntegerValue: value
          }

          ... on CollectionSourceInclusionConditionMetafieldString {
            metafieldStringDefinition: definition {
              id
              namespace
              key
              name
            }
            metafieldStringRelation: relation
            metafieldStringValues: values
            metafieldStringMatchType: matchType
          }

          ... on CollectionSourceInclusionConditionMetafieldStringList {
            metafieldStringListDefinition: definition {
              id
              namespace
              key
              name
            }
            metafieldStringListRelation: relation
            metafieldStringListValues: values
            metafieldStringListMatchType: matchType
          }

          ... on CollectionSourceInclusionConditionMetafieldMetaobject {
            metafieldMetaobjectDefinition: definition {
              id
              namespace
              key
              name
            }
            metafieldMetaobjectRelation: relation
            metafieldMetaobjectValue: value {
              id
              handle
              type
            }
          }

          ... on CollectionSourceInclusionConditionMetafieldMetaobjectList {
            metafieldMetaobjectListDefinition: definition {
              id
              namespace
              key
              name
            }
            metafieldMetaobjectListRelation: relation
            metafieldMetaobjectListMatchType: matchType
            metafieldMetaobjectListValues: values {
              id
              handle
              type
            }
          }

          ... on CollectionSourceInclusionConditionUnknown {
            unknownRelation: relation
            unknownValues: values
            unknownMatchType: matchType
          }
        }

        selections(first: 250) {
          nodes {
            product {
              id
              handle
              title
            }
            variantIds
          }
        }
      }

      exclusion {
        matchType

        conditions {
          __typename
          id

          ... on CollectionSourceExclusionConditionCollection {
            excludedCollectionMatchType: matchType
            excludedCollections: values {
              id
              handle
              title
            }
          }

          ... on CollectionSourceExclusionConditionProductTag {
            excludedTagRelation: relation
            excludedTagValues: values
            excludedTagMatchType: matchType
          }

          ... on CollectionSourceExclusionConditionProductType {
            excludedTypeRelation: relation
            excludedTypeValues: values
            excludedTypeMatchType: matchType
          }

          ... on CollectionSourceExclusionConditionProductVendor {
            excludedVendorRelation: relation
            excludedVendorValues: values
            excludedVendorMatchType: matchType
          }

          ... on CollectionSourceExclusionConditionProductCategory {
            excludedCategoryRelation: relation
            excludedCategoryMatchType: matchType
            excludedCategoryValues: values {
              includeDescendants
              category {
                id
                name
                fullName
              }
            }
          }

          ... on CollectionSourceExclusionConditionUnknown {
            excludedUnknownRelation: relation
            excludedUnknownValues: values
            excludedUnknownMatchType: matchType
          }
        }

        selections(first: 250) {
          nodes {
            product {
              id
              handle
              title
            }
          }
        }
      }
    }

    ... on CollectionSubCollectionsSource {
      collections {
        id
        handle
        title
      }
    }
  }
`;

export async function startCollectionExport(
  admin: AdminClient,
  options: {
    query: string;
    includeProducts: boolean;
    includeMetafields: boolean;
  },
): Promise<CollectionExportOperation> {
  const response = await admin.graphql(
    `#graphql
      mutation StartCollectionExport($query: String!) {
        bulkOperationRunQuery(query: $query, groupObjects: false) {
          bulkOperation {
            id
            status
            objectCount
            rootObjectCount
            fileSize
            url
            partialDataUrl
            errorCode
            createdAt
            completedAt
          }

          userErrors {
            field
            message
          }
        }
      }
    `,
    {
      variables: {
        query: buildBulkQuery(
          options.query,
          options.includeProducts,
          options.includeMetafields,
        ),
      },
    },
  );

  const payload = await response.json() as {
    data?: {
      bulkOperationRunQuery: {
        bulkOperation: CollectionExportOperation | null;
        userErrors: Array<{ message: string }>;
      };
    };
    errors?: Array<{ message: string }>;
  };

  const graphqlError = payload.errors
    ?.map((item) => item.message)
    .join(", ");

  if (graphqlError) {
    throw new Error(graphqlError);
  }

  const result = payload.data?.bulkOperationRunQuery;

  if (!result) {
    throw new Error("The collection export operation could not be started.");
  }

  if (result.userErrors.length > 0) {
    throw new Error(
      result.userErrors.map((item) => item.message).join(", "),
    );
  }

  if (!result.bulkOperation) {
    throw new Error("Shopify did not return a bulk operation ID.");
  }

  return result.bulkOperation;
}

export async function getCollectionExportStatus(
  admin: AdminClient,
  id: string,
): Promise<CollectionExportOperation> {
  const response = await admin.graphql(
    `#graphql
      query CollectionExportStatus($id: ID!) {
        bulkOperation(id: $id) {
          id
          status
          objectCount
          rootObjectCount
          fileSize
          url
          partialDataUrl
          errorCode
          createdAt
          completedAt
        }
      }
    `,
    {
      variables: { id },
    },
  );

  const payload = await response.json() as {
    data?: {
      bulkOperation: CollectionExportOperation | null;
    };
    errors?: Array<{ message: string }>;
  };

  const graphqlError = payload.errors
    ?.map((item) => item.message)
    .join(", ");

  if (graphqlError) {
    throw new Error(graphqlError);
  }

  if (!payload.data?.bulkOperation) {
    throw new Error("The collection export operation was not found.");
  }

  return payload.data.bulkOperation;
}

function parseJsonl(content: string): CollectionRecord[] {
  const collections = new Map<string, CollectionRecord>();
  const products: ProductLine[] = [];
  const metafields: MetafieldLine[] = [];

  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;

    const item = JSON.parse(line) as
      | CollectionLine
      | ProductLine
      | MetafieldLine;

    if (item.__typename === "Collection") {
      collections.set(item.id, {
        ...item,
        products: [],
        metafields: [],
        sources: [],
      });
    } else if (item.__typename === "Product") {
      products.push(item);
    } else if (item.__typename === "Metafield") {
      metafields.push(item);
    }
  }

  for (const product of products) {
    collections.get(product.__parentId)?.products.push(product);
  }

  for (const metafield of metafields) {
    collections.get(metafield.__parentId)?.metafields.push(metafield);
  }

  return Array.from(collections.values());
}

async function fetchSourceDetails(
  admin: AdminClient,
  collections: CollectionRecord[],
): Promise<void> {
  const batchSize = 12;

  for (let index = 0; index < collections.length; index += batchSize) {
    const batch = collections.slice(index, index + batchSize);

    const fields = batch
      .map(
        (collection, itemIndex) => `
          c${itemIndex}: collection(id: ${JSON.stringify(collection.id)}) {
            id
            ${SOURCE_SELECTION}
          }
        `,
      )
      .join("\n");

    const response = await admin.graphql(
      `#graphql
        query CollectionHybridSources {
          ${fields}
        }
      `,
    );

    const payload = await response.json() as {
      data?: Record<
        string,
        {
          id: string;
          sources: CollectionSource[];
        } | null
      >;
      errors?: Array<{ message: string }>;
    };

    const graphqlError = payload.errors
      ?.map((item) => item.message)
      .join(", ");

    if (graphqlError) {
      throw new Error(
        `Collection sources could not be read: ${graphqlError}`,
      );
    }

    for (let itemIndex = 0; itemIndex < batch.length; itemIndex += 1) {
      const sourceData = payload.data?.[`c${itemIndex}`];

      if (sourceData) {
        batch[itemIndex].sources = sourceData.sources || [];
      }
    }
  }
}

function summarizeSources(
  collection: CollectionRecord,
): SourceSummary {
  const conditionsSources = collection.sources.filter(
    (source): source is CollectionConditionsSource =>
      source.__typename === "CollectionConditionsSource",
  );

  const subCollectionSources = collection.sources.filter(
    (source): source is CollectionSubCollectionsSource =>
      source.__typename === "CollectionSubCollectionsSource",
  );

  const inclusionConditions = conditionsSources.flatMap((source) =>
    source.inclusion.conditions.map((condition) => ({
      sourceId: source.id,
      sourceTitle: source.title,
      targetType: source.targetType,
      sourceMatchType: source.inclusion.matchType,
      ...condition,
    })),
  );

  const inclusionSelections = conditionsSources.flatMap((source) =>
    source.inclusion.selections.nodes.map((selection) => ({
      sourceId: source.id,
      sourceTitle: source.title,
      targetType: source.targetType,
      product: selection.product,
      variantIds: selection.variantIds,
    })),
  );

  const exclusionConditions = conditionsSources.flatMap((source) =>
    (source.exclusion?.conditions || []).map((condition) => ({
      sourceId: source.id,
      sourceTitle: source.title,
      targetType: source.targetType,
      sourceMatchType: source.exclusion?.matchType || null,
      ...condition,
    })),
  );

  const exclusionSelections = conditionsSources.flatMap((source) =>
    (source.exclusion?.selections.nodes || []).map((selection) => ({
      sourceId: source.id,
      sourceTitle: source.title,
      targetType: source.targetType,
      product: selection.product,
      variantIds: selection.variantIds ?? [],
    })),
  );

  const subCollections = subCollectionSources.flatMap((source) =>
    source.collections.map((subCollection) => ({
      sourceId: source.id,
      sourceTitle: source.title,
      ...subCollection,
    })),
  );

  const mechanisms = [
    inclusionConditions.length > 0,
    inclusionSelections.length > 0,
    exclusionConditions.length > 0 || exclusionSelections.length > 0,
    subCollections.length > 0,
    collection.sources.some((source) => Boolean(source.app)),
  ].filter(Boolean).length;

  return {
    sourceCount: collection.sources.length,
    sourceTypes: Array.from(
      new Set(collection.sources.map((source) => source.__typename)),
    ),
    targetTypes: Array.from(
      new Set(conditionsSources.map((source) => source.targetType)),
    ),
    hasConditions: inclusionConditions.length > 0,
    hasManualSelections: inclusionSelections.length > 0,
    hasExclusions:
      exclusionConditions.length > 0 ||
      exclusionSelections.length > 0,
    hasSubCollections: subCollections.length > 0,
    hasAppSources: collection.sources.some((source) => Boolean(source.app)),
    isHybrid:
      collection.sources.length > 1 ||
      mechanisms > 1,
    inclusionMatchTypes: Array.from(
      new Set(
        conditionsSources
          .map((source) => source.inclusion.matchType)
          .filter((value): value is string => Boolean(value)),
      ),
    ),
    exclusionMatchTypes: Array.from(
      new Set(
        conditionsSources
          .map((source) => source.exclusion?.matchType)
          .filter((value): value is string => Boolean(value)),
      ),
    ),
    inclusionConditions,
    inclusionSelections,
    exclusionConditions,
    exclusionSelections,
    subCollections,
    sources: collection.sources,
  };
}

function matchesSourceFilter(
  summary: SourceSummary,
  sourceFilter: SourceFilter,
): boolean {
  switch (sourceFilter) {
    case "conditions":
      return summary.hasConditions;
    case "manual-selections":
      return summary.hasManualSelections;
    case "exclusions":
      return summary.hasExclusions;
    case "subcollections":
      return summary.hasSubCollections;
    case "app-sources":
      return summary.hasAppSources;
    case "hybrid":
      return summary.isHybrid;
    case "products":
      return summary.targetTypes.includes("PRODUCTS");
    case "variants":
      return summary.targetTypes.includes("VARIANTS");
    default:
      return true;
  }
}

function metafieldColumn(metafield: MetafieldLine): string {
  return `Metafield: ${metafield.namespace}.${metafield.key} [${metafield.type}]`;
}

function bool(value: boolean): string {
  return value ? "TRUE" : "FALSE";
}

function buildRows(
  collections: CollectionRecord[],
  sourceFilter: SourceFilter,
): {
  columns: string[];
  rows: ExportRow[];
} {
  const summarized = collections
    .map((collection) => ({
      collection,
      summary: summarizeSources(collection),
    }))
    .filter(({ summary }) =>
      matchesSourceFilter(summary, sourceFilter),
    );

  const dynamicColumns = Array.from(
    new Set(
      summarized.flatMap(({ collection }) =>
        collection.metafields.map(metafieldColumn),
      ),
    ),
  ).sort((left, right) => left.localeCompare(right));

  const columns = [...BASE_COLUMNS, ...dynamicColumns];

  const rows = summarized.map(({ collection, summary }) => {
    const row: ExportRow = Object.fromEntries(
      columns.map((column) => [column, ""]),
    );

    row.ID = collection.id;
    row["Legacy Resource ID"] = collection.legacyResourceId;
    row.Handle = collection.handle;
    row.Title = collection.title;
    row["Body (HTML)"] = collection.descriptionHtml;
    row["Sort Order"] = collection.sortOrder;
    row["Template Suffix"] = collection.templateSuffix || "";
    row["Image Src"] = collection.image?.url || "";
    row["Image Alt Text"] = collection.image?.altText || "";
    row["SEO Title"] = collection.seo.title || "";
    row["SEO Description"] = collection.seo.description || "";
    row["Products Count"] = collection.productsCount.count;
    row["Product Handles"] = collection.products
      .map((product) => product.handle)
      .join("|");
    row["Product IDs"] = collection.products
      .map((product) => product.id)
      .join("|");
    row["Source Count"] = summary.sourceCount;
    row["Source Types"] = summary.sourceTypes.join("|");
    row["Target Types"] = summary.targetTypes.join("|");
    row["Has Conditions"] = bool(summary.hasConditions);
    row["Has Manual Selections"] = bool(summary.hasManualSelections);
    row["Has Exclusions"] = bool(summary.hasExclusions);
    row["Has Sub-Collections"] = bool(summary.hasSubCollections);
    row["Has App Sources"] = bool(summary.hasAppSources);
    row["Is Hybrid"] = bool(summary.isHybrid);
    row["Inclusion Match Types"] =
      summary.inclusionMatchTypes.join("|");
    row["Exclusion Match Types"] =
      summary.exclusionMatchTypes.join("|");
    row["Inclusion Conditions JSON"] =
      JSON.stringify(summary.inclusionConditions);
    row["Inclusion Selections JSON"] =
      JSON.stringify(summary.inclusionSelections);
    row["Exclusion Conditions JSON"] =
      JSON.stringify(summary.exclusionConditions);
    row["Exclusion Selections JSON"] =
      JSON.stringify(summary.exclusionSelections);
    row["Sub-Collections JSON"] =
      JSON.stringify(summary.subCollections);
    row["Sources JSON"] =
      JSON.stringify(summary.sources);
    row["Published Channels Count"] =
      collection.resourcePublicationsCount.count;
    row["Available Publications Count"] =
      collection.availablePublicationsCount.count;
    row["Updated At"] = collection.updatedAt;

    for (const metafield of collection.metafields) {
      row[metafieldColumn(metafield)] = metafield.value;
    }

    return row;
  });

  return {
    columns,
    rows,
  };
}

function csvCell(
  value: string | number | boolean,
  delimiter: string,
): string {
  const text = String(value ?? "");

  return text.includes(delimiter) || /["\r\n]/.test(text)
    ? `"${text.replace(/"/g, '""')}"`
    : text;
}

function createCsv(
  columns: string[],
  rows: ExportRow[],
  delimiter: string,
  includeBom: boolean,
): string {
  const content = [
    columns.map((value) => csvCell(value, delimiter)).join(delimiter),
    ...rows.map((row) =>
      columns
        .map((column) => csvCell(row[column] ?? "", delimiter))
        .join(delimiter),
    ),
  ].join("\r\n");

  return `${includeBom ? "\uFEFF" : ""}${content}`;
}

function createFilename(
  shop: string,
  format: CollectionExportFormat,
): string {
  const shopName = shop
    .replace(".myshopify.com", "")
    .replace(/[^a-z0-9_-]+/gi, "-");

  const date = new Date().toISOString().slice(0, 10);

  return `${shopName}-collections-hybrid-${date}.${format}`;
}

export async function createCollectionExportFile(
  admin: AdminClient,
  operationId: string,
  format: CollectionExportFormat,
  shop: string,
  sourceFilter: SourceFilter,
  csvOptions: { delimiter: string; includeBom: boolean } = {
    delimiter: ",",
    includeBom: true,
  },
): Promise<Response> {
  const operation = await getCollectionExportStatus(
    admin,
    operationId,
  );

  if (operation.status !== "COMPLETED" || !operation.url) {
    throw new Error("The collection export operation is not complete yet.");
  }

  const collections = parseJsonl(await externalText(operation.url));

  await fetchSourceDetails(admin, collections);

  const { columns, rows } = buildRows(
    collections,
    sourceFilter,
  );

  const filename = createFilename(shop, format);

  if (format === "json") {
    return new Response(
      JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          shop,
          sourceFilter,
          collectionCount: rows.length,
          columns,
          rows,
        },
        null,
        2,
      ),
      {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      },
    );
  }

  if (format === "xlsx") {
    const worksheet = XLSX.utils.json_to_sheet(rows, {
      header: columns,
    });

    const workbook = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
      workbook,
      worksheet,
      "Collections",
    );

    const buffer = XLSX.write(workbook, {
      type: "buffer",
      bookType: "xlsx",
    });

    return new Response(buffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  return new Response(
    createCsv(
      columns,
      rows,
      csvOptions.delimiter,
      csvOptions.includeBom,
    ),
    {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    },
  );
}
