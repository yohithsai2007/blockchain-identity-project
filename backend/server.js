const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');

const { db, initDatabase, logAudit } = require('./database');
const { authenticateToken, requireRole, JWT_SECRET } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 10000;
const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || 'http://127.0.0.1:5001';

// Initialize DB schema & seed data
initDatabase();

// Middleware
// 1. Allow requests from your Vercel frontend (and localhost)
app.use(cors({
    origin: '*',
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint for uptime monitors (Keep Render Awake)
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', service: 'node-backend', timestamp: new Date().toISOString() });
});

// Serve frontend static files
app.use(express.static(path.resolve(__dirname, '../frontend')));

// Upload configuration for verification file uploads
const upload = multer({
    dest: path.resolve(__dirname, '../storage/temp_uploads/'),
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Ensure directories exist
fs.mkdirSync(path.resolve(__dirname, '../storage/temp_uploads/'), { recursive: true });
fs.mkdirSync(path.resolve(__dirname, '../storage/certificates/'), { recursive: true });

// Rate Limiting to prevent brute force / DDoS simulation
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    message: { error: 'Too many login attempts, please try again after 15 minutes' }
});

const apiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 500,
    message: { error: 'Rate limit exceeded, please slow down requests' }
});

app.use('/api/', apiLimiter);

// ----------------------------------------------------
// AUTHENTICATION ROUTES
// ----------------------------------------------------

app.post('/api/auth/login', authLimiter, (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
    }

    db.get('SELECT * FROM users WHERE username = ? OR email = ?', [username, username], (err, user) => {
        if (err || !user) {
            logAudit('LOGIN_FAILED', username, req.ip, { reason: 'User not found' }, 'FAILURE');
            return res.status(401).json({ error: 'Invalid username or password' });
        }

        const validPassword = bcrypt.compareSync(password, user.password_hash);
        if (!validPassword) {
            logAudit('LOGIN_FAILED', username, req.ip, { reason: 'Incorrect password' }, 'FAILURE');
            return res.status(401).json({ error: 'Invalid username or password' });
        }

        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role, fullName: user.full_name },
            JWT_SECRET,
            { expiresIn: '8h' }
        );

        logAudit('LOGIN_SUCCESS', user.username, req.ip, { role: user.role }, 'SUCCESS');

        res.json({
            message: 'Login successful',
            token,
            user: {
                id: user.id,
                username: user.username,
                role: user.role,
                fullName: user.full_name,
                email: user.email
            }
        });
    });
});

// Citizen Registration / Signup Route
app.post('/api/auth/register', authLimiter, (req, res) => {
    let { full_name, username, email, password } = req.body;

    if (!full_name || !username || !email || !password) {
        return res.status(400).json({ error: 'All fields (Full Name, Username, Email, Password) are required.' });
    }

    full_name = full_name.trim();
    username = username.trim().toLowerCase();
    email = email.trim().toLowerCase();

    // Validate username (letters, numbers, underscores, min 3 chars)
    if (!/^[a-zA-Z0-9_]{3,30}$/.test(username)) {
        return res.status(400).json({ error: 'Username must be between 3 and 30 characters and can only contain letters, numbers, and underscores.' });
    }

    // Validate email
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'Please provide a valid email address.' });
    }

    // Validate password
    if (password.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
    }

    // Check if username or email already exists
    db.get('SELECT id, username, email FROM users WHERE username = ? OR email = ?', [username, email], (err, existing) => {
        if (err) {
            return res.status(500).json({ error: 'Database check failed: ' + err.message });
        }

        if (existing) {
            if (existing.username.toLowerCase() === username) {
                return res.status(409).json({ error: 'Username is already taken. Please choose another username.' });
            }
            if (existing.email.toLowerCase() === email) {
                return res.status(409).json({ error: 'Email address is already registered. Please sign in or use a different email.' });
            }
        }

        const password_hash = bcrypt.hashSync(password, 10);

        const stmt = db.prepare('INSERT INTO users (username, email, password_hash, role, full_name) VALUES (?, ?, ?, "citizen", ?)');
        stmt.run(username, email, password_hash, full_name, function(insertErr) {
            if (insertErr) {
                return res.status(500).json({ error: 'Failed to create citizen account: ' + insertErr.message });
            }

            const newUserId = this.lastID;
            logAudit('CITIZEN_REGISTRATION', username, req.ip, { userId: newUserId, email, fullName: full_name }, 'SUCCESS');

            const token = jwt.sign(
                { id: newUserId, username, role: 'citizen', fullName: full_name },
                JWT_SECRET,
                { expiresIn: '8h' }
            );

            res.status(201).json({
                message: 'Citizen account registered successfully!',
                token,
                user: {
                    id: newUserId,
                    username,
                    role: 'citizen',
                    fullName: full_name,
                    email
                }
            });
        });
        stmt.finalize();
    });
});

