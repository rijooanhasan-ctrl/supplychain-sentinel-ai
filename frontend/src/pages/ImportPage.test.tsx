import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ImportPage } from './ImportPage';
import * as endpoints from '../api/endpoints';
import { MetaContext } from '../context/metaContextDef';
import type { ImportStatusResponse, ValidateImportResponse } from '../api/types';

vi.mock('../api/endpoints');

const mockDisabledStatus: ImportStatusResponse = {
  enabled: false,
  active: 'demo',
  uploaded_available: false,
  limits: {
    max_file_bytes: 5242880,
    max_files: 11,
    max_total_bytes: 26214400,
  },
  accepted_files: [
    { name: 'warehouses.csv', required: true },
    { name: 'components.csv', required: true },
  ],
};

const mockEnabledStatus: ImportStatusResponse = {
  enabled: true,
  active: 'demo',
  uploaded_available: true,
  limits: {
    max_file_bytes: 5242880,
    max_files: 11,
    max_total_bytes: 26214400,
  },
  accepted_files: [
    { name: 'warehouses.csv', required: true },
    { name: 'components.csv', required: true },
    { name: 'suppliers.csv', required: true },
    { name: 'inventory.csv', required: true },
  ],
};

describe('ImportPage Component', () => {
  const reloadMock = vi.fn();

  const renderWithContext = (ui: React.ReactElement, metaOverrides = {}) => {
    return render(
      <MetaContext.Provider
        value={{
          meta: {
            seeded: true,
            data_source: 'demo',
            label: 'DEMO DATA',
            seed: 42,
            as_of: '2026-10-17',
            generator_version: '0.1.0',
            generated_at: '2026-10-19T00:00:00Z',
            counts: {},
            message: 'Active',
            active_dataset: 'demo',
            ...metaOverrides,
          },
          loading: false,
          error: null,
          reload: reloadMock,
          isDemo: true,
          asOf: '2026-10-17',
        }}
      >
        <MemoryRouter>{ui}</MemoryRouter>
      </MetaContext.Provider>
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders disabled state text and no interactive controls when web import is disabled', async () => {
    vi.mocked(endpoints.getImportStatus).mockResolvedValueOnce(mockDisabledStatus);

    renderWithContext(<ImportPage />);

    const disabledMsg = await screen.findByText(
      /Web import is disabled\. Set ENABLE_WEB_IMPORT=true in backend\\\.env and restart the backend\./i
    );
    expect(disabledMsg).toBeInTheDocument();
    expect(screen.queryByText(/Upload User Dataset/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Validate/i })).not.toBeInTheDocument();
  });

  it('handles status load error with retry button', async () => {
    vi.mocked(endpoints.getImportStatus).mockRejectedValueOnce(new Error('Network offline'));

    renderWithContext(<ImportPage />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/Failed to retrieve web import status/i);

    const retryBtn = screen.getByRole('button', { name: /Retry/i });
    expect(retryBtn).toBeInTheDocument();

    vi.mocked(endpoints.getImportStatus).mockResolvedValueOnce(mockEnabledStatus);
    fireEvent.click(retryBtn);

    expect(await screen.findByText(/Upload User Dataset/i)).toBeInTheDocument();
  });

  it('renders enabled state with controls, as-of helper text, and dataset switchers', async () => {
    vi.mocked(endpoints.getImportStatus).mockResolvedValueOnce(mockEnabledStatus);

    renderWithContext(<ImportPage />);

    expect(await screen.findByText(/Upload User Dataset/i)).toBeInTheDocument();
    expect(
      screen.getByText(/History should end the day before the as-of date\. Money values must be in USD\./i)
    ).toBeInTheDocument();

    expect(screen.getByRole('button', { name: /Validate/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Load this dataset/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /View demo data/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /View uploaded data/i })).toBeInTheDocument();
  });

  it('adds files, checks client-side limits, and allows removing files', async () => {
    vi.mocked(endpoints.getImportStatus).mockResolvedValueOnce(mockEnabledStatus);

    renderWithContext(<ImportPage />);
    await screen.findByText(/Upload User Dataset/i);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).toBeInTheDocument();

    // 1. Add valid file
    const validFile = new File(['code,name,role\nWH-1,Plant,plant\n'], 'warehouses.csv', {
      type: 'text/csv',
    });
    fireEvent.change(fileInput, { target: { files: [validFile] } });

    expect(await screen.findByText('warehouses.csv')).toBeInTheDocument();
    expect(screen.getByText(/Selected Files \(1\)/i)).toBeInTheDocument();

    // 2. Add invalid extension file
    const invalidExtFile = new File(['binary content'], 'script.exe', { type: 'application/octet-stream' });
    fireEvent.change(fileInput, { target: { files: [invalidExtFile] } });

    expect(await screen.findByText(/'script\.exe' is not a \.csv file\./i)).toBeInTheDocument();

    // 3. Remove valid file
    const removeBtn = screen.getByRole('button', { name: /Remove/i });
    fireEvent.click(removeBtn);

    expect(screen.queryByText('warehouses.csv')).not.toBeInTheDocument();
  });

  it('validates files, renders errors and coverage, enables Load only after valid', async () => {
    vi.mocked(endpoints.getImportStatus).mockResolvedValueOnce(mockEnabledStatus);

    const mockValidationFail: ValidateImportResponse = {
      valid: false,
      errors: [
        { file: 'warehouses.csv', line: 2, message: 'Invalid role' },
      ],
      warnings: ['Missing demand history'],
      coverage: {
        entities_covered: ['warehouses'],
        missing: ['demand_history'],
        consequences: { demand_history: 'No forecasts' },
      },
      row_counts: { warehouses: 1 },
      as_of: '2026-10-18',
      label: 'USER-SUPPLIED DATA (file import)',
    };

    const mockValidationSuccess: ValidateImportResponse = {
      valid: true,
      errors: [],
      warnings: [],
      coverage: {
        entities_covered: ['warehouses', 'components'],
        missing: [],
        consequences: {},
      },
      row_counts: { warehouses: 2, components: 2 },
      as_of: '2026-10-18',
      label: 'USER-SUPPLIED DATA (file import)',
    };

    renderWithContext(<ImportPage />);
    await screen.findByText(/Upload User Dataset/i);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const testFile = new File(['code,name,role\nWH-1,Plant,plant\n'], 'warehouses.csv', {
      type: 'text/csv',
    });
    fireEvent.change(fileInput, { target: { files: [testFile] } });

    const validateBtn = screen.getByRole('button', { name: /Validate/i });
    const loadBtn = screen.getByRole('button', { name: /Load this dataset/i });

    // Step 1: Failed validation
    vi.mocked(endpoints.validateImport).mockResolvedValueOnce(mockValidationFail);
    fireEvent.click(validateBtn);

    expect(await screen.findByText('INVALID')).toBeInTheDocument();
    expect(screen.getByText('Invalid role')).toBeInTheDocument();
    expect(screen.getByText(/Missing demand history/i)).toBeInTheDocument();
    expect(loadBtn).toBeDisabled();

    // Step 2: Successful validation
    vi.mocked(endpoints.validateImport).mockResolvedValueOnce(mockValidationSuccess);
    fireEvent.click(validateBtn);

    expect(await screen.findByText('VALID')).toBeInTheDocument();
    expect(loadBtn).not.toBeDisabled();

    // Step 3: Changing date re-disables Load button
    const dateInput = screen.getByLabelText(/As-Of Snapshot Date/i);
    fireEvent.change(dateInput, { target: { value: '2026-10-19' } });
    expect(loadBtn).toBeDisabled();
  });

  it('runs confirm step and loads dataset, refreshing meta and showing success label', async () => {
    vi.mocked(endpoints.getImportStatus).mockResolvedValue(mockEnabledStatus);

    const mockValidationSuccess: ValidateImportResponse = {
      valid: true,
      errors: [],
      warnings: [],
      coverage: {
        entities_covered: ['warehouses'],
        missing: [],
        consequences: {},
      },
      row_counts: { warehouses: 2 },
      as_of: '2026-10-18',
      label: 'USER-SUPPLIED DATA (file import)',
    };

    renderWithContext(<ImportPage />);
    await screen.findByText(/Upload User Dataset/i);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const testFile = new File(['code,name,role\nWH-1,Plant,plant\n'], 'warehouses.csv', {
      type: 'text/csv',
    });
    fireEvent.change(fileInput, { target: { files: [testFile] } });

    vi.mocked(endpoints.validateImport).mockResolvedValueOnce(mockValidationSuccess);
    fireEvent.click(screen.getByRole('button', { name: /Validate/i }));

    const loadBtn = await screen.findByRole('button', { name: /Load this dataset/i });
    expect(loadBtn).not.toBeDisabled();

    // Click Load -> shows confirmation modal
    fireEvent.click(loadBtn);

    expect(
      screen.getByText(/This replaces any previously uploaded dataset\. Demo data is not modified\./i)
    ).toBeInTheDocument();

    vi.mocked(endpoints.loadImport).mockResolvedValueOnce({
      ...mockValidationSuccess,
      active: 'uploaded',
    });

    const confirmBtn = screen.getByRole('button', { name: /Yes, load dataset/i });
    fireEvent.click(confirmBtn);

    expect(await screen.findByText(/Now viewing: USER-SUPPLIED DATA \(file import\)/i)).toBeInTheDocument();
    expect(reloadMock).toHaveBeenCalled();
  });

  it('switches dataset between demo and uploaded', async () => {
    vi.mocked(endpoints.getImportStatus).mockResolvedValueOnce({
      ...mockEnabledStatus,
      active: 'uploaded',
    });

    renderWithContext(<ImportPage />, { active_dataset: 'uploaded' });
    await screen.findByText(/Upload User Dataset/i);

    vi.mocked(endpoints.activateDataset).mockResolvedValueOnce({
      ...mockEnabledStatus,
      active: 'demo',
    });

    const demoBtn = screen.getByRole('button', { name: /View demo data/i });
    fireEvent.click(demoBtn);

    await waitFor(() => {
      expect(endpoints.activateDataset).toHaveBeenCalledWith('demo');
      expect(reloadMock).toHaveBeenCalled();
    });
  });

  it('triggers download of template files', async () => {
    vi.mocked(endpoints.getImportStatus).mockResolvedValueOnce(mockEnabledStatus);
    vi.mocked(endpoints.getImportTemplates).mockResolvedValueOnce({
      'warehouses.csv': 'code,name,role\n',
    });

    renderWithContext(<ImportPage />);
    await screen.findByText(/Upload User Dataset/i);

    const downloadBtn = screen.getByRole('button', { name: /Download template files/i });
    fireEvent.click(downloadBtn);

    await waitFor(() => {
      expect(endpoints.getImportTemplates).toHaveBeenCalled();
    });
  });
});
