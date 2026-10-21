import { useState, useEffect, useCallback, useId, type ChangeEvent, type DragEvent } from 'react';
import {
  activateDataset,
  getImportStatus,
  getImportTemplates,
  loadImport,
  validateImport,
} from '../api/endpoints';
import { ApiError, NetworkError } from '../api/http';
import type {
  ImportStatusResponse,
  ValidateImportResponse,
  ValidationErrorItem,
} from '../api/types';
import { useMeta } from '../hooks/useMeta';
import { clearGlobeCache } from '../components/globe/useGlobeData';

interface SelectedFile {
  file: File;
  name: string;
  size: number;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function ImportPage() {
  const fileInputId = useId();
  const dateInputId = useId();
  const { meta, reload: reloadMeta } = useMeta();

  // Status state
  const [status, setStatus] = useState<ImportStatusResponse | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);

  // Form state
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [asOfDate, setAsOfDate] = useState<string>('2026-10-18');
  const [clientErrors, setClientErrors] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  // Validation state
  const [isValidating, setIsValidating] = useState(false);
  const [validationReport, setValidationReport] = useState<ValidateImportResponse | null>(null);
  const [validatedFingerprint, setValidatedFingerprint] = useState<string | null>(null);

  // Load state
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [isLoadingDataset, setIsLoadingDataset] = useState(false);
  const [loadSuccessMessage, setLoadSuccessMessage] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Switching state
  const [isSwitching, setIsSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);

  // Template download state
  const [isDownloadingTemplates, setIsDownloadingTemplates] = useState(false);

