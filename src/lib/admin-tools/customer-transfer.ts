import {
  booleanValue,
  firstValue,
  graphqlData,
  listValue,
  optionalText,
  pause,
  userErrorMessage,
  type AdminClient,
  type DataRow,
} from "./adminTools";

export async function exportCustomers(
  admin: AdminClient,
  query: string,
  limit = 10000,
): Promise<DataRow[]> {
  const rows: DataRow[] = [];
  let cursor: string | null = null;

  while (rows.length < limit) {
    const data = await graphqlData<{
      customers: {
        nodes: Array<{
          id: string;
          legacyResourceId: string;
          firstName: string | null;
          lastName: string | null;
          email: string | null;
          phone: string | null;
          note: string | null;
          tags: string[];
          taxExempt: boolean;
          verifiedEmail: boolean;
          state: string;
          locale: string | null;
          createdAt: string;
          updatedAt: string;
          amountSpent: { amount: string; currencyCode: string };
          numberOfOrders: string;
          defaultAddress: {
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
          } | null;
        }>;
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    }>(
      admin,
      `#graphql
        query CustomerExport($first: Int!, $after: String, $query: String) {
          customers(first: $first, after: $after, query: $query, sortKey: UPDATED_AT) {
            nodes {
              id legacyResourceId firstName lastName email phone note tags taxExempt verifiedEmail state locale
              createdAt updatedAt numberOfOrders
              amountSpent { amount currencyCode }
              defaultAddress {
                firstName lastName company address1 address2 city provinceCode countryCodeV2 zip phone
              }
            }
            pageInfo { hasNextPage endCursor }
          }
        }
      `,
      { first: 100, after: cursor, query: query.trim() || null },
    );

    for (const customer of data.customers.nodes) {
      rows.push({
        "Customer ID": customer.id,
        "Legacy Customer ID": customer.legacyResourceId,
        "First Name": customer.firstName || "",
        "Last Name": customer.lastName || "",
        Email: customer.email || "",
        Phone: customer.phone || "",
        Note: customer.note || "",
        Tags: customer.tags.join(", "),
        "Tax Exempt": customer.taxExempt,
        "Verified Email": customer.verifiedEmail,
        State: customer.state,
        Locale: customer.locale || "",
        "Orders Count": customer.numberOfOrders,
        "Amount Spent": customer.amountSpent.amount,
        Currency: customer.amountSpent.currencyCode,
        "Address First Name": customer.defaultAddress?.firstName || "",
        "Address Last Name": customer.defaultAddress?.lastName || "",
        Company: customer.defaultAddress?.company || "",
        "Address 1": customer.defaultAddress?.address1 || "",
        "Address 2": customer.defaultAddress?.address2 || "",
        City: customer.defaultAddress?.city || "",
        "Province Code": customer.defaultAddress?.provinceCode || "",
        "Country Code": customer.defaultAddress?.countryCodeV2 || "",
        ZIP: customer.defaultAddress?.zip || "",
        "Address Phone": customer.defaultAddress?.phone || "",
        "Created At": customer.createdAt,
        "Updated At": customer.updatedAt,
      });
      if (rows.length >= limit) break;
    }

    if (!data.customers.pageInfo.hasNextPage || !data.customers.pageInfo.endCursor) break;
    cursor = data.customers.pageInfo.endCursor;
  }

  return rows;
}

interface CustomerImportResult {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: string[];
}

function mailingAddress(row: DataRow): Record<string, unknown> | null {
  const address1 = optionalText(firstValue(row, ["Address 1", "address1", "Street"]));
  const zip = optionalText(firstValue(row, ["ZIP", "Zip", "Postal Code"]));
  const city = optionalText(firstValue(row, ["City"]));
  if (!address1 && !zip && !city) return null;
  const countryCode = optionalText(firstValue(row, ["Country Code", "Country", "countryCode"])).toUpperCase();
  const provinceCode = optionalText(firstValue(row, ["Province Code", "State Code", "provinceCode"]));
  return {
    firstName: optionalText(firstValue(row, ["Address First Name", "First Name"])),
    lastName: optionalText(firstValue(row, ["Address Last Name", "Last Name"])),
    company: optionalText(firstValue(row, ["Company"])),
    address1,
    address2: optionalText(firstValue(row, ["Address 2", "address2"])),
    city,
    provinceCode: provinceCode || undefined,
    countryCode: countryCode || undefined,
    zip,
    phone: optionalText(firstValue(row, ["Address Phone", "Phone"])),
  };
}

async function findCustomerId(admin: AdminClient, row: DataRow): Promise<string | null> {
  const id = optionalText(firstValue(row, ["Customer ID", "ID"]));
  if (id.startsWith("gid://shopify/Customer/")) return id;
  const email = optionalText(firstValue(row, ["Email"]));
  if (!email) return null;
  const data = await graphqlData<{
    customer: { id: string } | null;
  }>(
    admin,
    `#graphql
      query CustomerByEmail($identifier: CustomerIdentifierInput!) {
        customer: customerByIdentifier(identifier: $identifier) { id }
      }
    `,
    { identifier: { emailAddress: email } },
  );
  return data.customer?.id || null;
}

export async function importCustomers(
  admin: AdminClient,
  rows: DataRow[],
  mode: "create" | "update" | "upsert",
): Promise<CustomerImportResult> {
  const result: CustomerImportResult = {
    total: rows.length,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const email = optionalText(firstValue(row, ["Email"]));
    const phone = optionalText(firstValue(row, ["Phone"]));
    if (!email && !phone) {
      result.skipped += 1;
      result.errors.push(`Row ${index + 2}: Email or phone is required.`);
      continue;
    }

    try {
      const existingId = mode === "create" ? null : await findCustomerId(admin, row);
      if (mode === "update" && !existingId) {
        result.skipped += 1;
        result.errors.push(`Row ${index + 2}: Existing customer was not found.`);
        continue;
      }

      const input: Record<string, unknown> = {
        ...(existingId ? { id: existingId } : {}),
        firstName: optionalText(firstValue(row, ["First Name", "firstName"])),
        lastName: optionalText(firstValue(row, ["Last Name", "lastName"])),
        email: email || undefined,
        phone: phone || undefined,
        note: optionalText(firstValue(row, ["Note"])),
        tags: listValue(firstValue(row, ["Tags"])),
        taxExempt: booleanValue(firstValue(row, ["Tax Exempt", "taxExempt"]), false),
        locale: optionalText(firstValue(row, ["Locale"])) || undefined,
      };

      const address = mailingAddress(row);
      if (!existingId && address) input.addresses = [address];

      if (existingId) {
        const data = await graphqlData<{
          customerUpdate: {
            customer: { id: string } | null;
            userErrors: Array<{ field?: string[]; message: string }>;
          };
        }>(
          admin,
          `#graphql
            mutation CustomerImportUpdate($input: CustomerInput!) {
              customerUpdate(input: $input) {
                customer { id }
                userErrors { field message }
              }
            }
          `,
          { input },
        );
        const message = userErrorMessage(data.customerUpdate.userErrors);
        if (message) throw new Error(message);
        result.updated += 1;

        if (address) {
          const addressData = await graphqlData<{
            customerAddressCreate: {
              address: { id: string } | null;
              userErrors: Array<{ field?: string[]; message: string }>;
            };
          }>(
            admin,
            `#graphql
              mutation CustomerImportAddress($customerId: ID!, $address: MailingAddressInput!) {
                customerAddressCreate(customerId: $customerId, address: $address, setAsDefault: true) {
                  address { id }
                  userErrors { field message }
                }
              }
            `,
            { customerId: existingId, address },
          );
          const addressError = userErrorMessage(addressData.customerAddressCreate.userErrors);
          if (addressError) result.errors.push(`Row ${index + 2} address: ${addressError}`);
        }
      } else {
        const data = await graphqlData<{
          customerCreate: {
            customer: { id: string } | null;
            userErrors: Array<{ field?: string[]; message: string }>;
          };
        }>(
          admin,
          `#graphql
            mutation CustomerImportCreate($input: CustomerInput!) {
              customerCreate(input: $input) {
                customer { id }
                userErrors { field message }
              }
            }
          `,
          { input },
        );
        const message = userErrorMessage(data.customerCreate.userErrors);
        if (message) throw new Error(message);
        result.created += 1;
      }
    } catch (error) {
      result.failed += 1;
      result.errors.push(`Row ${index + 2}: ${error instanceof Error ? error.message : String(error)}`);
    }
    await pause(100);
  }

  return result;
}
