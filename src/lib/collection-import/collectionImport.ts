import type {
  CollectionImportResult,
  CollectionImportRow,
  CollectionImportSettings,
} from "./collectionImport.shared";

type AdminClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

interface ExistingCollection {
  id: string;
  legacyResourceId: string;
  handle: string;
  title: string;
  sourceIds: string[];
}

type JsonObject = Record<string, unknown>;

function parseJsonArray(value: string): JsonObject[] {
  if (!value?.trim()) return [];

  const parsed = JSON.parse(value) as unknown;

  if (!Array.isArray(parsed)) {
    throw new Error("The source field must be a JSON array.");
  }

  return parsed.filter(
    (item): item is JsonObject => Boolean(item) && typeof item === "object",
  );
}


function optionalString(value: string | undefined): string | undefined {
  const cleaned = value?.trim();
  return cleaned ? cleaned : undefined;
}

function parseMetafields(row: CollectionImportRow): JsonObject[] {
  const result: JsonObject[] = [];
  const pattern = /^Metafield:\s*([^.[\s]+)\.([^\s\[]+)\s*\[([^\]]+)\]$/i;

  for (const [column, value] of Object.entries(row)) {
    if (!value) continue;

    const match = column.match(pattern);
    if (!match) continue;

    result.push({
      namespace: match[1],
      key: match[2],
      type: match[3],
      value,
    });
  }

  return result;
}

async function findCollectionByHandle(
  admin: AdminClient,
  handle: string,
): Promise<ExistingCollection | null> {
  const response = await admin.graphql(
    `#graphql
      query FindCollectionByHandle($query: String!) {
        collections(first: 5, query: $query) {
          nodes {
            id
            legacyResourceId
            handle
            title
            sources {
              id
            }
          }
        }
      }
    `,
    {
      variables: {
        query: `handle:${JSON.stringify(handle)}`,
      },
    },
  );

  const payload = (await response.json()) as {
    data?: {
      collections: {
        nodes: Array<{
          id: string;
          legacyResourceId: string;
          handle: string;
          title: string;
          sources: Array<{ id: string }>;
        }>;
      };
    };
    errors?: Array<{ message: string }>;
  };

  const graphqlError = payload.errors?.map((item) => item.message).join(", ");
  if (graphqlError) throw new Error(graphqlError);

  const match = payload.data?.collections.nodes.find(
    (collection) => collection.handle === handle,
  );

  if (!match) return null;

  return {
    id: match.id,
    legacyResourceId: match.legacyResourceId,
    handle: match.handle,
    title: match.title,
    sourceIds: match.sources.map((source) => source.id),
  };
}

async function resolveProductId(
  admin: AdminClient,
  handle: string,
  cache: Map<string, string | null>,
): Promise<string | null> {
  if (cache.has(handle)) return cache.get(handle) ?? null;

  const response = await admin.graphql(
    `#graphql
      query ResolveProductHandle($query: String!) {
        products(first: 5, query: $query) {
          nodes {
            id
            handle
          }
        }
      }
    `,
    {
      variables: {
        query: `handle:${JSON.stringify(handle)}`,
      },
    },
  );

  const payload = (await response.json()) as {
    data?: {
      products: {
        nodes: Array<{ id: string; handle: string }>;
      };
    };
    errors?: Array<{ message: string }>;
  };

  const graphqlError = payload.errors?.map((item) => item.message).join(", ");
  if (graphqlError) throw new Error(graphqlError);

  const id =
    payload.data?.products.nodes.find((product) => product.handle === handle)
      ?.id ?? null;

  cache.set(handle, id);
  return id;
}

async function resolveCollectionId(
  admin: AdminClient,
  handle: string,
  cache: Map<string, string | null>,
): Promise<string | null> {
  if (cache.has(handle)) return cache.get(handle) ?? null;

  const existing = await findCollectionByHandle(admin, handle);
  const id = existing?.id ?? null;
  cache.set(handle, id);
  return id;
}

function valuesFrom(condition: JsonObject, alias: string): unknown[] {
  const value = condition[alias] ?? condition.values;
  return Array.isArray(value) ? value : [];
}

function scalarFrom(condition: JsonObject, alias: string): unknown {
  return condition[alias] ?? condition.value;
}

function relationFrom(condition: JsonObject, alias: string): string | undefined {
  return optionalString(String(condition[alias] ?? condition.relation ?? ""));
}

function matchTypeFrom(condition: JsonObject, alias: string): string | undefined {
  return optionalString(String(condition[alias] ?? condition.matchType ?? ""));
}

function transformInclusionCondition(
  condition: JsonObject,
  warnings: string[],
): JsonObject | null {
  const type = String(condition.__typename || "");

  const stringCondition = (
    key: string,
    relationAlias: string,
    valuesAlias: string,
    matchAlias: string,
  ): JsonObject | null => {
    const relation = relationFrom(condition, relationAlias);
    const values = valuesFrom(condition, valuesAlias).map(String);
    const matchType = matchTypeFrom(condition, matchAlias);

    if (!relation || values.length === 0) return null;

    return {
      [key]: {
        relation,
        values,
        ...(matchType ? { matchType } : {}),
      },
    };
  };

  switch (type) {
    case "CollectionSourceInclusionConditionProductTag":
      return stringCondition("productTag", "tagRelation", "tagValues", "tagMatchType");
    case "CollectionSourceInclusionConditionProductTitle":
      return stringCondition(
        "productTitle",
        "productTitleRelation",
        "productTitleValues",
        "productTitleMatchType",
      );
    case "CollectionSourceInclusionConditionProductType":
      return stringCondition(
        "productType",
        "productTypeRelation",
        "productTypeValues",
        "productTypeMatchType",
      );
    case "CollectionSourceInclusionConditionProductVendor":
      return stringCondition(
        "productVendor",
        "productVendorRelation",
        "productVendorValues",
        "productVendorMatchType",
      );
    case "CollectionSourceInclusionConditionProductStatus":
      return stringCondition(
        "productStatus",
        "productStatusRelation",
        "productStatusValues",
        "productStatusMatchType",
      );
    case "CollectionSourceInclusionConditionVariantTitle":
      return stringCondition(
        "variantTitle",
        "variantTitleRelation",
        "variantTitleValues",
        "variantTitleMatchType",
      );
    case "CollectionSourceInclusionConditionVariantInventory": {
      const relation = relationFrom(condition, "variantInventoryRelation");
      const value = scalarFrom(condition, "variantInventoryValue");
      if (!relation || value === undefined || value === null) return null;
      return { variantInventory: { relation, value: Number(value) } };
    }
    case "CollectionSourceInclusionConditionVariantPrice": {
      const relation = relationFrom(condition, "variantPriceRelation");
      const value = scalarFrom(condition, "variantPriceValue");
      if (!relation || !value || typeof value !== "object") return null;
      return { variantPrice: { relation, value } };
    }
    case "CollectionSourceInclusionConditionVariantCompareAtPrice": {
      const relation = relationFrom(condition, "compareAtPriceRelation");
      const value = scalarFrom(condition, "compareAtPriceValue");
      if (!relation || !value || typeof value !== "object") return null;
      return { variantCompareAtPrice: { relation, value } };
    }
    case "CollectionSourceInclusionConditionVariantWeight": {
      const relation = relationFrom(condition, "variantWeightRelation");
      const value = scalarFrom(condition, "variantWeightValue");
      if (!relation || !value || typeof value !== "object") return null;
      return { variantWeight: { relation, value } };
    }
    default:
      warnings.push(`Condition type was skipped: ${type || "Unknown"}.`);
      return null;
  }
}

function transformExclusionCondition(
  condition: JsonObject,
  warnings: string[],
): JsonObject | null {
  const type = String(condition.__typename || "");

  const stringCondition = (
    key: string,
    relationAlias: string,
    valuesAlias: string,
    matchAlias: string,
  ): JsonObject | null => {
    const relation = relationFrom(condition, relationAlias);
    const values = valuesFrom(condition, valuesAlias).map(String);
    const matchType = matchTypeFrom(condition, matchAlias);

    if (!relation || values.length === 0) return null;

    return {
      [key]: {
        relation,
        values,
        ...(matchType ? { matchType } : {}),
      },
    };
  };

  switch (type) {
    case "CollectionSourceExclusionConditionProductTag":
      return stringCondition(
        "productTag",
        "excludedTagRelation",
        "excludedTagValues",
        "excludedTagMatchType",
      );
    case "CollectionSourceExclusionConditionProductType":
      return stringCondition(
        "productType",
        "excludedTypeRelation",
        "excludedTypeValues",
        "excludedTypeMatchType",
      );
    case "CollectionSourceExclusionConditionProductVendor":
      return stringCondition(
        "productVendor",
        "excludedVendorRelation",
        "excludedVendorValues",
        "excludedVendorMatchType",
      );
    default:
      warnings.push(`Exclusion condition was skipped: ${type || "Unknown"}.`);
      return null;
  }
}

async function transformSources(
  admin: AdminClient,
  row: CollectionImportRow,
  warnings: string[],
): Promise<JsonObject[]> {
  const sources = parseJsonArray(row["Sources JSON"] || "");
  const productCache = new Map<string, string | null>();
  const collectionCache = new Map<string, string | null>();
  const output: JsonObject[] = [];

  for (const source of sources) {
    const type = String(source.__typename || "");

    if (type === "CollectionConditionsSource") {
      const inclusion =
        source.inclusion && typeof source.inclusion === "object"
          ? (source.inclusion as JsonObject)
          : {};
      const exclusion =
        source.exclusion && typeof source.exclusion === "object"
          ? (source.exclusion as JsonObject)
          : null;

      const inclusionConditions = Array.isArray(inclusion.conditions)
        ? inclusion.conditions
            .filter((item): item is JsonObject => Boolean(item) && typeof item === "object")
            .map((condition) => transformInclusionCondition(condition, warnings))
            .filter((item): item is JsonObject => Boolean(item))
        : [];

      const inclusionSelections: JsonObject[] = [];
      const inclusionNodes =
        inclusion.selections && typeof inclusion.selections === "object"
          ? (inclusion.selections as { nodes?: unknown[] }).nodes
          : [];

      for (const selection of Array.isArray(inclusionNodes) ? inclusionNodes : []) {
        if (!selection || typeof selection !== "object") continue;
        const product = (selection as { product?: unknown }).product;
        if (!product || typeof product !== "object") continue;
        const handle = optionalString(String((product as JsonObject).handle || ""));
        if (!handle) continue;

        const productId = await resolveProductId(admin, handle, productCache);
        if (productId) {
          inclusionSelections.push({ productId });
        } else {
          warnings.push(`The product was not found and the manual selection was skipped: ${handle}.`);
        }

        const variantIds = (selection as { variantIds?: unknown }).variantIds;
        if (Array.isArray(variantIds) && variantIds.length > 0) {
          warnings.push(
            `Variant selections contain store-specific IDs and were imported at product level: ${handle}.`,
          );
        }
      }

      const exclusionConditions =
        exclusion && Array.isArray(exclusion.conditions)
          ? exclusion.conditions
              .filter((item): item is JsonObject => Boolean(item) && typeof item === "object")
              .map((condition) => transformExclusionCondition(condition, warnings))
              .filter((item): item is JsonObject => Boolean(item))
          : [];

      const exclusionSelections: JsonObject[] = [];
      const exclusionNodes =
        exclusion?.selections && typeof exclusion.selections === "object"
          ? (exclusion.selections as { nodes?: unknown[] }).nodes
          : [];

      for (const selection of Array.isArray(exclusionNodes) ? exclusionNodes : []) {
        if (!selection || typeof selection !== "object") continue;
        const product = (selection as { product?: unknown }).product;
        if (!product || typeof product !== "object") continue;
        const handle = optionalString(String((product as JsonObject).handle || ""));
        if (!handle) continue;

        const productId = await resolveProductId(admin, handle, productCache);
        if (productId) {
          exclusionSelections.push({ productId });
        } else {
          warnings.push(`The product to exclude was not found: ${handle}.`);
        }
      }

      const sourceInput: JsonObject = {
        title: optionalString(String(source.title || "")) || "Imported Source",
        description: optionalString(String(source.description || "")),
        targetType: optionalString(String(source.targetType || "")) || "PRODUCTS",
      };

      if (inclusionConditions.length > 0 || inclusionSelections.length > 0) {
        sourceInput.inclusion = {
          ...(optionalString(String(inclusion.matchType || ""))
            ? { matchType: String(inclusion.matchType) }
            : {}),
          ...(inclusionConditions.length > 0
            ? { conditions: inclusionConditions }
            : {}),
          ...(inclusionSelections.length > 0
            ? { selections: inclusionSelections }
            : {}),
        };
      }

      if (exclusionConditions.length > 0 || exclusionSelections.length > 0) {
        sourceInput.exclusion = {
          matchType: optionalString(String(exclusion?.matchType || "")) || "ALL",
          ...(exclusionConditions.length > 0
            ? { conditions: exclusionConditions }
            : {}),
          ...(exclusionSelections.length > 0
            ? { selections: exclusionSelections }
            : {}),
        };
      }

      if (source.app) {
        warnings.push(
          `The app source was recreated as a normal collection source: ${String(
            (source.app as JsonObject).title || source.title || "Source",
          )}.`,
        );
      }

      output.push({ source: sourceInput });
      continue;
    }

    if (type === "CollectionSubCollectionsSource") {
      const collectionIds: string[] = [];
      const subCollections = Array.isArray(source.collections) ? source.collections : [];

      for (const item of subCollections) {
        if (!item || typeof item !== "object") continue;
        const handle = optionalString(String((item as JsonObject).handle || ""));
        if (!handle) continue;

        const collectionId = await resolveCollectionId(admin, handle, collectionCache);
        if (collectionId) {
          collectionIds.push(collectionId);
        } else {
          warnings.push(`The sub-collection was not found in the destination store: ${handle}.`);
        }
      }

      if (collectionIds.length > 0) {
        output.push({
          subCollections: {
            title:
              optionalString(String(source.title || "")) || "Imported Sub-Collections",
            description: optionalString(String(source.description || "")),
            collectionIds,
          },
        });
      }
      continue;
    }

    warnings.push(`Unknown collection source was skipped: ${type || "Unknown"}.`);
  }

  return output;
}

function baseCollectionInput(
  row: CollectionImportRow,
  settings: CollectionImportSettings,
): JsonObject {
  const input: JsonObject = {
    title: row.Title,
    handle: row.Handle,
    descriptionHtml: row["Body (HTML)"] || "",
    sortOrder: optionalString(row["Sort Order"]) || "MOST_RELEVANT",
    ...(optionalString(row["Template Suffix"])
      ? { templateSuffix: row["Template Suffix"] }
      : {}),
    seo: {
      title: row["SEO Title"] || null,
      description: row["SEO Description"] || null,
    },
  };

  if (settings.includeImage && optionalString(row["Image Src"])) {
    input.image = {
      src: row["Image Src"],
      ...(optionalString(row["Image Alt Text"])
        ? { altText: row["Image Alt Text"] }
        : {}),
    };
  }

  if (settings.includeMetafields) {
    const metafields = parseMetafields(row);
    if (metafields.length > 0) input.metafields = metafields;
  }

  return input;
}

async function createCollection(
  admin: AdminClient,
  input: JsonObject,
): Promise<{
  id: string;
  legacyResourceId: string;
  title: string;
  handle: string;
}> {
  const response = await admin.graphql(
    `#graphql
      mutation ImportCollectionCreate($collection: CollectionCreateInput!) {
        collectionCreate(collection: $collection) {
          collection {
            id
            legacyResourceId
            title
            handle
          }
          userErrors {
            field
            message
          }
        }
      }
    `,
    {
      variables: { collection: input },
    },
  );

  const payload = (await response.json()) as {
    data?: {
      collectionCreate: {
        collection: {
          id: string;
          legacyResourceId: string;
          title: string;
          handle: string;
        } | null;
        userErrors: Array<{ field?: string[]; message: string }>;
      };
    };
    errors?: Array<{ message: string }>;
  };

  const graphqlError = payload.errors?.map((item) => item.message).join(", ");
  if (graphqlError) throw new Error(graphqlError);

  const result = payload.data?.collectionCreate;
  if (!result) throw new Error("No collectionCreate response was received.");

  if (result.userErrors.length > 0) {
    throw new Error(result.userErrors.map((item) => item.message).join(", "));
  }

  if (!result.collection) throw new Error("The collection could not be created.");
  return result.collection;
}

async function updateCollection(
  admin: AdminClient,
  input: JsonObject,
): Promise<{
  id: string;
  legacyResourceId: string;
  title: string;
  handle: string;
}> {
  const response = await admin.graphql(
    `#graphql
      mutation ImportCollectionUpdate($collection: CollectionUpdateInput!) {
        collectionUpdate(collection: $collection) {
          collection {
            id
            legacyResourceId
            title
            handle
          }
          job {
            id
            done
          }
          userErrors {
            field
            message
          }
        }
      }
    `,
    {
      variables: { collection: input },
    },
  );

  const payload = (await response.json()) as {
    data?: {
      collectionUpdate: {
        collection: {
          id: string;
          legacyResourceId: string;
          title: string;
          handle: string;
        } | null;
        userErrors: Array<{ field?: string[]; message: string }>;
      };
    };
    errors?: Array<{ message: string }>;
  };

  const graphqlError = payload.errors?.map((item) => item.message).join(", ");
  if (graphqlError) throw new Error(graphqlError);

  const result = payload.data?.collectionUpdate;
  if (!result) throw new Error("No collectionUpdate response was received.");

  if (result.userErrors.length > 0) {
    throw new Error(result.userErrors.map((item) => item.message).join(", "));
  }

  if (!result.collection) throw new Error("The collection could not be updated.");
  return result.collection;
}


function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error || "");
}