  // Load initial status
  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    setStatusError(null);
    try {
      const data = await getImportStatus();
      setStatus(data);
    } catch (err) {
      if (err instanceof ApiError || err instanceof NetworkError) {
        setStatusError(err.message);
      } else {
        setStatusError('Failed to retrieve web import status.');
      }
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    getImportStatus()
      .then((data) => {
        if (!cancelled) {
          setStatus(data);
          setStatusLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          if (err instanceof ApiError || err instanceof NetworkError) {
            setStatusError(err.message);
          } else {
            setStatusError('Failed to retrieve web import status.');
          }
          setStatusLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Compute file fingerprint for validation tracking
  const currentFingerprint = files.map((f) => `${f.name}:${f.size}`).sort().join('|') + `||${asOfDate}`;
  const isCurrentlyValidated = Boolean(
    validationReport?.valid && validatedFingerprint === currentFingerprint
  );

  // Handle client-side file selection
  const handleFilesAdded = (incomingFiles: FileList | File[]) => {
    setClientErrors([]);
    setLoadSuccessMessage(null);
    setValidationReport(null);
    setValidatedFingerprint(null);

    const newFiles: SelectedFile[] = [];
    const errors: string[] = [];

    const maxFileBytes = status?.limits.max_file_bytes ?? 5242880;
    const maxFiles = status?.limits.max_files ?? 11;
    const maxTotalBytes = status?.limits.max_total_bytes ?? 26214400;

    const acceptedNames = new Set(status?.accepted_files.map((f) => f.name) ?? []);

    for (let i = 0; i < incomingFiles.length; i++) {
      const f = incomingFiles[i];
      if (!f.name.endsWith('.csv')) {
        errors.push(`'${f.name}' is not a .csv file.`);
        continue;
      }
      if (acceptedNames.size > 0 && !acceptedNames.has(f.name)) {
        errors.push(`'${f.name}' is not an accepted CSV file.`);
        continue;
      }
      if (f.size > maxFileBytes) {
        errors.push(`'${f.name}' (${formatBytes(f.size)}) exceeds maximum file limit of ${formatBytes(maxFileBytes)}.`);
        continue;
      }
      newFiles.push({ file: f, name: f.name, size: f.size });
    }

    // Merge without duplicates by name
    const merged = [...files];
    for (const nf of newFiles) {
      const idx = merged.findIndex((m) => m.name === nf.name);
      if (idx >= 0) {
        merged[idx] = nf;
      } else {
        merged.push(nf);
      }
    }

    if (merged.length > maxFiles) {
      errors.push(`Total selected files (${merged.length}) exceeds the maximum limit of ${maxFiles}.`);
    }

    const totalBytes = merged.reduce((acc, f) => acc + f.size, 0);
    if (totalBytes > maxTotalBytes) {
      errors.push(`Total selected size (${formatBytes(totalBytes)}) exceeds maximum allowed total of ${formatBytes(maxTotalBytes)}.`);
    }

    setFiles(merged);
    if (errors.length > 0) {
      setClientErrors(errors);
    }
  };

  const handleRemoveFile = (fileName: string) => {
    setFiles((prev) => prev.filter((f) => f.name !== fileName));
    setValidationReport(null);
    setValidatedFingerprint(null);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFilesAdded(e.dataTransfer.files);
    }
  };

  // Read all files as text and prepare body
  const readFilesAsText = async (): Promise<Record<string, string>> => {
    const fileTexts: Record<string, string> = {};
    for (const sf of files) {
      fileTexts[sf.name] = await sf.file.text();
    }
    return fileTexts;
  };

  // Validate handler
  const handleValidate = async () => {
    if (files.length === 0) {
      setClientErrors(['Please select at least one CSV file to validate.']);
      return;
    }
    if (!asOfDate) {
      setClientErrors(['Please provide a valid as-of date (YYYY-MM-DD).']);
      return;
    }

    setIsValidating(true);
    setClientErrors([]);
    setLoadSuccessMessage(null);
    setLoadError(null);

    try {
      const fileData = await readFilesAsText();
      const report = await validateImport({ as_of: asOfDate, files: fileData });
      setValidationReport(report);
      setValidatedFingerprint(currentFingerprint);
    } catch (err) {
      if (err instanceof ApiError || err instanceof NetworkError) {
        setClientErrors([err.message]);
      } else {
        setClientErrors(['Validation failed due to an unexpected error.']);
      }
    } finally {
      setIsValidating(false);
    }
  };

  // Load dataset handler
  const handleConfirmLoad = async () => {
    setShowConfirmModal(false);
    setIsLoadingDataset(true);
    setLoadError(null);
    setLoadSuccessMessage(null);

    try {
      const fileData = await readFilesAsText();
      const res = await loadImport({ as_of: asOfDate, files: fileData, replace_uploaded: true });
      if (res.valid) {
        setLoadSuccessMessage(`Now viewing: ${res.label}`);
        // Clear cached globe data so it reflects the new dataset immediately
        clearGlobeCache();
        // Reload global metadata and status
        reloadMeta();
        await loadStatus();
      } else {
        setValidationReport(res);
        setLoadError('Dataset load rejected due to validation errors.');
      }
    } catch (err) {
      if (err instanceof ApiError || err instanceof NetworkError) {
        setLoadError(err.message);
      } else {
        setLoadError('Failed to load dataset.');
      }
    } finally {
      setIsLoadingDataset(false);
    }
  };

  // Switch dataset handler
  const handleSwitchDataset = async (target: 'demo' | 'uploaded') => {
    setIsSwitching(true);
    setSwitchError(null);
    try {
      const updated = await activateDataset(target);
      setStatus(updated);
      clearGlobeCache();
      reloadMeta();
    } catch (err) {
      if (err instanceof ApiError || err instanceof NetworkError) {
        setSwitchError(err.message);
      } else {
        setSwitchError(`Failed to switch to ${target} dataset.`);
      }
    } finally {
      setIsSwitching(false);
    }
  };

  // Template download handler
  const handleDownloadTemplates = async () => {
    setIsDownloadingTemplates(true);
    try {
      const templates = await getImportTemplates();
      for (const [fname, content] of Object.entries(templates)) {
        const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fname;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      if (err instanceof ApiError || err instanceof NetworkError) {
        setClientErrors([`Template download failed: ${err.message}`]);
      } else {
        setClientErrors(['Failed to download CSV templates.']);
      }
    } finally {
      setIsDownloadingTemplates(false);
    }
  };

  // 1. Loading state
  if (statusLoading) {
    return (
      <main className="p-6 max-w-5xl mx-auto space-y-4">
        <h1 className="text-xl font-bold text-text-primary">Import Data</h1>
        <p className="text-sm text-text-secondary">Checking import service configuration...</p>
      </main>
    );
  }

  // 2. Status error state with retry
  if (statusError || !status) {
    return (
      <main className="p-6 max-w-5xl mx-auto space-y-4">
        <h1 className="text-xl font-bold text-text-primary">Import Data</h1>
        <aside
          role="alert"
          aria-label="Import service connection error"
          className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-900 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
        >
          <div>
            <span className="font-semibold">Service Unavailable: </span>
            <span>{statusError || 'Could not communicate with the backend import service.'}</span>
          </div>
          <button
            type="button"
            onClick={loadStatus}
            className="px-3 py-1.5 bg-surface border border-red-300 rounded font-medium text-red-900 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500"
          >
            Retry
          </button>
        </aside>
      </main>
    );
  }

  // 3. Web import disabled state (shows only required exact text and nothing interactive)
  if (!status.enabled) {
    return (
      <main className="p-6 max-w-5xl mx-auto space-y-4">
        <h1 className="text-xl font-bold text-text-primary">Import Data</h1>
        <aside
          role="status"
          className="p-5 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-950 font-medium"
        >
          Web import is disabled. Set ENABLE_WEB_IMPORT=true in backend\.env and restart the backend.
        </aside>
      </main>
    );
  }

  const activeDatasetName = meta?.active_dataset || status.active;

  return (
    <main className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border-subtle pb-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Import Data</h1>
          <p className="text-xs sm:text-sm text-text-secondary mt-1">
            Safely test custom supply chain scenarios using separate, user-supplied CSV files.
          </p>
        </div>
        <button
          type="button"
          onClick={handleDownloadTemplates}
          disabled={isDownloadingTemplates}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-surface border border-border-subtle text-text-primary hover:bg-elevated rounded text-xs font-medium shadow-xs focus:outline-none focus:ring-2 focus:ring-accent-primary cursor-pointer disabled:opacity-50"
        >
          <svg className="w-4 h-4 text-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          {isDownloadingTemplates ? 'Downloading...' : 'Download template files'}
        </button>
      </div>

      {/* Dataset Switcher Section */}
      <section
        aria-labelledby="active-dataset-heading"
        className="bg-surface border border-border-subtle rounded-lg p-4 sm:p-5 shadow-xs space-y-3"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 id="active-dataset-heading" className="text-sm font-semibold uppercase tracking-wider text-text-secondary">
              Active Dataset
            </h2>
            <p className="text-base font-bold text-text-primary mt-0.5 flex items-center gap-2">
              <span>{activeDatasetName === 'uploaded' ? 'Uploaded Dataset' : 'Demo Dataset'}</span>
              <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${activeDatasetName === 'uploaded' ? 'bg-purple-100 text-purple-800 border border-purple-200' : 'bg-amber-100 text-amber-800 border border-amber-200'}`}>
                {activeDatasetName}
              </span>
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => handleSwitchDataset('demo')}
              disabled={isSwitching || activeDatasetName === 'demo'}
              className="px-3 py-1.5 bg-elevated hover:bg-surface text-text-primary text-xs font-semibold rounded border border-border-subtle disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-accent-primary cursor-pointer"
            >
              View demo data
            </button>
            <button
              type="button"
              onClick={() => handleSwitchDataset('uploaded')}
              disabled={isSwitching || activeDatasetName === 'uploaded' || !status.uploaded_available}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-accent-primary cursor-pointer"
            >
              View uploaded data
            </button>
          </div>
        </div>

        {switchError && (
          <p role="alert" className="text-xs text-red-600 font-medium">
            {switchError}
          </p>
        )}
      </section>

      {/* Upload & Form Section */}
      <section className="bg-surface border border-border-subtle rounded-lg p-4 sm:p-5 shadow-xs space-y-5">
        <h2 className="text-base font-semibold text-text-primary border-b border-border-subtle pb-2">
          Upload User Dataset (CSV)
        </h2>

        {/* As-Of Date Input */}
        <div className="max-w-md space-y-1">
          <label htmlFor={dateInputId} className="block text-xs font-semibold uppercase tracking-wider text-text-primary">
            As-Of Snapshot Date <span className="text-red-500">*</span>
          </label>
          <input
            id={dateInputId}
            type="date"
            value={asOfDate}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              setAsOfDate(e.target.value);
              setValidationReport(null);
              setValidatedFingerprint(null);
            }}
            required
            className="w-full px-3 py-2 text-sm border border-border-subtle rounded focus:ring-2 focus:ring-accent-primary focus:outline-none"
          />
          <p className="text-xs text-text-secondary">
            History should end the day before the as-of date. Money values must be in USD.
          </p>
        </div>

        {/* File Picker & Drag-and-Drop Area */}
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
            isDragging
              ? 'border-blue-500 bg-blue-50/50'
              : 'border-border-subtle hover:border-border-strong bg-elevated/50'
          }`}
        >
          <svg className="w-10 h-10 mx-auto text-text-muted mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
          <p className="text-sm font-medium text-text-primary">
            Drag and drop CSV files here, or{' '}
            <label
              htmlFor={fileInputId}
              className="text-blue-600 hover:text-blue-800 underline cursor-pointer font-semibold"
            >
              browse
            </label>
          </p>
          <p className="text-xs text-text-secondary mt-1">
            Accepts up to {status.limits.max_files} CSV files (max {formatBytes(status.limits.max_file_bytes)} per file, {formatBytes(status.limits.max_total_bytes)} total)
          </p>
          <input
            id={fileInputId}
            type="file"
            multiple
            accept=".csv"
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              if (e.target.files && e.target.files.length > 0) {
                handleFilesAdded(e.target.files);
              }
            }}
            className="sr-only"
          />
        </div>

        {/* Selected Files List */}
        {files.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-text-secondary">
              <span>Selected Files ({files.length})</span>
              <span>Total: {formatBytes(files.reduce((a, b) => a + b.size, 0))}</span>
            </div>
            <ul className="divide-y divide-border-subtle border border-border-subtle rounded text-xs bg-surface">
              {files.map((sf) => (
                <li key={sf.name} className="px-3 py-2 flex items-center justify-between gap-2">
                  <span className="font-mono text-text-primary font-medium truncate">{sf.name}</span>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-text-secondary">{formatBytes(sf.size)}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveFile(sf.name)}
                      className="text-red-600 hover:text-red-800 font-semibold focus:outline-none focus:ring-1 focus:ring-red-500"
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Client validation errors */}
        {clientErrors.length > 0 && (
          <aside
            role="alert"
            className="p-3 bg-red-50 border border-red-200 rounded text-xs text-red-900 space-y-1"
          >
            <span className="font-semibold block">Client Validation Notice:</span>
            {clientErrors.map((err, i) => (
              <p key={i}>{err}</p>
            ))}
          </aside>
        )}

        {/* Action Buttons */}
        <div className="flex items-center gap-3 pt-2">
          <button
            type="button"
            onClick={handleValidate}
            disabled={isValidating || files.length === 0}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-bold shadow-xs disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-accent-primary cursor-pointer"
          >
            {isValidating ? 'Validating...' : 'Validate'}
          </button>

          <button
            type="button"
            onClick={() => setShowConfirmModal(true)}
            disabled={!isCurrentlyValidated || isLoadingDataset}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-bold shadow-xs disabled:opacity-40 disabled:bg-slate-300 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer"
          >
            {isLoadingDataset ? 'Loading dataset...' : 'Load this dataset'}
          </button>
        </div>

        {/* Confirmation Step */}
        {showConfirmModal && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-modal-title"
            className="p-4 bg-amber-50 border border-amber-300 rounded-lg space-y-3"
          >
            <h3 id="confirm-modal-title" className="text-sm font-bold text-amber-950">
              Confirm Dataset Load
            </h3>
            <p className="text-xs text-amber-900">
              This replaces any previously uploaded dataset. Demo data is not modified.
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleConfirmLoad}
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer"
              >
                Yes, load dataset
              </button>
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                className="px-3 py-1.5 bg-surface border border-border-subtle text-text-primary hover:bg-elevated rounded text-xs font-medium focus:outline-none focus:ring-2 focus:ring-slate-400 cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Load Status Banners */}
        {loadSuccessMessage && (
          <aside
            role="status"
            aria-live="polite"
            className="p-4 bg-emerald-50 border border-emerald-300 rounded-lg text-sm text-emerald-950 font-bold"
          >
            {loadSuccessMessage}
          </aside>
        )}

        {loadError && (
          <aside
            role="alert"
            className="p-4 bg-red-50 border border-red-300 rounded-lg text-xs text-red-900 font-medium"
          >
            {loadError}
          </aside>
        )}
      </section>

      {/* Server Validation Report Section */}
      {validationReport && (
        <section
          aria-live="polite"
          className="bg-surface border border-border-subtle rounded-lg p-4 sm:p-5 shadow-xs space-y-4"
        >
          <div className="flex items-center justify-between border-b border-border-subtle pb-3">
            <h2 className="text-base font-semibold text-text-primary">Validation Results</h2>
            <span
              className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                validationReport.valid
                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                  : 'bg-red-100 text-red-800 border border-red-300'
              }`}
            >
              {validationReport.valid ? 'VALID' : 'INVALID'}
            </span>
          </div>

          {/* Errors Table */}
          {validationReport.errors && validationReport.errors.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-red-700">
                Errors ({validationReport.errors.length})
              </h3>
              <div className="overflow-x-auto border border-red-200 rounded">
                <table className="min-w-full divide-y divide-red-200 text-left text-xs">
                  <thead className="bg-red-50 text-red-950 font-semibold">
                    <tr>
                      <th scope="col" className="px-3 py-2 w-1/4">File</th>
                      <th scope="col" className="px-3 py-2 w-16">Line</th>
                      <th scope="col" className="px-3 py-2">Message</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-red-100 bg-surface">
                    {validationReport.errors.map((err: ValidationErrorItem, idx: number) => (
                      <tr key={idx} className="hover:bg-red-50/40">
                        <td className="px-3 py-2 font-mono text-text-primary">{err.file}</td>
                        <td className="px-3 py-2 text-text-secondary">{err.line ?? '—'}</td>
                        <td className="px-3 py-2 text-red-900">{err.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Warnings */}
          {validationReport.warnings && validationReport.warnings.length > 0 && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded text-xs text-amber-900 space-y-1">
              <span className="font-semibold block">Warnings:</span>
              <ul className="list-disc pl-4 space-y-0.5">
                {validationReport.warnings.map((w, idx) => (
                  <li key={idx}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Coverage Details */}
          {validationReport.coverage && (
            <div className="space-y-3 pt-2 border-t border-border-subtle">
              <h3 className="text-xs font-bold uppercase tracking-wider text-text-primary">
                Entity Coverage &amp; Feed Omission Consequences
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                {/* Covered */}
                <div className="p-3 bg-elevated border border-border-subtle rounded space-y-1">
                  <span className="font-semibold text-emerald-800 block">
                    Covered Entities ({validationReport.coverage.entities_covered.length})
                  </span>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {validationReport.coverage.entities_covered.map((ent) => (
                      <span key={ent} className="px-2 py-0.5 bg-surface border border-border-subtle rounded font-mono text-text-primary">
                        {ent}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Missing & Consequences */}
                <div className="p-3 bg-elevated border border-border-subtle rounded space-y-1">
                  <span className="font-semibold text-amber-800 block">
                    Missing Entities ({validationReport.coverage.missing?.length ?? 0})
                  </span>
                  {validationReport.coverage.missing && validationReport.coverage.missing.length > 0 ? (
                    <ul className="list-disc pl-4 space-y-1 text-text-primary mt-1">
                      {validationReport.coverage.missing.map((ent) => (
                        <li key={ent}>
                          <span className="font-mono font-medium">{ent}</span>:{' '}
                          <span className="text-text-secondary">
                            {validationReport.coverage.consequences?.[ent] || 'No specific consequence noted.'}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-text-secondary">All standard entity feeds are covered.</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Row Counts Breakdown */}
          {validationReport.row_counts && Object.keys(validationReport.row_counts).length > 0 && (
            <div className="pt-2 border-t border-border-subtle">
              <h3 className="text-xs font-bold uppercase tracking-wider text-text-primary mb-2">
                Loaded Row Counts
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 text-xs">
                {Object.entries(validationReport.row_counts).map(([entity, count]) => (
                  <div key={entity} className="p-2 bg-elevated rounded border border-border-subtle flex justify-between items-center">
                    <span className="font-mono text-text-primary">{entity}</span>
                    <span className="font-bold text-text-primary">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}
    </main>
  );
}

export default ImportPage;
