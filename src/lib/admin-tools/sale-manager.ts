import { graphqlData, pause, roundMoney, userErrorMessage, type AdminClient } from "./adminTools";

export type SaleFilterMode = "collection" | "vendor" | "products";
export type SaleOperation = "apply" | "remove";

export interface SaleCollectionRef { id: string; title: string; handle: string }
export interface SaleProductRef { id: string; title: string; handle: string; vendor: string }

export interface SaleInput {
  operation: SaleOperation;
  discountPercent: number;
  filterMode: SaleFilterMode;
  collectionHandle: string;
  vendor: string;
  productHandles: string[];
  minimumInventory: number;
}

export interface SaleVariantRow {
  productId: string;
  productTitle: string;
  handle: string;
  variantId: string;
  sku: string;
  inventoryQuantity: number;
  currentPrice: number;
  currentCompareAtPrice: number | null;
  newPrice: number;
  newCompareAtPrice: number | null;
  eligible: boolean;
  reason: string;
}

interface ProductNode {
  id: string;
  title: string;
  handle: string;
  vendor: string;
  variants: {
    nodes: Array<{
      id: string;
      sku: string | null;
      price: string;
      compareAtPrice: string | null;
      inventoryQuantity: number | null;
    }>;
  };
}

export async function listSaleCollections(admin: AdminClient): Promise<SaleCollectionRef[]> {
  const out: SaleCollectionRef[] = [];
  let cursor: string | null = null;
  while (out.length < 1000) {
    const data = await graphqlData<{
      collections: { nodes: SaleCollectionRef[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
    }>(admin, `#graphql
      query SaleCollections($first: Int!, $after: String) {
        collections(first: $first, after: $after, sortKey: TITLE) {
          nodes { id title handle }
          pageInfo { hasNextPage endCursor }
        }
      }
    `, { first: 100, after: cursor });
    out.push(...data.collections.nodes);
    if (!data.collections.pageInfo.hasNextPage || !data.collections.pageInfo.endCursor) break;
    cursor = data.collections.pageInfo.endCursor;
  }
  return out;
}

export async function listSaleVendors(admin: AdminClient): Promise<string[]> {
  try {
    const data = await graphqlData<{ productVendors: { nodes: string[] } }>(admin, `#graphql
      query SaleVendors { productVendors(first: 250) { nodes } }
    `);
    return Array.from(new Set<string>(data.productVendors.nodes.filter((x): x is string => Boolean(x)))).sort((a,b)=>a.localeCompare(b));
  } catch {
    const products = await fetchProductsByQuery(admin, "", 2500);
    return Array.from(new Set<string>(products.map(p=>p.vendor).filter((x): x is string => Boolean(x)))).sort((a,b)=>a.localeCompare(b));
  }
}

export async function searchSaleProducts(admin: AdminClient, term: string): Promise<SaleProductRef[]> {
  const data = await graphqlData<{
    products: { nodes: Array<{ id: string; title: string; handle: string; vendor: string }> };
  }>(admin, `#graphql
    query SaleProductSearch($query: String) {
      products(first: 50, query: $query, sortKey: TITLE) {
        nodes { id title handle vendor }
      }
    }
  `, { query: term.trim() || null });
  return data.products.nodes;
}

async function collectionIdByHandle(admin: AdminClient, handle: string): Promise<string | null> {
  if (!handle) return null;
  const data = await graphqlData<{
    collections: { nodes: SaleCollectionRef[] };
  }>(admin, `#graphql
    query SaleCollectionLookup($query: String!) {
      collections(first: 10, query: $query) { nodes { id title handle } }
    }
  `, { query: `handle:${handle}` });
  return data.collections.nodes.find(x=>x.handle===handle)?.id || null;
}

async function fetchProductsByQuery(admin: AdminClient, query: string, limit = 20000): Promise<ProductNode[]> {
  const out: ProductNode[] = [];
  let cursor: string | null = null;
  while (out.length < limit) {
    const data = await graphqlData<{
      products: { nodes: ProductNode[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
    }>(admin, `#graphql
      query SaleProducts($first: Int!, $after: String, $query: String) {
        products(first: $first, after: $after, query: $query, sortKey: TITLE) {
          nodes {
            id title handle vendor
            variants(first: 250) {
              nodes { id sku price compareAtPrice inventoryQuantity }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `, { first: 100, after: cursor, query: query || null });
    out.push(...data.products.nodes);
    if (!data.products.pageInfo.hasNextPage || !data.products.pageInfo.endCursor) break;
    cursor = data.products.pageInfo.endCursor;
  }
  return out.slice(0, limit);
}

async function productsForInput(admin: AdminClient, input: SaleInput): Promise<ProductNode[]> {
  if (input.filterMode === "vendor") {
    return fetchProductsByQuery(admin, input.vendor ? `vendor:${JSON.stringify(input.vendor)}` : "");
  }
  if (input.filterMode === "collection") {
    const id = await collectionIdByHandle(admin, input.collectionHandle);
    if (!id) return [];
    return fetchProductsByQuery(admin, `collection_id:${id.split("/").pop()}`);
  }
  const handles = input.productHandles.filter(Boolean);
  if (!handles.length) return [];
  const out: ProductNode[] = [];
  for (let i=0;i<handles.length;i+=25) {
    const q = handles.slice(i,i+25).map(h=>`handle:${h}`).join(" OR ");
    out.push(...await fetchProductsByQuery(admin, q, handles.length));
  }
  const wanted = new Set(handles);
  return out.filter(p=>wanted.has(p.handle));
}

export async function buildSalePlan(admin: AdminClient, input: SaleInput): Promise<SaleVariantRow[]> {
  const percent = Math.max(0, Math.min(100, Number(input.discountPercent) || 0));
  const minInventory = Math.max(0, Number(input.minimumInventory) || 10);
  const products = await productsForInput(admin, input);
  const rows: SaleVariantRow[] = [];

  for (const product of products) {
    for (const variant of product.variants.nodes) {
      const currentPrice = Number(variant.price || 0);
      const compare = variant.compareAtPrice == null ? null : Number(variant.compareAtPrice);
      const inventory = Number(variant.inventoryQuantity || 0);
      let eligible = true;
      let reason = "";
      let newPrice = currentPrice;
      let newCompare: number | null = compare;

      if (input.operation === "apply") {
        if (!(currentPrice > 0)) { eligible = false; reason = "Price is zero"; }
        else if (inventory <= minInventory) { eligible = false; reason = `Stock ${inventory} ≤ ${minInventory}`; }
        else if (compare != null && compare > currentPrice) { eligible = false; reason = "Already discounted"; }
        if (eligible) {
          newCompare = currentPrice;
          newPrice = roundMoney(currentPrice * (1 - percent / 100), "two-decimals");
        }
      } else {
        if (!(compare != null && compare > 0)) { eligible = false; reason = "No compare-at price"; }
        if (eligible) {
          newPrice = compare as number;
          newCompare = null;
        }
      }

      rows.push({
        productId: product.id,
        productTitle: product.title,
        handle: product.handle,
        variantId: variant.id,
        sku: variant.sku || "",
        inventoryQuantity: inventory,
        currentPrice,
        currentCompareAtPrice: compare,
        newPrice,
        newCompareAtPrice: newCompare,
        eligible,
        reason,
      });
    }
  }
  return rows;
}

export async function applySalePlan(
  admin: AdminClient,
  rows: SaleVariantRow[],
  onProduct?: (processedProducts: number, totalProducts: number, title: string, message: string) => void,
): Promise<{ updated: number; skipped: number; failed: number; errors: string[]; totalProducts: number }> {
  const groups = new Map<string, SaleVariantRow[]>();
  for (const row of rows) {
    const list = groups.get(row.productId) || [];
    list.push(row);
    groups.set(row.productId, list);
  }
  const entries = Array.from(groups.entries());
  let updated = 0;
  let skipped = rows.filter(r=>!r.eligible).length;
  let failed = 0;
  const errors: string[] = [];
  let processedProducts = 0;

  for (const [productId, productRows] of entries) {
    const eligible = productRows.filter(r=>r.eligible);
    const title = productRows[0]?.productTitle || productId;
    if (!eligible.length) {
      processedProducts += 1;
      onProduct?.(processedProducts, entries.length, title, `Skipped · ${productRows.map(r=>r.reason).filter(Boolean)[0] || "No eligible variants"}`);
      continue;
    }
    try {
      const data = await graphqlData<{
        productVariantsBulkUpdate: {
          productVariants: Array<{ id: string }>;
          userErrors: Array<{ field?: string[]; message: string }>;
        };
      }>(admin, `#graphql
        mutation SaleManagerApply($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
          productVariantsBulkUpdate(productId: $productId, variants: $variants, allowPartialUpdates: true) {
            productVariants { id }
            userErrors { field message }
          }
        }
      `, {
        productId,
        variants: eligible.map(row=>({
          id: row.variantId,
          price: row.newPrice.toFixed(2),
          compareAtPrice: row.newCompareAtPrice == null ? null : row.newCompareAtPrice.toFixed(2),
        })),
      });
      const message = userErrorMessage(data.productVariantsBulkUpdate.userErrors);
      if (message) {
        failed += eligible.length;
        errors.push(`${title}: ${message}`);
        onProduct?.(processedProducts + 1, entries.length, title, `ERROR · ${message}`);
      } else {
        updated += data.productVariantsBulkUpdate.productVariants.length;
        onProduct?.(processedProducts + 1, entries.length, title, `Updated ${data.productVariantsBulkUpdate.productVariants.length} variant(s)`);
      }
    } catch (error) {
      failed += eligible.length;
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${title}: ${message}`);
      onProduct?.(processedProducts + 1, entries.length, title, `ERROR · ${message}`);
    }
    processedProducts += 1;
    await pause(120);
  }
  return { updated, skipped, failed, errors, totalProducts: entries.length };
}