app.post('/api/auth/signup', (req, res, next) => {
    req.url = '/api/auth/register';
    app.handle(req, res, next);
});

app.get('/api/auth/me', authenticateToken, (req, res) => {
    res.json({ user: req.user });
});

// List citizens for government issuance dropdown
app.get('/api/citizens', authenticateToken, requireRole('admin'), (req, res) => {
    db.all('SELECT id, username, full_name, email FROM users WHERE role = "citizen"', (err, rows) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json({ citizens: rows });
    });
});

// ----------------------------------------------------
// GOVERNMENT ROUTES (Admin only)
// ----------------------------------------------------

app.post('/api/certificates/issue', authenticateToken, requireRole('admin'), upload.single('certificate_file'), async (req, res) => {
    const { citizen_id, certificate_type, remarks } = req.body;

    if (!citizen_id || !certificate_type) {
        if (req.file) fs.unlink(req.file.path, () => {});
        return res.status(400).json({ error: 'Citizen and Certificate Type are required' });
    }

    // Lookup Citizen Details
    db.get('SELECT * FROM users WHERE id = ? AND role = "citizen"', [citizen_id], async (err, citizen) => {
        if (err || !citizen) {
            if (req.file) fs.unlink(req.file.path, () => {});
            return res.status(404).json({ error: 'Citizen not found' });
        }

        // Generate non-identifying Unique Certificate ID
        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const randomHex = Math.random().toString(36).substring(2, 7).toUpperCase();
        const cert_id = `GOV-${dateStr}-${randomHex}`;
        const issue_date = new Date().toISOString().split('T')[0];

        try {
            let response;
            if (req.file) {
                // If official document was uploaded by government
                const fileBytes = fs.readFileSync(req.file.path);
                const formData = new FormData();
                const blob = new Blob([fileBytes], { type: req.file.mimetype || 'application/pdf' });
                formData.append('file', blob, `${cert_id}.pdf`);
                formData.append('certificate_id', cert_id);
                formData.append('certificate_type', certificate_type);
                formData.append('recipient_name', citizen.full_name);
                formData.append('citizen_identifier', citizen.username);
                formData.append('issue_date', issue_date);

                response = await fetch(`${PYTHON_SERVICE_URL}/issue-certificate`, {
                    method: 'POST',
                    body: formData
                });
                fs.unlink(req.file.path, () => {});
            } else {
                // Forward standard issuance to Python Blockchain Service
                response = await fetch(`${PYTHON_SERVICE_URL}/issue-certificate`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        certificate_id: cert_id,
                        certificate_type,
                        recipient_name: citizen.full_name,
                        citizen_identifier: citizen.username,
                        issue_date,
                        details: { remarks }
                    })
                });
            }

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Python service failed');
            }

            const pyResult = await response.json();

            // Store certificate record in SQLite
            const stmt = db.prepare(`
                INSERT INTO certificates (
                    certificate_id, citizen_id, citizen_name, certificate_type,
                    file_location, certificate_hash, signature, issuer_key_id, issue_date
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

            stmt.run(
                cert_id,
                citizen.id,
                citizen.full_name,
                certificate_type,
                pyResult.pdf_path,
                pyResult.certificate_hash,
                pyResult.signature,
                pyResult.issuer_key_id,
                issue_date,
                function (dbErr) {
                    if (dbErr) {
                        logAudit('CERTIFICATE_ISSUE_FAILED', req.user.username, req.ip, { cert_id, error: dbErr.message }, 'FAILURE');
                        return res.status(500).json({ error: 'Database record failed' });
                    }

                    logAudit('CERTIFICATE_ISSUED', req.user.username, req.ip, {
                        cert_id,
                        citizen: citizen.username,
                        block_number: pyResult.block.block_number
                    }, 'SUCCESS');

                    res.status(201).json({
                        message: 'Certificate issued and recorded onto blockchain successfully',
                        certificate: {
                            id: this.lastID,
                            certificate_id: cert_id,
                            citizen_name: citizen.full_name,
                            certificate_type,
                            certificate_hash: pyResult.certificate_hash,
                            signature: pyResult.signature,
                            block: pyResult.block
                        }
                    });
                }
            );
            stmt.finalize();
        } catch (error) {
            logAudit('CERTIFICATE_ISSUE_ERROR', req.user.username, req.ip, { error: error.message }, 'FAILURE');
            res.status(502).json({ error: 'Failed to communicate with Python blockchain service: ' + error.message });
        }
    });
});

app.get('/api/certificates/issued', authenticateToken, requireRole('admin'), (req, res) => {
    db.all(`
        SELECT id, certificate_id, certificate_type, issue_date, citizen_name, certificate_hash, status, revocation_reason, revocation_date, created_at
        FROM certificates
        ORDER BY id DESC
    `, (err, rows) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json({ certificates: rows });
    });
});

// Revoke a certificate on the Blockchain (Admin only)
app.post('/api/certificates/revoke/:id', authenticateToken, requireRole('admin'), async (req, res) => {
    const certId = req.params.id;
    const { reason } = req.body;

    db.get('SELECT c.*, u.username as citizen_username FROM certificates c LEFT JOIN users u ON c.citizen_id = u.id WHERE c.certificate_id = ? OR c.id = ?', [certId, certId], async (err, cert) => {
        if (err || !cert) {
            return res.status(404).json({ error: 'Certificate record not found' });
        }

        if (cert.status === 'REVOKED') {
            return res.status(400).json({ error: 'Certificate is already revoked' });
        }

        const revocationReason = reason || 'Revoked by Government Authority';

        try {
            // Forward revocation to Python Blockchain Service
            const response = await fetch(`${PYTHON_SERVICE_URL}/revoke-certificate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    certificate_id: cert.certificate_id,
                    citizen_identifier: cert.citizen_username,
                    reason: revocationReason
                })
            });

            if (!response.ok) {
                const pyErr = await response.json();
                throw new Error(pyErr.error || 'Failed to record revocation on blockchain');
            }

            const pyResult = await response.json();

            // Update SQLite status
            db.run(
                'UPDATE certificates SET status = "REVOKED", revocation_reason = ?, revocation_date = CURRENT_TIMESTAMP WHERE certificate_id = ?',
                [revocationReason, cert.certificate_id],
                function(dbErr) {
                    if (dbErr) return res.status(500).json({ error: 'Failed to update database status' });

                    logAudit('CERTIFICATE_REVOKED', req.user.username, req.ip, {
                        cert_id: cert.certificate_id,
                        citizen: cert.citizen_username,
                        reason: revocationReason,
                        block_number: pyResult.block_number
                    }, 'SUCCESS');

                    res.json({
                        message: `Document ${cert.certificate_id} has been officially REVOKED on the blockchain`,
                        revocation: pyResult
                    });
                }
            );
        } catch (e) {
            logAudit('CERTIFICATE_REVOCATION_FAILED', req.user.username, req.ip, { cert_id: cert.certificate_id, error: e.message }, 'FAILURE');
            res.status(502).json({ error: 'Blockchain service error: ' + e.message });
        }
    });
});

