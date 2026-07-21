import {
  adjustNumber,
  graphqlData,
  pause,
  productFilterQuery,
  roundMoney,
  userErrorMessage,
  type AdminClient,
} from "./adminTools";

export interface PriceManagerInput {
  query: string;
  vendor: string;
  productType: string;
  tag: string;
  collectionId: string;
  status: string;
  operation: "increase" | "decrease" | "set";
  mode: "percent" | "fixed";
  amount: number;
  target: "price" | "compareAtPrice" | "both";
  rounding: "two-decimals" | "integer" | "end-99" | "end-95" | "end-90";
  minimumPrice?: number;
  maximumPrice?: number;
  limit?: number;
}

export interface PricePreviewRow {
  productId: string;
  productTitle: string;
  vendor: string;
  productType: string;
  variantId: string;
  sku: string;
  currentPrice: number;
  newPrice: number;
  currentCompareAtPrice: number | null;
  newCompareAtPrice: number | null;
}

interface ProductNode {
  id: string;
  title: string;
  vendor: string;
  productType: string;
  variants: {
    nodes: Array<{
      id: string;
      sku: string | null;
      price: string;
      compareAtPrice: string | null;
    }>;
  };
}

export async function previewPriceChanges(
  admin: AdminClient,
  input: PriceManagerInput,
): Promise<PricePreviewRow[]> {
  const query = productFilterQuery(input);
  const output: PricePreviewRow[] = [];
  const limit = Math.max(1, Math.min(input.limit || 5000, 20000));
  let cursor: string | null = null;

  while (output.length < limit) {
    const data = await graphqlData<{
      products: {
        nodes: ProductNode[];
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    }>(
      admin,
      `#graphql
        query PriceManagerProducts($first: Int!, $after: String, $query: String) {
          products(first: $first, after: $after, query: $query, sortKey: TITLE) {
            nodes {
              id
              title
              vendor
              productType
              variants(first: 250) {
                nodes { id sku price compareAtPrice }
              }
            }
            pageInfo { hasNextPage endCursor }
          }
        }
      `,
      { first: 100, after: cursor, query: query || null },
    );

    for (const product of data.products.nodes) {
      for (const variant of product.variants.nodes) {
        const currentPrice = Number(variant.price || 0);
        if (Number.isFinite(input.minimumPrice) && currentPrice < Number(input.minimumPrice)) continue;
        if (Number.isFinite(input.maximumPrice) && Number(input.maximumPrice) > 0 && currentPrice > Number(input.maximumPrice)) continue;

        const currentCompare = variant.compareAtPrice == null ? null : Number(variant.compareAtPrice);
        let newPrice = currentPrice;
        let newCompare = currentCompare;

        if (input.target === "price" || input.target === "both") {
          newPrice = Math.max(0, roundMoney(
            adjustNumber(currentPrice, input.operation, input.mode, input.amount),
            input.rounding,
          ));
        }

        if (input.target === "compareAtPrice" || input.target === "both") {
          const compareBase = currentCompare ?? currentPrice;
          newCompare = Math.max(0, roundMoney(
            adjustNumber(compareBase, input.operation, input.mode, input.amount),
            input.rounding,
          ));
        }

        output.push({
          productId: product.id,
          productTitle: product.title,
          vendor: product.vendor,
          productType: product.productType,
          variantId: variant.id,
          sku: variant.sku || "",
          currentPrice,
          newPrice,
          currentCompareAtPrice: currentCompare,
          newCompareAtPrice: newCompare,
        });
        if (output.length >= limit) break;
      }
      if (output.length >= limit) break;
    }

    if (!data.products.pageInfo.hasNextPage || !data.products.pageInfo.endCursor) break;
    cursor = data.products.pageInfo.endCursor;
  }

  return output;
}

export async function applyPriceChanges(
  admin: AdminClient,
  rows: PricePreviewRow[],
): Promise<{ updated: number; failed: number; errors: string[] }> {
  const groups = new Map<string, PricePreviewRow[]>();
  for (const row of rows) {
    const values = groups.get(row.productId) || [];
    values.push(row);
    groups.set(row.productId, values);
  }

  let updated = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const [productId, variants] of groups) {
    try {
      const data = await graphqlData<{
        productVariantsBulkUpdate: {
          productVariants: Array<{ id: string }>;
          userErrors: Array<{ field?: string[]; message: string }>;
        };
      }>(
        admin,
        `#graphql
          mutation PriceManagerApply($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
            productVariantsBulkUpdate(
              productId: $productId,
              variants: $variants,
              allowPartialUpdates: true
            ) {
              productVariants { id }
              userErrors { field message }
            }
          }
        `,
        {
          productId,
          variants: variants.map((row) => ({
            id: row.variantId,
            price: row.newPrice.toFixed(2),
            compareAtPrice: row.newCompareAtPrice == null
              ? null
              : row.newCompareAtPrice.toFixed(2),
          })),
        },
      );

      const message = userErrorMessage(data.productVariantsBulkUpdate.userErrors);
      if (message) {
        failed += variants.length;
        errors.push(`${variants[0]?.productTitle || productId}: ${message}`);
      } else {
        updated += data.productVariantsBulkUpdate.productVariants.length;
      }
    } catch (error) {
      failed += variants.length;
      errors.push(`${variants[0]?.productTitle || productId}: ${error instanceof Error ? error.message : String(error)}`);
    }
    await pause(120);
  }

  return { updated, failed, errors };
}
