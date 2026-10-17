# SupplyChain Sentinel AI

AI/ML-powered supply-chain risk prediction and decision-support web application for **SAP Hackfest 2026** (Theme: *Resilient Supply Chains*).

> **Important Notice:**
> - **Decision-Support Only:** SupplyChain Sentinel AI is strictly an analytical and decision-support system. It does not create real purchase orders, touch real operational ERP transaction ledgers, or modify live enterprise data.
> - **Demo Data Notice:** All data currently processed and displayed by the system is **DEMO DATA**. No live SAP connection exists yet in this phase. Real external systems are reached only through a decoupled integration adapter boundary.

---

## 1. Prerequisites

Before running the project locally on Windows 11, verify that the following tools are installed:
- **Python**: Version 3.13.x (invoke via `python`, not `python3` on Windows)
- **Node.js**: Version 20+ (verified with v24.16.0) and **npm** (v11.x)
- **Git**: Version 2.40+ (verified with v2.55.0)

---

## 2. Repository Layout

```
SAP/
├── .gitignore
├── README.md
├── docs/
│   └── ARCHITECTURE.md          # Architectural layers, adapter boundaries, and system rules
├── backend/
│   ├── .env.example             # Backend environment template
│   ├── requirements.txt         # Production runtime dependencies (FastAPI, Uvicorn, Pydantic)
│   ├── requirements-dev.txt     # Development and testing dependencies (pytest, httpx)
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py              # FastAPI app factory, CORS middleware, router registration
│   │   ├── core/
│   │   │   ├── __init__.py
│   │   │   └── config.py        # Pydantic Settings (env configuration and defaults)
│   │   ├── api/
│   │   │   ├── __init__.py
│   │   │   └── routes/
│   │   │       ├── __init__.py
│   │   │       └── health.py    # GET /api/health endpoint
│   │   ├── domain/              # Pure business logic layer (Phase 1: empty)
│   │   ├── services/            # Application services layer (Phase 1: empty)
│   │   ├── db/                  # Persistence and SQLite models (Phase 1: empty)
│   │   └── integrations/        # SourceAdapter boundaries (Phase 1: empty)
│   └── tests/
│       ├── __init__.py
│       ├── test_config.py       # Configuration defaults and env override tests
│       └── test_health.py       # Health check response and ISO-8601 timestamp tests
└── frontend/
    ├── package.json             # React, Vite, Tailwind CSS, Vitest dependencies
    ├── vite.config.ts           # Vite server config (port 5173, /api proxy to 8000, Vitest)
    ├── tsconfig.json            # TypeScript configuration
    └── src/
        ├── App.tsx              # Health status, loading/error states, DEMO DATA badge
        ├── App.test.tsx         # Vitest unit tests (loading, success, error states)
        ├── index.css            # Tailwind CSS v4 styling
        ├── api/
        │   └── client.ts        # Typed API client for /api/health
        └── test/
            └── setup.ts         # Testing Library / jest-dom setup
```

---

## 3. Setup and Execution (Windows PowerShell)

> Note for Windows PowerShell: If script execution policy prevents running activation scripts (`activate.ps1`), invoke virtual environment binaries directly via their executable paths as shown below.

### A. Backend Setup & Run

1. Open PowerShell and navigate to the repository root:
   ```powershell
   cd "C:\Users\SK MD Rijooan Hasan\Desktop\SAP"
   ```

2. Create the Python virtual environment:
   ```powershell
   python -m venv "backend\.venv"
   ```

3. Install development and runtime dependencies:
   ```powershell
   & "backend\.venv\Scripts\python.exe" -m pip install --upgrade pip
   & "backend\.venv\Scripts\python.exe" -m pip install -r "backend\requirements-dev.txt"
   ```

4. Create local environment configuration:
   ```powershell
   Copy-Item "backend\.env.example" "backend\.env"
   ```

5. Run the FastAPI development server:
   ```powershell
   & "backend\.venv\Scripts\python.exe" -m uvicorn app.main:app --app-dir backend --reload --port 8000
   ```
   *The backend will be accessible at: `http://localhost:8000` (API docs at `/docs`, health check at `/api/health`).*

---

### B. Frontend Setup & Run

1. Open a new PowerShell terminal and navigate to the frontend directory:
   ```powershell
   cd "C:\Users\SK MD Rijooan Hasan\Desktop\SAP\frontend"
   ```

2. Install dependencies:
   ```powershell
   npm install
   ```

3. Run the Vite development server:
   ```powershell
   npm run dev
   ```
   *The frontend will be accessible at: `http://localhost:5173`. Requests to `/api/*` are automatically proxied to the backend at `http://localhost:8000`.*

---

## 4. Running Tests and Builds

### Run Backend Tests (pytest)
From repository root:
```powershell
& "backend\.venv\Scripts\python.exe" -m pytest "backend\tests" -v
```

### Run Frontend Tests (Vitest)
From `frontend/` directory:
```powershell
npm test
```

### Build Frontend Production Bundle
From `frontend/` directory:
```powershell
npm run build
```

---

## 5. Security & Credentials
- No secrets, tokens, or live credentials exist or are required in this phase.
- `.env` files are excluded in `.gitignore`; only `.env.example` is committed to version control.