app.get('/api/admin/audit-logs', authenticateToken, requireRole('admin'), (req, res) => {
    db.all('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 50', (err, rows) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json({ logs: rows });
    });
});

// ----------------------------------------------------
// CITIZEN ROUTES (Citizen only)
// ----------------------------------------------------

// Submit a new certificate application/request
app.post('/api/citizen/apply', authenticateToken, requireRole('citizen'), (req, res) => {
    const {
        certificate_type, full_name, phone_number, email,
        date_of_birth, state_region, father_name, address,
        id_number_hint, purpose, details
    } = req.body;

    if (!certificate_type) {
        return res.status(400).json({ error: 'Identity Document / Certificate Type is required' });
    }

    const applicantName = (full_name && full_name.trim()) || req.user.fullName;
    const applicantEmail = (email && email.trim()) || req.user.email || '';
    const applicantPhone = (phone_number && phone_number.trim()) || '';
    const applicantDob = (date_of_birth && date_of_birth.trim()) || '';
    const applicantState = (state_region && state_region.trim()) || '';
    const applicantFather = (father_name && father_name.trim()) || '';
    const applicantAddress = (address && address.trim()) || '';
    const applicantIdHint = (id_number_hint && id_number_hint.trim()) || '';

    const stmt = db.prepare(`
        INSERT INTO certificate_requests (
            citizen_id, citizen_name, phone_number, email,
            date_of_birth, state_region, father_name, address, id_number_hint,
            certificate_type, purpose, details, status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')
    `);

    stmt.run(
        req.user.id,
        applicantName,
        applicantPhone,
        applicantEmail,
        applicantDob,
        applicantState,
        applicantFather,
        applicantAddress,
        applicantIdHint,
        certificate_type,
        purpose || '',
        details || '',
        function(err) {
            if (err) {
                return res.status(500).json({ error: 'Failed to submit application: ' + err.message });
            }
            logAudit('CERTIFICATE_REQUEST_SUBMITTED', req.user.username, req.ip, {
                requestId: this.lastID,
                certificate_type,
                phone: applicantPhone
            }, 'SUCCESS');

            res.status(201).json({
                message: 'Application submitted successfully to Government Authority',
                request: {
                    id: this.lastID,
                    citizen_name: applicantName,
                    certificate_type,
                    status: 'PENDING'
                }
            });
        }
    );
    stmt.finalize();
});