function isCollectionImageDownloadError(
  error: unknown,
): boolean {
  const message = errorMessage(error).toLowerCase();

  return (
    message.includes("image upload failed") ||
    message.includes("failed to download") ||
    message.includes("file not found") ||
    message.includes("could not download image") ||
    message.includes("image could not be downloaded")
  );
}

function collectionImageUrl(
  input: JsonObject,
): string {
  const image = input.image;

  if (
    !image ||
    typeof image !== "object" ||
    !("src" in image)
  ) {
    return "";
  }

  return String(
    (image as JsonObject).src || "",
  );
}

function withoutCollectionImage(
  input: JsonObject,
): JsonObject {
  const retryInput: JsonObject = {
    ...input,
  };

  delete retryInput.image;

  return retryInput;
}

async function createCollectionWithImageFallback(
  admin: AdminClient,
  input: JsonObject,
  warnings: string[],
  allowFallback: boolean,
): Promise<{
  id: string;
  legacyResourceId: string;
  title: string;
  handle: string;
}> {
  try {
    return await createCollection(
      admin,
      input,
    );
  } catch (error) {
    if (
      !allowFallback ||
      !input.image ||
      !isCollectionImageDownloadError(error)
    ) {
      throw error;
    }

    const imageUrl =
      collectionImageUrl(input);

    warnings.push(
      imageUrl
        ? `The collection image could not be downloaded and was skipped: ${imageUrl}. The collection was imported without an image.`
        : "The collection image could not be downloaded and was skipped. The collection was imported without an image.",
    );

    return await createCollection(
      admin,
      withoutCollectionImage(input),
    );
  }
}

