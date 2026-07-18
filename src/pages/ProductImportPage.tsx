import {
  ChangeEvent,
  DragEvent,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  isSupportedImportFile,
  parseImportFile,
  ParsedImportFile,
} from "../lib/fileParser";

import {
  createMetafieldAwareMapping,
  METAFIELD_MAPPING_VALUE,
} from "../lib/metafieldMapping";

import type {
  MetafieldMappingMap,
} from "../lib/metafieldMapping";

import {
  validateProductImport,
} from "../lib/productValidation";

import {
  createAutomaticMapping,
} from "../lib/shopifyFields";

import type {
  ColumnMapping,
} from "../lib/shopifyFields";

import ColumnMappingStep from "./ColumnMappingStep";
import ProductValidationStep from "./ProductValidationStep";

import "./ProductImportPage.css";
import { prepareImportProducts } from "../lib/product-import/importPayload";
import { runBulkProductImportBatch } from "../lib/product-import/shopifyBulkImport";
import { runTestProductImport } from "../lib/product-import/shopifyTestImport";
import { createAdminClient } from "../lib/shopifyClient";
import { desktopApi, type StoreRecord } from "../lib/desktopApi";
import type { AppSettings } from "../lib/appSettings";
import type { BulkImportItemResult } from "../lib/product-import/bulkImport";


const ACCEPTED_FILES = ".csv,.xlsx,.xls,.json";
const PREVIEW_ROW_LIMIT = 100;

type ImportStep =
  | "preview"
  | "mapping"
  | "validation";

