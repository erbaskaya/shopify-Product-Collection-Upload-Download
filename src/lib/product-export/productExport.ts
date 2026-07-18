import { externalText } from "../shopifyClient";
import * as XLSX from "xlsx";

type AdminClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

export type ExportFormat = "csv" | "xlsx" | "json";

export interface ExportOperation {
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

interface ProductLine {
  __typename: "Product";
  id: string;
  handle: string;
  title: string;
  descriptionHtml: string;
  vendor: string;
  productType: string;
  status: string;
  tags: string[];
  isGiftCard: boolean;
  publishedAt: string | null;
  seo: { title: string | null; description: string | null };
}

interface VariantLine {
  __typename: "ProductVariant";
  __parentId: string;
  id: string;
  sku: string | null;
  barcode: string | null;
  price: string;
  compareAtPrice: string | null;
  position: number;
  inventoryQuantity: number;
  inventoryPolicy: string;
  taxable: boolean;
  selectedOptions: Array<{ name: string; value: string }>;
  inventoryItem: {
    tracked: boolean;
    requiresShipping: boolean;
    measurement: {
      weight: { value: number; unit: string } | null;
    };
    unitCost: { amount: string } | null;
  };
}

interface MediaLine {
  __typename: "MediaImage";
  __parentId: string;
  id: string;
  alt: string | null;
  image: { url: string } | null;
}

interface MetafieldLine {
  __typename: "Metafield";
  __parentId: string;
  namespace: string;
  key: string;
  type: string;
  value: string;
}

interface ProductRecord extends ProductLine {
  variants: VariantRecord[];
  media: MediaLine[];
  metafields: MetafieldLine[];
}

interface VariantRecord extends VariantLine {
  media: MediaLine[];
}

type ExportRow = Record<string, string | number | boolean>;

const BASE_COLUMNS = [
  "Handle",
  "Title",
  "Body (HTML)",
  "Vendor",
  "Type",
  "Tags",
  "Published",
  "Option1 Name",
  "Option1 Value",
  "Option2 Name",
  "Option2 Value",
  "Option3 Name",
  "Option3 Value",
  "Variant SKU",
  "Variant Grams",
  "Variant Inventory Tracker",
  "Variant Inventory Qty",
  "Variant Inventory Policy",
  "Variant Fulfillment Service",
  "Variant Price",
  "Variant Compare At Price",
  "Variant Requires Shipping",
  "Variant Taxable",
  "Variant Barcode",
  "Image Src",
  "Image Position",
  "Image Alt Text",
  "Gift Card",
  "SEO Title",
  "SEO Description",
  "Variant Image",
  "Variant Weight Unit",
  "Cost per item",
  "Status",
];

function productSearch(status: string, query: string): string {
  const parts: string[] = [];

  if (["active", "draft", "archived"].includes(status)) {
    parts.push(`status:${status}`);
  }

  if (query.trim()) {
    parts.push(query.trim());
  }

  return parts.join(" AND ");
}

function bulkQuery(status: string, query: string): string {
  const search = productSearch(status, query);
  const argument = search ? `(query: ${JSON.stringify(search)})` : "";

  return `{
    products${argument} {
      edges {
        node {
          __typename
          id
          handle
          title
          descriptionHtml
          vendor
          productType
          status
          tags
          isGiftCard
          publishedAt
          seo { title description }

          variants {
            edges {
              node {
                __typename
                id
                sku
                barcode
                price
                compareAtPrice
                position
                inventoryQuantity
                inventoryPolicy
                taxable
                selectedOptions { name value }

                inventoryItem {
                  tracked
                  requiresShipping
                  measurement {
                    weight { value unit }
                  }
                  unitCost { amount }
                }

                media(first: 1) {
                  edges {
                    node {
                      __typename
                      ... on MediaImage {
                        id
                        alt
                        image { url }
                      }
                    }
                  }
                }
              }
            }
          }

          media(first: 250) {
            edges {
              node {
                __typename
                ... on MediaImage {
                  id
                  alt
                  image { url }
                }
              }
            }
          }

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
        }
      }
    }
  }`;
}

export async function startExport(
  admin: AdminClient,
  status: string,
  query: string,
): Promise<ExportOperation> {
  const response = await admin.graphql(
    `#graphql
      mutation StartProductExport($query: String!) {
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
          userErrors { field message }
        }
      }
    `,
    { variables: { query: bulkQuery(status, query) } },
  );

  const json = await response.json() as {
    data?: {
      bulkOperationRunQuery: {
        bulkOperation: ExportOperation | null;
        userErrors: Array<{ message: string }>;
      };
    };
    errors?: Array<{ message: string }>;
  };

  const graphqlError = json.errors?.map((item) => item.message).join(", ");
  if (graphqlError) throw new Error(graphqlError);

  const result = json.data?.bulkOperationRunQuery;
  if (!result) throw new Error("The export operation could not be started.");

  if (result.userErrors.length) {
    throw new Error(result.userErrors.map((item) => item.message).join(", "));
  }

  if (!result.bulkOperation) {
    throw new Error("Shopify did not return a bulk operation ID.");
  }

  return result.bulkOperation;
}

export async function exportStatus(
  admin: AdminClient,
  id: string,
): Promise<ExportOperation> {
  const response = await admin.graphql(
    `#graphql
      query ProductExportStatus($id: ID!) {
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
    { variables: { id } },
  );

  const json = await response.json() as {
    data?: { bulkOperation: ExportOperation | null };
    errors?: Array<{ message: string }>;
  };

  const graphqlError = json.errors?.map((item) => item.message).join(", ");
  if (graphqlError) throw new Error(graphqlError);

  if (!json.data?.bulkOperation) {
    throw new Error("The export operation was not found.");
  }

  return json.data.bulkOperation;
}

function parseJsonl(text: string): ProductRecord[] {
  const products = new Map<string, ProductRecord>();
  const variants = new Map<string, VariantRecord>();
  const media: MediaLine[] = [];
  const metafields: MetafieldLine[] = [];

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;

    const item = JSON.parse(line) as
      | ProductLine
      | VariantLine
      | MediaLine
      | MetafieldLine;

    if (item.__typename === "Product") {
      products.set(item.id, {
        ...item,
        variants: [],
        media: [],
        metafields: [],
      });
    } else if (item.__typename === "ProductVariant") {
      variants.set(item.id, { ...item, media: [] });
    } else if (item.__typename === "MediaImage") {
      media.push(item);
    } else if (item.__typename === "Metafield") {
      metafields.push(item);
    }
  }

  for (const variant of variants.values()) {
    products.get(variant.__parentId)?.variants.push(variant);
  }

  for (const item of media) {
    const product = products.get(item.__parentId);
    if (product) {
      product.media.push(item);
    } else {
      variants.get(item.__parentId)?.media.push(item);
    }
  }

  for (const metafield of metafields) {
    products.get(metafield.__parentId)?.metafields.push(metafield);
  }

  const result = Array.from(products.values());
  for (const product of result) {
    product.variants.sort((a, b) => a.position - b.position);
  }

  return result;
}

function grams(weight: { value: number; unit: string } | null): number | "" {
  if (!weight) return "";

  if (weight.unit === "GRAMS") return weight.value;
  if (weight.unit === "KILOGRAMS") return weight.value * 1000;
  if (weight.unit === "OUNCES") return weight.value * 28.349523125;
  if (weight.unit === "POUNDS") return weight.value * 453.59237;
  return "";
}

function weightUnit(unit?: string): string {
  if (unit === "GRAMS") return "g";
  if (unit === "KILOGRAMS") return "kg";
  if (unit === "OUNCES") return "oz";
  if (unit === "POUNDS") return "lb";
  return "";
}

function bool(value: boolean): string {
  return value ? "TRUE" : "FALSE";
}

function metafieldColumn(item: MetafieldLine): string {
  return `Metafield: ${item.namespace}.${item.key} [${item.type}]`;
}

function emptyRow(columns: string[]): ExportRow {
  return Object.fromEntries(columns.map((column) => [column, ""]));
}

function buildRows(products: ProductRecord[]): {
  columns: string[];
  rows: ExportRow[];
} {
  const dynamicColumns = Array.from(
    new Set(
      products.flatMap((product) =>
        product.metafields.map(metafieldColumn),
      ),
    ),
  ).sort();

  const columns = [...BASE_COLUMNS, ...dynamicColumns];
  const rows: ExportRow[] = [];

  for (const product of products) {
    product.variants.forEach((variant, index) => {
      const row = emptyRow(columns);
      const first = index === 0;
      row.Handle = product.handle;

      if (first) {
        row.Title = product.title;
        row["Body (HTML)"] = product.descriptionHtml;
        row.Vendor = product.vendor;
        row.Type = product.productType;
        row.Tags = product.tags.join(", ");
        row.Published = bool(Boolean(product.publishedAt));
        row["Gift Card"] = bool(product.isGiftCard);
        row["SEO Title"] = product.seo.title || "";
        row["SEO Description"] = product.seo.description || "";
        row.Status = product.status.toLowerCase();

        const image = product.media[0];
        if (image?.image?.url) {
          row["Image Src"] = image.image.url;
          row["Image Position"] = 1;
          row["Image Alt Text"] = image.alt || "";
        }

        for (const metafield of product.metafields) {
          row[metafieldColumn(metafield)] = metafield.value;
        }
      }

      variant.selectedOptions.slice(0, 3).forEach((option, optionIndex) => {
        const position = optionIndex + 1;
        row[`Option${position} Name`] = option.name;
        row[`Option${position} Value`] = option.value;
      });

      const weight = variant.inventoryItem.measurement.weight;
      row["Variant SKU"] = variant.sku || "";
      row["Variant Grams"] = grams(weight);
      row["Variant Inventory Tracker"] = variant.inventoryItem.tracked ? "shopify" : "";
      row["Variant Inventory Qty"] = variant.inventoryQuantity;
      row["Variant Inventory Policy"] = variant.inventoryPolicy.toLowerCase();
      row["Variant Fulfillment Service"] = "manual";
      row["Variant Price"] = variant.price;
      row["Variant Compare At Price"] = variant.compareAtPrice || "";
      row["Variant Requires Shipping"] = bool(variant.inventoryItem.requiresShipping);
      row["Variant Taxable"] = bool(variant.taxable);
      row["Variant Barcode"] = variant.barcode || "";
      row["Variant Weight Unit"] = weightUnit(weight?.unit);
      row["Cost per item"] = variant.inventoryItem.unitCost?.amount || "";
      row["Variant Image"] = variant.media[0]?.image?.url || "";
      rows.push(row);
    });

    product.media.slice(1).forEach((image, index) => {
      if (!image.image?.url) return;
      const row = emptyRow(columns);
      row.Handle = product.handle;
      row["Image Src"] = image.image.url;
      row["Image Position"] = index + 2;
      row["Image Alt Text"] = image.alt || "";
      rows.push(row);
    });
  }

  return { columns, rows };
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

function csv(
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

function filename(shop: string, format: ExportFormat): string {
  const name = shop.replace(".myshopify.com", "").replace(/[^a-z0-9_-]+/gi, "-");
  return `${name}-products-${new Date().toISOString().slice(0, 10)}.${format}`;
}

export async function downloadExport(
  admin: AdminClient,
  operationId: string,
  format: ExportFormat,
  shop: string,
  csvOptions: { delimiter: string; includeBom: boolean } = {
    delimiter: ",",
    includeBom: true,
  },
): Promise<Response> {
  const operation = await exportStatus(admin, operationId);

  if (operation.status !== "COMPLETED" || !operation.url) {
    throw new Error("The export operation is not complete yet.");
  }

  const products = parseJsonl(await externalText(operation.url));
  const { columns, rows } = buildRows(products);
  const name = filename(shop, format);

  if (format === "json") {
    return new Response(
      JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          shop,
          productCount: products.length,
          rowCount: rows.length,
          columns,
          rows,
        },
        null,
        2,
      ),
      {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="${name}"`,
        },
      },
    );
  }

  if (format === "xlsx") {
    const sheet = XLSX.utils.json_to_sheet(rows, { header: columns });
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Products");
    const buffer = XLSX.write(book, { type: "buffer", bookType: "xlsx" });

    return new Response(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${name}"`,
      },
    });
  }

  return new Response(
    csv(columns, rows, csvOptions.delimiter, csvOptions.includeBom),
    {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name}"`,
      },
    },
  );
}
