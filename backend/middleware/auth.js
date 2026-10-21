const jwt = require('jsonwebtoken');
const { logAudit } = require('../database');

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_national_blockchain_key_2026';

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = (authHeader && authHeader.split(' ')[1]) || req.query.token;

    if (!token) {
        logAudit('UNAUTHORIZED_ACCESS_ATTEMPT', 'GUEST', req.ip, { path: req.path }, 'FAILURE');
        return res.status(401).json({ error: 'Access token required' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            logAudit('INVALID_TOKEN_ATTEMPT', 'GUEST', req.ip, { path: req.path }, 'FAILURE');
            return res.status(403).json({ error: 'Token is invalid or expired' });
        }
        req.user = user;
        next();
    });
}

function requireRole(...allowedRoles) {
    return (req, res, next) => {
        if (!req.user || !allowedRoles.includes(req.user.role)) {
            logAudit('ROLE_VIOLATION_ATTEMPT', req.user ? req.user.username : 'UNKNOWN', req.ip, {
                attemptedRole: req.user ? req.user.role : null,
                requiredRoles: allowedRoles,
                path: req.path
            }, 'FAILURE');
            return res.status(403).json({ error: 'Access forbidden: Insufficient role permissions' });
        }
        next();
    };
}

module.exports = {
    authenticateToken,
    requireRole,
    JWT_SECRET
};