function formatBytes(bytes: number): string {
  if (bytes === 0) {
    return "0 Byte";
  }

  const units = ["Byte", "KB", "MB", "GB"];

  const unitIndex = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );

  const value = bytes / 1024 ** unitIndex;

  return `${value.toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
}

function createInitialMapping(headers: string[]) {
  const standardMapping =
    createAutomaticMapping(headers);

  return createMetafieldAwareMapping(
    headers,
    standardMapping,
  );
}

interface ProductImportPageProps {
  activeStore: StoreRecord | null;
  settings: AppSettings;
  onHistoryChanged: () => void;
}

function ProductImportPage({ activeStore, settings, onHistoryChanged }: ProductImportPageProps) {
  const fileInputRef =
    useRef<HTMLInputElement | null>(null);

  const [parsedFile, setParsedFile] =
    useState<ParsedImportFile | null>(null);

  const [selectedSheetName, setSelectedSheetName] =
    useState("");

  const [isDragging, setIsDragging] =
    useState(false);

  const [isLoading, setIsLoading] =
    useState(false);

  const [searchText, setSearchText] =
    useState("");

  const [errorMessage, setErrorMessage] =
    useState("");

  const [activeStep, setActiveStep] =
    useState<ImportStep>("preview");

  const [columnMapping, setColumnMapping] =
    useState<ColumnMapping>({});

  const [
    metafieldMappings,
    setMetafieldMappings,
  ] = useState<MetafieldMappingMap>({});

  const [mappingSaved, setMappingSaved] =
    useState(false);

  const [
    validationConfirmed,
    setValidationConfirmed,
  ] = useState(false);

  const [testPassed, setTestPassed] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importResults, setImportResults] = useState<BulkImportItemResult[]>([]);
  const [transferMessage, setTransferMessage] = useState("");
  const [transferError, setTransferError] = useState("");

  const selectedSheet = useMemo(() => {
    if (!parsedFile) {
      return null;
    }

    return (
      parsedFile.sheets.find(
        (sheet) =>
          sheet.name === selectedSheetName,
      ) ??
      parsedFile.sheets[0] ??
      null
    );
  }, [parsedFile, selectedSheetName]);

  const filteredRows = useMemo(() => {
    if (!selectedSheet) {
      return [];
    }

    const normalizedSearch = searchText
      .trim()
      .toLocaleLowerCase("en-US");

    if (!normalizedSearch) {
      return selectedSheet.rows;
    }

    return selectedSheet.rows.filter((row) =>
      Object.values(row).some((value) =>
        String(value ?? "")
          .toLocaleLowerCase("en-US")
          .includes(normalizedSearch),
      ),
    );
  }, [searchText, selectedSheet]);

  const previewRows = filteredRows.slice(
    0,
    PREVIEW_ROW_LIMIT,
  );

  const mappedMetafieldCount =
    Object.values(columnMapping).filter(
      (fieldId) =>
        fieldId === METAFIELD_MAPPING_VALUE,
    ).length;

  const validationResult = useMemo(() => {
    if (!selectedSheet) {
      return null;
    }

    return validateProductImport(
      selectedSheet.rows,
      columnMapping,
    );
  }, [
    selectedSheet,
    columnMapping,
  ]);

  const preparedProducts = useMemo(() => {
    if (!selectedSheet) {
      return [];
    }

    return prepareImportProducts(
      selectedSheet.rows,
      columnMapping,
      metafieldMappings,
    );
  }, [selectedSheet, columnMapping, metafieldMappings]);

  function resetImportState() {
    setParsedFile(null);
    setSelectedSheetName("");
    setSearchText("");
    setErrorMessage("");
    setColumnMapping({});
    setMetafieldMappings({});
    setActiveStep("preview");
    setMappingSaved(false);
    setValidationConfirmed(false);
    setTestPassed(false);
    setImportResults([]);
    setImportProgress(0);
    setTransferMessage("");
    setTransferError("");

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  async function loadFile(file: File) {
    setErrorMessage("");
    setMappingSaved(false);
    setValidationConfirmed(false);

    if (!isSupportedImportFile(file)) {
      setParsedFile(null);
      setSelectedSheetName("");
      setColumnMapping({});
      setMetafieldMappings({});
      setActiveStep("preview");

      setErrorMessage(
        "This file type is not supported. Select a CSV, XLSX, XLS, or JSON file.",
      );

      return;
    }

    setIsLoading(true);

    try {
      const result =
        await parseImportFile(file);

      if (result.sheets.length === 0) {
        throw new Error(
          "No readable worksheet was found in the file.",
        );
      }

      const firstSheet = result.sheets[0];

      const initialMapping =
        createInitialMapping(
          firstSheet.headers,
        );

      setParsedFile(result);
      setSelectedSheetName(firstSheet.name);

      setColumnMapping(
        initialMapping.mapping,
      );

      setMetafieldMappings(
        initialMapping.metafieldMappings,
      );

      setSearchText("");
      setActiveStep("preview");
      setMappingSaved(false);
      setValidationConfirmed(false);
    } catch (error) {
      setParsedFile(null);
      setSelectedSheetName("");
      setColumnMapping({});
      setMetafieldMappings({});
      setActiveStep("preview");
      setMappingSaved(false);
      setValidationConfirmed(false);

      setErrorMessage(
        error instanceof Error
          ? error.message
          : "An unknown error occurred while reading the file.",
      );
    } finally {
      setIsLoading(false);

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  function handleFileInput(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0];

    if (file) {
      void loadFile(file);
    }
  }

  function handleDragOver(
    event: DragEvent<HTMLDivElement>,
  ) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsDragging(true);
  }

  function handleDragLeave(
    event: DragEvent<HTMLDivElement>,
  ) {
    event.preventDefault();
    setIsDragging(false);
  }

  function handleDrop(
    event: DragEvent<HTMLDivElement>,
  ) {
    event.preventDefault();
    setIsDragging(false);

    const file =
      event.dataTransfer.files?.[0];

    if (file) {
      void loadFile(file);
    }
  }

  function clearFile() {
    resetImportState();
  }

  function selectSheet(sheetName: string) {
    if (!parsedFile) {
      return;
    }

    const sheet =
      parsedFile.sheets.find(
        (item) =>
          item.name === sheetName,
      );

    if (!sheet) {
      return;
    }

    const initialMapping =
      createInitialMapping(sheet.headers);

    setSelectedSheetName(sheet.name);

    setColumnMapping(
      initialMapping.mapping,
    );

    setMetafieldMappings(
      initialMapping.metafieldMappings,
    );

    setSearchText("");
    setActiveStep("preview");
    setMappingSaved(false);
    setValidationConfirmed(false);
  }

  async function runSafeTest() {
    if (!activeStore || preparedProducts.length === 0) {
      setTransferError("Connect and select a store before testing the import.");
      return;
    }

    setIsTesting(true);
    setTransferError("");
    setTransferMessage("");

    try {
      const result = await runTestProductImport(
        createAdminClient(activeStore.id),
        {
          product: preparedProducts[0],
          settings: settings.product,
        },
      );

      if (!result.ok) {
        throw new Error(result.errors.join("\n") || "Test import failed.");
      }

      setTestPassed(true);
      setTransferMessage(
        `Test product created as Draft: ${result.title ?? preparedProducts[0].title}`,
      );
    } catch (error) {
      setTestPassed(false);
      setTransferError(error instanceof Error ? error.message : "Test import failed.");
    } finally {
      setIsTesting(false);
    }
  }

  async function runFullImport() {
    if (!activeStore || preparedProducts.length === 0) {
      setTransferError("Connect and select a store before importing products.");
      return;
    }

    if (settings.product.requireTest && !testPassed) {
      setTransferError("Run the safe test import before starting the full import.");
      return;
    }

    setIsImporting(true);
    setTransferError("");
    setTransferMessage("");
    setImportResults([]);
    setImportProgress(0);

    let history = await desktopApi.saveHistory({
      storeId: activeStore.id,
      kind: "product-import",
      name: parsedFile?.fileName ?? "Product import",
      status: "RUNNING",
      total: preparedProducts.length,
      processed: 0,
      createdCount: 0,
      updatedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      detailsJson: "[]",
    });

    const results: BulkImportItemResult[] = [];
    const batchSize = Math.max(1, Math.min(25, settings.product.batchSize));

    try {
      for (let offset = 0; offset < preparedProducts.length; offset += batchSize) {
        const response = await runBulkProductImportBatch(
          createAdminClient(activeStore.id),
          {
            requestId: `${history.id}-${offset}`,
            offset,
            products: preparedProducts.slice(offset, offset + batchSize),
            settings: settings.product,
          },
        );

        if (response.fatalErrors.length > 0) {
          throw new Error(response.fatalErrors.join("\n"));
        }

        results.push(...response.results);
        setImportResults([...results]);
        const processed = results.length;
        const created = results.filter((item) => item.status === "created").length;
        const updated = results.filter((item) => item.status === "updated").length;
        const skipped = results.filter((item) => item.status === "skipped").length;
        const failed = results.filter((item) => item.status === "error").length;
        setImportProgress(Math.round((processed / preparedProducts.length) * 100));

        history = await desktopApi.saveHistory({
          id: history.id,
          storeId: activeStore.id,
          kind: "product-import",
          name: parsedFile?.fileName ?? "Product import",
          status: response.stoppedOnError ? "FAILED" : "RUNNING",
          total: preparedProducts.length,
          processed,
          createdCount: created,
          updatedCount: updated,
          skippedCount: skipped,
          failedCount: failed,
          detailsJson: JSON.stringify(results),
        });

        if (response.stoppedOnError) {
          break;
        }
      }

      const failed = results.filter((item) => item.status === "error").length;
      const finalStatus = failed > 0 && !settings.product.continueOnError ? "FAILED" : "COMPLETED";
      await desktopApi.saveHistory({
        id: history.id,
        storeId: activeStore.id,
        kind: "product-import",
        name: parsedFile?.fileName ?? "Product import",
        status: finalStatus,
        total: preparedProducts.length,
        processed: results.length,
        createdCount: results.filter((item) => item.status === "created").length,
        updatedCount: results.filter((item) => item.status === "updated").length,
        skippedCount: results.filter((item) => item.status === "skipped").length,
        failedCount: failed,
        detailsJson: JSON.stringify(results),
      });

      setTransferMessage(`Import finished: ${results.length} products processed, ${failed} failed.`);
      onHistoryChanged();
    } catch (error) {
      await desktopApi.saveHistory({
        id: history.id,
        storeId: activeStore.id,
        kind: "product-import",
        name: parsedFile?.fileName ?? "Product import",
        status: "FAILED",
        total: preparedProducts.length,
        processed: results.length,
        createdCount: results.filter((item) => item.status === "created").length,
        updatedCount: results.filter((item) => item.status === "updated").length,
        skippedCount: results.filter((item) => item.status === "skipped").length,
        failedCount: Math.max(1, results.filter((item) => item.status === "error").length),
        detailsJson: JSON.stringify({ results, error: error instanceof Error ? error.message : String(error) }),
      });
      setTransferError(error instanceof Error ? error.message : "Product import failed.");
      onHistoryChanged();
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <div className="product-import-page">
      {!activeStore && (
        <div className="import-error" role="alert">
          <span className="import-error-icon">!</span>
          <div><strong>No active store</strong><p>Add a store in Stores before importing products.</p></div>
        </div>
      )}
      <section className="import-intro">
        <div>
          <span className="import-eyebrow">
            PRODUCT IMPORT
          </span>

          <h2>Upload your product file</h2>

          <p>
            Import Shopify products from a CSV, Excel, or
            JSON file. The file is checked first and a
            preview is shown before any products are sent.
          </p>
        </div>

        <div className="supported-formats">
          <span>CSV</span>
          <span>XLSX</span>
          <span>XLS</span>
          <span>JSON</span>
        </div>
      </section>

      {!parsedFile && (
        <section className="upload-panel">
          <input
            ref={fileInputRef}
            className="hidden-file-input"
            type="file"
            accept={ACCEPTED_FILES}
            onChange={handleFileInput}
          />

          <div
            className={`drop-zone ${
              isDragging
                ? "drop-zone-active"
                : ""
            }`}
            role="button"
            tabIndex={0}
            onClick={() =>
              fileInputRef.current?.click()
            }
            onKeyDown={(event) => {
              if (
                event.key === "Enter" ||
                event.key === " "
              ) {
                event.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <div className="drop-icon">
              ↑
            </div>

            <h3>
              {isLoading
                ? "Reading file..."
                : "Drag your file here"}
            </h3>

            <p>
              or select a CSV, Excel, or JSON file
              from your computer.
            </p>

            <button
              className="select-file-button"
              type="button"
              disabled={isLoading}
              onClick={(event) => {
                event.stopPropagation();
                fileInputRef.current?.click();
              }}
            >
              {isLoading
                ? "Please wait"
                : "Select File"}
            </button>

            <small>
              Recommended maximum file size:
              100 MB
            </small>
          </div>
        </section>
      )}

      {errorMessage && (
        <div
          className="import-error"
          role="alert"
        >
          <span className="import-error-icon">
            !
          </span>

          <div>
            <strong>
              File could not be loaded
            </strong>

            <p>{errorMessage}</p>
          </div>
        </div>
      )}

      {parsedFile && selectedSheet && (
        <>
          <section className="file-summary-card">
            <div className="file-summary-main">
              <div className="file-type-icon">
                {parsedFile.extension
                  .replace(".", "")
                  .toUpperCase()}
              </div>

              <div>
                <span className="summary-label">
                  UPLOADED FILE
                </span>

                <h3>
                  {parsedFile.fileName}
                </h3>

                <p>
                  {formatBytes(
                    parsedFile.size,
                  )}{" "}
                  ·{" "}
                  {
                    parsedFile.sheets
                      .length
                  }{" "}
                  sheet ·{" "}
                  {
                    selectedSheet.totalRows
                  }{" "}
                  data rows
                </p>
              </div>
            </div>

            <div className="file-summary-actions">
              <span className="file-ready-badge">
                File ready
              </span>

              <button
                className="clear-file-button"
                type="button"
                onClick={clearFile}
              >
                Remove File
              </button>
            </div>
          </section>

          {parsedFile.sheets.length > 1 && (
            <section className="sheet-tabs">
              <span className="sheet-tabs-label">
                Excel worksheet:
              </span>

              <div className="sheet-tab-list">
                {parsedFile.sheets.map(
                  (sheet) => (
                    <button
                      key={sheet.name}
                      className={
                        sheet.name ===
                        selectedSheet.name
                          ? "sheet-tab sheet-tab-active"
                          : "sheet-tab"
                      }
                      type="button"
                      onClick={() =>
                        selectSheet(
                          sheet.name,
                        )
                      }
                    >
                      {sheet.name}

                      <small>
                        {
                          sheet.totalRows
                        }
                      </small>
                    </button>
                  ),
                )}
              </div>
            </section>
          )}

          {activeStep === "preview" && (
            <section className="preview-panel">
              <header className="preview-header">
                <div>
                  <h3>
                    File Preview
                  </h3>

                  <p>
                    {
                      selectedSheet.headers
                        .length
                    }{" "}
                    columns,{" "}
                    {
                      selectedSheet.totalRows
                    }{" "}
                    data rows found.
                  </p>
                </div>

                <div className="preview-actions">
                  <input
                    className="preview-search"
                    type="search"
                    value={searchText}
                    placeholder="Search table..."
                    onChange={(event) =>
                      setSearchText(
                        event.target.value,
                      )
                    }
                  />

                  <button
                    className="change-file-button"
                    type="button"
                    onClick={() =>
                      fileInputRef.current?.click()
                    }
                  >
                    Select Another File
                  </button>

                  <input
                    ref={fileInputRef}
                    className="hidden-file-input"
                    type="file"
                    accept={ACCEPTED_FILES}
                    onChange={handleFileInput}
                  />
                </div>
              </header>

              {selectedSheet.headers
                .length === 0 ? (
                <div className="empty-sheet">
                  <div>◇</div>

                  <h4>
                    No columns were found
                    on this worksheet
                  </h4>

                  <p>
                    Select another Excel worksheet
                    or choose a different file.
                  </p>
                </div>
              ) : (
                <>
                  <div className="preview-table-wrapper">
                    <table className="preview-table">
                      <thead>
                        <tr>
                          <th className="row-number-column">
                            #
                          </th>

                          {selectedSheet.headers.map(
                            (header) => (
                              <th
                                key={header}
                                title={
                                  header
                                }
                              >
                                {header}
                              </th>
                            ),
                          )}
                        </tr>
                      </thead>

                      <tbody>
                        {previewRows.map(
                          (
                            row,
                            rowIndex,
                          ) => (
                            <tr
                              key={`${selectedSheet.name}-${rowIndex}`}
                            >
                              <td className="row-number-column">
                                {
                                  rowIndex +
                                  1
                                }
                              </td>

                              {selectedSheet.headers.map(
                                (
                                  header,
                                ) => (
                                  <td
                                    key={`${rowIndex}-${header}`}
                                  >
                                    <span
                                      title={String(
                                        row[
                                          header
                                        ] ?? "",
                                      )}
                                    >
                                      {String(
                                        row[
                                          header
                                        ] ?? "",
                                      )}
                                    </span>
                                  </td>
                                ),
                              )}
                            </tr>
                          ),
                        )}
                      </tbody>
                    </table>
                  </div>

                  <footer className="preview-footer">
                    <div>
                      {searchText ? (
                        <span>
                          {
                            filteredRows.length
                          }{" "}
                          matching rows
                          found.
                        </span>
                      ) : (
                        <span>
                          First{" "}
                          {Math.min(
                            selectedSheet.totalRows,
                            PREVIEW_ROW_LIMIT,
                          )}{" "}
                          rows
                          are shown.
                        </span>
                      )}

                      {selectedSheet.totalRows >
                        PREVIEW_ROW_LIMIT && (
                        <small>
                          The preview is limited
                          to 100 rows for
                          better performance.
                        </small>
                      )}
                    </div>

                    <button
                      className="continue-import-button"
                      type="button"
                      disabled={
                        selectedSheet
                          .headers
                          .length === 0
                      }
                      onClick={() => {
                        setActiveStep(
                          "mapping",
                        );

                        setMappingSaved(
                          false,
                        );

                        setValidationConfirmed(
                          false,
                        );
                      }}
                    >
                      Continue to Column Mapping
                    </button>
                  </footer>
                </>
              )}
            </section>
          )}

          {activeStep === "mapping" && (
            <>
              <ColumnMappingStep
                headers={
                  selectedSheet.headers
                }
                rows={
                  selectedSheet.rows
                }
                mapping={
                  columnMapping
                }
                metafieldMappings={
                  metafieldMappings
                }
                onMappingChange={(
                  newMapping,
                ) => {
                  setColumnMapping(
                    newMapping,
                  );

                  setMappingSaved(
                    false,
                  );

                  setValidationConfirmed(
                    false,
                  );
                }}
                onMetafieldMappingsChange={(
                  newMappings,
                ) => {
                  setMetafieldMappings(
                    newMappings,
                  );

                  setMappingSaved(
                    false,
                  );

                  setValidationConfirmed(
                    false,
                  );
                }}
                onBack={() => {
                  setActiveStep(
                    "preview",
                  );

                  setMappingSaved(
                    false,
                  );

                  setValidationConfirmed(
                    false,
                  );
                }}
                onSave={() => {
                  setMappingSaved(
                    true,
                  );

                  setValidationConfirmed(
                    false,
                  );
                }}
              />

              {mappingSaved && (
                <div className="workflow-success-message">
                  <span>
                    ✓ Column mapping was saved.{" "}
                    {mappedMetafieldCount >
                    0
                      ? `${mappedMetafieldCount} metafield columns are also ready for import.`
                      : "No metafield columns were selected."}
                  </span>

                  <button
                    className="workflow-next-button"
                    type="button"
                    onClick={() => {
                      setActiveStep(
                        "validation",
                      );

                      setValidationConfirmed(
                        false,
                      );
                    }}
                  >
                    Continue to Data Validation
                  </button>
                </div>
              )}
            </>
          )}

          {activeStep === "validation" &&
            validationResult && (
              <>
                <ProductValidationStep
                  result={
                    validationResult
                  }
                  onBack={() => {
                    setActiveStep(
                      "mapping",
                    );

                    setValidationConfirmed(
                      false,
                    );
                  }}
                  onComplete={() => {
                    setValidationConfirmed(
                      true,
                    );
                  }}
                />

                {validationConfirmed && (
                  <section className="desktop-transfer-panel">
                    <div className="desktop-transfer-header">
                      <div>
                        <span className="import-eyebrow">TRANSFER SETTINGS</span>
                        <h3>Import to {activeStore?.name ?? "a connected store"}</h3>
                        <p>{preparedProducts.length} products · batch size {settings.product.batchSize} · {settings.product.importMode}</p>
                      </div>
                      <div className="desktop-transfer-actions">
                        <button className="change-file-button" type="button" disabled={!activeStore || isTesting || isImporting} onClick={() => void runSafeTest()}>
                          {isTesting ? "Testing..." : testPassed ? "Run Test Again" : "Safe Test Import"}
                        </button>
                        <button className="continue-import-button" type="button" disabled={!activeStore || isTesting || isImporting || (settings.product.requireTest && !testPassed)} onClick={() => void runFullImport()}>
                          {isImporting ? `Importing ${importProgress}%` : "Start Full Import"}
                        </button>
                      </div>
                    </div>

                    {isImporting && <div className="desktop-progress"><span style={{ width: `${importProgress}%` }} /></div>}
                    {transferMessage && <div className="workflow-success-message"><span>✓ {transferMessage}</span></div>}
                    {transferError && <div className="import-error"><span className="import-error-icon">!</span><div><strong>Transfer failed</strong><p>{transferError}</p></div></div>}

                    {importResults.length > 0 && (
                      <div className="desktop-result-table-wrapper">
                        <table className="preview-table">
                          <thead><tr><th>Product</th><th>Handle</th><th>Variants</th><th>Result</th><th>Notes</th></tr></thead>
                          <tbody>
                            {importResults.map((item) => (
                              <tr key={item.sourceKey}>
                                <td>{item.title}</td><td>{item.handle}</td><td>{item.variantCount}</td><td>{item.status}</td><td>{[...item.warnings, ...item.errors].join(" · ") || "No issues"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                )}
              </>
            )}
        </>
      )}
    </div>
  );
}

export default ProductImportPage;
