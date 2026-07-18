import type {
  PreparedMetafield,
  PreparedProduct,
  PreparedVariant,
} from "./importPayload";

import type {
  ImportTransferSettings,
  StoreLocationOption,
} from "./transferSettings";

import type {
  TestImportRequest,
  TestImportResponse,
} from "./testImport";

interface AdminGraphqlClient {
  graphql: (
    query: string,
    options?: {
      variables?: Record<string, unknown>;
    },
  ) => Promise<Response>;
}

interface GraphqlUserError {
  field?: string[] | null;
  message: string;
  code?: string | null;
}

interface ProductSetResponse {
  data?: {
    productSet?: {
      product?: {
        id: string;
        title: string;
        handle: string;
        status: string;
        variants: {
          nodes: Array<{
            id: string;
            sku: string;
            inventoryItem: {
              id: string;
            };
          }>;
        };
      } | null;
      userErrors: GraphqlUserError[];
    };
  };
  errors?: Array<{
    message: string;
  }>;
}

interface LocationQueryResponse {
  data?: {
    locations: {
      nodes: Array<{
        id: string;
        name: string;
        isActive: boolean;
      }>;
    };
  };
  errors?: Array<{
    message: string;
  }>;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);

    return (
      url.protocol === "http:" ||
      url.protocol === "https:"
    );
  } catch {
    return false;
  }
}

function compactObject<T extends Record<string, unknown>>(
  value: T,
): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(
      ([, item]) =>
        item !== undefined &&
        item !== null &&
        item !== "",
    ),
  ) as Partial<T>;
}

function metafieldToInput(
  metafield: PreparedMetafield,
) {
  return {
    namespace: metafield.namespace,
    key: metafield.key,
    type: metafield.type,
    value: metafield.value,
  };
}

async function getActiveLocations(
  admin: AdminGraphqlClient,
): Promise<StoreLocationOption[]> {
  const response = await admin.graphql(
    `#graphql
      query TestImportLocations {
        locations(first: 100) {
          nodes {
            id
            name
            isActive
          }
        }
      }
    `,
  );

  const json =
    (await response.json()) as LocationQueryResponse;

  if (!json.data) {
    throw new Error(
      json.errors
        ?.map((error) => error.message)
        .join(", ") ||
        "Active Shopify locations could not be retrieved.",
    );
  }

  return json.data.locations.nodes
    .filter((location) => location.isActive)
    .map((location) => ({
      id: location.id,
      name: location.name,
    }));
}

function selectTargetLocations(
  activeLocations: StoreLocationOption[],
  settings: ImportTransferSettings,
): StoreLocationOption[] {
  if (settings.inventoryMode === "skip") {
    return [];
  }

  if (
    settings.inventoryTarget ===
    "all_locations"
  ) {
    return activeLocations;
  }

  const selected = activeLocations.find(
    (location) =>
      location.id === settings.locationId,
  );

  if (!selected) {
    throw new Error(
      "The selected inventory location is not active in the store.",
    );
  }

  return [selected];
}

function variantInventoryQuantity(
  variant: PreparedVariant,
  settings: ImportTransferSettings,
): number | null {
  if (settings.inventoryMode === "skip") {
    return null;
  }

  if (
    settings.inventoryMode ===
    "default_quantity"
  ) {
    return settings.defaultQuantity;
  }

  return variant.inventoryQuantity ?? 0;
}

function variantToInput(
  variant: PreparedVariant,
  settings: ImportTransferSettings,
  locations: StoreLocationOption[],
) {
  const quantity = variantInventoryQuantity(
    variant,
    settings,
  );

  const inventoryQuantities =
    quantity === null
      ? undefined
      : locations.map((location) => ({
          locationId: location.id,
          name: "available",
          quantity,
        }));

  const inventoryItem = compactObject({
    tracked:
      settings.inventoryMode !== "skip"
        ? true
        : variant.inventoryTracked,
    requiresShipping:
      variant.requiresShipping ?? undefined,
    cost: variant.cost ?? undefined,
  });

  return compactObject({
    sku: variant.sku || undefined,
    barcode: variant.barcode || undefined,
    price: variant.price ?? undefined,
    compareAtPrice:
      variant.compareAtPrice ?? undefined,
    taxable: variant.taxable ?? undefined,
    inventoryPolicy:
      variant.inventoryPolicy,
    inventoryItem,
    inventoryQuantities,
    optionValues: variant.optionValues,
    file:
      variant.imageUrl &&
      isHttpUrl(variant.imageUrl)
        ? compactObject({
            originalSource:
              variant.imageUrl,
            alt:
              variant.imageAlt ||
              undefined,
            contentType: "IMAGE",
          })
        : undefined,
    metafields:
      variant.metafields.length > 0
        ? variant.metafields.map(
            metafieldToInput,
          )
        : undefined,
  });
}

