import {
  graphqlData,
  productFilterQuery,
  userErrorMessage,
  type AdminClient,
} from "./adminTools";

export interface DiscountManagerInput {
  title: string;
  discountType: "automatic" | "code";
  code: string;
  valueType: "percentage" | "fixed";
  value: number;
  startsAt: string;
  endsAt: string;
  minimumSubtotal: number;
  appliesOncePerCustomer: boolean;
  usageLimit: number;
  query: string;
  vendor: string;
  productType: string;
  tag: string;
  collectionId: string;
  taxonomyCategoryId: string;
  allProducts: boolean;
}

export interface DiscountProductPreview {
  id: string;
  title: string;
  handle: string;
  vendor: string;
  productType: string;
}

export async function previewDiscountProducts(
  admin: AdminClient,
  input: DiscountManagerInput,
): Promise<DiscountProductPreview[]> {
  if (input.allProducts) return [];
  const query = productFilterQuery({
    query: [input.query, input.taxonomyCategoryId ? `category_id:${input.taxonomyCategoryId.replace(/\D/g, "")}` : ""]
      .filter(Boolean)
      .join(" AND "),
    vendor: input.vendor,
    productType: input.productType,
    tag: input.tag,
    collectionId: input.collectionId,
  });
  const products: DiscountProductPreview[] = [];
  let cursor: string | null = null;
  while (products.length < 250) {
    const data = await graphqlData<{
      products: {
        nodes: DiscountProductPreview[];
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    }>(
      admin,
      `#graphql
        query DiscountProducts($first: Int!, $after: String, $query: String) {
          products(first: $first, after: $after, query: $query, sortKey: TITLE) {
            nodes { id title handle vendor productType }
            pageInfo { hasNextPage endCursor }
          }
        }
      `,
      { first: 100, after: cursor, query: query || null },
    );
    products.push(...data.products.nodes.slice(0, 250 - products.length));
    if (!data.products.pageInfo.hasNextPage || !data.products.pageInfo.endCursor) break;
    cursor = data.products.pageInfo.endCursor;
  }
  return products;
}

export async function createDiscount(
  admin: AdminClient,
  input: DiscountManagerInput,
  products: DiscountProductPreview[],
): Promise<{ id: string; title: string; selectedProducts: number }> {
  if (!input.title.trim()) throw new Error("Discount title is required.");
  if (input.value <= 0) throw new Error("Discount value must be greater than zero.");
  if (!input.allProducts && !input.collectionId && products.length === 0) {
    throw new Error("No products match the selected vendor or category filters.");
  }

  const items = input.allProducts
    ? { all: true }
    : input.collectionId
      ? { collections: { add: [input.collectionId] } }
      : { products: { productsToAdd: products.map((item) => item.id) } };

  const customerGets = {
    value: input.valueType === "percentage"
      ? { percentage: input.value / 100 }
      : { discountAmount: { amount: input.value.toFixed(2), appliesOnEachItem: true } },
    items,
  };

  const common: Record<string, unknown> = {
    title: input.title.trim(),
    startsAt: input.startsAt || new Date().toISOString(),
    endsAt: input.endsAt || null,
    context: { all: "ALL" },
    customerGets,
    combinesWith: {
      orderDiscounts: false,
      productDiscounts: false,
      shippingDiscounts: true,
    },
  };
  if (input.minimumSubtotal > 0) {
    common.minimumRequirement = {
      subtotal: { greaterThanOrEqualToSubtotal: input.minimumSubtotal.toFixed(2) },
    };
  }

  if (input.discountType === "code") {
    if (!input.code.trim()) throw new Error("Discount code is required.");
    const data = await graphqlData<{
      discountCodeBasicCreate: {
        codeDiscountNode: { id: string; codeDiscount: { title: string } } | null;
        userErrors: Array<{ field?: string[]; message: string }>;
      };
    }>(
      admin,
      `#graphql
        mutation DiscountManagerCode($input: DiscountCodeBasicInput!) {
          discountCodeBasicCreate(basicCodeDiscount: $input) {
            codeDiscountNode { id codeDiscount { ... on DiscountCodeBasic { title } } }
            userErrors { field message }
          }
        }
      `,
      {
        input: {
          ...common,
          code: input.code.trim().toUpperCase(),
          appliesOncePerCustomer: input.appliesOncePerCustomer,
          usageLimit: input.usageLimit > 0 ? input.usageLimit : null,
        },
      },
    );
    const message = userErrorMessage(data.discountCodeBasicCreate.userErrors);
    if (message) throw new Error(message);
    const node = data.discountCodeBasicCreate.codeDiscountNode;
    if (!node) throw new Error("Shopify did not return the created discount code.");
    return { id: node.id, title: node.codeDiscount.title, selectedProducts: products.length };
  }

  const data = await graphqlData<{
    discountAutomaticBasicCreate: {
      automaticDiscountNode: { id: string; automaticDiscount: { title: string } } | null;
      userErrors: Array<{ field?: string[]; message: string }>;
    };
  }>(
    admin,
    `#graphql
      mutation DiscountManagerAutomatic($input: DiscountAutomaticBasicInput!) {
        discountAutomaticBasicCreate(automaticBasicDiscount: $input) {
          automaticDiscountNode { id automaticDiscount { ... on DiscountAutomaticBasic { title } } }
          userErrors { field message }
        }
      }
    `,
    { input: common },
  );
  const message = userErrorMessage(data.discountAutomaticBasicCreate.userErrors);
  if (message) throw new Error(message);
  const node = data.discountAutomaticBasicCreate.automaticDiscountNode;
  if (!node) throw new Error("Shopify did not return the created automatic discount.");
  return { id: node.id, title: node.automaticDiscount.title, selectedProducts: products.length };
}
