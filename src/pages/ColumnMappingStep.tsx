import { useMemo, useState } from "react";

import type { ImportCell } from "../lib/fileParser";

import {
  createDefaultMetafieldConfig,
  createMetafieldAwareMapping,
  formatMetafieldPath,
  isMetafieldConfigValid,
  METAFIELD_MAPPING_VALUE,
  METAFIELD_OWNER_OPTIONS,
  METAFIELD_TYPE_OPTIONS,
} from "../lib/metafieldMapping";

import type {
  MetafieldMappingConfig,
  MetafieldMappingMap,
  MetafieldOwnerType,
  ShopifyMetafieldType,
} from "../lib/metafieldMapping";

import {
  createAutomaticMapping,
  getShopifyField,
  SHOPIFY_FIELD_GROUPS,
  SHOPIFY_IMPORT_FIELDS,
} from "../lib/shopifyFields";

import type { ColumnMapping } from "../lib/shopifyFields";

import "./ColumnMappingStep.css";

interface ColumnMappingStepProps {
  headers: string[];
  rows: Record<string, ImportCell>[];
  mapping: ColumnMapping;
  metafieldMappings: MetafieldMappingMap;
  onMappingChange: (mapping: ColumnMapping) => void;
  onMetafieldMappingsChange: (
    mappings: MetafieldMappingMap,
  ) => void;
  onBack: () => void;
  onSave: () => void;
}

function getSampleValue(
  header: string,
  rows: Record<string, ImportCell>[],
): string {
  const values: string[] = [];

  for (const row of rows) {
    const value = String(row[header] ?? "").trim();

    if (value && !values.includes(value)) {
      values.push(value);
    }

    if (values.length === 2) {
      break;
    }
  }

  if (values.length === 0) {
    return "Empty value";
  }

  return values.join(" · ");
}