function productToInput(
  product: PreparedProduct,
  settings: ImportTransferSettings,
  locations: StoreLocationOption[],
) {
  const files = product.files
    .filter((file) =>
      isHttpUrl(file.originalSource),
    )
    .map((file) =>
      compactObject({
        originalSource:
          file.originalSource,
        alt: file.alt || undefined,
        contentType: "IMAGE",
      }),
    );

  return compactObject({
    title: product.title,
    handle: product.handle || undefined,
    descriptionHtml:
      product.descriptionHtml || undefined,
    vendor: product.vendor || undefined,
    productType:
      product.productType || undefined,
    tags:
      product.tags.length > 0
        ? product.tags
        : undefined,
    status: "DRAFT",
    seo:
      product.seoTitle ||
      product.seoDescription
        ? compactObject({
            title:
              product.seoTitle || undefined,
            description:
              product.seoDescription ||
              undefined,
          })
        : undefined,
    productOptions:
      product.productOptions.map(
        (option) => ({
          name: option.name,
          position: option.position,
          values: option.values.map(
            (name) => ({ name }),
          ),
        }),
      ),
    variants: product.variants.map(
      (variant) =>
        variantToInput(
          variant,
          settings,
          locations,
        ),
    ),
    files:
      files.length > 0
        ? files
        : undefined,
    metafields:
      product.metafields.length > 0
        ? product.metafields.map(
            metafieldToInput,
          )
        : undefined,
  });
}

function definitionName(
  metafield: PreparedMetafield,
): string {
  return metafield.key
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) =>
      letter.toUpperCase(),
    )
    .slice(0, 64);
}

async function createDefinitionIfNeeded(
  admin: AdminGraphqlClient,
  metafield: PreparedMetafield,
): Promise<string | null> {
  const response = await admin.graphql(
    `#graphql
      mutation CreateImportMetafieldDefinition(
        $definition: MetafieldDefinitionInput!
      ) {
        metafieldDefinitionCreate(
          definition: $definition
        ) {
          createdDefinition {
            id
          }
          userErrors {
            field
            message
            code
          }
        }
      }
    `,
    {
      variables: {
        definition: {
          name: definitionName(metafield),
          namespace: metafield.namespace,
          key: metafield.key,
          type: metafield.type,
          ownerType: metafield.ownerType,
          description:
            "Created by Product Collection Upload.",
        },
      },
    },
  );

  const json = (await response.json()) as {
    data?: {
      metafieldDefinitionCreate?: {
        createdDefinition?: {
          id: string;
        } | null;
        userErrors: GraphqlUserError[];
      };
    };
    errors?: Array<{
      message: string;
    }>;
  };

  const topLevelError =
    json.errors?.[0]?.message;

  if (topLevelError) {
    return topLevelError;
  }

  const userErrors =
    json.data?.metafieldDefinitionCreate
      ?.userErrors ?? [];

  if (userErrors.length === 0) {
    return null;
  }

  const duplicateOnly = userErrors.every(
    (error) =>
      error.code === "TAKEN" ||
      /already exists|taken/i.test(
        error.message,
      ),
  );

  if (duplicateOnly) {
    return null;
  }

  return userErrors
    .map((error) => error.message)
    .join(", ");
}

