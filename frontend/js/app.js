// Shared frontend client utilities
// Automatically points to remote Render backend if deployed on Vercel, or local origin if co-hosted
const BACKEND_URL = window.BACKEND_API_URL || localStorage.getItem('BACKEND_API_URL') || '';
const API_BASE = `${BACKEND_URL}/api`;
window.API_BASE = API_BASE;

function getToken() {
  return localStorage.getItem('token');
}

function getUser() {
  const user = localStorage.getItem('user');
  return user ? JSON.parse(user) : null;
}

function setAuth(token, user) {
  localStorage.setItem('token', token);
  localStorage.setItem('user', JSON.stringify(user));
}

function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  window.location.href = '/login.html';
}

async function apiRequest(endpoint, options = {}) {
  const headers = options.headers || {};
  const token = getToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  if (options.body && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }

  const targetUrl = `${API_BASE}${endpoint}`;
  let response;
  try {
    response = await fetch(targetUrl, {
      ...options,
      headers
    });
  } catch (netErr) {
    throw new Error(`Cannot connect to Backend (${targetUrl}). Please ensure your backend server is running.`);
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Endpoint not found (404) at ${targetUrl}. Please ensure your Render backend URL is configured.`);
    }
    if (response.status === 502 || response.status === 503) {
      throw new Error('Render backend is currently waking up (cold start). Please wait ~25 seconds and try again.');
    }
    throw new Error(data.error || `Server responded with status ${response.status}`);
  }
  return data;
}

function updateNav() {
  const user = getUser();
  const navUser = document.getElementById('nav-user');
  const navLinks = document.querySelector('.nav-links');

  if (navLinks) {
    // Generate role-strict navbar links
    let linksHtml = `<a href="/" class="nav-link ${window.location.pathname === '/' || window.location.pathname === '/index.html' ? 'active' : ''}">Home</a>`;

    if (user) {
      if (user.role === 'admin') {
        const isGovPage = window.location.pathname.includes('government.html');
        const isVerifyTab = window.location.search.includes('tab=verify') || window.location.hash === '#tab-verify';
        linksHtml += `
          <a href="/government.html" class="nav-link ${isGovPage && !isVerifyTab ? 'active' : ''}">Admin Console</a>
          <a href="/government.html?tab=verify" class="nav-link ${isGovPage && isVerifyTab ? 'active' : ''}">Gov Document Verification</a>
          <a href="/security.html" class="nav-link ${window.location.pathname.includes('security.html') ? 'active' : ''}">Blockchain & Security</a>
        `;
      } else if (user.role === 'citizen') {
        linksHtml += `
          <a href="/citizen.html" class="nav-link ${window.location.pathname.includes('citizen.html') ? 'active' : ''}">Citizen Identity Services</a>
        `;
      } else if (user.role === 'employer') {
        linksHtml += `
          <a href="/employer.html" class="nav-link ${window.location.pathname.includes('employer.html') ? 'active' : ''}">Employer / Verifier Portal</a>
        `;
      }

      linksHtml += `
        <div style="display: flex; align-items: center; gap: 0.75rem; margin-left: 0.5rem;">
          <span style="font-weight: 600; font-size: 0.88rem; color: var(--primary);">${user.fullName} (${user.role.toUpperCase()})</span>
          <button onclick="logout()" class="btn btn-outline btn-sm">Logout</button>
        </div>
      `;
    } else {
      // Guest User before login - STRICT: No blockchain ledger, no verification portal
      linksHtml += `
        <a href="/login.html" class="nav-link ${window.location.pathname.includes('login.html') && !window.location.search.includes('mode=register') ? 'active' : ''}">Sign In</a>
        <a href="/login.html?mode=register" class="btn btn-primary btn-sm">Citizen Sign Up</a>
      `;
    }

    navLinks.innerHTML = linksHtml;
  }
}

// Strict Client-Side Route Protection Guard
function enforceRoutePermissions() {
  const path = window.location.pathname;
  const user = getUser();

  if (path.includes('government.html') || path.includes('security.html')) {
    if (!user || user.role !== 'admin') {
      alert('Access Restricted: Only authorized Government Officials can access the Government Console and Blockchain Ledger.');
      window.location.href = '/login.html';
    }
  } else if (path.includes('citizen.html')) {
    if (!user || user.role !== 'citizen') {
      alert('Please log in with a citizen account to access your digital locker.');
      window.location.href = '/login.html';
    }
  } else if (path.includes('employer.html')) {
    if (!user) {
      alert('Please log in to access the verification portal.');
      window.location.href = '/login.html';
    } else if (user.role === 'admin') {
      // Government admin has dedicated verification in the admin console
      window.location.href = '/government.html?tab=verify';
    } else if (user.role !== 'employer') {
      alert('Access Restricted: This tool is strictly for registered employers and independent verification agencies.');
      window.location.href = '/citizen.html';
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  enforceRoutePermissions();
  updateNav();
});

// ====================================================
// Interactive In-Browser PDF Previewer Engine
// ====================================================

let activePreviewBlobUrl = null;

function ensurePdfModalExists() {
  let modal = document.getElementById('pdf-preview-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'pdf-preview-modal';
    modal.className = 'modal-overlay';
    modal.style.display = 'none';
    modal.style.zIndex = '9999';

    modal.innerHTML = `
      <div class="pdf-modal-box">
        <div class="pdf-modal-header">
          <div style="display: flex; align-items: center; gap: 0.75rem;">
            <span style="font-size: 1.6rem;">🪪</span>
            <div>
              <h3 id="pdf-modal-title" style="margin: 0; font-size: 1.1rem; color: white;">Official Identity Document Preview</h3>
              <small id="pdf-modal-id" style="color: #93c5fd; font-family: monospace; font-size: 0.82rem;"></small>
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
            <button id="pdf-modal-download-btn" class="btn btn-sm" style="background: var(--india-green); color: white; display: inline-flex; align-items: center; gap: 0.3rem;">
              ⬇️ Save PDF
            </button>
            <button id="pdf-modal-copy-btn" class="btn btn-sm" style="background: rgba(255,255,255,0.18); color: white; border: 1px solid rgba(255,255,255,0.35); display: inline-flex; align-items: center; gap: 0.3rem;">
              📋 Copy Public Hash
            </button>
            <button onclick="closePdfPreview()" class="btn btn-sm btn-outline" style="color: white; border-color: rgba(255,255,255,0.4); background: transparent;" title="Close (Esc)">
              ✕ Close
            </button>
          </div>
        </div>

        <div class="pdf-modal-body" id="pdf-modal-body">
          <div id="pdf-modal-loading" style="display: flex; flex-direction: column; align-items: center; gap: 1rem; color: white; text-align: center; padding: 2rem;">
            <div class="spinner"></div>
            <p style="margin: 0; font-size: 0.95rem;">Retrieving & decrypting official document from server storage...</p>
          </div>
          <iframe id="pdf-modal-iframe" style="display: none; width: 100%; height: 100%; border: none;"></iframe>
        </div>

        <div class="pdf-modal-footer">
          <div style="display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap;">
            <strong>Public SHA-256 Digest:</strong>
            <span id="pdf-modal-hash" class="hash-pill" style="font-size: 0.78rem;"></span>
          </div>
          <div style="color: var(--india-green); font-weight: 600; display: flex; align-items: center; gap: 0.35rem;">
            <span>🔐</span> Cryptographically Anchored & Digitally Signed
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Close when clicking outside modal box
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closePdfPreview();
      }
    });

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal.style.display !== 'none') {
        closePdfPreview();
      }
    });
  }
  return modal;
}