async function updateCollectionWithImageFallback(
  admin: AdminClient,
  input: JsonObject,
  warnings: string[],
  allowFallback: boolean,
): Promise<{
  id: string;
  legacyResourceId: string;
  title: string;
  handle: string;
}> {
  try {
    return await updateCollection(
      admin,
      input,
    );
  } catch (error) {
    if (
      !allowFallback ||
      !input.image ||
      !isCollectionImageDownloadError(error)
    ) {
      throw error;
    }

    const imageUrl =
      collectionImageUrl(input);

    warnings.push(
      imageUrl
        ? `The collection image could not be downloaded and was skipped: ${imageUrl}. The collection was updated with its other fields.`
        : "The collection image could not be downloaded and was skipped. The collection was updated with its other fields.",
    );

    return await updateCollection(
      admin,
      withoutCollectionImage(input),
    );
  }
}

function adminUrl(shop: string, legacyResourceId: string): string {
  const store = shop.replace(".myshopify.com", "");
  return `https://admin.shopify.com/store/${store}/collections/${legacyResourceId}`;
}

export async function importCollectionRow(
  admin: AdminClient,
  shop: string,
  row: CollectionImportRow,
  settings: CollectionImportSettings,
  testMode: boolean,
): Promise<CollectionImportResult> {
  try {
    const warnings: string[] = [];
    const originalHandle = row.Handle.trim();
    const existing = await findCollectionByHandle(admin, originalHandle);

    if (!testMode) {
      if (settings.mode === "create-only" && existing) {
        return {
          ok: true,
          action: "skipped",
          collectionId: existing.id,
          collectionLegacyId: existing.legacyResourceId,
          collectionTitle: existing.title,
          collectionHandle: existing.handle,
          adminUrl: adminUrl(shop, existing.legacyResourceId),
          warnings: ["A collection with the same Handle exists and was skipped in create-only mode."],
        };
      }

      if (settings.mode === "update-only" && !existing) {
        return {
          ok: true,
          action: "skipped",
          collectionTitle: row.Title,
          collectionHandle: row.Handle,
          warnings: ["The destination collection was not found and was skipped in update-only mode."],
        };
      }
    }

    const sources = await transformSources(admin, row, warnings);
    const input = baseCollectionInput(row, settings);

    if (testMode) {
      const suffix = Math.random().toString(36).slice(2, 9);
      input.title = `[TEST] ${row.Title}`;
      input.handle = `${row.Handle}-spcu-test-${suffix}`;
      if (sources.length > 0) input.sources = sources;

      const collection = await createCollectionWithImageFallback(
        admin,
        input,
        warnings,
        settings.imageFailurePolicy === "skip-image",
      );

      return {
        ok: true,
        action: "test-created",
        collectionId: collection.id,
        collectionLegacyId: collection.legacyResourceId,
        collectionTitle: collection.title,
        collectionHandle: collection.handle,
        adminUrl: adminUrl(shop, collection.legacyResourceId),
        warnings,
      };
    }

    if (!existing) {
      if (sources.length > 0) input.sources = sources;
      const collection = await createCollectionWithImageFallback(
        admin,
        input,
        warnings,
        settings.imageFailurePolicy === "skip-image",
      );

      return {
        ok: true,
        action: "created",
        collectionId: collection.id,
        collectionLegacyId: collection.legacyResourceId,
        collectionTitle: collection.title,
        collectionHandle: collection.handle,
        adminUrl: adminUrl(shop, collection.legacyResourceId),
        warnings,
      };
    }

    input.id = existing.id;
    input.redirectNewHandle = false;

    if (settings.replaceSources) {
      if (existing.sourceIds.length > 0) {
        input.sourcesToDelete = existing.sourceIds;
      }
      if (sources.length > 0) {
        input.sourcesToCreate = sources;
      }
    } else if (sources.length > 0) {
      input.sourcesToCreate = sources;
      warnings.push("Existing sources were preserved and the sources from the file were added.");
    }

    const collection = await updateCollectionWithImageFallback(
      admin,
      input,
      warnings,
      settings.imageFailurePolicy === "skip-image",
    );

    return {
      ok: true,
      action: "updated",
      collectionId: collection.id,
      collectionLegacyId: collection.legacyResourceId,
      collectionTitle: collection.title,
      collectionHandle: collection.handle,
      adminUrl: adminUrl(shop, collection.legacyResourceId),
      warnings,
    };
  } catch (error) {
    return {
      ok: false,
      collectionTitle: row.Title,
      collectionHandle: row.Handle,
      error:
        error instanceof Error
          ? error.message
          : "An unknown error occurred during collection import.",
    };
  }
}
