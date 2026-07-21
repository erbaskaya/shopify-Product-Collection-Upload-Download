import {
  firstValue,
  graphqlData,
  integerValue,
  numberValue,
  optionalText,
  pause,
  userErrorMessage,
  type AdminClient,
  type DataRow,
} from "./adminTools";

export async function exportOrders(
  admin: AdminClient,
  query: string,
  limit = 10000,
): Promise<DataRow[]> {
  const rows: DataRow[] = [];
  let cursor: string | null = null;

  while (rows.length < limit) {
    const data = await graphqlData<{
      orders: {
        nodes: Array<{
          id: string;
          legacyResourceId: string;
          name: string;
          createdAt: string;
          processedAt: string;
          closedAt: string | null;
          cancelledAt: string | null;
          cancelReason: string | null;
          email: string | null;
          phone: string | null;
          note: string | null;
          tags: string[];
          displayFinancialStatus: string;
          displayFulfillmentStatus: string;
          currencyCode: string;
          totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
          subtotalPriceSet: { shopMoney: { amount: string } };
          totalTaxSet: { shopMoney: { amount: string } };
          totalShippingPriceSet: { shopMoney: { amount: string } };
          totalDiscountsSet: { shopMoney: { amount: string } };
          customer: { id: string; email: string | null; firstName: string | null; lastName: string | null } | null;
          shippingAddress: Address | null;
          billingAddress: Address | null;
          lineItems: {
            nodes: Array<{
              id: string;
              title: string;
              variantTitle: string | null;
              sku: string | null;
              quantity: number;
              currentQuantity: number;
              vendor: string | null;
              originalUnitPriceSet: { shopMoney: { amount: string; currencyCode: string } };
              variant: { id: string } | null;
            }>;
          };
        }>;
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    }>(
      admin,
      `#graphql
        query OrderExport($first: Int!, $after: String, $query: String) {
          orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT, reverse: true) {
            nodes {
              id legacyResourceId name createdAt processedAt closedAt cancelledAt cancelReason
              email phone note tags displayFinancialStatus displayFulfillmentStatus currencyCode
              totalPriceSet { shopMoney { amount currencyCode } }
              subtotalPriceSet { shopMoney { amount } }
              totalTaxSet { shopMoney { amount } }
              totalShippingPriceSet { shopMoney { amount } }
              totalDiscountsSet { shopMoney { amount } }
              customer { id email firstName lastName }
              shippingAddress { firstName lastName company address1 address2 city provinceCode countryCodeV2 zip phone }
              billingAddress { firstName lastName company address1 address2 city provinceCode countryCodeV2 zip phone }
              lineItems(first: 250) {
                nodes {
                  id title variantTitle sku quantity currentQuantity vendor
                  originalUnitPriceSet { shopMoney { amount currencyCode } }
                  variant { id }
                }
              }
            }
            pageInfo { hasNextPage endCursor }
          }
        }
      `,
      { first: 50, after: cursor, query: query.trim() || null },
    );

    for (const order of data.orders.nodes) {
      for (let itemIndex = 0; itemIndex < order.lineItems.nodes.length; itemIndex += 1) {
        const item = order.lineItems.nodes[itemIndex];
        const row: DataRow = {
          "Order ID": order.id,
          "Legacy Order ID": order.legacyResourceId,
          "Order Name": order.name,
          "Line Number": itemIndex + 1,
          "Created At": order.createdAt,
          "Processed At": order.processedAt,
          "Financial Status": order.displayFinancialStatus,
          "Fulfillment Status": order.displayFulfillmentStatus,
          Email: order.email || order.customer?.email || "",
          Phone: order.phone || "",
          "Customer First Name": order.customer?.firstName || "",
          "Customer Last Name": order.customer?.lastName || "",
          "Customer ID": order.customer?.id || "",
          Note: order.note || "",
          Tags: order.tags.join(", "),
          Currency: order.currencyCode,
          Subtotal: order.subtotalPriceSet.shopMoney.amount,
          Shipping: order.totalShippingPriceSet.shopMoney.amount,
          Tax: order.totalTaxSet.shopMoney.amount,
          Discount: order.totalDiscountsSet.shopMoney.amount,
          Total: order.totalPriceSet.shopMoney.amount,
          "Variant ID": item.variant?.id || "",
          "Variant SKU": item.sku || "",
          "Line Item Title": item.title,
          "Variant Title": item.variantTitle || "",
          Vendor: item.vendor || "",
          Quantity: item.quantity,
          "Current Quantity": item.currentQuantity,
          "Unit Price": item.originalUnitPriceSet.shopMoney.amount,
          "Shipping First Name": order.shippingAddress?.firstName || "",
          "Shipping Last Name": order.shippingAddress?.lastName || "",
          "Shipping Company": order.shippingAddress?.company || "",
          "Shipping Address 1": order.shippingAddress?.address1 || "",
          "Shipping Address 2": order.shippingAddress?.address2 || "",
          "Shipping City": order.shippingAddress?.city || "",
          "Shipping Province Code": order.shippingAddress?.provinceCode || "",
          "Shipping Country Code": order.shippingAddress?.countryCodeV2 || "",
          "Shipping ZIP": order.shippingAddress?.zip || "",
          "Shipping Phone": order.shippingAddress?.phone || "",
          "Billing First Name": order.billingAddress?.firstName || "",
          "Billing Last Name": order.billingAddress?.lastName || "",
          "Billing Company": order.billingAddress?.company || "",
          "Billing Address 1": order.billingAddress?.address1 || "",
          "Billing Address 2": order.billingAddress?.address2 || "",
          "Billing City": order.billingAddress?.city || "",
          "Billing Province Code": order.billingAddress?.provinceCode || "",
          "Billing Country Code": order.billingAddress?.countryCodeV2 || "",
          "Billing ZIP": order.billingAddress?.zip || "",
          "Billing Phone": order.billingAddress?.phone || "",
        };
        rows.push(row);
        if (rows.length >= limit) break;
      }
      if (rows.length >= limit) break;
    }

    if (!data.orders.pageInfo.hasNextPage || !data.orders.pageInfo.endCursor) break;
    cursor = data.orders.pageInfo.endCursor;
  }

  return rows;
}

interface Address {
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  provinceCode: string | null;
  countryCodeV2: string | null;
  zip: string | null;
  phone: string | null;
}

async function resolveVariantId(admin: AdminClient, row: DataRow): Promise<string | null> {
  const id = optionalText(firstValue(row, ["Variant ID", "variantId"]));
  if (id.startsWith("gid://shopify/ProductVariant/")) return id;
  const sku = optionalText(firstValue(row, ["Variant SKU", "SKU", "sku"]));
  if (!sku) return null;
  const data = await graphqlData<{
    productVariants: { nodes: Array<{ id: string }> };
  }>(
    admin,
    `#graphql
      query VariantBySku($query: String!) {
        productVariants(first: 2, query: $query) { nodes { id } }
      }
    `,
    { query: `sku:${JSON.stringify(sku)}` },
  );
  return data.productVariants.nodes[0]?.id || null;
}

function addressFromRow(row: DataRow, prefix: "Shipping" | "Billing"): Record<string, unknown> | undefined {
  const address1 = optionalText(firstValue(row, [`${prefix} Address 1`]));
  const city = optionalText(firstValue(row, [`${prefix} City`]));
  const zip = optionalText(firstValue(row, [`${prefix} ZIP`]));
  if (!address1 && !city && !zip) return undefined;
  return {
    firstName: optionalText(firstValue(row, [`${prefix} First Name`, "Customer First Name"])),
    lastName: optionalText(firstValue(row, [`${prefix} Last Name`, "Customer Last Name"])),
    company: optionalText(firstValue(row, [`${prefix} Company`])),
    address1,
    address2: optionalText(firstValue(row, [`${prefix} Address 2`])),
    city,
    provinceCode: optionalText(firstValue(row, [`${prefix} Province Code`])) || undefined,
    countryCode: optionalText(firstValue(row, [`${prefix} Country Code`])).toUpperCase() || undefined,
    zip,
    phone: optionalText(firstValue(row, [`${prefix} Phone`, "Phone"])),
  };
}

export async function importOrders(
  admin: AdminClient,
  rows: DataRow[],
  options: { financialStatus: string; sendReceipt: boolean; sendFulfillmentReceipt: boolean },
): Promise<{ total: number; created: number; failed: number; skipped: number; errors: string[] }> {
  const groups = new Map<string, DataRow[]>();
  rows.forEach((row, index) => {
    const key = optionalText(firstValue(row, ["Order Name", "Order", "Legacy Order ID"])) || `ROW-${index + 2}`;
    const items = groups.get(key) || [];
    items.push(row);
    groups.set(key, items);
  });

  const result = { total: groups.size, created: 0, failed: 0, skipped: 0, errors: [] as string[] };
  for (const [key, orderRows] of groups) {
    try {
      const lineItems: Array<Record<string, unknown>> = [];
      for (const row of orderRows) {
        const variantId = await resolveVariantId(admin, row);
        const quantity = Math.max(1, integerValue(firstValue(row, ["Quantity", "Qty"]), 1));
        if (variantId) {
          lineItems.push({ variantId, quantity });
        } else {
          const title = optionalText(firstValue(row, ["Line Item Title", "Title"]));
          const price = numberValue(firstValue(row, ["Unit Price", "Price"]), 0);
          if (!title) continue;
          lineItems.push({
            title,
            quantity,
            priceSet: {
              shopMoney: {
                amount: price.toFixed(2),
                currencyCode: optionalText(firstValue(row, ["Currency"])) || "EUR",
              },
            },
          });
        }
      }
      if (!lineItems.length) {
        result.skipped += 1;
        result.errors.push(`${key}: No valid line items were found.`);
        continue;
      }

      const first = orderRows[0];
      const email = optionalText(firstValue(first, ["Email"]));
      const customerFirstName = optionalText(firstValue(first, ["Customer First Name"]));
      const customerLastName = optionalText(firstValue(first, ["Customer Last Name"]));
      const order: Record<string, unknown> = {
        lineItems,
        financialStatus: options.financialStatus || "PENDING",
        note: optionalText(firstValue(first, ["Note"])) || `Imported order: ${key}`,
        tags: ["imported-order"],
        shippingAddress: addressFromRow(first, "Shipping"),
        billingAddress: addressFromRow(first, "Billing"),
      };
      if (email) {
        order.customer = {
          toUpsert: {
            email,
            firstName: customerFirstName || undefined,
            lastName: customerLastName || undefined,
          },
        };
      }

      const data = await graphqlData<{
        orderCreate: {
          order: { id: string; name: string } | null;
          userErrors: Array<{ field?: string[]; message: string }>;
        };
      }>(
        admin,
        `#graphql
          mutation OrderImport($order: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) {
            orderCreate(order: $order, options: $options) {
              order { id name }
              userErrors { field message }
            }
          }
        `,
        {
          order,
          options: {
            sendReceipt: options.sendReceipt,
            sendFulfillmentReceipt: options.sendFulfillmentReceipt,
          },
        },
      );
      const message = userErrorMessage(data.orderCreate.userErrors);
      if (message) throw new Error(message);
      result.created += 1;
    } catch (error) {
      result.failed += 1;
      result.errors.push(`${key}: ${error instanceof Error ? error.message : String(error)}`);
    }
    await pause(220);
  }
  return result;
}