async function previewCertificate(certId, certType, certHash) {
  const modal = ensurePdfModalExists();
  const titleElem = document.getElementById('pdf-modal-title');
  const idElem = document.getElementById('pdf-modal-id');
  const hashElem = document.getElementById('pdf-modal-hash');
  const loadingElem = document.getElementById('pdf-modal-loading');
  const iframe = document.getElementById('pdf-modal-iframe');
  const downloadBtn = document.getElementById('pdf-modal-download-btn');
  const copyBtn = document.getElementById('pdf-modal-copy-btn');

  // Reset view state
  titleElem.textContent = certType ? `${certType} Preview` : 'Official Certificate Preview';
  idElem.textContent = `Document ID: ${certId}`;
  hashElem.textContent = certHash || 'N/A';
  hashElem.title = certHash || '';
  loadingElem.style.display = 'flex';
  iframe.style.display = 'none';
  iframe.src = 'about:blank';
  modal.style.display = 'flex';

  // Revoke previous blob if any
  if (activePreviewBlobUrl) {
    URL.revokeObjectURL(activePreviewBlobUrl);
    activePreviewBlobUrl = null;
  }

  // Setup header buttons
  downloadBtn.onclick = () => downloadCert(certId);
  copyBtn.onclick = () => {
    if (certHash) {
      navigator.clipboard.writeText(certHash);
      const prevText = copyBtn.innerHTML;
      copyBtn.innerHTML = '✅ Copied!';
      setTimeout(() => { copyBtn.innerHTML = prevText; }, 2000);
    }
  };

  try {
    const token = getToken();
    const response = await fetch(`${API_BASE}/certificates/download/${certId}?inline=true`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      const errJson = await response.json().catch(() => ({}));
      throw new Error(errJson.error || 'Failed to stream certificate file');
    }

    const blob = await response.blob();
    activePreviewBlobUrl = URL.createObjectURL(blob);

    // Load into iframe
    iframe.src = `${activePreviewBlobUrl}#toolbar=1&navpanes=0&view=FitH`;
    iframe.onload = () => {
      loadingElem.style.display = 'none';
      iframe.style.display = 'block';
    };

    // Fallback in case iframe onload does not fire for application/pdf
    setTimeout(() => {
      loadingElem.style.display = 'none';
      iframe.style.display = 'block';
    }, 500);

  } catch (err) {
    loadingElem.innerHTML = `
      <div style="color: #fca5a5; font-size: 2.2rem; margin-bottom: 0.5rem;">⚠️</div>
      <p style="color: white; margin: 0; font-size: 0.95rem;"><strong>Preview Failed:</strong> ${err.message}</p>
      <button onclick="downloadCert('${certId}')" class="btn btn-outline btn-sm" style="color: white; border-color: rgba(255,255,255,0.4); margin-top: 1rem; background: transparent;">
        ⬇️ Download Directly Instead
      </button>
    `;
  }
}

function closePdfPreview() {
  const modal = document.getElementById('pdf-preview-modal');
  if (modal) {
    modal.style.display = 'none';
    const iframe = document.getElementById('pdf-modal-iframe');
    if (iframe) iframe.src = 'about:blank';
  }
  if (activePreviewBlobUrl) {
    URL.revokeObjectURL(activePreviewBlobUrl);
    activePreviewBlobUrl = null;
  }
}

async function downloadCert(certId) {
  try {
    const token = getToken();
    const response = await fetch(`${API_BASE}/certificates/download/${certId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to download certificate file');
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${certId}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (err) {
    alert('Download error: ' + err.message);
  }
}