// View citizen's own requests
app.get('/api/citizen/my-requests', authenticateToken, requireRole('citizen'), (req, res) => {
    db.all(`
        SELECT id, certificate_type, citizen_name, phone_number, email, date_of_birth, state_region,
               father_name, address, id_number_hint, purpose, details, status, rejection_reason, certificate_id, created_at, updated_at
        FROM certificate_requests
        WHERE citizen_id = ?
        ORDER BY id DESC
    `, [req.user.id], (err, rows) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json({ requests: rows });
    });
});

app.get('/api/citizen/my-certificates', authenticateToken, requireRole('citizen'), (req, res) => {
    db.all(`
        SELECT id, certificate_id, certificate_type, issue_date, certificate_hash, signature, created_at
        FROM certificates
        WHERE citizen_id = ?
        ORDER BY id DESC
    `, [req.user.id], (err, rows) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json({ certificates: rows });
    });
});

// Authenticated certificate download & in-browser preview (Citizen & Admin)
app.get('/api/certificates/download/:id', authenticateToken, (req, res) => {
    const certId = req.params.id;
    const isInline = req.query.inline === 'true';

    db.get('SELECT * FROM certificates WHERE certificate_id = ? OR id = ?', [certId, certId], (err, cert) => {
        if (err || !cert) {
            return res.status(404).json({ error: 'Certificate not found' });
        }

        // Access check: Admin or the owner Citizen
        if (req.user.role !== 'admin' && req.user.id !== cert.citizen_id) {
            logAudit('UNAUTHORIZED_DOWNLOAD_ATTEMPT', req.user.username, req.ip, { cert_id: cert.certificate_id }, 'FAILURE');
            return res.status(403).json({ error: 'You are not authorized to access this certificate' });
        }

        if (!fs.existsSync(cert.file_location)) {
            return res.status(404).json({ error: 'Certificate file missing on disk' });
        }

        const dispositionType = isInline ? 'inline' : 'attachment';
        logAudit(isInline ? 'CERTIFICATE_PREVIEWED' : 'CERTIFICATE_DOWNLOADED', req.user.username, req.ip, { cert_id: cert.certificate_id }, 'SUCCESS');
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `${dispositionType}; filename="${cert.certificate_id}.pdf"`);
        const fileStream = fs.createReadStream(cert.file_location);
        fileStream.pipe(res);
    });
});

