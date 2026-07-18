import type {
  PreparedMetafield,
  PreparedProduct,
  PreparedVariant,
} from "./importPayload";

import type {
  BulkImportBatchRequest,
  BulkImportBatchResponse,
  BulkImportItemResult,
} from "./bulkImport";

import type {
  ImportTransferSettings,
  StoreLocationOption,
} from "./transferSettings";

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

interface ExistingProduct {
  id: string;
  title: string;
  handle: string;
  matchedBy: "handle" | "sku";
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
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

function formatUserErrors(
  errors: GraphqlUserError[],
): string[] {
  return errors.map((error) => {
    const field = error.field?.join(".");
    return field
      ? `${field}: ${error.message}`
      : error.message;
  });
}

async function getActiveLocations(
  admin: AdminGraphqlClient,
): Promise<StoreLocationOption[]> {
  const response = await admin.graphql(
    `#graphql
      query BulkImportLocations {
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

  const json = (await response.json()) as {
    data?: {
      locations: {
        nodes: Array<{
          id: string;
          name: string;
          isActive: boolean;
        }>;
      };
    };
    errors?: Array<{ message: string }>;
  };

  if (!json.data) {
    throw new Error(
      json.errors?.map((error) => error.message).join(", ") ||
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

  if (settings.inventoryTarget === "all_locations") {
    return activeLocations;
  }

  const selected = activeLocations.find(
    (location) => location.id === settings.locationId,
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

  if (settings.inventoryMode === "default_quantity") {
    return settings.defaultQuantity;
  }

  return variant.inventoryQuantity ?? 0;
}

function variantToInput(
  variant: PreparedVariant,
  settings: ImportTransferSettings,
  locations: StoreLocationOption[],
  includeMedia: boolean,
) {
  const quantity = variantInventoryQuantity(variant, settings);

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
    compareAtPrice: variant.compareAtPrice ?? undefined,
    taxable: variant.taxable ?? undefined,
    inventoryPolicy: variant.inventoryPolicy,
    inventoryItem,
    inventoryQuantities,
    optionValues: variant.optionValues,
    file:
      includeMedia &&
      variant.imageUrl &&
      isHttpUrl(variant.imageUrl)
        ? compactObject({
            originalSource: variant.imageUrl,
            alt: variant.imageAlt || undefined,
            contentType: "IMAGE",
          })
        : undefined,
    metafields:
      variant.metafields.length > 0
        ? variant.metafields.map(metafieldToInput)
        : undefined,
  });
}

function productStatus(
  product: PreparedProduct,
  settings: ImportTransferSettings,
): "ACTIVE" | "DRAFT" | "ARCHIVED" {
  if (settings.productStatus === "active") {
    return "ACTIVE";
  }

  if (settings.productStatus === "draft") {
    return "DRAFT";
  }

  const source = product.sourceStatus
    .trim()
    .toLocaleLowerCase("en-US");

  if (source === "active") {
    return "ACTIVE";
  }

  if (source === "archived") {
    return "ARCHIVED";
  }

  return "DRAFT";
}

function productToInput(
  product: PreparedProduct,
  settings: ImportTransferSettings,
  locations: StoreLocationOption[],
  existingProduct: ExistingProduct | null,
) {
  const includeMedia =
    !existingProduct || !settings.preserveExistingMedia;

  const files = includeMedia
    ? product.files
        .filter((file) => isHttpUrl(file.originalSource))
        .map((file) =>
          compactObject({
            originalSource: file.originalSource,
            alt: file.alt || undefined,
            contentType: "IMAGE",
          }),
        )
    : [];

  return compactObject({
    title: product.title,
    handle: product.handle || undefined,
    descriptionHtml: product.descriptionHtml || undefined,
    vendor: product.vendor || undefined,
    productType: product.productType || undefined,
    // Product Category is intentionally omitted. Shopify can suggest one.
    tags: product.tags.length > 0 ? product.tags : undefined,
    status: productStatus(product, settings),
    seo:
      product.seoTitle || product.seoDescription
        ? compactObject({
            title: product.seoTitle || undefined,
            description: product.seoDescription || undefined,
          })
        : undefined,
    productOptions: product.productOptions.map((option) => ({
      name: option.name,
      position: option.position,
      values: option.values.map((name) => ({ name })),
    })),
    variants: product.variants.map((variant) =>
      variantToInput(
        variant,
        settings,
        locations,
        includeMedia,
      ),
    ),
    files: files.length > 0 ? files : undefined,
    metafields:
      product.metafields.length > 0
        ? product.metafields.map(metafieldToInput)
        : undefined,
  });
}

function definitionName(
  metafield: PreparedMetafield,
): string {
  return metafield.key
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .slice(0, 64);
}

async function createDefinitionIfNeeded(
  admin: AdminGraphqlClient,
  metafield: PreparedMetafield,
): Promise<string | null> {
  const response = await admin.graphql(
    `#graphql
      mutation CreateBulkImportMetafieldDefinition(
        $definition: MetafieldDefinitionInput!
      ) {
        metafieldDefinitionCreate(definition: $definition) {
          createdDefinition { id }
          userErrors { field message code }
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
        userErrors: GraphqlUserError[];
      };
    };
    errors?: Array<{ message: string }>;
  };

  if (json.errors?.length) {
    return json.errors.map((error) => error.message).join(", ");
  }

  const errors =
    json.data?.metafieldDefinitionCreate?.userErrors ?? [];

  if (errors.length === 0) {
    return null;
  }

  if (
    errors.every(
      (error) =>
        error.code === "TAKEN" ||
        /already exists|taken/i.test(error.message),
    )
  ) {
    return null;
  }

  return errors.map((error) => error.message).join(", ");
}

async function ensureMetafieldDefinitions(
  admin: AdminGraphqlClient,
  products: PreparedProduct[],
): Promise<string[]> {
  const unique = new Map<string, PreparedMetafield>();

  for (const product of products) {
    [
      ...product.metafields,
      ...product.variants.flatMap((variant) => variant.metafields),
    ].forEach((metafield) => {
      unique.set(
        `${metafield.ownerType}:${metafield.namespace}:${metafield.key}`,
        metafield,
      );
    });
  }

  const warnings: string[] = [];

  for (const metafield of unique.values()) {
    const error = await createDefinitionIfNeeded(admin, metafield);
    if (error) {
      warnings.push(
        `${metafield.namespace}.${metafield.key} definition could not be created: ${error}`,
      );
    }
  }

  return warnings;
}

async function findProductByHandle(
  admin: AdminGraphqlClient,
  handle: string,
): Promise<ExistingProduct | null> {
  if (!handle.trim()) {
    return null;
  }

  const response = await admin.graphql(
    `#graphql
      query FindImportProductByHandle($handle: String!) {
        productByHandle(handle: $handle) {
          id
          title
          handle
        }
      }
    `,
    { variables: { handle } },
  );

  const json = (await response.json()) as {
    data?: {
      productByHandle?: {
        id: string;
        title: string;
        handle: string;
      } | null;
    };
    errors?: Array<{ message: string }>;
  };

  if (json.errors?.length) {
    throw new Error(
      json.errors.map((error) => error.message).join(", "),
    );
  }

  const product = json.data?.productByHandle;
  return product
    ? { ...product, matchedBy: "handle" }
    : null;
}

function escapeSearchValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

async function findProductBySku(
  admin: AdminGraphqlClient,
  skus: string[],
): Promise<ExistingProduct | null> {
  for (const sku of Array.from(new Set(skus.filter(Boolean)))) {
    const response = await admin.graphql(
      `#graphql
        query FindImportProductBySku($query: String!) {
          productVariants(first: 10, query: $query) {
            nodes {
              sku
              product {
                id
                title
                handle
              }
            }
          }
        }
      `,
      {
        variables: {
          query: `sku:"${escapeSearchValue(sku)}"`,
        },
      },
    );

    const json = (await response.json()) as {
      data?: {
        productVariants: {
          nodes: Array<{
            sku: string;
            product: {
              id: string;
              title: string;
              handle: string;
            };
          }>;
        };
      };
      errors?: Array<{ message: string }>;
    };

    if (json.errors?.length) {
      throw new Error(
        json.errors.map((error) => error.message).join(", "),
      );
    }

    const exact = (json.data?.productVariants.nodes ?? []).filter(
      (node) =>
        node.sku.trim().toLocaleLowerCase("en-US") ===
        sku.trim().toLocaleLowerCase("en-US"),
    );

    const productIds = Array.from(
      new Set(exact.map((node) => node.product.id)),
    );

    if (productIds.length > 1) {
      throw new Error(
        `SKU "${sku}" is used by more than one Shopify product. A safe match could not be made.`,
      );
    }

    if (exact[0]) {
      return {
        ...exact[0].product,
        matchedBy: "sku",
      };
    }
  }

  return null;
}

async function findExistingProduct(
  admin: AdminGraphqlClient,
  product: PreparedProduct,
  settings: ImportTransferSettings,
): Promise<ExistingProduct | null> {
  if (
    settings.matchMethod === "handle" ||
    settings.matchMethod === "handle_then_sku"
  ) {
    const byHandle = await findProductByHandle(admin, product.handle);
    if (byHandle) {
      return byHandle;
    }
  }

  if (
    settings.matchMethod === "sku" ||
    settings.matchMethod === "handle_then_sku"
  ) {
    return findProductBySku(
      admin,
      product.variants.map((variant) => variant.sku),
    );
  }

  return null;
}

async function getPublicationIds(
  admin: AdminGraphqlClient,
): Promise<{ ids: string[]; warnings: string[] }> {
  const response = await admin.graphql(
    `#graphql
      query BulkImportPublications {
        publications(first: 100) {
          nodes { id }
        }
      }
    `,
  );

  const json = (await response.json()) as {
    data?: {
      publications: { nodes: Array<{ id: string }> };
    };
    errors?: Array<{ message: string }>;
  };

  if (!json.data) {
    return {
      ids: [],
      warnings: [
        json.errors?.map((error) => error.message).join(", ") ||
          "Sales channels could not be retrieved.",
      ],
    };
  }

  return {
    ids: json.data.publications.nodes.map((node) => node.id),
    warnings: [],
  };
}

async function publishProduct(
  admin: AdminGraphqlClient,
  productId: string,
  publicationIds: string[],
): Promise<string[]> {
  if (publicationIds.length === 0) {
    return ["No sales channel was available for publishing."];
  }

  const response = await admin.graphql(
    `#graphql
      mutation PublishImportedProduct(
        $id: ID!
        $input: [PublicationInput!]!
      ) {
        publishablePublish(id: $id, input: $input) {
          userErrors { field message }
        }
      }
    `,
    {
      variables: {
        id: productId,
        input: publicationIds.map((publicationId) => ({ publicationId })),
      },
    },
  );

  const json = (await response.json()) as {
    data?: {
      publishablePublish?: {
        userErrors: GraphqlUserError[];
      };
    };
    errors?: Array<{ message: string }>;
  };

  if (json.errors?.length) {
    return json.errors.map((error) => error.message);
  }

  return formatUserErrors(
    json.data?.publishablePublish?.userErrors ?? [],
  );
}

async function importOneProduct(
  admin: AdminGraphqlClient,
  product: PreparedProduct,
  settings: ImportTransferSettings,
  locations: StoreLocationOption[],
  publicationIds: string[],
  sharedWarnings: string[],
): Promise<BulkImportItemResult> {
  const base = {
    sourceKey: product.sourceKey,
    title: product.title,
    handle: product.handle,
    variantCount: product.variants.length,
    warnings: [...product.warnings, ...sharedWarnings],
  };

  try {
    const existing = await findExistingProduct(admin, product, settings);

    if (settings.importMode === "create_only" && existing) {
      return {
        ...base,
        status: "skipped",
        matchedBy: existing.matchedBy,
        productId: existing.id,
        productLegacyId: existing.id.split("/").pop(),
        warnings: [
          ...base.warnings,
          "The product already exists in the store and was skipped in create-only mode.",
        ],
        errors: [],
      };
    }

    if (settings.importMode === "update_only" && !existing) {
      return {
        ...base,
        status: "skipped",
        warnings: [
          ...base.warnings,
          "No matching product was found in the store, so it was skipped in update-only mode.",
        ],
        errors: [],
      };
    }

    const input = productToInput(product, settings, locations, existing);

    const response = await admin.graphql(
      `#graphql
        mutation ImportProductBatchItem(
          $input: ProductSetInput!
          $identifier: ProductSetIdentifiers
        ) {
          productSet(
            synchronous: true
            input: $input
            identifier: $identifier
          ) {
            product {
              id
              title
              handle
              status
              variantsCount { count }
            }
            userErrors { field message code }
          }
        }
      `,
      {
        variables: {
          input,
          identifier: existing ? { id: existing.id } : undefined,
        },
      },
    );

    const json = (await response.json()) as {
      data?: {
        productSet?: {
          product?: {
            id: string;
            title: string;
            handle: string;
            status: string;
            variantsCount: { count: number };
          } | null;
          userErrors: GraphqlUserError[];
        };
      };
      errors?: Array<{ message: string }>;
    };

    if (json.errors?.length) {
      return {
        ...base,
        status: "error",
        matchedBy: existing?.matchedBy,
        errors: json.errors.map((error) => error.message),
      };
    }

    const mutationResult = json.data?.productSet;
    const userErrors = mutationResult?.userErrors ?? [];

    if (!mutationResult?.product || userErrors.length > 0) {
      return {
        ...base,
        status: "error",
        matchedBy: existing?.matchedBy,
        errors:
          userErrors.length > 0
            ? formatUserErrors(userErrors)
            : ["Shopify did not return the product record."],
      };
    }

    const saved = mutationResult.product;
    const warnings = [...base.warnings];

    if (
      settings.publishToSalesChannels &&
      saved.status === "ACTIVE"
    ) {
      warnings.push(
        ...(await publishProduct(admin, saved.id, publicationIds)),
      );
    } else if (
      settings.publishToSalesChannels &&
      saved.status !== "ACTIVE"
    ) {
      warnings.push(
        "The product was not published to sales channels because its status is not Active.",
      );
    }

    return {
      ...base,
      title: saved.title,
      handle: saved.handle,
      status: existing ? "updated" : "created",
      matchedBy: existing?.matchedBy,
      productId: saved.id,
      productLegacyId: saved.id.split("/").pop(),
      variantCount: saved.variantsCount.count,
      warnings,
      errors: [],
    };
  } catch (error) {
    return {
      ...base,
      status: "error",
      errors: [
        error instanceof Error
          ? error.message
          : "An unknown error occurred during product import.",
      ],
    };
  }
}

function validateRequest(payload: BulkImportBatchRequest): string[] {
  const errors: string[] = [];

  if (!payload.requestId) {
    errors.push("The request ID is missing.");
  }

  if (!Array.isArray(payload.products) || payload.products.length === 0) {
    errors.push("The product batch is empty.");
  }

  if (payload.products.length > 25) {
    errors.push("A maximum of 25 products can be sent in one request.");
  }

  return errors;
}

export async function runBulkProductImportBatch(
  admin: AdminGraphqlClient,
  payload: BulkImportBatchRequest,
): Promise<BulkImportBatchResponse> {
  const validationErrors = validateRequest(payload);

  if (validationErrors.length > 0) {
    return {
      ok: false,
      requestId: payload.requestId || "invalid-request",
      offset: payload.offset || 0,
      processedCount: 0,
      stoppedOnError: true,
      results: [],
      fatalErrors: validationErrors,
    };
  }

  try {
    const activeLocations = await getActiveLocations(admin);
    const locations = selectTargetLocations(activeLocations, payload.settings);

    const sharedWarnings = payload.settings.createMetafieldDefinitions
      ? await ensureMetafieldDefinitions(admin, payload.products)
      : [];

    let publicationIds: string[] = [];
    if (payload.settings.publishToSalesChannels) {
      const publications = await getPublicationIds(admin);
      publicationIds = publications.ids;
      sharedWarnings.push(...publications.warnings);
    }

    const results: BulkImportItemResult[] = [];
    let stoppedOnError = false;

    for (const product of payload.products) {
      const result = await importOneProduct(
        admin,
        product,
        payload.settings,
        locations,
        publicationIds,
        sharedWarnings,
      );

      results.push(result);

      if (
        result.status === "error" &&
        !payload.settings.continueOnError
      ) {
        stoppedOnError = true;
        break;
      }
    }

    return {
      ok: results.every((result) => result.status !== "error"),
      requestId: payload.requestId,
      offset: payload.offset,
      processedCount: results.length,
      stoppedOnError,
      results,
      fatalErrors: [],
    };
  } catch (error) {
    return {
      ok: false,
      requestId: payload.requestId,
      offset: payload.offset,
      processedCount: 0,
      stoppedOnError: true,
      results: [],
      fatalErrors: [
        error instanceof Error
          ? error.message
          : "An unknown error occurred while processing the batch.",
      ],
    };
  }
}
