import {
  useMemo,
  useState,
} from "react";

import type {
  ProductValidationResult,
  ProductValidationStatus,
  ValidatedProduct,
  ValidationIssue,
} from "../lib/productValidation";

import "./ProductValidationStep.css";

type ValidationFilter =
  | "all"
  | ProductValidationStatus;

interface ProductValidationStepProps {
  result: ProductValidationResult;
  onBack: () => void;
  onComplete: () => void;
}

function statusLabel(
  status: ProductValidationStatus,
): string {
  if (status === "error") {
    return "Error";
  }

  if (status === "warning") {
    return "Warning";
  }

  return "Ready";
}

function issueLabel(
  issue: ValidationIssue,
): string {
  if (issue.severity === "error") {
    return "Error";
  }

  if (issue.severity === "warning") {
    return "Warning";
  }

  return "Info";
}

function productDisplayName(
  product: ValidatedProduct,
): string {
  return (
    product.title ||
    product.handle ||
    product.firstSku ||
    "Untitled product"
  );
}

function ProductValidationStep({
  result,
  onBack,
  onComplete,
}: ProductValidationStepProps) {
  const [filter, setFilter] =
    useState<ValidationFilter>("all");

  const [searchText, setSearchText] =
    useState("");

  const [
    expandedProductIds,
    setExpandedProductIds,
  ] = useState<Set<string>>(
    () => new Set(),
  );

  const filteredProducts = useMemo(() => {
    const search = searchText
      .trim()
      .toLocaleLowerCase("en-US");

    return result.products.filter(
      (product) => {
        if (
          filter !== "all" &&
          product.status !== filter
        ) {
          return false;
        }

        if (!search) {
          return true;
        }

        const searchableText = [
          product.title,
          product.handle,
          product.firstSku,
          ...product.issues.map(
            (issue) => issue.message,
          ),
        ]
          .join(" ")
          .toLocaleLowerCase("en-US");

        return searchableText.includes(
          search,
        );
      },
    );
  }, [
    filter,
    result.products,
    searchText,
  ]);

  const hasErrors =
    result.summary.errorCount > 0;

  function toggleProduct(
    productId: string,
  ) {
    setExpandedProductIds(
      (current) => {
        const next = new Set(current);

        if (next.has(productId)) {
          next.delete(productId);
        } else {
          next.add(productId);
        }

        return next;
      },
    );
  }

  return (
    <section className="validation-panel">
      <header className="validation-header">
        <div>
          <span className="validation-eyebrow">
            STEP 3
          </span>

          <h3>
            Validate product data
          </h3>

          <p>
            Products were grouped by Handle. Variant, SKU, price, inventory, option, and image data were checked.
          </p>
        </div>

        <div className="validation-summary-grid">
          <article>
            <strong>
              {
                result.summary
                  .totalProducts
              }
            </strong>
            <span>Products</span>
          </article>

          <article>
            <strong>
              {
                result.summary
                  .totalVariants
              }
            </strong>
            <span>Variants</span>
          </article>

          <article className="validation-ready-card">
            <strong>
              {
                result.summary
                  .readyProducts
              }
            </strong>
            <span>Ready</span>
          </article>

          <article className="validation-error-card">
            <strong>
              {
                result.summary
                  .errorCount
              }
            </strong>
            <span>Errors</span>
          </article>

          <article className="validation-warning-card">
            <strong>
              {
                result.summary
                  .warningCount
              }
            </strong>
            <span>Warnings</span>
          </article>
        </div>
      </header>

      <div className="validation-toolbar">
        <div className="validation-filter-list">
          {(
            [
              {
                value: "all",
                label: "All",
                count:
                  result.summary
                    .totalProducts,
              },
              {
                value: "ready",
                label: "Ready",
                count:
                  result.summary
                    .readyProducts,
              },
              {
                value: "error",
                label: "Errors",
                count:
                  result.summary
                    .productsWithErrors,
              },
              {
                value: "warning",
                label: "Warnings",
                count:
                  result.summary
                    .productsWithWarnings,
              },
            ] as Array<{
              value: ValidationFilter;
              label: string;
              count: number;
            }>
          ).map((item) => (
            <button
              key={item.value}
              className={
                filter === item.value
                  ? "validation-filter validation-filter-active"
                  : "validation-filter"
              }
              type="button"
              onClick={() =>
                setFilter(item.value)
              }
            >
              {item.label}
              <span>{item.count}</span>
            </button>
          ))}
        </div>

        <input
          className="validation-search"
          type="search"
          value={searchText}
          placeholder="Search product, Handle, SKU, or issue..."
          onChange={(event) =>
            setSearchText(
              event.target.value,
            )
          }
        />
      </div>

      {hasErrors && (
        <div className="validation-blocker">
          <span>!</span>

          <div>
            <strong>
              Import-blocking errors were found
            </strong>

            <p>
              {
                result.summary
                  .productsWithErrors
              }{" "}
              products contain{" "}
              {
                result.summary
                  .errorCount
              }{" "}
              errors. Correct these records before continuing to Shopify import.
            </p>
          </div>
        </div>
      )}

      {!hasErrors &&
        result.summary.warningCount >
          0 && (
          <div className="validation-notice">
            <span>i</span>

            <div>
              <strong>
                Import can continue
              </strong>

              <p>
                No errors were found. Review the warnings and complete validation.
              </p>
            </div>
          </div>
        )}

      {!hasErrors &&
        result.summary.warningCount ===
          0 && (
          <div className="validation-success">
            <span>✓</span>

            <div>
              <strong>
                All products are ready for import
              </strong>

              <p>
                No errors or warnings were found in the product and variant checks.
              </p>
            </div>
          </div>
        )}

      <div className="validation-table-wrapper">
        <table className="validation-table">
          <thead>
            <tr>
              <th>Product</th>
              <th>Handle / SKU</th>
              <th>Source rows</th>
              <th>Variants</th>
              <th>Images</th>
              <th>Result</th>
              <th />
            </tr>
          </thead>

          <tbody>
            {filteredProducts.map(
              (product) => {
                const isExpanded =
                  expandedProductIds.has(
                    product.id,
                  );

                return (
                  <>
                    <tr
                      key={product.id}
                      className={`validation-product-row validation-product-row-${product.status}`}
                    >
                      <td>
                        <div className="validation-product-name">
                          <span>
                            {product.status ===
                            "ready"
                              ? "✓"
                              : product.status ===
                                  "error"
                                ? "!"
                                : "i"}
                          </span>

                          <div>
                            <strong>
                              {productDisplayName(
                                product,
                              )}
                            </strong>

                            <small>
                              {
                                product.errorCount
                              }{" "}
                              errors ·{" "}
                              {
                                product.warningCount
                              }{" "}
                              warnings
                            </small>
                          </div>
                        </div>
                      </td>

                      <td>
                        <div className="validation-code-values">
                          <code>
                            {product.handle ||
                              "No Handle"}
                          </code>

                          <small>
                            {product.firstSku ||
                              "No SKU"}
                          </small>
                        </div>
                      </td>

                      <td>
                        <span className="validation-row-range">
                          {product.sourceRows.length >
                          1
                            ? `${product.sourceRows[0]}–${product.sourceRows[product.sourceRows.length - 1]}`
                            : product.sourceRows[0]}
                        </span>
                      </td>

                      <td>
                        <strong className="validation-number">
                          {
                            product.variantCount
                          }
                        </strong>
                      </td>

                      <td>
                        <strong className="validation-number">
                          {
                            product.imageCount
                          }
                        </strong>
                      </td>

                      <td>
                        <span
                          className={`validation-status validation-status-${product.status}`}
                        >
                          {statusLabel(
                            product.status,
                          )}
                        </span>
                      </td>

                      <td>
                        <button
                          className="validation-detail-button"
                          type="button"
                          disabled={
                            product.issues
                              .length === 0
                          }
                          onClick={() =>
                            toggleProduct(
                              product.id,
                            )
                          }
                        >
                          {product.issues
                            .length === 0
                            ? "No issues"
                            : isExpanded
                              ? "Close"
                              : "Details"}
                        </button>
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr
                        key={`${product.id}-details`}
                        className="validation-detail-row"
                      >
                        <td colSpan={7}>
                          <div className="validation-issue-list">
                            {product.issues.map(
                              (issue) => (
                                <article
                                  key={
                                    issue.id
                                  }
                                  className={`validation-issue validation-issue-${issue.severity}`}
                                >
                                  <span>
                                    {issueLabel(
                                      issue,
                                    )}
                                  </span>

                                  <div>
                                    <strong>
                                      {
                                        issue.message
                                      }
                                    </strong>

                                    <small>
                                      Source row:{" "}
                                      {issue.sourceRows.join(
                                        ", ",
                                      )}
                                    </small>
                                  </div>
                                </article>
                              ),
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              },
            )}
          </tbody>
        </table>

        {filteredProducts.length ===
          0 && (
          <div className="validation-empty">
            <strong>
              No products to display
            </strong>

            <p>
              Change the search text or status filter.
            </p>
          </div>
        )}
      </div>

      <footer className="validation-footer">
        <button
          className="validation-back-button"
          type="button"
          onClick={onBack}
        >
          Back to Column Mapping
        </button>

        <div>
          <span>
            {hasErrors
              ? "Import cannot continue until all errors are corrected."
              : `${result.summary.totalProducts} products validated.`}
          </span>

          <button
            className="validation-complete-button"
            type="button"
            disabled={hasErrors}
            onClick={onComplete}
          >
            Complete Validation
          </button>
        </div>
      </footer>
    </section>
  );
}

export default ProductValidationStep;