// ----------------------------------------------------
// GOVERNMENT REQUEST MANAGEMENT ROUTES (Admin only)
// ----------------------------------------------------

// List all citizen requests with filtering options
app.get('/api/admin/requests', authenticateToken, requireRole('admin'), (req, res) => {
    const statusFilter = req.query.status; // Optional: PENDING, APPROVED, REJECTED
    let query = `
        SELECT r.id, r.citizen_id, r.citizen_name, r.phone_number, r.email,
               r.date_of_birth, r.state_region, r.father_name, r.address, r.id_number_hint,
               r.certificate_type, r.purpose, r.details,
               r.status, r.rejection_reason, r.certificate_id, r.created_at, r.updated_at,
               u.email as citizen_account_email
        FROM certificate_requests r
        LEFT JOIN users u ON r.citizen_id = u.id
    `;
    const params = [];
    if (statusFilter && ['PENDING', 'APPROVED', 'REJECTED'].includes(statusFilter.toUpperCase())) {
        query += ` WHERE r.status = ? `;
        params.push(statusFilter.toUpperCase());
    }
    query += ` ORDER BY CASE WHEN r.status = 'PENDING' THEN 1 ELSE 2 END, r.id DESC `;

    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: 'Database error: ' + err.message });
        res.json({ requests: rows });
    });
});

// Reject an application
app.post('/api/admin/requests/:id/reject', authenticateToken, requireRole('admin'), (req, res) => {
    const requestId = req.params.id;
    const { reason } = req.body;

    db.run(
        'UPDATE certificate_requests SET status = "REJECTED", rejection_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [reason || 'Application rejected by authority', requestId],
        function(err) {
            if (err) return res.status(500).json({ error: 'Database error' });
            logAudit('CERTIFICATE_REQUEST_REJECTED', req.user.username, req.ip, { requestId, reason }, 'SUCCESS');
            res.json({ message: 'Request rejected successfully' });
        }
    );
});

