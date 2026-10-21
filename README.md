# Blockchain-Based Secure Verification of Government-Issued Digital Certificates

An end-to-end web system allowing the government to issue digitally signed certificates and anchor their cryptographic SHA-256 digests onto an immutable Python blockchain. Employers and institutions can independently verify authenticity without manual phone calls or issuing office verification.

---

## 🌟 Architecture & Key Features

| Role / Feature | Technology | Capabilities |
| :--- | :--- | :--- |
| **Government Admin** | Node.js + Python | Log in securely, generate official certificates, digitally sign with RSA-2048 private key, anchor SHA-256 digest to blockchain. |
| **Citizen Portal** | HTML5 + Node.js | Log in, view issued certificates, download tamper-evident official PDFs. |
| **Employer Verifier** | Express + Python | Upload applicant PDFs, independently audit RSA digital signatures & recalculate SHA-256 hash against blockchain blocks. |
| **Security & Tamper Center** | Python + SQLite | Real-time audit logs, block explorer, and interactive attack simulation to prove tampering detection. |

---

## 📁 Project Directory Structure

```
cert-chain-project/
├── backend/
│   ├── middleware/
│   │   └── auth.js              # JWT & Role-based authentication
│   ├── database.js              # SQLite database (Users, Certificates, Audit Logs)
│   ├── server.js                # Express API gateway & Python proxy
│   └── package.json             # Node dependencies
├── python-service/
│   ├── app.py                   # Flask REST microservice
│   ├── blockchain.py            # Custom Python Blockchain engine with SQLite persistence
│   ├── hashing.py               # SHA-256 binary hashing
│   ├── signatures.py            # RSA-2048 keypair generation & PSS digital signatures
│   ├── pdf_generator.py         # ReportLab official PDF generator
│   └── requirements.txt         # Python dependencies
├── frontend/
│   ├── css/style.css            # Modern styling & responsive design
│   ├── js/app.js                # Client auth state & API handler
│   ├── index.html               # Public portal landing page
│   ├── login.html               # Role-based login page
│   ├── government.html          # Government Admin issuance console
│   ├── citizen.html             # Citizen locker & download dashboard
│   ├── employer.html            # Employer verification tool
│   └── security.html            # Security center & tamper attack simulation
├── storage/
│   ├── certificates/            # Off-chain physical PDF storage
│   ├── data/                    # SQLite database files (app.db & blockchain.db)
│   └── keys/                    # RSA private & public keys
├── DEPLOYMENT_GUIDE.md          # 24/7 VPS hosting manual (Ubuntu + Nginx + HTTPS)
└── run_system.bat               # 1-Click Windows launcher script
```

---

## 🚀 How to Run Locally

### Option 1: 1-Click Launcher (Windows)
Double-click [`run_system.bat`](file:///C:/Users/P%20Yohith%20Sai/.gemini/antigravity/scratch/cert-chain-project/run_system.bat). This will:
1. Start the Python Blockchain node on port `5001`.
2. Start the Node.js Express backend on port `3000`.
3. Open your browser directly to `http://localhost:3000`.

### Option 2: Manual Terminal Startup

1. **Start Python Blockchain Service**:
   ```powershell
   cd python-service
   ..\venv\Scripts\python.exe app.py
   ```
2. **Start Node.js Backend**:
   ```powershell
   cd backend
   node server.js
   ```
3. **Open in Browser**:
   Navigate to [http://localhost:3000](http://localhost:3000).

---

## 🔑 Demo Login Accounts

| Role | Username | Password | Notes |
| :--- | :--- | :--- | :--- |
| **Government Admin** | `gov_admin` | `admin123` | Can issue certificates & view audit logs |
| **Citizen (Rahul)** | `citizen_rahul` | `citizen123` | Can view and download personal certificates |
| **Citizen (Priya)** | `citizen_priya` | `citizen123` | Can view personal certificates |
| **Employer** | `tech_corp` | `employer123` | Independent verification portal access |

---

## 🧪 Testing the Complete Workflow

1. **Issue Certificate**:
   - Log in as `gov_admin` / `admin123` at `http://localhost:3000/login.html`.
   - Select citizen **Rahul Sharma** and click **Sign & Anchor to Blockchain**.
2. **Download as Citizen**:
   - Log in as `citizen_rahul` / `citizen123` at `http://localhost:3000/citizen.html`.
   - Download the issued PDF certificate.
3. **Verify as Employer**:
   - Open `http://localhost:3000/employer.html`.
   - Upload the downloaded PDF.
   - Result: `CERTIFICATE VERIFIED` with Government Signature `VALID` and Hash `MATCH`.
4. **Simulate Tampering (Attack Detection)**:
   - Edit even a single letter in the PDF using a text editor or hex tool.
   - Re-upload to the verification tool.
   - Result: `CERTIFICATE REJECTED (Hash Mismatch - Document Modified)`.
