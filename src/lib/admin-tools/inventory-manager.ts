import {
  graphqlData,
  pause,
  productFilterQuery,
  userErrorMessage,
  type AdminClient,
} from "./adminTools";

export interface InventoryManagerInput {
  query: string;
  vendor: string;
  productType: string;
  tag: string;
  collectionId: string;
  status: string;
  locationId: string;
  operation: "increase" | "decrease" | "set";
  quantity: number;
  preventNegative: boolean;
  limit?: number;
}

export interface InventoryPreviewRow {
  productId: string;
  productTitle: string;
  variantId: string;
  sku: string;
  inventoryItemId: string;
  locationId: string;
  locationName: string;
  currentQuantity: number;
  delta: number;
  newQuantity: number;
}

interface ProductNode {
  id: string;
  title: string;
  variants: {
    nodes: Array<{
      id: string;
      sku: string | null;
      inventoryItem: {
        id: string;
        inventoryLevels: {
          nodes: Array<{
            location: { id: string; name: string };
            quantities: Array<{ name: string; quantity: number }>;
          }>;
        };
      };
    }>;
  };
}

export async function previewInventoryChanges(
  admin: AdminClient,
  input: InventoryManagerInput,
): Promise<InventoryPreviewRow[]> {
  if (!input.locationId) throw new Error("Select an inventory location.");
  const filter = productFilterQuery(input);
  const output: InventoryPreviewRow[] = [];
  const limit = Math.max(1, Math.min(input.limit || 10000, 50000));
  let cursor: string | null = null;

  while (output.length < limit) {
    const data: any = await graphqlData<{
      products: {
        nodes: ProductNode[];
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    }>(
      admin,
      `#graphql
        query InventoryManagerProducts($first: Int!, $after: String, $query: String) {
          products(first: $first, after: $after, query: $query, sortKey: TITLE) {
            nodes {
              id
              title
              variants(first: 250) {
                nodes {
                  id
                  sku
                  inventoryItem {
                    id
                    inventoryLevels(first: 100) {
                      nodes {
                        location { id name }
                        quantities(names: ["available"]) { name quantity }
                      }
                    }
                  }
                }
              }
            }
            pageInfo { hasNextPage endCursor }
          }
        }
      `,
      { first: 80, after: cursor, query: filter || null },
    );

    for (const product of data.products.nodes) {
      for (const variant of product.variants.nodes) {
        const level = variant.inventoryItem.inventoryLevels.nodes.find(
          (item) => item.location.id === input.locationId,
        );
        if (!level) continue;
        const current = level.quantities.find((item) => item.name === "available")?.quantity || 0;
        let target = current;
        if (input.operation === "increase") target = current + input.quantity;
        if (input.operation === "decrease") target = current - input.quantity;
        if (input.operation === "set") target = input.quantity;
        if (input.preventNegative) target = Math.max(0, target);
        const delta = target - current;
        if (delta === 0) continue;
        output.push({
          productId: product.id,
          productTitle: product.title,
          variantId: variant.id,
          sku: variant.sku || "",
          inventoryItemId: variant.inventoryItem.id,
          locationId: level.location.id,
          locationName: level.location.name,
          currentQuantity: current,
          delta,
          newQuantity: target,
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

export async function applyInventoryChanges(
  admin: AdminClient,
  rows: InventoryPreviewRow[],
): Promise<{ updated: number; failed: number; errors: string[] }> {
  let updated = 0;
  let failed = 0;
  const errors: string[] = [];
  const batchSize = 100;

  for (let index = 0; index < rows.length; index += batchSize) {
    const batch = rows.slice(index, index + batchSize);
    try {
      const data: any = await graphqlData<{
        inventoryAdjustQuantities: {
          inventoryAdjustmentGroup: {
            changes: Array<{ delta: number; quantityAfterChange: number | null }>;
          } | null;
          userErrors: Array<{ field?: string[]; message: string }>;
        };
      }>(
        admin,
        `#graphql
          mutation InventoryManagerApply($input: InventoryAdjustQuantitiesInput!) {
            inventoryAdjustQuantities(input: $input) {
              inventoryAdjustmentGroup {
                changes { delta quantityAfterChange }
              }
              userErrors { field message }
            }
          }
        `,
        {
          input: {
            name: "available",
            reason: "correction",
            referenceDocumentUri: `gid://hausone/InventoryManager/${Date.now()}-${index}`,
            changes: batch.map((row) => ({
              inventoryItemId: row.inventoryItemId,
              locationId: row.locationId,
              delta: row.delta,
            })),
          },
        },
      );
      const message = userErrorMessage(data.inventoryAdjustQuantities.userErrors);
      if (message) {
        failed += batch.length;
        errors.push(message);
      } else {
        updated += data.inventoryAdjustQuantities.inventoryAdjustmentGroup?.changes.length || batch.length;
      }
    } catch (error) {
      failed += batch.length;
      errors.push(error instanceof Error ? error.message : String(error));
    }
    await pause(180);
  }

  return { updated, failed, errors };
}