// Approve application & issue certificate onto blockchain
app.post('/api/admin/requests/:id/approve', authenticateToken, requireRole('admin'), async (req, res) => {
    const requestId = req.params.id;
    const { remarks } = req.body;

    db.get('SELECT * FROM certificate_requests WHERE id = ?', [requestId], async (err, requestRow) => {
        if (err || !requestRow) {
            return res.status(404).json({ error: 'Request not found' });
        }

        if (requestRow.status !== 'PENDING') {
            return res.status(400).json({ error: `Request already processed (Status: ${requestRow.status})` });
        }

        db.get('SELECT * FROM users WHERE id = ?', [requestRow.citizen_id], async (uErr, citizen) => {
            if (uErr || !citizen) {
                return res.status(404).json({ error: 'Applicant citizen record not found' });
            }

            const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
            const randomHex = Math.random().toString(36).substring(2, 7).toUpperCase();
            const cert_id = `GOV-${dateStr}-${randomHex}`;
            const issue_date = new Date().toISOString().split('T')[0];

            try {
                // Call Python service to generate PDF, sign, hash and anchor into citizen's block
                const response = await fetch(`${PYTHON_SERVICE_URL}/issue-certificate`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        certificate_id: cert_id,
                        certificate_type: requestRow.certificate_type,
                        recipient_name: citizen.full_name,
                        citizen_identifier: citizen.username,
                        issue_date,
                        details: {
                            phone_number: requestRow.phone_number,
                            email: requestRow.email || citizen.email,
                            date_of_birth: requestRow.date_of_birth,
                            state_region: requestRow.state_region,
                            father_name: requestRow.father_name,
                            address: requestRow.address,
                            id_number_hint: requestRow.id_number_hint,
                            remarks: remarks || requestRow.purpose || requestRow.details,
                            application_id: requestRow.id
                        }
                    })
                });

                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.error || 'Python service failed');
                }

                const pyResult = await response.json();

                // Save to certificates table
                const stmt = db.prepare(`
                    INSERT INTO certificates (
                        certificate_id, citizen_id, citizen_name, certificate_type,
                        file_location, certificate_hash, signature, issuer_key_id, issue_date
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `);

                stmt.run(
                    cert_id,
                    citizen.id,
                    citizen.full_name,
                    requestRow.certificate_type,
                    pyResult.pdf_path,
                    pyResult.certificate_hash,
                    pyResult.signature,
                    pyResult.issuer_key_id,
                    issue_date,
                    function(insErr) {
                        if (insErr) {
                            return res.status(500).json({ error: 'Failed to record certificate: ' + insErr.message });
                        }

                        // Mark request as APPROVED
                        db.run(
                            'UPDATE certificate_requests SET status = "APPROVED", certificate_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                            [cert_id, requestId]
                        );

                        logAudit('CERTIFICATE_REQUEST_APPROVED_AND_ISSUED', req.user.username, req.ip, {
                            requestId,
                            cert_id,
                            citizen: citizen.username,
                            block_number: pyResult.block.block_number
                        }, 'SUCCESS');

                        res.json({
                            message: 'Application approved and Certificate issued to blockchain successfully!',
                            certificate: {
                                certificate_id: cert_id,
                                citizen_name: citizen.full_name,
                                certificate_type: requestRow.certificate_type,
                                certificate_hash: pyResult.certificate_hash,
                                signature: pyResult.signature,
                                block: pyResult.block
                            }
                        });
                    }
                );
                stmt.finalize();
            } catch (pErr) {
                logAudit('CERTIFICATE_APPROVAL_FAILED', req.user.username, req.ip, { error: pErr.message }, 'FAILURE');
                res.status(502).json({ error: 'Blockchain service error: ' + pErr.message });
            }
        });
    });
});

// ----------------------------------------------------
// EMPLOYER / PUBLIC VERIFICATION ROUTES
// ----------------------------------------------------

