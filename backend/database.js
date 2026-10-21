const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = path.resolve(__dirname, '../storage/data/app.db');

const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('Failed to connect to SQLite database:', err.message);
    } else {
        console.log('Connected to SQLite application database at:', DB_PATH);
    }
});

function initDatabase() {
    db.serialize(() => {
        // Users Table
        db.run(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('admin', 'citizen', 'employer')),
                full_name TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Certificates Table
        db.run(`
            CREATE TABLE IF NOT EXISTS certificates (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                certificate_id TEXT UNIQUE NOT NULL,
                citizen_id INTEGER NOT NULL,
                citizen_name TEXT NOT NULL,
                certificate_type TEXT NOT NULL,
                file_location TEXT NOT NULL,
                certificate_hash TEXT NOT NULL,
                signature TEXT NOT NULL,
                issuer_key_id TEXT NOT NULL,
                issue_date TEXT NOT NULL,
                status TEXT DEFAULT 'ACTIVE',
                revocation_reason TEXT,
                revocation_date TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (citizen_id) REFERENCES users(id)
            )
        `);

        // Migration safe check for existing database
        db.run("ALTER TABLE certificates ADD COLUMN status TEXT DEFAULT 'ACTIVE'", () => {});
        db.run("ALTER TABLE certificates ADD COLUMN revocation_reason TEXT", () => {});
        db.run("ALTER TABLE certificates ADD COLUMN revocation_date TEXT", () => {});

        // Certificate Applications / Requests Table
        db.run(`
            CREATE TABLE IF NOT EXISTS certificate_requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                citizen_id INTEGER NOT NULL,
                citizen_name TEXT NOT NULL,
                phone_number TEXT,
                email TEXT,
                date_of_birth TEXT,
                state_region TEXT,
                father_name TEXT,
                address TEXT,
                id_number_hint TEXT,
                certificate_type TEXT NOT NULL,
                purpose TEXT,
                details TEXT,
                status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'APPROVED', 'REJECTED')),
                rejection_reason TEXT,
                certificate_id TEXT,
                ekyc_verified INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (citizen_id) REFERENCES users(id)
            )
        `);

        db.run("ALTER TABLE certificate_requests ADD COLUMN ekyc_verified INTEGER DEFAULT 0", () => {});

        // Audit Logs Table
        db.run(`
            CREATE TABLE IF NOT EXISTS audit_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_type TEXT NOT NULL,
                user_identifier TEXT,
                ip_address TEXT,
                details TEXT,
                outcome TEXT NOT NULL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Seed initial demo users if not present
        db.get('SELECT COUNT(*) as count FROM users', (err, row) => {
            if (!err && row.count === 0) {
                console.log('Seeding initial demo users...');
                const salt = bcrypt.genSaltSync(10);
                const govPass = bcrypt.hashSync('admin123', salt);
                const citizenPass = bcrypt.hashSync('citizen123', salt);
                const employerPass = bcrypt.hashSync('employer123', salt);

                const stmt = db.prepare('INSERT INTO users (username, email, password_hash, role, full_name) VALUES (?, ?, ?, ?, ?)');
                stmt.run('gov_admin', 'admin@gov.in', govPass, 'admin', 'Government Administrator');
                stmt.run('citizen_rahul', 'rahul@citizen.in', citizenPass, 'citizen', 'Rahul Sharma');
                stmt.run('citizen_priya', 'priya@citizen.in', citizenPass, 'citizen', 'Priya Patel');
                stmt.run('tech_corp', 'hr@techcorp.com', employerPass, 'employer', 'TechCorp HR Solutions');
                stmt.finalize();
                console.log('Demo users seeded successfully!');
            }
        });
    });
}

function logAudit(eventType, userIdentifier, ipAddress, details, outcome) {
    db.run(
        'INSERT INTO audit_logs (event_type, user_identifier, ip_address, details, outcome) VALUES (?, ?, ?, ?, ?)',
        [eventType, userIdentifier || 'ANONYMOUS', ipAddress || 'UNKNOWN', JSON.stringify(details || {}), outcome]
    );
}

module.exports = {
    db,
    initDatabase,
    logAudit
};