async function ensureMetafieldDefinitions(
  admin: AdminGraphqlClient,
  product: PreparedProduct,
): Promise<string[]> {
  const unique = new Map<
    string,
    PreparedMetafield
  >();

  [
    ...product.metafields,
    ...product.variants.flatMap(
      (variant) => variant.metafields,
    ),
  ].forEach((metafield) => {
    unique.set(
      `${metafield.ownerType}:${metafield.namespace}:${metafield.key}`,
      metafield,
    );
  });

  const warnings: string[] = [];

  for (const metafield of unique.values()) {
    const error =
      await createDefinitionIfNeeded(
        admin,
        metafield,
      );

    if (error) {
      warnings.push(
        `${metafield.namespace}.${metafield.key} definition could not be created: ${error}`,
      );
    }
  }

  return warnings;
}

function validatePayload(
  payload: TestImportRequest,
): string[] {
  const errors: string[] = [];

  if (!payload?.product) {
    errors.push(
      "No product data was available for the safe test.",
    );
    return errors;
  }

  if (!payload.product.title.trim()) {
    errors.push("Product title cannot be empty.");
  }

  if (
    payload.product.variants.length === 0
  ) {
    errors.push(
      "A product must contain at least one variant.",
    );
  }

  if (
    payload.product.variants.length > 2048
  ) {
    errors.push(
      "A product cannot contain more than 2,048 variants.",
    );
  }

  return errors;
}

function createSafeTestProduct(
  product: PreparedProduct,
): PreparedProduct {
  const suffix = Date.now()
    .toString(36)
    .slice(-7);

  const baseHandle =
    product.handle ||
    product.title
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("en-US")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") ||
    "spcu-test-product";

  return {
    ...product,
    title: `[TEST] ${product.title}`,
    handle: `${baseHandle}-spcu-test-${suffix}`
      .slice(0, 240)
      .replace(/-+$/g, ""),
    sourceStatus: "draft",
    warnings: [
      ...product.warnings,
      "[TEST] was added to the title and a unique test suffix was added to the handle.",
    ],
  };
}

export async function runTestProductImport(
  admin: AdminGraphqlClient,
  payload: TestImportRequest,
): Promise<TestImportResponse> {
  const errors = validatePayload(payload);

  if (errors.length > 0) {
    return {
      ok: false,
      warnings: [],
      errors,
    };
  }

  const testProduct =
    createSafeTestProduct(
      payload.product,
    );

  const warnings = [
    ...testProduct.warnings,
    "The safe test import forces the product status to Draft.",
    "The safe test import does not publish to sales channels.",
  ];

  const activeLocations =
    await getActiveLocations(admin);

  const targetLocations =
    selectTargetLocations(
      activeLocations,
      payload.settings,
    );

  if (
    payload.settings.createMetafieldDefinitions
  ) {
    warnings.push(
      ...(await ensureMetafieldDefinitions(
        admin,
        testProduct,
      )),
    );
  }

  const input = productToInput(
    testProduct,
    payload.settings,
    targetLocations,
  );

  const response = await admin.graphql(
    `#graphql
      mutation ProductCollectionUploadTest(
        $input: ProductSetInput!
      ) {
        productSet(
          synchronous: true
          input: $input
        ) {
          product {
            id
            title
            handle
            status
            variants(first: 250) {
              nodes {
                id
                sku
                inventoryItem {
                  id
                }
              }
            }
          }
          userErrors {
            field
            message
            code
          }
        }
      }
    `,
    {
      variables: {
        input,
      },
    },
  );

  const json =
    (await response.json()) as ProductSetResponse;

  if (json.errors?.length) {
    return {
      ok: false,
      warnings,
      errors: json.errors.map(
        (error) => error.message,
      ),
    };
  }

  const result = json.data?.productSet;
  const userErrors =
    result?.userErrors ?? [];

  if (
    userErrors.length > 0 ||
    !result?.product
  ) {
    return {
      ok: false,
      warnings,
      errors:
        userErrors.length > 0
          ? userErrors.map((error) => {
              const field =
                error.field?.join(".");

              return field
                ? `${field}: ${error.message}`
                : error.message;
            })
          : [
              "Shopify did not create a product record.",
            ],
    };
  }

  const product = result.product;

  return {
    ok: true,
    productId: product.id,
    productLegacyId:
      product.id.split("/").pop(),
    title: product.title,
    handle: product.handle,
    status: product.status,
    variantCount:
      product.variants.nodes.length,
    warnings,
    errors: [],
  };
}