function ColumnMappingStep({
  headers,
  rows,
  mapping,
  metafieldMappings,
  onMappingChange,
  onMetafieldMappingsChange,
  onBack,
  onSave,
}: ColumnMappingStepProps) {
  const [searchText, setSearchText] = useState("");
  const [showOnlyUnmapped, setShowOnlyUnmapped] =
    useState(false);

  const mappedCount = Object.values(mapping).filter(
    Boolean,
  ).length;

  const metafieldCount = Object.values(mapping).filter(
    (fieldId) =>
      fieldId === METAFIELD_MAPPING_VALUE,
  ).length;

  const unmappedCount = headers.length - mappedCount;

  const mappedStandardTargetIds = Object.values(
    mapping,
  ).filter(
    (fieldId) =>
      Boolean(fieldId) &&
      fieldId !== METAFIELD_MAPPING_VALUE,
  );

  const hasProductIdentity =
    mappedStandardTargetIds.some((fieldId) =>
      ["handle", "title", "variantSku"].includes(
        fieldId,
      ),
    );

  const invalidMetafieldHeaders = headers.filter(
    (header) =>
      mapping[header] === METAFIELD_MAPPING_VALUE &&
      !isMetafieldConfigValid(
        metafieldMappings[header],
      ),
  );

  const hasInvalidMetafields =
    invalidMetafieldHeaders.length > 0;

  const filteredHeaders = useMemo(() => {
    const search = searchText
      .trim()
      .toLocaleLowerCase("tr-TR");

    return headers.filter((header) => {
      if (showOnlyUnmapped && mapping[header]) {
        return false;
      }

      if (!search) {
        return true;
      }

      const selectedField = getShopifyField(
        mapping[header] ?? "",
      );

      const metafieldConfig =
        metafieldMappings[header];

      const metafieldSearchText = metafieldConfig
        ? `${metafieldConfig.namespace}.${metafieldConfig.key} ${metafieldConfig.type}`
        : "";

      return (
        header
          .toLocaleLowerCase("tr-TR")
          .includes(search) ||
        selectedField?.label
          .toLocaleLowerCase("tr-TR")
          .includes(search) ||
        metafieldSearchText
          .toLocaleLowerCase("tr-TR")
          .includes(search) ||
        false
      );
    });
  }, [
    headers,
    mapping,
    metafieldMappings,
    searchText,
    showOnlyUnmapped,
  ]);

  function updateMapping(
    sourceHeader: string,
    targetFieldId: string,
  ) {
    const nextMetafieldMappings = {
      ...metafieldMappings,
    };

    if (
      targetFieldId === METAFIELD_MAPPING_VALUE
    ) {
      nextMetafieldMappings[sourceHeader] =
        nextMetafieldMappings[sourceHeader] ??
        createDefaultMetafieldConfig(sourceHeader);
    } else {
      delete nextMetafieldMappings[sourceHeader];
    }

    onMetafieldMappingsChange(
      nextMetafieldMappings,
    );

    onMappingChange({
      ...mapping,
      [sourceHeader]: targetFieldId,
    });
  }

  function updateMetafieldConfig(
    sourceHeader: string,
    patch: Partial<MetafieldMappingConfig>,
  ) {
    const currentConfig =
      metafieldMappings[sourceHeader] ??
      createDefaultMetafieldConfig(sourceHeader);

    onMetafieldMappingsChange({
      ...metafieldMappings,
      [sourceHeader]: {
        ...currentConfig,
        ...patch,
      },
    });
  }

  function clearMapping() {
    const emptyMapping: ColumnMapping = {};

    headers.forEach((header) => {
      emptyMapping[header] = "";
    });

    onMappingChange(emptyMapping);
    onMetafieldMappingsChange({});
  }

  function automaticMapping() {
    const standardMapping =
      createAutomaticMapping(headers);

    const result = createMetafieldAwareMapping(
      headers,
      standardMapping,
    );

    onMappingChange(result.mapping);

    onMetafieldMappingsChange(
      result.metafieldMappings,
    );
  }

  return (
    <section className="mapping-panel">
      <header className="mapping-header">
        <div>
          <span className="mapping-eyebrow">
            STEP 2
          </span>

          <h3>Map Shopify columns</h3>

          <p>
            Match every source column to its Shopify field. Standard fields and Shopify-formatted metafield columns are selected automatically.
          </p>
        </div>

        <div className="mapping-counters">
          <div>
            <strong>{headers.length}</strong>
            <span>File columns</span>
          </div>

          <div className="mapped-counter">
            <strong>{mappedCount}</strong>
            <span>Mapped</span>
          </div>

          <div className="metafield-counter">
            <strong>{metafieldCount}</strong>
            <span>Metafield</span>
          </div>

          <div
            className={
              unmappedCount > 0
                ? "unmapped-counter"
                : ""
            }
          >
            <strong>{unmappedCount}</strong>
            <span>Unmapped</span>
          </div>
        </div>
      </header>

      <div className="mapping-toolbar">
        <div className="mapping-search-area">
          <input
            type="search"
            value={searchText}
            placeholder="Search source, Shopify, or metafield fields..."
            onChange={(event) =>
              setSearchText(event.target.value)
            }
          />

          <label className="unmapped-filter">
            <input
              type="checkbox"
              checked={showOnlyUnmapped}
              onChange={(event) =>
                setShowOnlyUnmapped(
                  event.target.checked,
                )
              }
            />

            <span>
              Show unmapped columns only
            </span>
          </label>
        </div>

        <div className="mapping-toolbar-actions">
          <button
            className="mapping-secondary-button"
            type="button"
            onClick={clearMapping}
          >
            Clear All
          </button>

          <button
            className="mapping-auto-button"
            type="button"
            onClick={automaticMapping}
          >
            Auto Map
          </button>
        </div>
      </div>

      {!hasProductIdentity && (
        <div className="mapping-warning">
          <span>!</span>

          <div>
            <strong>
              No product identity field is mapped
            </strong>

            <p>
              Map at least one of Handle, Title, or Variant SKU to continue.
            </p>
          </div>
        </div>
      )}

      {hasInvalidMetafields && (
        <div className="mapping-warning">
          <span>!</span>

          <div>
            <strong>
              Some metafield settings are incomplete
            </strong>

            <p>
              {invalidMetafieldHeaders.length} metafield columns must be checked for namespace, key, and data type.
            </p>
          </div>
        </div>
      )}

      <div className="mapping-table-wrapper">
        <table className="mapping-table">
          <thead>
            <tr>
              <th>Source column</th>
              <th>Sample value</th>
              <th>Shopify field</th>
              <th>Status</th>
            </tr>
          </thead>

          <tbody>
            {filteredHeaders.map((header) => {
              const selectedTarget =
                mapping[header] ?? "";

              const isMetafield =
                selectedTarget ===
                METAFIELD_MAPPING_VALUE;

              const selectedField = isMetafield
                ? undefined
                : getShopifyField(selectedTarget);

              const metafieldConfig =
                metafieldMappings[header];

              const metafieldIsValid =
                isMetafieldConfigValid(
                  metafieldConfig,
                );

              return (
                <tr key={header}>
                  <td>
                    <div className="source-column">
                      <span className="source-column-icon">
                        C
                      </span>

                      <div>
                        <strong>{header}</strong>
                        <small>
                          Source file column
                        </small>
                      </div>
                    </div>
                  </td>

                  <td>
                    <span
                      className="sample-value"
                      title={getSampleValue(
                        header,
                        rows,
                      )}
                    >
                      {getSampleValue(header, rows)}
                    </span>
                  </td>

                  <td>
                    <select
                      className={
                        selectedTarget
                          ? "mapping-select mapping-select-selected"
                          : "mapping-select"
                      }
                      value={selectedTarget}
                      onChange={(event) =>
                        updateMapping(
                          header,
                          event.target.value,
                        )
                      }
                    >
                      <option value="">
                        Do not import
                      </option>

                      {SHOPIFY_FIELD_GROUPS.map(
                        (group) => (
                          <optgroup
                            key={group}
                            label={group}
                          >
                            {SHOPIFY_IMPORT_FIELDS.filter(
                              (field) =>
                                field.group === group,
                            ).map((field) => {
                              const usedByAnotherColumn =
                                mappedStandardTargetIds.includes(
                                  field.id,
                                ) &&
                                field.id !==
                                  selectedTarget;

                              return (
                                <option
                                  key={field.id}
                                  value={field.id}
                                  disabled={
                                    usedByAnotherColumn
                                  }
                                >
                                  {field.label}
                                </option>
                              );
                            })}
                          </optgroup>
                        ),
                      )}

                      <optgroup label="Custom Fields">
                        <option
                          value={
                            METAFIELD_MAPPING_VALUE
                          }
                        >
                          Import as metafield
                        </option>
                      </optgroup>
                    </select>

                    {selectedField && (
                      <small className="mapping-description">
                        {selectedField.description}
                      </small>
                    )}

                    {isMetafield && (
                      <div className="metafield-editor">
                        <div className="metafield-editor-heading">
                          <div>
                            <strong>
                              Metafield settings
                            </strong>

                            <small>
                              {formatMetafieldPath(
                                metafieldConfig,
                              )}
                            </small>
                          </div>

                          <span>
                            Custom field
                          </span>
                        </div>

                        <div className="metafield-grid">
                          <label className="metafield-field">
                            <span>Owner type</span>

                            <select
                              value={
                                metafieldConfig?.ownerType ??
                                "PRODUCT"
                              }
                              onChange={(event) =>
                                updateMetafieldConfig(
                                  header,
                                  {
                                    ownerType:
                                      event.target
                                        .value as MetafieldOwnerType,
                                  },
                                )
                              }
                            >
                              {METAFIELD_OWNER_OPTIONS.map(
                                (option) => (
                                  <option
                                    key={option.value}
                                    value={option.value}
                                  >
                                    {option.label}
                                  </option>
                                ),
                              )}
                            </select>
                          </label>

                          <label className="metafield-field">
                            <span>Data type</span>

                            <select
                              value={
                                metafieldConfig?.type ??
                                "single_line_text_field"
                              }
                              onChange={(event) =>
                                updateMetafieldConfig(
                                  header,
                                  {
                                    type: event.target
                                      .value as ShopifyMetafieldType,
                                  },
                                )
                              }
                            >
                              {METAFIELD_TYPE_OPTIONS.map(
                                (option) => (
                                  <option
                                    key={option.value}
                                    value={option.value}
                                  >
                                    {option.label}
                                  </option>
                                ),
                              )}
                            </select>
                          </label>

                          <label className="metafield-field">
                            <span>Namespace</span>

                            <input
                              type="text"
                              value={
                                metafieldConfig?.namespace ??
                                ""
                              }
                              placeholder="custom"
                              onChange={(event) =>
                                updateMetafieldConfig(
                                  header,
                                  {
                                    namespace:
                                      event.target.value,
                                  },
                                )
                              }
                            />
                          </label>

                          <label className="metafield-field">
                            <span>Key</span>

                            <input
                              type="text"
                              value={
                                metafieldConfig?.key ??
                                ""
                              }
                              placeholder="inhaltsstoffe"
                              onChange={(event) =>
                                updateMetafieldConfig(
                                  header,
                                  {
                                    key: event.target
                                      .value,
                                  },
                                )
                              }
                            />
                          </label>
                        </div>

                        <label className="metafield-definition-check">
                          <input
                            type="checkbox"
                            checked={
                              metafieldConfig
                                ?.createDefinition ??
                              true
                            }
                            onChange={(event) =>
                              updateMetafieldConfig(
                                header,
                                {
                                  createDefinition:
                                    event.target.checked,
                                },
                              )
                            }
                          />

                          <span>
                            Create the metafield definition if it does not exist in the store
                          </span>
                        </label>
                      </div>
                    )}
                  </td>

                  <td>
                    {isMetafield ? (
                      metafieldIsValid ? (
                        <span className="mapping-status mapping-status-metafield">
                          Metafield
                        </span>
                      ) : (
                        <span className="mapping-status mapping-status-warning">
                          Incomplete
                        </span>
                      )
                    ) : selectedField ? (
                      <span className="mapping-status mapping-status-success">
                        Mapped
                      </span>
                    ) : (
                      <span className="mapping-status mapping-status-empty">
                        Skipped
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {filteredHeaders.length === 0 && (
          <div className="mapping-empty">
            <strong>
              No columns to display
            </strong>

            <p>
              Change the search text or filter.
            </p>
          </div>
        )}
      </div>

      <footer className="mapping-footer">
        <button
          className="mapping-back-button"
          type="button"
          onClick={onBack}
        >
          Back to Preview
        </button>

        <div>
          <span>
            {mappedCount} columns will be imported;{" "}
            {metafieldCount} are metafields.
          </span>

          <button
            className="mapping-save-button"
            type="button"
            disabled={
              !hasProductIdentity ||
              mappedCount === 0 ||
              hasInvalidMetafields
            }
            onClick={onSave}
          >
            Mappedrmeyi Kaydet
          </button>
        </div>
      </footer>
    </section>
  );
}

export default ColumnMappingStep;