app.post('/api/verify', upload.single('certificate_file'), async (req, res) => {
    const certId = req.body.certificate_id;
    const certHash = req.body.certificate_hash;
    let signature = req.body.signature;

    // Mode 1: Public Hash or Certificate ID lookup (no file upload required)
    if (!req.file) {
        if (!certHash && !certId) {
            return res.status(400).json({ error: 'Please provide either a Certificate PDF file, a Public SHA-256 Hash, or a Certificate ID.' });
        }

        try {
            const response = await fetch(`${PYTHON_SERVICE_URL}/verify-certificate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    certificate_hash: certHash,
                    certificate_id: certId
                })
            });

            const verifyResult = await response.json();
            const userIdentifier = req.user ? req.user.username : 'GUEST_VERIFIER';
            logAudit('HASH_VERIFICATION_ATTEMPT', userIdentifier, req.ip, {
                hash: certHash || 'N/A',
                cert_id: certId || 'N/A',
                result: verifyResult.final_result
            }, verifyResult.status === 'VERIFIED' ? 'SUCCESS' : 'FLAGGED');

            return res.json(verifyResult);
        } catch (err) {
            return res.status(502).json({ error: 'Communication error with verification service: ' + err.message });
        }
    }

    // Mode 2: Full Document File Audit
    const filePath = req.file.path;

    // Auto-fetch signature if not provided
    if (!signature && certId) {
        const row = await new Promise((resolve) => {
            db.get('SELECT signature FROM certificates WHERE certificate_id = ?', [certId], (err, r) => resolve(r));
        });
        if (row) signature = row.signature;
    }

    try {
        const fileBytes = fs.readFileSync(filePath);
        const formData = new FormData();
        const blob = new Blob([fileBytes], { type: 'application/pdf' });
        formData.append('file', blob, req.file.originalname);
        if (signature) formData.append('signature', signature);
        if (certId) formData.append('certificate_id', certId);

        const response = await fetch(`${PYTHON_SERVICE_URL}/verify-certificate`, {
            method: 'POST',
            body: formData
        });

        fs.unlink(filePath, () => {});

        if (!response.ok) {
            const errData = await response.json();
            return res.status(400).json({ error: errData.error || 'Verification failed' });
        }

        const verifyResult = await response.json();
        const userIdentifier = req.user ? req.user.username : 'GUEST_EMPLOYER';
        logAudit('FILE_VERIFICATION_ATTEMPT', userIdentifier, req.ip, {
            cert_id: certId || 'UNKNOWN',
            result: verifyResult.final_result,
            status: verifyResult.status
        }, verifyResult.status === 'VERIFIED' ? 'SUCCESS' : 'FLAGGED');

        res.json(verifyResult);
    } catch (err) {
        fs.unlink(filePath, () => {});
        res.status(502).json({ error: 'Communication error with verification service: ' + err.message });
    }
});

// Trusted Government Public Key Route
app.get('/api/trusted-key', async (req, res) => {
    try {
        const response = await fetch(`${PYTHON_SERVICE_URL}/keys/public`);
        const data = await response.json();
        res.json(data);
    } catch (err) {
        res.status(502).json({ error: 'Failed to retrieve public key: ' + err.message });
    }
});

// Internal Blockchain Status API (Strictly Government Admin Only)
app.get('/api/blockchain/status', authenticateToken, requireRole('admin'), async (req, res) => {
    try {
        const [blocksRes, valRes] = await Promise.all([
            fetch(`${PYTHON_SERVICE_URL}/blockchain/blocks`),
            fetch(`${PYTHON_SERVICE_URL}/blockchain/validate`)
        ]);
        const blocksData = await blocksRes.json();
        const valData = await valRes.json();
        res.json({
            blocks: blocksData.blocks,
            total_blocks: blocksData.total,
            validation: valData
        });
    } catch (err) {
        res.status(502).json({ error: 'Failed to contact blockchain service: ' + err.message });
    }
});

// Tamper test endpoint for security demonstration
app.post('/api/security/tamper-test', authenticateToken, requireRole('admin'), async (req, res) => {
    try {
        const response = await fetch(`${PYTHON_SERVICE_URL}/blockchain/tamper-test`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(req.body)
        });
        const data = await response.json();
        res.json(data);
    } catch (err) {
        res.status(502).json({ error: err.message });
    }
});

// Fallback to index.html
app.get('*', (req, res) => {
    res.sendFile(path.resolve(__dirname, '../frontend/index.html'));
});

// Start Server on 0.0.0.0 for Render / Docker
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Node Backend running on port ${PORT}`);
});
