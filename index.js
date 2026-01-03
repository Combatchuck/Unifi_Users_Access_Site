require('dotenv').config();
console.log('This is version 4 of index.js - Enhanced Security & Monitoring');
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const { MongoClient } = require('mongodb');
const rateLimit = require('express-rate-limit');
const app = express();
const port = 3000;

// Trust reverse proxy and read real client IP from X-Forwarded-For header
app.set('trust proxy', true);

// Global process-level handlers to log uncaught errors for debugging (do not expose to clients)
process.on('uncaughtException', (err) => {
    try {
        console.error('❌ [UNCAUGHT_EXCEPTION] ', err && err.stack ? err.stack : err);
    } catch (e) {
        console.error('❌ [UNCAUGHT_EXCEPTION] (error while logging):', e);
    }
});
process.on('unhandledRejection', (reason) => {
    try {
        console.error('❌ [UNHANDLED_REJECTION] ', reason && reason.stack ? reason.stack : reason);
    } catch (e) {
        console.error('❌ [UNHANDLED_REJECTION] (error while logging):', e);
    }
});

const { sendVerificationCode } = require('./email');
const { logUserAction } = require('./user_action_log');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const https = require('https');

// MongoDB database and collection variables
let db = null;
let usersCollection = null;
let verificationCodesCollection = null;
let userProfilesCollection = null;
let visitorInvitesCollection = null;
let visitorsCacheCollection = null;

// Session blacklist to invalidate sessions on logout
const sessionBlacklist = new Set();

// Helper function to log admin actions
async function logAdminAction(email, action, details = {}) {
    try {
        if (!db) return;
        const auditCollection = db.collection('audit_logs');
        await auditCollection.insertOne({
            email,
            action,
            details,
            timestamp: new Date(),
            ipAddress: details.ip || 'unknown'
        });
        console.log(`📋 [AUDIT] ${email}: ${action}`);
    } catch (error) {
        console.error(`❌ [AUDIT] Failed to log action: ${error.message}`);
    }
}

// Log user actions to audit_logs collection
async function logUserAuditAction(email, action, details = {}, req = null) {
    try {
        // If action is CODE_SENT and the email belongs to a configured admin OR the actor is an admin, skip logging to avoid noise
        const emailLower = (email || '').toLowerCase();
        const adminsLower = (typeof adminEmailsLower !== 'undefined') ? adminEmailsLower : (adminEmails || []).map(e => e.toLowerCase());
        // Check subject
        if (action === 'CODE_SENT' && adminsLower.includes(emailLower)) {
            console.log(`📋 [USER_AUDIT] Skipping CODE_SENT log for admin user ${email}`);
            return;
        }
        // Check actor (if request provided and user in session)
        try {
            if (action === 'CODE_SENT' && req && req.session && req.session.user && adminsLower.includes((req.session.user.email || '').toLowerCase())) {
                console.log(`📋 [USER_AUDIT] Skipping CODE_SENT log because actor ${req.session.user.email} is admin`);
                return;
            }
        } catch (e) {
            // ignore errors accessing req/session
        }

        if (!db) return;
        const auditCollection = db.collection('audit_logs');
        await auditCollection.insertOne({
            email,
            action,
            details,
            timestamp: new Date(),
            ipAddress: req?.ip || details.ip || 'unknown'
        });
        console.log(`📋 [USER_AUDIT] ${email}: ${action}`);
    } catch (error) {
        console.error(`❌ [AUDIT] Failed to log user action: ${error.message}`);
    }
}
app.use(express.json());

app.use(express.static('public'));

// Cache control middleware for static files
app.use((req, res, next) => {
    // Set cache control headers for static assets
    // No cache for development - always get latest files
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
});

const mongoUrl = process.env.MONGO_URL;
if (!mongoUrl) {
  console.error('MONGO_URL not set. See .env.example');
  process.exit(1);
}

// Create avatars directory if it doesn't exist
const avatarCacheDir = path.join(__dirname, 'public', 'avatars');
if (!fs.existsSync(avatarCacheDir)) {
    fs.mkdirSync(avatarCacheDir, { recursive: true });
}

// Function to download and cache avatar
function cacheAvatarLocally(cdnUrl, userId) {
    if (!cdnUrl) return null;
    
    const avatarFileName = `${userId}.png`;
    const avatarPath = path.join(avatarCacheDir, avatarFileName);
    
    // If already cached, return the local path
    if (fs.existsSync(avatarPath)) {
        return `/avatars/${avatarFileName}`;
    }
    
    // Download from CDN asynchronously (don't block the request)
    https.get(cdnUrl, { timeout: 10000 }, (response) => {
        if (response.statusCode === 200) {
            const fileStream = fs.createWriteStream(avatarPath);
            
            response.pipe(fileStream)
                .on('finish', () => {
                    fileStream.close();
                })
                .on('error', (err) => {
                    console.error(`Failed to write avatar file for user ${userId}: ${err.message}`);
                    fs.unlink(avatarPath, () => {}); // Clean up partial file
                });
        } else {
            console.error(`Failed to download avatar for user ${userId}: HTTP ${response.statusCode}`);
        }
    }).on('error', (err) => {
        console.error(`HTTPS error downloading avatar for user ${userId}: ${err.message}`);
    }).on('timeout', () => {
        console.error(`Timeout downloading avatar for user ${userId}`);
    });
    
    // Return CDN URL while downloading to local cache
    return cdnUrl;
}

// Helper to redact sensitive values for logs unless ALLOW_RAW_LOGS=true
function redactValue(value) {
    try {
        if (value === undefined || value === null) return '[REDACTED]';
        const s = String(value);
        if ((process.env.ALLOW_RAW_LOGS || '').toLowerCase() === 'true') return s;
        if (s.length <= 2) return '[REDACTED]';
        if (s.length === 3) return s[0] + '*' + s[2];
        const visibleStart = 2;
        const visibleEnd = 1;
        return s.slice(0, visibleStart) + '*'.repeat(Math.max(1, s.length - visibleStart - visibleEnd)) + s.slice(-visibleEnd);
    } catch (e) {
        return '[REDACTED]';
    }
}

app.use(session({
    secret: 'a-very-secret-key-that-should-be-in-an-env-file',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl }),
    cookie: { 
        maxAge: parseInt(process.env.SESSION_TIMEOUT_MS || '3600000'), // Default 1 hour
        httpOnly: true,
        secure: false, // Set to true if using HTTPS
        sameSite: 'lax'
    }
}));

// Protect admin.html - require authentication and admin role (MUST be after session middleware)
app.get('/admin.html', requireLogin, requireAdmin, (req, res) => {
    res.sendFile(__dirname + '/public/admin.html');
});

// Parse admin emails from environment variable
const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(email => email.trim()).filter(email => email);
const adminEmailsLower = adminEmails.map(email => email.toLowerCase());
console.log(`✅ [ADMIN] Admin emails configured: ${adminEmails.join(', ')}`);

// Rate limiting configuration for /verify-code endpoint
const rateLimitWindow = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'); // 15 minutes
const rateLimitMaxRequests = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '5'); // 5 attempts

const verifyCodeLimiter = rateLimit({
    windowMs: rateLimitWindow,
    max: rateLimitMaxRequests,
    message: 'Too many verification attempts. Please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req, res) => {
        // Don't count requests that are not verification attempts
        return !req.body.email;
    },
    keyGenerator: (req, res) => {
        // Rate limit by email address, not IP
        return req.body.email || req.ip;
    },
    handler: async (req, res, next, options) => {
        console.warn(`⚠️ [RATE LIMIT] Brute force attempt detected for ${req.body.email} - too many requests`);
        
        // Log rate limit breach to MongoDB
        if (db) {
            try {
                await db.collection('rate_limit_breaches').insertOne({
                    email: req.body.email,
                    ip: req.ip,
                    timestamp: new Date(),
                    attempts_in_window: req.rateLimit.current
                });
            } catch (mongoError) {
                console.error(`❌ Failed to log rate limit breach: ${mongoError.message}`);
            }
        }
        
        res.status(429).json({ error: options.message });
    }
});

const verificationCodes = {};

let userCache = [];
let licensePlateCache = {};
let userEmailMap = {};

// MongoDB initialization function
async function initializeDatabase() {
    try {
        const client = new MongoClient(mongoUrl);
        await client.connect();
        db = client.db('web-portal');
        
        // Create collections if they don't exist
        usersCollection = db.collection('users_cache');
        verificationCodesCollection = db.collection('verification_codes');
        userProfilesCollection = db.collection('user_profiles');
        visitorInvitesCollection = db.collection('visitor_invites');
        visitorsCacheCollection = db.collection('visitors_cache');
        
        // Additional audit collections
        const licensePlateAuditCollection = db.collection('license_plate_audit');
        const pinChangeHistoryCollection = db.collection('pin_change_history');
        const failedLoginAttemptsCollection = db.collection('failed_login_attempts');
        const apiHealthCollection = db.collection('api_health');
        const visitorModificationHistoryCollection = db.collection('visitor_modification_history');
        
        // Create indexes for core collections
        await usersCollection.createIndex({ email: 1 });
        await usersCollection.createIndex({ user_id: 1 }, { unique: true });
        await usersCollection.createIndex({ lastSync: 1 });
        
        await verificationCodesCollection.createIndex({ email: 1 });
        await verificationCodesCollection.createIndex({ timestamp: 1 }, { expireAfterSeconds: 300 }); // TTL: 5 minutes
        
        await userProfilesCollection.createIndex({ email: 1 });
        await userProfilesCollection.createIndex({ lastModified: 1 });
        
        await visitorInvitesCollection.createIndex({ inviter_email: 1 });
        await visitorInvitesCollection.createIndex({ visitor_id: 1 });
        await visitorInvitesCollection.createIndex({ invitedAt: 1 });
        
        await visitorsCacheCollection.createIndex({ user_id: 1 });
        await visitorsCacheCollection.createIndex({ lastSync: 1 });
        
        // Create indexes for audit collections
        await licensePlateAuditCollection.createIndex({ user_email: 1 });
        await licensePlateAuditCollection.createIndex({ visitor_id: 1 });
        await licensePlateAuditCollection.createIndex({ timestamp: 1 });
        
        await pinChangeHistoryCollection.createIndex({ user_email: 1 });
        await pinChangeHistoryCollection.createIndex({ timestamp: 1 });
        
        await failedLoginAttemptsCollection.createIndex({ email: 1 });
        try {
            await failedLoginAttemptsCollection.createIndex({ timestamp: 1 }, { expireAfterSeconds: 2592000 }); // TTL: 30 days
        } catch (error) {
            if (error.message.includes('already exists')) {
                await failedLoginAttemptsCollection.dropIndex('timestamp_1');
                await failedLoginAttemptsCollection.createIndex({ timestamp: 1 }, { expireAfterSeconds: 2592000 });
            }
        }
        
        await apiHealthCollection.createIndex({ endpoint: 1 });
        try {
            await apiHealthCollection.createIndex({ timestamp: 1 }, { expireAfterSeconds: 7776000 }); // TTL: 90 days
        } catch (error) {
            if (error.message.includes('already exists')) {
                await apiHealthCollection.dropIndex('timestamp_1');
                await apiHealthCollection.createIndex({ timestamp: 1 }, { expireAfterSeconds: 7776000 });
            }
        }
        
        // Audit logs collection with 1-year TTL
        const auditLogsCollection = db.collection('audit_logs');
        await auditLogsCollection.createIndex({ email: 1 });
        try {
            await auditLogsCollection.createIndex({ timestamp: 1 }, { expireAfterSeconds: 31536000 }); // TTL: 1 year (365 days)
        } catch (error) {
            if (error.message.includes('already exists')) {
                await auditLogsCollection.dropIndex('timestamp_1');
                await auditLogsCollection.createIndex({ timestamp: 1 }, { expireAfterSeconds: 31536000 });
            }
        }
        
        await visitorModificationHistoryCollection.createIndex({ visitor_id: 1 });
        await visitorModificationHistoryCollection.createIndex({ user_email: 1 });
        await visitorModificationHistoryCollection.createIndex({ timestamp: 1 });
        
        console.log('✅ [MONGODB] Database initialized with 12 collections and all indexes created');
        return true;
    } catch (error) {
        console.error('❌ [MONGODB] Failed to initialize database:', error.message);
        return false;
    }
}

function fetchAndCacheData() {
    const UNIFA_API_URL = process.env.UNIFA_API_URL;
    const UNIFA_BEARER_TOKEN = process.env.UNIFA_BEARER_TOKEN;
    if (!UNIFA_API_URL) {
      console.error('UNIFA_API_URL not set. See .env.example');
      return Promise.resolve();
    }
    if (!UNIFA_BEARER_TOKEN) {
      console.error('UNIFA_BEARER_TOKEN not set. See .env.example');
      return Promise.resolve();
    }
    const API_URL = `${UNIFA_API_URL}/api/v1/developer/users`;
    const AUTH_HEADER = `Authorization: Bearer ${UNIFA_BEARER_TOKEN}`;
    const command = `curl -s -k "${API_URL}?expand[]=license_plates" -H "${AUTH_HEADER}"`;

    return new Promise((resolve, reject) => {
        const startTime = Date.now();
        exec(command, { timeout: 60000 }, async (error, stdout, stderr) => {
            const responseTime = Date.now() - startTime;
            
            if (error) {
                console.error(`❌ [USER CACHE] exec error: ${error.message}`);
                console.error(`❌ [USER CACHE] command: ${command}`);
                console.error(`❌ [USER CACHE] stderr: ${stderr}`);
                
                // Log API health issue
                if (db) {
                    try {
                        await db.collection('api_health').insertOne({
                            endpoint: '/api/v1/developer/users',
                            status: 500,
                            error: error.message,
                            responseTime: responseTime,
                            timestamp: new Date()
                        });
                    } catch (mongoError) {
                        console.error(`❌ [USER CACHE] Failed to log API health: ${mongoError.message}`);
                    }
                }
                return reject(error);
            }

            try {
                const users = JSON.parse(stdout);
                const newUserCache = users.data;
                const newLicensePlateCache = {};
                const newUserEmailMap = {};

                newUserCache.forEach(user => {
                    if (user.license_plates) {
                        newLicensePlateCache[user.id] = user.license_plates.map(p => ({ plate: p.credential }));
                    } else {
                        newLicensePlateCache[user.id] = [];
                    }
                    if (user.email) {
                        newUserEmailMap[user.email.toLowerCase()] = user;
                    }
                    if (user.user_email) {
                        newUserEmailMap[user.user_email.toLowerCase()] = user;
                    }
                });
                userCache = newUserCache;
                licensePlateCache = newLicensePlateCache;
                userEmailMap = newUserEmailMap;
                
                console.log(`✅ [USER CACHE] Successfully refreshed ${newUserCache.length} users in ${responseTime}ms`);
                
                // Log API health success
                if (db) {
                    try {
                        await db.collection('api_health').insertOne({
                            endpoint: '/api/v1/developer/users',
                            status: 200,
                            responseTime: responseTime,
                            users_fetched: newUserCache.length,
                            timestamp: new Date()
                        });
                    } catch (mongoError) {
                        console.error(`❌ [USER CACHE] Failed to log API health: ${mongoError.message}`);
                    }
                }
                
                // Persist to MongoDB if available
                if (usersCollection) {
                    try {
                        for (const user of newUserCache) {
                            await usersCollection.updateOne(
                                { user_id: user.id },
                                { $set: { ...user, lastSync: new Date() } },
                                { upsert: true }
                            );
                        }
                        console.log(`✅ [USER CACHE] Persisted all users to MongoDB`);
                    } catch (mongoError) {
                        console.error(`❌ [USER CACHE] MongoDB persistence failed: ${mongoError.message}`);
                    }
                }
                
                resolve();
            } catch (e) {
                console.error(`❌ [USER CACHE] Error parsing JSON: ${e.message}`);
                console.error(`❌ [USER CACHE] stdout length: ${stdout.length} bytes`);
                
                // Log API health parse error
                if (db) {
                    try {
                        await db.collection('api_health').insertOne({
                            endpoint: '/api/v1/developer/users',
                            status: 500,
                            error: 'JSON Parse Error: ' + e.message,
                            responseTime: responseTime,
                            timestamp: new Date()
                        });
                    } catch (mongoError) {
                        console.error(`❌ [USER CACHE] Failed to log API health: ${mongoError.message}`);
                    }
                }
                reject(e);
            }
        });
    });
}

setInterval(fetchAndCacheData, 30 * 60 * 1000);

function startServer() {
    // License Plate Recognition API Endpoints
    // ==========================================

    // GET all license plates with filters
    app.get('/api/license-plates', (req, res) => {
        const limit = parseInt(req.query.limit) || 100;
        const hours = parseInt(req.query.hours) || 24;
        const camera = req.query.camera;
        const plate = req.query.plate;

        try {
            if (!db) {
                return res.status(503).json({ error: 'Database not available' });
            }
            
            const plates = db.collection('license_plates');
            let query = {};
            
            // Filter by time
            const since = new Date(Date.now() - hours * 3600 * 1000);
            query.timestamp = { $gte: since };
            
            // Filter by camera if specified
            if (camera) {
                query.camera_name = camera;
            }
            
            // Filter by plate if specified
            if (plate) {
                query.license_plate = plate;
            }

            plates.find(query)
                .sort({ timestamp: -1 })
                .limit(limit)
                .toArray((err, results) => {
                    if (err) {
                        res.status(500).json({ error: 'Database error', details: err.message });
                        return;
                    }

                    res.json({
                        total: results.length,
                        hours: hours,
                        plates: results,
                        timestamp: new Date().toISOString()
                    });
                });
        } catch (err) {
            res.status(500).json({ error: 'Server error', details: err.message });
        }
    });

    // GET statistics
    app.get('/api/license-plates/stats', (req, res) => {
        const hours = parseInt(req.query.hours) || 24;

        try {
            if (!db) {
                return res.status(503).json({ error: 'Database not available' });
            }
            
            const plates = db.collection('license_plates');
            const since = new Date(Date.now() - hours * 3600 * 1000);
            const startOfDay = new Date(); startOfDay.setHours(0,0,0,0);

            // Use aggregation with ts = $toDate(timestamp) to handle string/number timestamp variants
            plates.aggregate([
                { $addFields: { ts: { $toDate: '$timestamp' } } },
                {
                    $facet: {
                        window: [
                            { $match: { ts: { $gte: since } } },
                            { $group: { _id: null, total_detections: { $sum: 1 }, avg_confidence: { $avg: '$confidence' }, unique_plates: { $addToSet: '$license_plate' } } }
                        ],
                        today: [
                            { $match: { ts: { $gte: startOfDay } } },
                            { $group: { _id: null, total: { $sum: 1 }, avg_confidence: { $avg: '$confidence' }, unique_plates: { $addToSet: '$license_plate' } } }
                        ],
                        by_camera: [ { $group: { _id: '$camera_name', count: { $sum: 1 } } } ],
                        by_plate: [ { $group: { _id: '$license_plate', count: { $sum: 1 } } } ]
                    }
                }
            ]).toArray((err, results) => {
                if (err) {
                    res.status(500).json({ error: 'Database error', details: err.message });
                    return;
                }

                const data = results[0] || {};
                const w = data.window?.[0] || {};
                const t = data.today?.[0] || {};

                // Add start_of_day and next_reset so clients can show reset countdown
                const nextReset = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);
                const secondsUntilReset = Math.max(0, Math.floor((nextReset.getTime() - Date.now()) / 1000));

                res.json({
                    hours: hours,
                    total_detections: w.total_detections || 0,
                    unique_plates: (w.unique_plates && w.unique_plates.length) || 0,
                    unique_plates_today: (t.unique_plates && t.unique_plates.length) || 0,
                    avg_confidence_all: w.avg_confidence ? parseFloat(w.avg_confidence).toFixed(1) : null,
                    avg_confidence_today: t.avg_confidence ? parseFloat(t.avg_confidence).toFixed(1) : null,
                    by_camera: data.by_camera || [],
                    by_plate: data.by_plate || [],
                    start_of_day: startOfDay.toISOString(),
                    next_reset: nextReset.toISOString(),
                    seconds_until_reset: secondsUntilReset,
                    timestamp: new Date().toISOString()
                });
            });
        } catch (err) {
            res.status(500).json({ error: 'Server error', details: err.message });
        }
    });

    // Public site information (site name, version, etc.)
    app.get('/api/site-info', (req, res) => {
        const inviteSiteCount = parseInt(process.env.INVITE_SITE_COUNT || '2', 10) || 2;
        const showLprData = (String(process.env.SHOW_LPR_DATA || 'YES').toUpperCase() !== 'NO');
        res.json({ 
            siteName: process.env.SITE_NAME || 'User Access Portal',
            inviteSite1Name: process.env.INVITE_SITE1_NAME || 'SMB Gate',
            inviteSite2Name: process.env.INVITE_SITE2_NAME || 'Clubhouse/Pool',
            inviteSiteCount: inviteSiteCount,
            showLprData
        });
    });

    // SEARCH for specific plate
    app.get('/api/license-plates/search/:plate', (req, res) => {
        const plate = req.params.plate.toUpperCase();

        try {
            if (!db) {
                return res.status(503).json({ error: 'Database not available' });
            }
            
            const plates = db.collection('license_plates');

            plates.find({ license_plate: plate })
                .sort({ timestamp: -1 })
                .toArray((err, results) => {
                    if (err) {
                        res.status(500).json({ error: 'Database error', details: err.message });
                        return;
                    }

                    res.json({
                        plate: plate,
                        found: results.length,
                        detections: results,
                        timestamp: new Date().toISOString()
                    });
                });
        } catch (err) {
            res.status(500).json({ error: 'Server error', details: err.message });
        }
    });

    // GET service status
    app.get('/api/license-plates/status', (req, res) => {
        try {
            if (!db) {
                return res.status(503).json({ 
                    status: 'unavailable',
                    database: 'web-portal',
                    collection: 'license_plates',
                    error: 'Database not available'
                });
            }
            
            const plates = db.collection('license_plates');

            plates.countDocuments({}, (err, total) => {
                if (err) {
                    res.status(500).json({
                        status: 'error',
                        error: err.message
                    });
                    return;
                }

                res.json({
                    status: 'active',
                    database: 'web-portal',
                    collection: 'license_plates',
                    total_records: total,
                    timestamp: new Date().toISOString()
                });
            });
        } catch (err) {
            res.status(500).json({ error: 'Server error', details: err.message });
        }
    });

    // GET /api/lpr/search - Advanced LPR search with filters (admin only)
    // Searches both license_plates collection and users_cache for registered plates
    app.get('/api/lpr/search', requireLogin, requireAdmin, async (req, res) => {
        try {
            if (!db) {
                return res.status(503).json({ error: 'Database not available' });
            }

            const plates = db.collection('license_plates');
            const usersCache = db.collection('users_cache');
            const visitors = db.collection('visitors');
            const limit = Math.min(parseInt(req.query.limit) || 100, 500);
            const page = Math.max(parseInt(req.query.page) || 1, 1);
            const skip = (page - 1) * limit;

            // Build query filter for license_plates collection
            let detectionQuery = {};

            // Filter by license plate
            if (req.query.plate) {
                detectionQuery.license_plate = { $regex: req.query.plate, $options: 'i' };
            }

            // Filter by camera
            if (req.query.camera) {
                detectionQuery.camera_name = req.query.camera;
            }

            // Filter by date range
            if (req.query.start_date || req.query.end_date) {
                detectionQuery.timestamp = {};
                if (req.query.start_date) {
                    const startDate = new Date(req.query.start_date);
                    if (!isNaN(startDate)) {
                        detectionQuery.timestamp.$gte = startDate;
                    }
                }
                if (req.query.end_date) {
                    const endDate = new Date(req.query.end_date);
                    endDate.setHours(23, 59, 59, 999);
                    if (!isNaN(endDate)) {
                        detectionQuery.timestamp.$lte = endDate;
                    }
                }
            }

            // Filter by confidence
            if (req.query.min_confidence) {
                const minConf = parseInt(req.query.min_confidence);
                if (!isNaN(minConf)) {
                    detectionQuery.confidence = { $gte: minConf };
                }
            }

            // Filter by vehicle color
            if (req.query.color) {
                detectionQuery['vehicle_data.attributes.color.value'] = { $regex: req.query.color, $options: 'i' };
            }

            // Filter by vehicle type
            if (req.query.vehicle_type) {
                detectionQuery['vehicle_data.attributes.vehicleType.value'] = { $regex: req.query.vehicle_type, $options: 'i' };
            }

            // Filter by owner/group name
            if (req.query.owner) {
                detectionQuery['vehicle_data.group.name'] = { $regex: req.query.owner, $options: 'i' };
            }

            // If searching by user name or email, search users_cache first
            let userPlates = [];
            if (req.query.name || req.query.email) {
                let userQuery = {};
                if (req.query.name) {
                    userQuery.$or = [
                        { name: { $regex: req.query.name, $options: 'i' } },
                        { user_name: { $regex: req.query.name, $options: 'i' } },
                        { first_name: { $regex: req.query.name, $options: 'i' } },
                        { last_name: { $regex: req.query.name, $options: 'i' } }
                    ];
                }
                if (req.query.email) {
                    if (userQuery.$or) {
                        userQuery.$and = [
                            { $or: userQuery.$or },
                            { $or: [
                                { user_email: { $regex: req.query.email, $options: 'i' } },
                                { email: { $regex: req.query.email, $options: 'i' } }
                            ]}
                        ];
                        delete userQuery.$or;
                    } else {
                        userQuery.$or = [
                            { user_email: { $regex: req.query.email, $options: 'i' } },
                            { email: { $regex: req.query.email, $options: 'i' } }
                        ];
                    }
                }

                const matchingUsers = await usersCache.find(userQuery).toArray();
                const matchingVisitors = await visitors.find(userQuery).toArray();
                
                // Combine both users_cache and visitors
                const allMatches = [...matchingUsers, ...matchingVisitors];
                
                // Collect all their registered plates
                const plateSet = new Set();
                for (const user of allMatches) {
                    if (user.license_plates && Array.isArray(user.license_plates)) {
                        user.license_plates.forEach(p => {
                            if (p.credential) {
                                plateSet.add(p.credential.toUpperCase());
                            }
                        });
                    }
                }
                userPlates = Array.from(plateSet);
            }

            // Handle status filter
            if (req.query.status) {
                if (req.query.status === 'known') {
                    detectionQuery.user_email = { $ne: 'unknown' };
                } else if (req.query.status === 'unknown') {
                    detectionQuery.user_email = 'unknown';
                }
            }

            // Check if search has any filters - if no filters, return all results
            const hasFilters = req.query.plate || req.query.name || req.query.email || req.query.camera || req.query.start_date || req.query.end_date || req.query.min_confidence || req.query.status || req.query.hours;
            
            if (!hasFilters) {
                // Return paginated results sorted by newest first. Avoid loading the full collection
                // into memory to prevent blocking the event loop on large collections.
                const cursor = plates.find({}).sort({ timestamp: -1 }).skip(skip).limit(limit);
                const results = await cursor.toArray();

                // Enrich only the returned page with user/visitor data (avoid scanning full DB)
                for (const result of results) {
                    const user = await usersCache.findOne({
                        'license_plates.credential': result.license_plate
                    });
                    
                    if (user) {
                        if (user?.first_name || user?.last_name) {
                            result.user_name = `${user.first_name || ''} ${user.last_name || ''}`.trim();
                        } else {
                            result.user_name = user?.name || user?.user_name || 'Unknown';
                        }
                        result.user_email = user?.user_email || user?.email;
                    } else {
                        const visitor = await visitors.findOne({
                            'license_plates.credential': result.license_plate
                        });
                        if (visitor?.first_name || visitor?.last_name) {
                            result.user_name = `${visitor.first_name || ''} ${visitor.last_name || ''}`.trim();
                        } else {
                            result.user_name = visitor?.name || visitor?.user_name || 'Unknown';
                        }
                        result.user_email = visitor?.user_email || visitor?.email;
                    }
                }

                // Compute total (use a fast countDocuments) and return pagination
                const total = await plates.countDocuments({});

                return res.json({
                    results: results,
                    pagination: {
                        page,
                        limit,
                        total,
                        pages: Math.ceil(total / limit)
                    },
                    query: {},
                    timestamp: new Date().toISOString()
                });
            }

            // Execute search
            let results = [];
            let total = 0;

            // If searching by user, get ONLY their registered plates (even without detections)
            if (req.query.name || req.query.email) {
                // We have user-specific search - only return THEIR plates
                results = [];
                
                for (const plate of userPlates) {
                    // Find detections for this plate
                    const detections = await plates.find({ license_plate: plate }).toArray();
                    
                    if (detections.length > 0) {
                        // Add detection data with user info
                        for (const detection of detections) {
                            // Look up user for this plate
                            const user = await usersCache.findOne({
                                'license_plates.credential': plate
                            });
                            if (!user) {
                                const visitor = await visitors.findOne({
                                    'license_plates.credential': plate
                                });
                                if (visitor?.first_name || visitor?.last_name) {
                                    detection.user_name = `${visitor.first_name || ''} ${visitor.last_name || ''}`.trim();
                                } else {
                                    detection.user_name = visitor?.name || visitor?.user_name || 'Unknown';
                                }
                                detection.user_email = visitor?.user_email || visitor?.email || 'unknown';
                            } else {
                                if (user?.first_name || user?.last_name) {
                                    detection.user_name = `${user.first_name || ''} ${user.last_name || ''}`.trim();
                                } else {
                                    detection.user_name = user?.name || user?.user_name || 'Unknown';
                                }
                                detection.user_email = user?.user_email || user?.email || 'unknown';
                            }
                            results.push(detection);
                        }
                    } else {
                        // Add plate with no detection data
                        const user = await usersCache.findOne({
                            'license_plates.credential': plate
                        }) || await visitors.findOne({
                            'license_plates.credential': plate
                        });
                        
                        let userName = 'Unknown';
                        if (user) {
                            if (user?.first_name || user?.last_name) {
                                userName = `${user.first_name || ''} ${user.last_name || ''}`.trim();
                            } else {
                                userName = user?.name || user?.user_name || 'Unknown';
                            }
                        }
                        
                        results.push({
                            license_plate: plate,
                            user_name: userName,
                            user_email: user?.user_email || user?.email || 'unknown',
                            camera_name: null,
                            timestamp: null,
                            confidence: null,
                            detected_at: null
                        });
                    }
                }

                // Apply limit and skip
                results = results.sort((a, b) => {
                    const aTime = new Date(a.timestamp || 0);
                    const bTime = new Date(b.timestamp || 0);
                    return bTime - aTime;
                }).slice(skip, skip + limit);

                total = results.length;
            } else {
                // Regular detection search
                const allResults = await plates.find(detectionQuery)
                    .sort({ timestamp: -1 })
                    .toArray();

                // Enrich with user data
                for (const result of allResults) {
                    const user = await usersCache.findOne({
                        'license_plates.credential': result.license_plate
                    });
                    
                    if (user) {
                        if (user?.first_name || user?.last_name) {
                            result.user_name = `${user.first_name || ''} ${user.last_name || ''}`.trim();
                        } else {
                            result.user_name = user?.name || user?.user_name || 'Unknown';
                        }
                        result.user_email = user?.user_email || user?.email;
                    } else {
                        const visitor = await visitors.findOne({
                            'license_plates.credential': result.license_plate
                        });
                        if (visitor?.first_name || visitor?.last_name) {
                            result.user_name = `${visitor.first_name || ''} ${visitor.last_name || ''}`.trim();
                        } else {
                            result.user_name = visitor?.name || visitor?.user_name || 'Unknown';
                        }
                        result.user_email = visitor?.user_email || visitor?.email;
                    }
                }

                results = allResults.slice(skip, skip + limit);
                total = allResults.length;
            }

            res.json({
                results: results,
                pagination: {
                    page,
                    limit,
                    total,
                    pages: Math.ceil(total / limit)
                },
                query: { plate: req.query.plate, name: req.query.name, email: req.query.email, status: req.query.status },
                timestamp: new Date().toISOString()
            });

        } catch (err) {
            console.error('LPR search error:', err);
            res.status(500).json({ error: 'Server error', details: err.message });
        }
    });
    // POST /api/lpr/note - Save notes to a license plate detection
    app.post('/api/lpr/note', requireLogin, requireAdmin, async (req, res) => {
        try {
            if (!db) {
                return res.status(503).json({ error: 'Database not available' });
            }

            const { plate, notes } = req.body;
            
            if (!plate) {
                return res.status(400).json({ error: 'Plate number required' });
            }

            const licensePlates = db.collection('license_plates');

            // Validate notes - reject email-only content to avoid accidental PII writes
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (notes && emailRegex.test(notes.trim())) {
                return res.status(400).json({ error: 'Invalid note content: email-only notes are not allowed' });
            }

            // Determine actor for audit fields
            const actor = (req.user && (req.user.user_email || req.user.email || req.user.user_name || req.user.user_id)) || 'admin';

            // Update all detections for this plate with the note and audit metadata
            const result = await licensePlates.updateMany(
                { license_plate: plate },
                {
                    $set: {
                        notes: notes || null,
                        notes_by: actor,
                        notes_updated_at: new Date()
                    }
                }
            );

            // Log the change for auditing
            console.info(`LPR: notes update by=${actor} plate=${plate} modified=${result.modifiedCount}`);

            res.json({ 
                success: true, 
                modified: result.modifiedCount,
                message: `Updated ${result.modifiedCount} detection(s)`
            });

        } catch (err) {
            console.error('Note save error:', err);
            res.status(500).json({ error: 'Server error', details: err.message });
        }
    });

    // Serve LPR Dashboard page (both with and without .html extension). If SHOW_LPR_DATA=NO, return 404.
    app.get('/lpr-dashboard', requireLogin, requireAdmin, (req, res) => {
        if (String(process.env.SHOW_LPR_DATA || 'YES').toUpperCase() === 'NO') {
            return res.status(404).send('Not available');
        }
        res.sendFile(__dirname + '/public/lpr-dashboard.html');
    });

    app.get('/lpr-dashboard.html', requireLogin, requireAdmin, (req, res) => {
        if (String(process.env.SHOW_LPR_DATA || 'YES').toUpperCase() === 'NO') {
            return res.status(404).send('Not available');
        }
        res.sendFile(__dirname + '/public/lpr-dashboard.html');
    });

    app.get('/', (req, res) => {
        res.sendFile(__dirname + '/public/index.html');
    });

    app.listen(port, () => {
        console.log(`Server listening at http://localhost:${port}`);
    });
}

// Initialize database and start server
async function initializeAndStart() {
    const dbReady = await initializeDatabase();
    if (!dbReady) {
        console.warn('⚠️ [MONGODB] Continuing without MongoDB - server will operate with in-memory caching only');
    }
    
    fetchAndCacheData()
        .then(startServer)
        .catch(err => {
            console.error('❌ Failed to initialize user cache, server not starting:', err);
            process.exit(1);
        });
}

initializeAndStart();

function requireLogin(req, res, next) {
    // Check if session ID is blacklisted (user logged out)
    if (req.sessionID && sessionBlacklist.has(req.sessionID)) {
        req.session.destroy(() => {});
        return res.redirect('/');
    }

    if (req.session.user) {
        next();
    } else {
        res.redirect('/');
    }

}

function requireAdmin(req, res, next) {
    if (!req.session.user) {
        console.warn(`❌ [ADMIN] Unauthorized admin access attempt - no session`);
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    if (!adminEmails.includes(req.session.user.email)) {
        console.warn(`❌ [ADMIN] Unauthorized admin access attempt by ${req.session.user.email}`);
        return res.status(403).json({ error: 'Admin access required' });
    }
    
    next();
}

app.post('/send-code', async (req, res) => {
    const { email } = req.body;
    console.log(`/send-code request: email=${email}`);
    
    // Check if user exists in the system first
    const normalizedEmail = email && email.toLowerCase ? email.toLowerCase() : '';
    const user = userEmailMap[normalizedEmail];
    if (!user) {
        console.warn(`Send code attempt with non-existent user: ${email}`);
        return res.status(404).json({ error: 'No user with that email exists.' });
    }
    
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    verificationCodes[email] = { code, timestamp: Date.now() };
    
    try {
        await sendVerificationCode(email, code);
        
        // Log code sent event (pass request so actor can be identified)
        logUserAuditAction(email, 'CODE_SENT', {
            timestamp: new Date(),
            ip: req.ip
        }, req);
        
        // Store in MongoDB for audit trail
        if (verificationCodesCollection) {
            try {
                await verificationCodesCollection.insertOne({
                    email,
                    code,
                    timestamp: new Date(),
                    used: false,
                    ip: req.ip
                });
            } catch (mongoError) {
                console.error(`❌ Failed to log verification code to MongoDB: ${mongoError.message}`);
            }
        }
        
        res.json({ success: true });
    } catch (error) {
        console.error(`❌ Error sending verification code to ${email}: ${error.message}`);
        console.error(`❌ Error stack: ${error.stack}`);
        res.status(500).json({ error: `Failed to send verification code: ${error.message}` });
    }
});

// Debug endpoint to fetch the last verification code for an email (LOCAL USE ONLY)
// Enabled when DEBUG_CODES=true to avoid leaking codes in production
app.get('/_debug/code/:email', (req, res) => {
    if ((process.env.DEBUG_CODES || '').toLowerCase() !== 'true') {
        return res.status(403).json({ error: 'Debug endpoint disabled' });
    }
    // Only allow requests from localhost
    const ip = req.ip || req.connection.remoteAddress || '';
    if (!['::1', '127.0.0.1', '::ffff:127.0.0.1'].includes(ip)) {
        return res.status(403).json({ error: 'Debug endpoint only available from localhost' });
    }
    const email = req.params.email;
    const entry = verificationCodes[email];
    if (!entry) return res.status(404).json({ error: 'No code found' });
    return res.json({ email, code: entry.code, timestamp: entry.timestamp });
});

app.post('/verify-code', verifyCodeLimiter, async (req, res) => {
    try {
        const { email, code } = req.body;
        
        // Validate input
        if (!email || !code) {
            return res.status(400).json({ error: 'Email and code are required' });
        }
        
        console.log(`User ${email} submitted verification code ${redactValue(code)}`);
        // Check if user exists and is active
        const user = userEmailMap[email && email.toLowerCase ? email.toLowerCase() : ''];
        if (!user) {
            
            // Log failed login attempt
            if (db) {
                try {
                    await db.collection('failed_login_attempts').insertOne({
                        email,
                        code_provided: code,
                        reason: 'user_not_found',
                        ip: req.ip,
                        timestamp: new Date()
                    });
                } catch (mongoError) {
                    console.error(`❌ [AUTH] Failed to log login attempt: ${mongoError.message}`);
                }
            }
            return res.status(404).json({ error: 'No user with that email exists.' });
        }
        
        if (verificationCodes[email] && verificationCodes[email].code === code) {
            // Code is valid for 5 minutes
            if (Date.now() - verificationCodes[email].timestamp < 5 * 60 * 1000) {
                delete verificationCodes[email];
                // Store session data with all required fields
                const emailLower = email.toLowerCase();
                const isAdmin = adminEmails.includes(emailLower);
                console.log(`[VERIFY-CODE] Login for ${email} (${emailLower}): isAdmin=${isAdmin}, AdminEmails=[${adminEmails.join(', ')}]`);
                req.session.user = { email: emailLower, isAdmin };
                req.session.email = emailLower;
                req.session.loginTime = new Date();
                req.session.lastActivity = new Date();
                req.session.ipAddress = req.ip || req.connection.remoteAddress || 'unknown';
                
                req.session.save(async (err) => {
                    try {
                        if (err) {
                            console.error('❌ Error saving session:', err);
                            return res.status(500).json({ error: 'Session save error' });
                        }
                        
                        // Mark code as used in MongoDB
                        if (verificationCodesCollection) {
                            try {
                                await verificationCodesCollection.updateOne(
                                    { email, code },
                                    { $set: { used: true, usedAt: new Date() } }
                                );
                            } catch (mongoError) {
                                console.error(`❌ Failed to mark code as used in MongoDB: ${mongoError.message}`);
                            }
                        }
                        
                        console.log(`✅ [AUTH] User ${email} connected from ${req.session.ipAddress}.`);
                        logUserAction(`User ${email} connected.`);
                        return res.json({ success: true, message: 'Logged in successfully' });
                    } catch (errInner) {
                        console.error('❌ [VERIFY-CODE] Error in session save callback:', errInner && errInner.stack ? errInner.stack : errInner);
                        return res.status(500).json({ error: 'Internal server error' });
                    }
                });
                return;
            } else {
                // Code expired
                if (db) {
                    try {
                        await db.collection('failed_login_attempts').insertOne({
                            email,
                            code_provided: code,
                            reason: 'code_expired',
                            ip: req.ip,
                            timestamp: new Date()
                        });
                    } catch (mongoError) {
                        console.error(`❌ [AUTH] Failed to log expired code attempt: ${mongoError.message}`);
                    }
                }
                return res.status(401).json({ error: 'Code has expired. Please request a new code.' });
            }
        } else {
            // Invalid code
            console.warn(`❌ [AUTH] Invalid code attempt for ${email}`);
            if (db) {
                try {
                    await db.collection('failed_login_attempts').insertOne({
                        email,
                        code_provided: code,
                        reason: 'invalid_code',
                        ip: req.ip,
                        timestamp: new Date()
                    });
                } catch (mongoError) {
                    console.error(`❌ [AUTH] Failed to log invalid code attempt: ${mongoError.message}`);
                }
            }
            return res.status(401).json({ error: 'Invalid code. Please try again.' });
        }
    } catch (err) {
        console.error('❌ [VERIFY-CODE] Unexpected error:', err && err.stack ? err.stack : err);
        // Respond with generic error to avoid leaking internal state
        return res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/dashboard', requireLogin, (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

app.get('/api/user', requireLogin, (req, res) => {
    res.json(req.session.user);
});

app.get('/api/user/profile', requireLogin, async (req, res) => {
    const { email } = req.session.user;
    const user = userEmailMap[email.toLowerCase()];
    
    if (user) {
        // Try to get avatar from touch_pass CDN URL first, fallback to relative path
        let avatarUrl = null;
        if (user.touch_pass && user.touch_pass.user_avatar) {
            // Cache the avatar locally and return local path if available, otherwise CDN URL
            avatarUrl = cacheAvatarLocally(user.touch_pass.user_avatar, user.id);
        } else if (user.avatar_relative_path) {
            // Convert relative path to full CDN URL
            // Path format: /avatar/{uuid} -> https://account-cdn.svc.ui.com/{uuid}
            const avatarUuid = user.avatar_relative_path.replace('/avatar/', '').trim();
            if (avatarUuid) {
                const fullAvatarUrl = `https://account-cdn.svc.ui.com/${avatarUuid}`;
                avatarUrl = cacheAvatarLocally(fullAvatarUrl, user.id);
            }
        }
        
        const profileData = {
            name: user.first_name && user.last_name ? `${user.first_name} ${user.last_name}` : (user.first_name || user.last_name || user.email),
            avatar: avatarUrl,
            address: user.employee_number || null
        };
        
        // Store profile in MongoDB
        if (userProfilesCollection) {
            try {
                await userProfilesCollection.updateOne(
                    { email },
                    { $set: { email, profileData, lastModified: new Date() } },
                    { upsert: true }
                );
            } catch (mongoError) {
                console.error(`❌ Failed to persist profile to MongoDB: ${mongoError.message}`);
            }
        }
        
        res.json(profileData);
    } else {
        res.status(404).json({ error: 'User not found' });
    }
});

app.post('/api/user/name', requireLogin, (req, res) => {
    const { email } = req.body;
    // console.log('Searching for email:', email);
    // Use userEmailMap for direct lookup
    const user = userEmailMap[email.toLowerCase()];

    if (user) {
        let fullName = 'User not found';
        if (user.first_name && user.last_name) {
            fullName = `${user.first_name} ${user.last_name}`;
        } else if (user.first_name) {
            fullName = user.first_name;
        } else if (user.last_name) {
            fullName = user.last_name;
        } else if (user.email) {
            fullName = user.email;
        } else if (user.user_email) {
            fullName = user.user_email;
        }
        res.send(fullName);
    } else {
        res.status(404).send('User not found');
    }
});




app.post('/logout', (req, res) => {
    const userEmail = req.session.user ? req.session.user.email : 'unknown user';
    logUserAction(`User ${userEmail} logged out.`);
    
    // Add session ID to blacklist
    if (req.sessionID) {
        sessionBlacklist.add(req.sessionID);
    }
    
    req.session.destroy(err => {
        // Clear the session cookie regardless of destroy error
        res.clearCookie('connect.sid', { path: '/' });
        
        if (err) {
            console.error('Session destroy error:', err);
            return res.json({ success: true, message: 'Logged out' });
        }
        
        res.json({ success: true, message: 'Logged out' });
    });
});

// Endpoint to update a visitor (proxy to Unifa API)
app.post('/api/update-visitor', requireLogin, (req, res) => {
    const { visitorId, update } = req.body;

    if (!visitorId || !update) {
        return res.status(400).json({ error: 'visitorId and update payload are required' });
    }

    const UNIFA_API_URL = process.env.UNIFA_API_URL;
    const UNIFA_BEARER_TOKEN = process.env.UNIFA_BEARER_TOKEN;
    if (!UNIFA_API_URL) {
      console.error('UNIFA_API_URL not set. See .env.example');
      return res.status(500).json({ error: 'Server configuration error' });
    }
    if (!UNIFA_BEARER_TOKEN) {
      console.error('UNIFA_BEARER_TOKEN not set. See .env.example');
      return res.status(500).json({ error: 'Server configuration error' });
    }
    const API_BASE = `${UNIFA_API_URL}/api/v1/developer`;
    const AUTH_HEADER = `Authorization: Bearer ${UNIFA_BEARER_TOKEN}`;

    const updateData = JSON.stringify(update);
    const putCommand = `curl -s -k -w "\\n%{http_code}" -X PUT "${API_BASE}/visitors/${visitorId}" -H "${AUTH_HEADER}" -H "Content-Type: application/json" -d '${updateData.replace(/'/g, "'\\''")}'`;

    exec(putCommand, { timeout: 30000 }, (putError, putStdout, putStderr) => {
        if (putError) {
            console.error(`Error updating visitor ${visitorId}: ${putError.message}`);
            console.error(`stderr: ${putStderr}`);
            return res.status(500).json({ error: 'Failed to update visitor' });
        }

        try {
            const lines = putStdout.trim().split('\n');
            const httpCode = lines[lines.length - 1];
            const responseBody = lines.slice(0, -1).join('\n');

            if (httpCode && httpCode.startsWith('2')) {
                try {
                    const responseJson = JSON.parse(responseBody);
                    return res.json(responseJson);
                } catch (e) {
                    return res.json({ success: true, message: 'Visitor updated' });
                }
            } else {
                console.error(`API returned HTTP ${httpCode} for updating visitor ${visitorId}`);
                console.error(`Response body: ${responseBody}`);
                return res.status(500).json({ error: `Failed to update visitor (HTTP ${httpCode})`, body: responseBody });
            }
        } catch (e) {
            console.error(`Error parsing update response: ${e.message}`);
            console.error(`stdout: ${putStdout}`);
            return res.status(500).json({ error: 'Failed to parse update response' });
        }
    });
});

// GET /logout - Logout and redirect to home
app.get('/logout', (req, res) => {
    const userEmail = req.session.user ? req.session.user.email : 'unknown user';
    logUserAction(`User ${userEmail} logged out.`);
    
    // Add session ID to blacklist
    if (req.sessionID) {
        sessionBlacklist.add(req.sessionID);
    }
    
    req.session.destroy(err => {
        // Clear the session cookie regardless of destroy error
        res.clearCookie('connect.sid', { path: '/' });
        
        if (err) {
            console.error('Session destroy error:', err);
            return res.redirect('/');
        }
        
        // Redirect to home after clearing cookie
        res.redirect('/');
    });
});

// GET /api/check-session - Check if user is authenticated and if they're admin
app.get('/api/check-session', (req, res) => {
    const isAuthenticated = req.session && req.session.user;
    const isAdmin = isAuthenticated && req.session.user.isAdmin;
    
    res.json({
        authenticated: isAuthenticated,
        isAdmin: isAdmin,
        user: isAuthenticated ? { email: req.session.user.email } : null
    });
});

// GET /api/lpr-service-health - Check if LPR capture service is running
app.get('/api/lpr-service-health', requireLogin, requireAdmin, async (req, res) => {
    try {
        if (!db) {
            return res.status(503).json({ status: 'NO_DB', message: 'Database not connected' });
        }
        
        const lprTable = db.collection('license_plates');
        
        // Get the newest plate and check when it was captured
        const newest = await lprTable.findOne({}, { sort: { timestamp: -1 } });
        
        if (!newest) {
            return res.json({
                running: false,
                pid: null,
                uptime: 'No capture data',
                lastUpdate: new Date(),
                status: 'degraded'
            });
        }
        
        // Check if service has captured something in the last 10 minutes
        const lastCaptureTime = new Date(newest.timestamp);
        const now = new Date();
        const minutesSinceLastCapture = (now - lastCaptureTime) / 60000;
        
        if (minutesSinceLastCapture > 10) {
            // Last capture was more than 10 minutes ago - service may not be running
            return res.json({
                running: false,
                pid: null,
                uptime: `Last capture: ${minutesSinceLastCapture.toFixed(1)} min ago`,
                lastUpdate: lastCaptureTime,
                status: 'critical'
            });
        }
        
        // Service is actively capturing (within last 10 minutes)
        res.json({
            running: true,
            pid: 'remote-service',
            uptime: `Last capture: ${minutesSinceLastCapture.toFixed(1)} min ago`,
            lastUpdate: lastCaptureTime,
            status: 'healthy',
            lastPlate: newest.license_plate
        });
        
    } catch (error) {
        console.error('Error checking LPR service health:', error);
        res.status(500).json({
            error: 'Failed to check service health',
            message: error.message
        });
    }
});

app.post('/change-pin', requireLogin, async (req, res) => {
    const { email, newPin } = req.body;

    // 1. Validate PIN exists and is a string
    if (!newPin || typeof newPin !== 'string') {
        return res.status(400).send('PIN must be a string.');
    }

    // 2. Check for non-digit characters
    if (!/^\d+$/.test(newPin)) {
        return res.status(400).send('PIN must contain only digits.');
    }

    // 3. Check length (5-8 digits)
    if (newPin.length < 5 || newPin.length > 8) {
        return res.status(400).send('PIN must be between 5 and 8 digits long.');
    }

    // 4. Check for repetitive digits (e.g., 11111)
    if (/(.)\1{2,}/.test(newPin)) {
        return res.status(400).send('PIN cannot contain repetitive numbers (e.g., 11111).');
    }

    // 5. Check for sequential digits (e.g., 12345 or 54321)
    let isSequential = true;
    // Check ascending
    for (let i = 0; i < newPin.length - 1; i++) {
        if (parseInt(newPin[i+1]) - parseInt(newPin[i]) !== 1) {
            isSequential = false;
            break;
        }
    }
    if (!isSequential) { // If not ascending, check descending
        isSequential = true; // Reset for descending check
        for (let i = 0; i < newPin.length - 1; i++) {
            if (parseInt(newPin[i]) - parseInt(newPin[i+1]) !== 1) {
                isSequential = false;
                break;
            }
        }
    }

    if (isSequential) {
        return res.status(400).send('PIN cannot contain sequential numbers (e.g., 12345 or 54321).');
    }

    let site1Success = false;
    let site2Success = false;
    let errorMessage = '';

    console.log(`${email} updated PIN ${redactValue(newPin)} at ${new Date().toLocaleTimeString()}`);

    try {
        // Execute script for the primary site
        const scriptPath1 = './Add_Pin_To_User.sh';
        const { stdout: stdout1, stderr: stderr1 } = await new Promise((resolve, reject) => {
            exec(`${scriptPath1} "${email}" "${newPin}"`, { cwd: __dirname, env: process.env }, (error, stdout, stderr) => {
                if (error) {
                    reject({ error, stdout, stderr, site: 'SMB Gate' });
                } else {
                    resolve({ stdout, stderr });
                }
            });
        });
        
        if (stdout1.includes("PIN successfully updated.")) {
            site1Success = true;
            console.log('SMB Gate Update complete');
        } else {
            errorMessage = 'Failed to confirm PIN update on SMB Gate.';
            console.error(errorMessage);
            if (stderr1) {
                console.error(`SMB Gate (stderr): ${stderr1}`);
            }
        }

        // Execute script for the second site
        const scriptPath2 = './Add_Pin_To_User_Site2.sh';
        try {
            const { stdout: stdout2, stderr: stderr2 } = await new Promise((resolve, reject) => {
                exec(`${scriptPath2} "${email}" "${newPin}"`, {
                    cwd: __dirname,
                    env: {
                        ...process.env,
                        UNIFA_SITE2_API_URL: process.env.UNIFA_SITE2_API_URL,
                        UNIFA_SITE2_BEARER_TOKEN: process.env.UNIFA_SITE2_BEARER_TOKEN
                    }
                }, (error, stdout, stderr) => {
                    if (error) {
                        reject({ error, stdout, stderr, site: 'SMB Clubhouse' });
                    } else {
                        resolve({ stdout, stderr });
                    }
                });
            });

            if (stdout2.includes("PIN successfully updated on Site 2.")) {
                site2Success = true;
                console.log('SMB Clubhouse Update complete');
            } else {
                errorMessage = 'PIN updated on SMB Gate, but failed to confirm update on SMB Clubhouse.';
                console.error(errorMessage);
                 if (stderr2) {
                    console.error(`SMB Clubhouse (stderr): ${stderr2}`);
                }
            }
        } catch (err) {
            errorMessage = `PIN updated on SMB Gate, but failed to update on SMB Clubhouse: ${err.error?.message || 'Unknown error'}`;
            console.error(`exec error for SMB Clubhouse: ${err.error?.message}`);
            console.error(`SMB Clubhouse (stdout): ${err.stdout}`);
            console.error(`SMB Clubhouse (stderr): ${err.stderr}`);
        }

    } catch (err) {
        errorMessage = `Failed to update PIN on ${err.site}: ${err.error?.message || 'Unknown error'}`;
        console.error(`exec error for ${err.site}: ${err.error?.message}`);
        console.error(`${err.site} (stdout): ${err.stdout}`);
        console.error(`${err.site} (stderr): ${err.stderr}`);
    } finally {
        // Trigger cache refresh regardless of full success, as primary might have updated
        fetchAndCacheData();
        
        // Log PIN change to MongoDB
        if (db) {
            try {
                await db.collection('pin_change_history').insertOne({
                    user_email: email,
                    site1_success: site1Success,
                    site2_success: site2Success,
                    overall_success: site1Success && site2Success,
                    error_message: errorMessage || null,
                    timestamp: new Date()
                });
                console.log(`✅ [PIN] PIN change history logged for ${email}`);
            } catch (mongoError) {
                console.error(`❌ [PIN] Failed to log PIN change: ${mongoError.message}`);
            }
        }

        if (site1Success && site2Success) {
            console.log(`✅ [PIN] ${email} successfully updated PIN on both sites`);
            logUserAction(`${email} updated PIN`);
            await logUserAuditAction(email, 'PIN_CHANGED', { sites: ['SMB Gate', 'SMB Clubhouse'], success: true }, req);
            return res.sendStatus(200);
        } else if (site1Success && !site2Success) {
            // Primary succeeded, but second site had issues
            console.warn(`⚠️ [PIN] ${email} updated PIN on SMB Gate only`);
            await logUserAuditAction(email, 'PIN_CHANGED', { sites: ['SMB Gate'], success: true, note: 'SMB Clubhouse update failed' }, req);
            return res.status(202).send(errorMessage || 'PIN updated on SMB Gate, but not fully confirmed on SMB Clubhouse.');
        } else {
            // Primary site failed, or unknown state
            console.error(`❌ [PIN] PIN update failed for ${email}`);
            await logUserAuditAction(email, 'PIN_CHANGED', { success: false, error: errorMessage }, req);
            return res.status(500).send(errorMessage || 'Failed to change PIN due to an internal error.');
        }
    }
});

app.post('/get-managed-users', requireLogin, (req, res) => {
    const { email } = req.body;
    const scriptPath = './get_managed_users.sh';
    exec(`${scriptPath} "${email}"`, (error, stdout, stderr) => {
        if (error) {
            console.error(`exec error: ${error}`);
            return res.sendStatus(500);
        }
        try {
            const users = JSON.parse(stdout);
            res.json(users);
        } catch (e) {
            console.error(`Error parsing JSON: ${e}`);
            res.sendStatus(500);
        }
    });
});

app.post('/get-license-plates', requireLogin, (req, res) => {
    const { email } = req.body;
    // console.log('Searching for email:', email);
    // Use userEmailMap for direct lookup
    const user = userEmailMap[email.toLowerCase()];
    if (user) {
        res.json(licensePlateCache[user.id] || []);
    } else {
        res.status(404).send('User not found');
    }
});

app.post('/add-license-plate', requireLogin, async (req, res) => {
    const { email, plate } = req.body;
    const scriptPath = './add_license_plate.sh';
    
    const sanitizedPlate = plate.trim().toUpperCase();

    if (!/^[A-Z0-9]{1,8}$/.test(sanitizedPlate)) {
        return res.status(400).send('Invalid license plate format. Only letters and numbers are allowed, and the length must be between 1 and 8 characters.');
    }

    exec(`${scriptPath} "${email}" "${sanitizedPlate}" 2>&1`, { cwd: __dirname }, async (error, stdout, stderr) => {
        if (error) {
            console.error(`❌ [PLATE] exec error for /add-license-plate: ${error.message}`);
            console.error(`❌ [PLATE] exec exit code: ${error.code}`);
            if (process.env.DEBUG_API === 'true') {
                console.error(`❌ [PLATE] exec stdout/stderr: ${stdout}`);
            } else {
                console.error('Plate script output redacted.');
            }
            
            // Log failed plate addition to MongoDB
            if (db) {
                try {
                    await db.collection('license_plate_audit').insertOne({
                        user_email: email,
                        plate: sanitizedPlate,
                        action: 'add',
                        success: false,
                        reason: stdout.trim(),
                        timestamp: new Date()
                    });
                } catch (mongoError) {
                    console.error(`❌ [PLATE] Failed to log plate audit: ${mongoError.message}`);
                }
            }
            
            // Check if error message contains specific known errors
            if (stdout.includes("already exists")) {
                // Look up which user has this plate and include their name
                const userWithPlate = Object.values(userEmailMap).find(user => 
                    user.license_plates && user.license_plates.some(p => p.credential === sanitizedPlate)
                );
                let errorMsg = stdout.trim();
                if (userWithPlate) {
                    const ownerName = userWithPlate.first_name && userWithPlate.last_name 
                        ? `${userWithPlate.first_name} ${userWithPlate.last_name}` 
                        : (userWithPlate.first_name || userWithPlate.last_name || userWithPlate.email);
                    errorMsg = `License plate ${sanitizedPlate} is already assigned to ${ownerName}. Please enter a different one.`;
                    logUserAction(`${email} attempted to add license plate ${sanitizedPlate} but it is already assigned to ${ownerName}`);
                } else {
                    logUserAction(`${email} attempted to add license plate ${sanitizedPlate} but it already exists`);
                }
                return res.status(400).json({ error: errorMsg });
            }
            return res.status(500).json({ error: 'Failed to add license plate due to internal error.' });
        }
        if (stdout.includes("added successfully")) {
            console.log(`✅ [PLATE] ${email} added ${sanitizedPlate} as a plate`);
            logUserAction(`${email} added license plate ${sanitizedPlate}`);
            await logUserAuditAction(email, 'PLATE_ADDED', { plate: sanitizedPlate }, req);
            
            // Log successful plate addition to MongoDB
            if (db) {
                try {
                    await db.collection('license_plate_audit').insertOne({
                        user_email: email,
                        plate: sanitizedPlate,
                        action: 'add',
                        success: true,
                        timestamp: new Date()
                    });
                } catch (mongoError) {
                    console.error(`❌ [PLATE] Failed to log plate audit: ${mongoError.message}`);
                }
            }
            
            fetchAndCacheData(); // Trigger cache refresh
            res.status(200).json({ success: true });
        } else {
            // If script ran without error but didn't explicitly succeed, it might be an error
            if (stdout.trim()) {
                return res.status(400).json({ error: stdout.trim() });
            }
            fetchAndCacheData(); // Trigger cache refresh
            res.status(200).json({ success: true });
        }
    });
});

app.post('/remove-license-plate', requireLogin, async (req, res) => {
    const { email, plate } = req.body;
    const scriptPath = './remove_license_plate.sh';
    exec(`${scriptPath} "${email}" "${plate}"`, { cwd: __dirname }, async (error, stdout, stderr) => {
        if (error) {
            console.error(`❌ [PLATE] exec error: ${error.message}`);
            console.error(`❌ [PLATE] exec stderr: ${stderr}`);
            
            // Log failed plate removal to MongoDB
            if (db) {
                try {
                    await db.collection('license_plate_audit').insertOne({
                        user_email: email,
                        plate: plate,
                        action: 'remove',
                        success: false,
                        reason: error.message,
                        timestamp: new Date()
                    });
                } catch (mongoError) {
                    console.error(`❌ [PLATE] Failed to log plate audit: ${mongoError.message}`);
                }
            }
            
            return res.status(500).send('Failed to remove license plate due to internal error.');
        }
        if (stdout.includes("removed successfully")) {
            console.log(`✅ [PLATE] ${email} removed plate ${plate}`);
            logUserAction(`${email} removed license plate ${plate}`);
            await logUserAuditAction(email, 'PLATE_REMOVED', { plate: plate }, req);
            
            // Log successful plate removal to MongoDB
            if (db) {
                try {
                    await db.collection('license_plate_audit').insertOne({
                        user_email: email,
                        plate: plate,
                        action: 'remove',
                        success: true,
                        timestamp: new Date()
                    });
                } catch (mongoError) {
                    console.error(`❌ [PLATE] Failed to log plate audit: ${mongoError.message}`);
                }
            }
        } else {
            console.error(`❌ [PLATE] Failed to remove license plate for ${email}. stdout: ${stdout}`);
        }
        fetchAndCacheData(); // Trigger cache refresh
        res.sendStatus(200);
    });
});

app.post('/api/send-invite', requireLogin, async (req, res) => {
    const { email } = req.body;
    console.log(`Received request to send invite to: ${email}`);

    const user = userEmailMap[email.toLowerCase()];

    if (!user) {
        console.warn(`User with email ${email} not found in cache.`);
        return res.status(404).send('User not found. Cannot send invite.');
    }

    const userId = user.id;
    const scriptPath = path.join(__dirname, 'send_invite.sh');

    console.log(`DEBUG: __dirname is: ${__dirname}`);
    console.log(`DEBUG: Attempting to execute script at: ${__dirname}/${scriptPath}`);

    // Execute the send_invite.sh script
    exec(`${scriptPath} "${userId}" "${email}"`, { cwd: __dirname, env: { ...process.env, UNIFA_API_URL: process.env.UNIFA_API_URL, UNIFA_BEARER_TOKEN: process.env.UNIFA_BEARER_TOKEN } }, async (error, stdout, stderr) => {
        if (error) {
            console.error(`❌ exec error for send_invite.sh: ${error.message}`);
            console.error(`❌ exec exit code: ${error.code}`);
            console.error(`❌ exec stdout: ${stdout}`);
            console.error(`❌ exec stderr: ${stderr}`);
            return res.status(500).send('Failed to send invitation due to internal error.');
        }
        console.log(`stdout from send_invite.sh: ${stdout}`);
        if (stderr) {
            console.error(`stderr from send_invite.sh: ${stderr}`);
        }
        // Check if the script's output indicates success
        if (stdout.includes("Invitation successfully triggered.")) {
            logUserAction(`Invitation sent to ${email} for SMB Gate`);
            await logUserAuditAction(req.session.user.email, 'INVITE_SENT', { invitee: email, site: 'SMB Gate' }, req);
            
            // Store invitation in MongoDB
            if (visitorInvitesCollection) {
                try {
                    await visitorInvitesCollection.insertOne({
                        inviter_email: req.session.user.email,
                        invitee_email: email,
                        site: 'SMB Gate',
                        invitedAt: new Date(),
                        status: 'sent'
                    });
                } catch (mongoError) {
                    console.error(`❌ Failed to log invitation to MongoDB: ${mongoError.message}`);
                }
            }
            
            res.sendStatus(200);
        } else {
            // If the script exited successfully but didn't print the success message,
            // it might have failed internally or returned an unexpected response.
            res.status(500).send('Invitation script executed, but response was not successful.');
        }
    });
});

app.post('/api/send-invite-site2', requireLogin, async (req, res) => {
    const { email } = req.body;
    console.log(`Received request to send invite to Site 2: ${email}`);

    const user = userEmailMap[email.toLowerCase()];

    if (!user) {
        console.warn(`User with email ${email} not found in cache for Site 2.`);
        return res.status(404).send('User not found for Site 2. Cannot send invite.');
    }

    const userId = user.id;
    const scriptPath = './send_invite_site2.sh';

    console.log(`DEBUG: __dirname for site2 is: ${__dirname}`);
    console.log(`DEBUG: Attempting to execute site2 script at: ${__dirname}/${scriptPath}`);

    // Execute the send_invite_site2.sh script
    exec(`${scriptPath} "${userId}" "${email}"`, {
        cwd: __dirname,
        env: {
            ...process.env,
            UNIFA_SITE2_API_URL: process.env.UNIFA_SITE2_API_URL,
            UNIFA_SITE2_BEARER_TOKEN: process.env.UNIFA_SITE2_BEARER_TOKEN
        }
    }, async (error, stdout, stderr) => {
        if (error) {
            console.error(`❌ exec error for send_invite_site2.sh: ${error.message}`);
            console.error(`❌ exec exit code: ${error.code}`);
            console.error(`❌ exec stdout: ${stdout}`);
            console.error(`❌ exec stderr: ${stderr}`);
            return res.status(500).send('Failed to send invitation to Site 2 due to internal error.');
        }
        console.log(`stdout from send_invite_site2.sh: ${stdout}`);
        if (stderr) {
            console.error(`stderr from send_invite_site2.sh: ${stderr}`);
        }
        // Check if the script's output indicates success
        if (stdout.includes("Invitation successfully triggered.")) {
            logUserAction(`Invitation sent to ${email} for SMB Clubhouse`);
            
            // Store invitation in MongoDB
            if (visitorInvitesCollection) {
                try {
                    await visitorInvitesCollection.insertOne({
                        inviter_email: req.session.user.email,
                        invitee_email: email,
                        site: 'SMB Clubhouse/Pool',
                        invitedAt: new Date(),
                        status: 'sent'
                    });
                } catch (mongoError) {
                    console.error(`❌ Failed to log invitation to MongoDB: ${mongoError.message}`);
                }
            }
            
            res.sendStatus(200);
        } else {
            res.status(500).send('Invitation script for Site 2 executed, but response was not successful.');
        }
    });
});

// Endpoint to get all visitors invited by the logged-in user
app.get('/api/visitors', requireLogin, async (req, res) => {
    const { email } = req.session.user;
    
    // Get the user's ID from cache
    const user = userEmailMap[email.toLowerCase()];
    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }
    
    const userId = user.id;
    const CACHE_DURATION = 60 * 60 * 1000; // 1 hour in milliseconds
    const UNIFA_API_URL = process.env.UNIFA_API_URL;
    const UNIFA_BEARER_TOKEN = process.env.UNIFA_BEARER_TOKEN;
    if (!UNIFA_API_URL) {
      console.error('UNIFA_API_URL not set. See .env.example');
      return res.status(500).json({ error: 'Server configuration error' });
    }
    if (!UNIFA_BEARER_TOKEN) {
      console.error('UNIFA_BEARER_TOKEN not set. See .env.example');
      return res.status(500).json({ error: 'Server configuration error' });
    }
    const API_URL = `${UNIFA_API_URL}/api/v1/developer/visitors`;
    const AUTH_HEADER = `Authorization: Bearer ${UNIFA_BEARER_TOKEN}`;
    const command = `curl -s -k "${API_URL}" -H "${AUTH_HEADER}"`;

    // Check MongoDB for cached visitors
    let cachedVisitors = null;
    if (visitorsCacheCollection) {
        try {
            const cachedData = await visitorsCacheCollection.findOne({ user_id: userId });
            
            if (cachedData && cachedData.visitorsData && Array.isArray(cachedData.visitorsData)) {
                const cacheAge = Date.now() - cachedData.lastSync.getTime();
                const cacheAgeSeconds = Math.floor(cacheAge / 1000);
                
                if (cacheAge < CACHE_DURATION) {
                    // Cache is fresh, return cached data
                    const filteredVisitors = cachedData.visitorsData.filter(v => v.inviter_id === userId);
                    console.log(`✅ [VISITOR CACHE] Cache HIT for user ${email} (age: ${cacheAgeSeconds}s)`);
                    return res.json({ 
                        data: filteredVisitors,
                        cached: true,
                        stale: false,
                        lastSync: cachedData.lastSync
                    });
                } else {
                    // Cache is stale, log and fetch fresh data
                    console.log(`🔄 [VISITOR CACHE] Cache EXPIRED for user ${email} (age: ${cacheAgeSeconds}s) - fetching fresh data`);
                    cachedVisitors = cachedData.visitorsData; // Keep stale data for fallback
                }
            } else if (cachedData && cachedData.visitorsData) {
                console.log(`🔄 [VISITOR CACHE] Cache MISS for user ${email} - fetching fresh data`);
                cachedVisitors = cachedData.visitorsData; // Keep for fallback
            } else {
                console.log(`🔄 [VISITOR CACHE] Cache MISS for user ${email} - fetching fresh data`);
            }
        } catch (error) {
            console.error(`❌ [VISITOR CACHE] MongoDB read error: ${error.message}`);
        }
    }

    // Fetch fresh data from API, but respond quickly if upstream is slow
    const apiStartTime = Date.now();
    let responded = false;

    // Fallback timer: after 3s, if upstream hasn't responded, return cached or empty response so UI doesn't hang
    const fallbackTimer = setTimeout(() => {
        if (responded) return;
        responded = true;
        if (cachedVisitors && Array.isArray(cachedVisitors)) {
            const filteredVisitors = cachedVisitors.filter(v => v.inviter_id === userId);
            console.warn(`⚠️ [VISITOR CACHE] Upstream slow; returning stale cache for user ${email}`);
            return res.json({ data: filteredVisitors, cached: true, stale: true, lastSync: new Date() });
        } else {
            console.warn(`⚠️ [VISITOR CACHE] Upstream slow; returning empty visitor list for user ${email}`);
            return res.json({ data: [], cached: false, stale: true, lastSync: null });
        }
    }, 3000);

    exec(command, { timeout: 30000 }, async (error, stdout, stderr) => {
        const apiResponseTime = Date.now() - apiStartTime;
        clearTimeout(fallbackTimer);

        if (responded) {
            // We've already sent a fallback response; update cache asynchronously and return
            if (error) {
                console.error(`❌ [VISITOR CACHE] Error fetching visitors from API (background update): ${error.message}`);
                console.error(`❌ [VISITOR CACHE] stderr: ${stderr}`);
                return;
            }
            try {
                const response = JSON.parse(stdout);
                const visitorsData = response.data && Array.isArray(response.data) ? response.data : [];
                if (visitorsCacheCollection) {
                    try {
                        await visitorsCacheCollection.updateOne(
                            { user_id: userId },
                            { $set: { user_id: userId, user_email: email, visitorsData: visitorsData, lastSync: new Date() } },
                            { upsert: true }
                        );
                        console.log(`✅ [VISITOR CACHE] Background cache updated in MongoDB for user ${email} (fetched in ${apiResponseTime}ms)`);
                    } catch (mongoError) {
                        console.error(`❌ [VISITOR CACHE] Failed to update cache in MongoDB (background): ${mongoError.message}`);
                    }
                }
            } catch (e) {
                console.error(`❌ [VISITOR CACHE] Error parsing visitors JSON (background): ${e.message}`);
            }
            return;
        }

        if (error) {
            console.error(`❌ [VISITOR CACHE] Error fetching visitors from API: ${error.message}`);
            console.error(`❌ [VISITOR CACHE] stderr: ${stderr}`);

            // Log API health issue
            if (db) {
                try {
                    await db.collection('api_health').insertOne({
                        endpoint: '/api/v1/developer/visitors',
                        status: 500,
                        error: error.message,
                        responseTime: apiResponseTime,
                        user_email: email,
                        timestamp: new Date()
                    });
                } catch (mongoError) {
                    console.error(`❌ [VISITOR CACHE] Failed to log API health: ${mongoError.message}`);
                }
            }

            // Try to fall back to stale cache
            if (cachedVisitors && Array.isArray(cachedVisitors)) {
                const filteredVisitors = cachedVisitors.filter(v => v.inviter_id === userId);
                console.warn(`⚠️ [VISITOR CACHE] API failed, falling back to stale cache for user ${email}`);
                responded = true;
                return res.json({ 
                    data: filteredVisitors,
                    cached: true,
                    stale: true,
                    lastSync: new Date()
                });
            }

            responded = true;
            return res.status(500).json({ error: 'Failed to fetch visitors' });
        }

        try {
            const response = JSON.parse(stdout);
            const visitorsData = response.data && Array.isArray(response.data) ? response.data : [];
            const filteredVisitors = visitorsData.filter(v => v.inviter_id === userId);

            // Log API health success
            if (db) {
                try {
                    await db.collection('api_health').insertOne({
                        endpoint: '/api/v1/developer/visitors',
                        status: 200,
                        responseTime: apiResponseTime,
                        user_email: email,
                        visitors_fetched: visitorsData.length,
                        timestamp: new Date()
                    });
                } catch (mongoError) {
                    console.error(`❌ [VISITOR CACHE] Failed to log API health: ${mongoError.message}`);
                }
            }

            // Update MongoDB cache
            if (visitorsCacheCollection) {
                try {
                    await visitorsCacheCollection.updateOne(
                        { user_id: userId },
                        {
                            $set: {
                                user_id: userId,
                                user_email: email,
                                visitorsData: visitorsData,
                                lastSync: new Date()
                            }
                        },
                        { upsert: true }
                    );
                    console.log(`✅ [VISITOR CACHE] Cache updated in MongoDB for user ${email} (fetched in ${apiResponseTime}ms)`);
                } catch (mongoError) {
                    console.error(`❌ [VISITOR CACHE] Failed to update cache in MongoDB: ${mongoError.message}`);
                }
            }

            responded = true;
            res.json({ 
                data: filteredVisitors,
                cached: false,
                stale: false,
                lastSync: new Date()
            });
        } catch (e) {
            console.error(`❌ [VISITOR CACHE] Error parsing visitors JSON: ${e.message}`);
            console.error(`❌ [VISITOR CACHE] stdout length: ${stdout.length} bytes`);

            // Log API health parse error
            if (db) {
                try {
                    await db.collection('api_health').insertOne({
                        endpoint: '/api/v1/developer/visitors',
                        status: 500,
                        error: 'JSON Parse Error: ' + e.message,
                        responseTime: apiResponseTime,
                        user_email: email,
                        timestamp: new Date()
                    });
                } catch (mongoError) {
                    console.error(`❌ [VISITOR CACHE] Failed to log API health: ${mongoError.message}`);
                }
            }

            // Try to fall back to stale cache even on parse error
            if (cachedVisitors && Array.isArray(cachedVisitors)) {
                const filteredVisitors = cachedVisitors.filter(v => v.inviter_id === userId);
                console.warn(`⚠️ [VISITOR CACHE] Parse error, falling back to stale cache for user ${email}`);
                responded = true;
                return res.json({ 
                    data: filteredVisitors,
                    cached: true,
                    stale: true,
                    lastSync: new Date()
                });
            }

            responded = true;
            res.status(500).json({ error: 'Failed to parse visitors response' });
        }
    });
});

// Endpoint to get single visitor details
app.get('/api/visitors/:visitorId', requireLogin, async (req, res) => {
    const { visitorId } = req.params;
    const UNIFA_API_URL = process.env.UNIFA_API_URL;
    const UNIFA_BEARER_TOKEN = process.env.UNIFA_BEARER_TOKEN;
    if (!UNIFA_API_URL) {
      console.error('UNIFA_API_URL not set. See .env.example');
      return res.status(500).json({ error: 'Server configuration error' });
    }
    if (!UNIFA_BEARER_TOKEN) {
      console.error('UNIFA_BEARER_TOKEN not set. See .env.example');
      return res.status(500).json({ error: 'Server configuration error' });
    }
    const API_URL = `${UNIFA_API_URL}/api/v1/developer/visitors/${visitorId}`;
    const AUTH_HEADER = `Authorization: Bearer ${UNIFA_BEARER_TOKEN}`;
    const command = `curl -s -k "${API_URL}" -H "${AUTH_HEADER}"`;

    exec(command, { timeout: 30000 }, (error, stdout, stderr) => {
        if (error) {
            console.error(`Error fetching visitor ${visitorId}: ${error.message}`);
            console.error(`stderr: ${stderr}`);
            return res.status(500).json({ error: 'Failed to fetch visitor details' });
        }

        try {
            const response = JSON.parse(stdout);
            res.json(response);
        } catch (e) {
            console.error(`Error parsing visitor JSON: ${e.message}`);
            console.error(`stdout: ${stdout}`);
            res.status(500).json({ error: 'Failed to parse visitor response' });
        }
    });
});

// Endpoint to add license plate to a visitor
app.post('/api/add-visitor-plate', requireLogin, (req, res) => {
    const { visitorId, plate } = req.body;

    if (!visitorId || !plate) {
        return res.status(400).json({ error: 'visitorId and plate are required' });
    }

    const sanitizedPlate = plate.trim().toUpperCase();

    if (!/^[A-Z0-9]{1,8}$/.test(sanitizedPlate)) {
        return res.status(400).send('Invalid license plate format. Only letters and numbers are allowed, and the length must be between 1 and 8 characters.');
    }

    const UNIFA_API_URL = process.env.UNIFA_API_URL;
    const UNIFA_BEARER_TOKEN = process.env.UNIFA_BEARER_TOKEN;
    if (!UNIFA_API_URL) {
        console.error('UNIFA_API_URL not set. See .env.example');
        return res.status(500).json({ error: 'Server configuration error' });
    }
    if (!UNIFA_BEARER_TOKEN) {
        console.error('UNIFA_BEARER_TOKEN not set. See .env.example');
        return res.status(500).json({ error: 'Server configuration error' });
    }
    const API_BASE = `${UNIFA_API_URL}/api/v1/developer`;
    const AUTH_HEADER = `Authorization: Bearer ${UNIFA_BEARER_TOKEN}`;
    
    // First, fetch the current visitor to get their existing plates
    const getCommand = `curl -s -k "${API_BASE}/visitors/${visitorId}" -H "${AUTH_HEADER}"`;
    
    exec(getCommand, { timeout: 30000 }, (error, stdout, stderr) => {
        if (error) {
            console.error(`Error fetching visitor ${visitorId}: ${error.message}`);
            console.error(`stderr: ${stderr}`);
            return res.status(500).json({ error: 'Failed to fetch visitor details' });
        }

        try {
            const visitorData = JSON.parse(stdout);
            
            // Check if the visitor exists
            if (!visitorData.data && !visitorData.id) {
                return res.status(404).json({ error: 'Visitor not found' });
            }
            
            const visitor = visitorData.data || visitorData;
            
            // Get existing plates or initialize empty array
            const existingPlates = visitor.license_plates ? visitor.license_plates.map(p => typeof p === 'string' ? p : p.credential) : [];
            
            // Check if plate already exists for this visitor
            if (existingPlates.includes(sanitizedPlate)) {
                logUserAuditAction(req.session.email, 'VISITOR_PLATE_ERROR', { 
                    visitorId, 
                    plate: sanitizedPlate, 
                    error: 'Plate already exists for this visitor' 
                }, req);
                return res.status(400).json({ error: 'This license plate already exists for this visitor' });
            }
            
            // Check if plate is assigned to another user (get all visitors)
            const getAllCommand = `curl -s -k "${API_BASE}/visitors?limit=500" -H "${AUTH_HEADER}"`;
            exec(getAllCommand, { timeout: 30000 }, (getAllError, getAllStdout, getAllStderr) => {
                if (!getAllError) {
                    try {
                        const allVisitorsData = JSON.parse(getAllStdout);
                        const allVisitors = Array.isArray(allVisitorsData) ? allVisitorsData : (allVisitorsData.data || []);
                        
                        // Check if plate is assigned to another visitor
                        for (const otherVisitor of allVisitors) {
                            if (otherVisitor.id !== visitorId && otherVisitor.license_plates) {
                                const otherPlates = otherVisitor.license_plates.map(p => typeof p === 'string' ? p : p.credential);
                                if (otherPlates.includes(sanitizedPlate)) {
                                    const otherVisitorName = `${otherVisitor.first_name || ''} ${otherVisitor.last_name || ''}`.trim();
                                    logUserAuditAction(req.session.email, 'VISITOR_PLATE_ERROR', { 
                                        visitorId, 
                                        plate: sanitizedPlate, 
                                        error: 'Plate already assigned to another visitor',
                                        assignedTo: otherVisitorName || otherVisitor.id
                                    }, req);
                                    return res.status(400).json({ error: `This plate is already assigned to ${otherVisitorName || 'another visitor'}` });
                                }
                            }
                        }
                    } catch (parseError) {
                        console.error('Error checking other visitors:', parseError);
                    }
                }
                
                // If we get here, the plate is not assigned elsewhere, proceed with adding it
                addPlateToVisitor();
            });
            
            function addPlateToVisitor() {
                // Add the new plate
                existingPlates.push(sanitizedPlate);
                
                // Update visitor with new plates array (send as array of strings, not objects)
                const updateData = JSON.stringify({ license_plates: existingPlates });
                const putCommand = `curl -s -k -w "\\n%{http_code}" -X PUT "${API_BASE}/visitors/${visitorId}" -H "${AUTH_HEADER}" -H "Content-Type: application/json" -d '${updateData.replace(/'/g, "'\\''")}'`;
                
                exec(putCommand, { timeout: 30000 }, (putError, putStdout, putStderr) => {
                    if (putError) {
                        console.error(`Error updating visitor ${visitorId}: ${putError.message}`);
                        console.error(`stderr: ${putStderr}`);
                        return res.status(500).json({ error: 'Failed to update visitor with new plate' });
                    }

                    try {
                        // Extract HTTP status code from curl output
                        const lines = putStdout.trim().split('\n');
                        const httpCode = lines[lines.length - 1];
                        const responseBody = lines.slice(0, -1).join('\n');
                        
                        // Check if HTTP status code indicates success (2xx)
                        if (httpCode && httpCode.startsWith('2')) {
                            console.log(`Added plate ${sanitizedPlate} to visitor ${visitorId}`);
                            logUserAction(`Added license plate ${sanitizedPlate} to visitor ${visitorId}`);
                            logUserAuditAction(req.session.email, 'VISITOR_PLATE_ADDED', { visitorId, plate: sanitizedPlate }, req);
                            
                            // Try to parse response body as JSON, but if it fails, just return success
                            try {
                                const response = JSON.parse(responseBody);
                                res.json(response);
                            } catch (e) {
                                // API returned 2xx but not JSON, that's OK - just confirm success
                                res.json({ success: true, message: `Plate ${sanitizedPlate} added successfully` });
                            }
                        } else {
                            console.error(`API returned HTTP ${httpCode} for updating visitor ${visitorId}`);
                            console.error(`Response body: ${responseBody}`);
                            res.status(500).json({ error: `Failed to update visitor (HTTP ${httpCode})` });
                        }
                    } catch (e) {
                        console.error(`Error parsing update response: ${e.message}`);
                        console.error(`stdout: ${putStdout}`);
                        res.status(500).json({ error: 'Failed to parse update response' });
                    }
                });
            }
            
        } catch (e) {
            console.error(`Error parsing visitor data: ${e.message}`);
            console.error(`stdout: ${stdout}`);
            res.status(500).json({ error: 'Failed to parse visitor data' });
        }
    });
});


// Endpoint to delete a single plate from a visitor
app.post('/api/delete-visitor-plate', requireLogin, (req, res) => {
    const { visitorId, plate } = req.body;

    if (!visitorId || !plate) {
        return res.status(400).json({ error: 'visitorId and plate are required' });
    }

    const sanitizedPlate = plate.trim().toUpperCase();
    const UNIFA_API_URL = process.env.UNIFA_API_URL;
    const UNIFA_BEARER_TOKEN = process.env.UNIFA_BEARER_TOKEN;
    if (!UNIFA_API_URL) {
        console.error('UNIFA_API_URL not set. See .env.example');
        return res.status(500).json({ error: 'Server configuration error' });
    }
    if (!UNIFA_BEARER_TOKEN) {
        console.error('UNIFA_BEARER_TOKEN not set. See .env.example');
        return res.status(500).json({ error: 'Server configuration error' });
    }
    const API_BASE = `${UNIFA_API_URL}/api/v1/developer`;
    const AUTH_HEADER = `Authorization: Bearer ${UNIFA_BEARER_TOKEN}`;
    
    // First, fetch the current visitor to get their existing plates
    const getCommand = `curl -s -k "${API_BASE}/visitors/${visitorId}" -H "${AUTH_HEADER}"`;
    
    exec(getCommand, { timeout: 30000 }, (error, stdout, stderr) => {
        if (error) {
            console.error(`Error fetching visitor ${visitorId}: ${error.message}`);
            console.error(`stderr: ${stderr}`);
            return res.status(500).json({ error: 'Failed to fetch visitor details' });
        }

        try {
            const visitorData = JSON.parse(stdout);
            
            // Check if the visitor exists
            if (!visitorData.data && !visitorData.id) {
                return res.status(404).json({ error: 'Visitor not found' });
            }
            
            const visitor = visitorData.data || visitorData;
            
            // Get existing plates
            const existingPlates = visitor.license_plates ? visitor.license_plates.map(p => typeof p === 'string' ? p : p.credential) : [];
            
            // Check if plate exists
            if (!existingPlates.includes(sanitizedPlate)) {
                return res.status(400).json({ error: 'This license plate does not exist for this visitor' });
            }
            
            // Remove the plate from the array
            const updatedPlates = existingPlates.filter(p => p !== sanitizedPlate);
            
            // Update visitor with new plates array
            const updateData = JSON.stringify({ license_plates: updatedPlates });
            const putCommand = `curl -s -k -w "\\n%{http_code}" -X PUT "${API_BASE}/visitors/${visitorId}" -H "${AUTH_HEADER}" -H "Content-Type: application/json" -d '${updateData.replace(/'/g, "'\\''")}'`;
            
            exec(putCommand, { timeout: 30000 }, (putError, putStdout, putStderr) => {
                if (putError) {
                    console.error(`Error updating visitor ${visitorId}: ${putError.message}`);
                    console.error(`stderr: ${putStderr}`);
                    return res.status(500).json({ error: 'Failed to update visitor after plate removal' });
                }

                try {
                    // Extract HTTP status code from curl output
                    const lines = putStdout.trim().split('\n');
                    const httpCode = lines[lines.length - 1];
                    const responseBody = lines.slice(0, -1).join('\n');
                    
                    // Check if HTTP status code indicates success (2xx)
                    if (httpCode && httpCode.startsWith('2')) {
                        console.log(`Deleted plate ${sanitizedPlate} from visitor ${visitorId}`);
                        logUserAction(`Deleted license plate ${sanitizedPlate} from visitor ${visitorId}`);
                        logUserAuditAction(req.session.email, 'VISITOR_PLATE_REMOVED', { visitorId, plate: sanitizedPlate }, req);
                        
                        // Try to parse response body as JSON, but if it fails, just return success
                        try {
                            const response = JSON.parse(responseBody);
                            res.json(response);
                        } catch (e) {
                            // API returned 2xx but not JSON, that's OK - just confirm success
                            res.json({ success: true, message: `Plate ${sanitizedPlate} deleted successfully` });
                        }
                    } else {
                        console.error(`API returned HTTP ${httpCode} for updating visitor ${visitorId}`);
                        console.error(`Response body: ${responseBody}`);
                        res.status(500).json({ error: `Failed to update visitor (HTTP ${httpCode})` });
                    }
                } catch (e) {
                    console.error(`Error parsing update response: ${e.message}`);
                    console.error(`stdout: ${putStdout}`);
                    res.status(500).json({ error: 'Failed to parse update response' });
                }
            });
            
        } catch (e) {
            console.error(`Error parsing visitor data: ${e.message}`);
            console.error(`stdout: ${stdout}`);
            res.status(500).json({ error: 'Failed to parse visitor data' });
        }
    });
});

// Endpoint to delete a visitor
app.post('/api/delete-visitor', requireLogin, (req, res) => {
    const { visitorId } = req.body;

    if (!visitorId) {
        return res.status(400).json({ error: 'visitorId is required' });
    }

    const UNIFA_API_URL = process.env.UNIFA_API_URL;
    const UNIFA_BEARER_TOKEN = process.env.UNIFA_BEARER_TOKEN;
    if (!UNIFA_API_URL) {
        console.error('UNIFA_API_URL not set. See .env.example');
        return res.status(500).json({ error: 'Server configuration error' });
    }
    if (!UNIFA_BEARER_TOKEN) {
        console.error('UNIFA_BEARER_TOKEN not set. See .env.example');
        return res.status(500).json({ error: 'Server configuration error' });
    }
    const API_URL = `${UNIFA_API_URL}/api/v1/developer/visitors/${visitorId}?is_force=true`;
    const AUTH_HEADER = `Authorization: Bearer ${process.env.UNIFA_BEARER_TOKEN}`;
    
    const command = `curl -s -k -w "\\n%{http_code}" -X DELETE "${API_URL}" -H "${AUTH_HEADER}"`;

    exec(command, { timeout: 30000 }, (error, stdout, stderr) => {
        if (error) {
            console.error(`Error deleting visitor ${visitorId}: ${error.message}`);
            console.error(`stderr: ${stderr}`);
            return res.status(500).json({ error: 'Failed to delete visitor' });
        }

        try {
            // Extract HTTP status code from curl output
            const lines = stdout.trim().split('\n');
            const httpCode = lines[lines.length - 1];
            const responseBody = lines.slice(0, -1).join('\n');
            
            // Check if HTTP status code indicates success (2xx)
            if (httpCode && httpCode.startsWith('2')) {
                console.log(`Deleted visitor ${visitorId}`);
                logUserAction(`Deleted visitor ${visitorId}`);
                logUserAuditAction(req.session.user.email, 'VISITOR_DELETED', { visitorId: visitorId }, req);
                res.json({ success: true, message: 'Visitor deleted successfully' });
            } else {
                console.error(`API returned HTTP ${httpCode} for deleting visitor ${visitorId}`);
                console.error(`Response body: ${responseBody}`);
                res.status(500).json({ error: `Failed to delete visitor (HTTP ${httpCode})` });
            }
        } catch (e) {
            console.error(`Error parsing delete response: ${e.message}`);
            console.error(`stdout: ${stdout}`);
            res.status(500).json({ error: 'Failed to parse delete response' });
        }
    });
});

// ========================================
// ADMIN DASHBOARD ENDPOINTS
// ========================================

// Admin middleware - checks if user is admin
function requireAdmin(req, res, next) {
    const sessionEmail = req.session.email;
    const isAdmin = sessionEmail && adminEmails.includes(sessionEmail);
    
    if (!isAdmin) {
        console.log(`[DEBUG] Admin check failed - Email: "${sessionEmail}", AdminEmails: [${adminEmails.join(', ')}]`);
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
}

// GET /admin/dashboard - Main dashboard with aggregated metrics
app.get('/admin/dashboard', requireLogin, requireAdmin, async (req, res) => {
    try {
        const apiHealthCollection = db.collection('api_health');
        const failedLoginCollection = db.collection('failed_login_attempts');
        const visitorModificationCollection = db.collection('visitor_modification_history');
        const licensePlatesCollection = db.collection('license_plates');
        
        // Get last 24 hours metrics
        const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
        
        // API Health summary
        const apiHealthData = await apiHealthCollection.find({
            timestamp: { $gte: last24h }
        }).toArray();
        
        const totalRequests = apiHealthData.length;
        const avgResponseTime = apiHealthData.length > 0 
            ? (apiHealthData.reduce((sum, d) => sum + d.responseTime, 0) / apiHealthData.length).toFixed(2)
            : 0;
        const failedRequests = apiHealthData.filter(d => d.status >= 400).length;
        const failureRate = totalRequests > 0 ? ((failedRequests / totalRequests) * 100).toFixed(2) : 0;
        
        // Failed login summary
        const failedLogins = await failedLoginCollection.countDocuments({
            timestamp: { $gte: last24h }
        });
        
        // Unique users with failed attempts
        const uniqueFailedUsers = await failedLoginCollection.distinct('email', {
            timestamp: { $gte: last24h }
        });
        
        // Visitor modifications summary
        const visitorMods = await visitorModificationCollection.countDocuments({
            timestamp: { $gte: last24h }
        });
        
        // LPR Monitoring summary
        let lprMetrics = {
            total_detections: 0,
            detections_today: 0,
            unique_plates: 0,
            unique_plates_today: 0,
            avg_confidence_all: 0,
            avg_confidence_today: null,
            cameras: []
        };

        try {
            // Use local midnight (server local timezone) as the start of "today"
            const startOfDay = new Date();
            startOfDay.setHours(0,0,0,0);

            const lprStats = await licensePlatesCollection.aggregate([
                // Coerce timestamp to a Date field 'ts' so sorting/matching is reliable
                { $addFields: { ts: { $toDate: '$timestamp' } } },
                {
                    $facet: {
                        summary: [
                            {
                                $group: {
                                    _id: null,
                                    total: { $sum: 1 },
                                    unique_plates: { $addToSet: '$license_plate' },
                                    avg_confidence: { $avg: '$confidence' }
                                }
                            }
                        ],
                        today_summary: [
                            { $match: { ts: { $gte: startOfDay } } },
                            {
                                $group: {
                                    _id: null,
                                    total: { $sum: 1 },
                                    unique_plates: { $addToSet: '$license_plate' },
                                    avg_confidence: { $avg: '$confidence' }
                                }
                            }
                        ],
                        by_camera: [
                            {
                                $group: {
                                    _id: '$camera_name',
                                    count: { $sum: 1 },
                                    last_detection: { $max: '$ts' }
                                }
                            }
                        ],
                        user_status: [
                            {
                                $group: {
                                    _id: null,
                                    known: {
                                        $sum: {
                                            $cond: [{ $ne: ['$user_email', 'unknown'] }, 1, 0]
                                        }
                                    },
                                    unknown: {
                                        $sum: {
                                            $cond: [{ $eq: ['$user_email', 'unknown'] }, 1, 0]
                                        }
                                    }
                                }
                            }
                        ],
                        oldest: [
                            { $sort: { ts: 1 } },
                            { $limit: 1 },
                            {
                                $project: {
                                    timestamp: '$ts',
                                    license_plate: 1,
                                    user_name: 1
                                }
                            }
                        ]
                    }
                }
            ]).toArray();

            if (lprStats && lprStats.length > 0) {
                const data = lprStats[0];
                const userStatus = data.user_status?.[0] || { known: 0, unknown: 0 };
                const oldestDetection = data.oldest?.[0] || null;
                const today = data.today_summary?.[0] || null;

                // calculate next reset and seconds until reset (server local)
                const nextReset = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);
                const secondsUntilReset = Math.max(0, Math.floor((nextReset.getTime() - Date.now()) / 1000));

                lprMetrics = {
                    total_detections: data.summary[0]?.total || 0,
                    detections_today: today?.total || 0,
                    unique_plates: data.summary[0]?.unique_plates.length || 0,
                    unique_plates_today: today?.unique_plates ? today.unique_plates.length : 0,
                    avg_confidence_all: data.summary[0]?.avg_confidence ? parseFloat(data.summary[0].avg_confidence).toFixed(1) : 0,
                    avg_confidence_today: today?.avg_confidence ? parseFloat(today.avg_confidence).toFixed(1) : null,
                    cameras: data.by_camera || [],
                    known_users: userStatus.known,
                    unknown_users: userStatus.unknown,
                    oldest_detection: oldestDetection,
                    start_of_day: startOfDay.toISOString(),
                    next_reset: nextReset.toISOString(),
                    seconds_until_reset: secondsUntilReset
                };
            }
        } catch (lprError) {
            console.log(`⚠️  LPR metrics unavailable: ${lprError.message}`);
        }

        // Top endpoints by request count
        const topEndpoints = await apiHealthCollection.aggregate([
            { $match: { timestamp: { $gte: last24h } } },
            { $group: { _id: '$endpoint', count: { $sum: 1 }, avgTime: { $avg: '$responseTime' } } },
            { $sort: { count: -1 } },
            { $limit: 10 }
        ]).toArray();
        
        res.json({
            lastUpdated: new Date(),
            metrics: {
                api: {
                    totalRequests,
                    avgResponseTime: parseFloat(avgResponseTime),
                    failedRequests,
                    failureRate: parseFloat(failureRate)
                },
                security: {
                    failedLogins,
                    uniqueFailedUsers: uniqueFailedUsers.length
                },
                activity: {
                    visitorModifications: visitorMods
                },
                lpr: lprMetrics,
                topEndpoints
            }
        });

    // Admin debug endpoint: show reset info and sample timestamps since midnight (server-local)
    app.get('/admin/lpr/reset-info', requireLogin, requireAdmin, async (req, res) => {
        try {
            if (!db) return res.status(503).json({ error: 'Database not connected' });
            const plates = db.collection('license_plates');

            const startOfDay = new Date(); startOfDay.setHours(0,0,0,0);
            const nextReset = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);
            const secondsUntilReset = Math.max(0, Math.floor((nextReset.getTime() - Date.now()) / 1000));

            // Count and sample using aggregation to safely coerce timestamps
            const aggCount = await plates.aggregate([
                { $addFields: { ts: { $toDate: '$timestamp' } } },
                { $match: { ts: { $gte: startOfDay } } },
                { $count: 'count' }
            ]).toArray();

            const count = aggCount[0]?.count || 0;
            const samples = await plates.aggregate([
                { $addFields: { ts: { $toDate: '$timestamp' } } },
                { $match: { ts: { $gte: startOfDay } } },
                { $sort: { ts: -1 } },
                { $limit: 10 },
                { $project: { license_plate: 1, ts: 1, confidence: 1, camera_name: 1 } }
            ]).toArray();

            res.json({
                start_of_day: startOfDay.toISOString(),
                next_reset: nextReset.toISOString(),
                seconds_until_reset: secondsUntilReset,
                detections_since_start: count,
                samples
            });
        } catch (err) {
            console.error('Reset-info error:', err);
            res.status(500).json({ error: 'Failed to compute reset info', details: err.message });
        }
    });
    } catch (error) {
        console.error(`❌ [ADMIN] Dashboard error: ${error.message}`);
        res.status(500).json({ error: 'Failed to retrieve dashboard data' });
    }
});

// GET /admin/api-health - Detailed API health metrics and trends
app.get('/admin/api-health', requireLogin, requireAdmin, async (req, res) => {
    try {
        const apiHealthCollection = db.collection('api_health');
        const hours = parseInt(req.query.hours || '24');
        const sinceDatetime = new Date(Date.now() - hours * 60 * 60 * 1000);
        
        // Get all health data for the time period
        const healthData = await apiHealthCollection.find({
            timestamp: { $gte: sinceDatetime }
        }).sort({ timestamp: -1 }).limit(1000).toArray();
        
        // Group by endpoint and calculate stats
        const endpointStats = {};
        healthData.forEach(record => {
            if (!endpointStats[record.endpoint]) {
                endpointStats[record.endpoint] = {
                    endpoint: record.endpoint,
                    totalRequests: 0,
                    successCount: 0,
                    failureCount: 0,
                    responseTimes: [],
                    errors: []
                };
            }
            
            endpointStats[record.endpoint].totalRequests++;
            
            // Handle both new (status) and old (success) field names
            const isSuccess = record.status !== undefined ? (record.status < 400) : (record.success === true);
            
            if (isSuccess) {
                endpointStats[record.endpoint].successCount++;
            } else {
                endpointStats[record.endpoint].failureCount++;
                if (record.error || record.error_message) {
                    endpointStats[record.endpoint].errors.push({
                        status: record.status,
                        error: record.error || record.error_message,
                        timestamp: record.timestamp
                    });
                }
            }
            
            // Handle both responseTime and response_time_ms
            const responseTime = record.responseTime !== undefined ? record.responseTime : record.response_time_ms;
            if (responseTime) {
                endpointStats[record.endpoint].responseTimes.push(responseTime);
            }
        });
        
        // Calculate aggregated stats
        const stats = Object.values(endpointStats).map(stat => {
            const avgTime = stat.responseTimes.length > 0 
                ? (stat.responseTimes.reduce((a, b) => a + b, 0) / stat.responseTimes.length).toFixed(2)
                : 0;
            const maxTime = stat.responseTimes.length > 0 ? Math.max(...stat.responseTimes).toFixed(2) : 0;
            const minTime = stat.responseTimes.length > 0 ? Math.min(...stat.responseTimes).toFixed(2) : 0;
            
            return {
                endpoint: stat.endpoint,
                totalRequests: stat.totalRequests,
                successCount: stat.successCount,
                failureCount: stat.failureCount,
                successRate: ((stat.successCount / stat.totalRequests) * 100).toFixed(2),
                avgResponseTime: parseFloat(avgTime),
                maxResponseTime: parseFloat(maxTime),
                minResponseTime: parseFloat(minTime),
                recentErrors: stat.errors.slice(0, 5)
            };
        }).sort((a, b) => b.totalRequests - a.totalRequests);
        
        // Hourly trend data
        const hourlyTrends = {};
        healthData.forEach(record => {
            const hour = new Date(record.timestamp);
            hour.setMinutes(0, 0, 0);
            const hourKey = hour.toISOString();
            
            if (!hourlyTrends[hourKey]) {
                hourlyTrends[hourKey] = {
                    timestamp: hour,
                    requests: 0,
                    errors: 0,
                    avgResponseTime: 0,
                    responseTimes: []
                };
            }
            
            hourlyTrends[hourKey].requests++;
            if (record.status >= 400) hourlyTrends[hourKey].errors++;
            hourlyTrends[hourKey].responseTimes.push(record.responseTime);
        });
        
        const trends = Object.values(hourlyTrends).map(h => ({
            timestamp: h.timestamp,
            requests: h.requests,
            errors: h.errors,
            errorRate: ((h.errors / h.requests) * 100).toFixed(2),
            avgResponseTime: (h.responseTimes.reduce((a, b) => a + b, 0) / h.responseTimes.length).toFixed(2)
        })).sort((a, b) => a.timestamp - b.timestamp);
        
        res.json({
            timeRange: { hours, since: sinceDatetime, until: new Date() },
            endpointStats: stats,
            hourlyTrends: trends
        });
    } catch (error) {
        console.error(`❌ [ADMIN] API health endpoint error: ${error.message}`);
        res.status(500).json({ error: 'Failed to retrieve API health data' });
    }
});

// GET /admin/failed-logins - Failed login attempts and patterns
app.get('/admin/failed-logins', requireLogin, requireAdmin, async (req, res) => {
    try {
        const failedLoginCollection = db.collection('failed_login_attempts');
        const hours = parseInt(req.query.hours || '24');
        const sinceDatetime = new Date(Date.now() - hours * 60 * 60 * 1000);
        
        // Get all failed login attempts in time period
        const failedLogins = await failedLoginCollection.find({
            timestamp: { $gte: sinceDatetime }
        }).sort({ timestamp: -1 }).toArray();
        
        // Analyze patterns
        const emailPatterns = {};
        const ipPatterns = {};
        const timeBasedPatterns = {};
        
        failedLogins.forEach(record => {
            // Email patterns
            if (!emailPatterns[record.email]) {
                emailPatterns[record.email] = {
                    email: record.email,
                    attempts: 0,
                    ips: new Set(),
                    timestamps: []
                };
            }
            emailPatterns[record.email].attempts++;
            if (record.ip) emailPatterns[record.email].ips.add(record.ip);
            emailPatterns[record.email].timestamps.push(record.timestamp);
            
            // IP patterns
            if (record.ip) {
                if (!ipPatterns[record.ip]) {
                    ipPatterns[record.ip] = {
                        ip: record.ip,
                        attempts: 0,
                        emails: new Set()
                    };
                }
                ipPatterns[record.ip].attempts++;
                ipPatterns[record.ip].emails.add(record.email);
            }
            
            // Time-based clustering (5 min windows)
            const timeWindow = new Date(Math.floor(record.timestamp / (5 * 60 * 1000)) * 5 * 60 * 1000);
            const windowKey = timeWindow.toISOString();
            if (!timeBasedPatterns[windowKey]) {
                timeBasedPatterns[windowKey] = { timestamp: timeWindow, count: 0, emails: new Set() };
            }
            timeBasedPatterns[windowKey].count++;
            timeBasedPatterns[windowKey].emails.add(record.email);
        });
        
        // Convert Sets to arrays and identify anomalies
        const emailAnomalies = Object.values(emailPatterns)
            .map(p => ({
                email: p.email,
                attempts: p.attempts,
                uniqueIPs: p.ips.size,
                ips: Array.from(p.ips),
                firstAttempt: new Date(Math.min(...p.timestamps.map(t => t.getTime()))),
                lastAttempt: new Date(Math.max(...p.timestamps.map(t => t.getTime()))),
                isAnomaly: p.attempts >= 3 || p.ips.size >= 3 // 3+ attempts or 3+ IPs
            }))
            .sort((a, b) => b.attempts - a.attempts);
        
        const ipAnomalies = Object.values(ipPatterns)
            .map(p => ({
                ip: p.ip,
                attempts: p.attempts,
                targetedEmails: p.emails.size,
                emails: Array.from(p.emails),
                isAnomaly: p.attempts >= 5 || p.emails.size >= 3 // 5+ attempts or 3+ emails
            }))
            .sort((a, b) => b.attempts - a.attempts);
        
        const timeBased = Object.values(timeBasedPatterns)
            .map(p => ({
                timestamp: p.timestamp,
                attemptCount: p.count,
                uniqueEmails: p.emails.size,
                isSpike: p.count >= 5 // 5+ attempts in 5 min window
            }))
            .sort((a, b) => a.timestamp - b.timestamp);
        
        res.json({
            timeRange: { hours, since: sinceDatetime, until: new Date() },
            totalFailedLogins: failedLogins.length,
            emailAnomalies,
            ipAnomalies,
            timeBased,
            recentAttempts: failedLogins.slice(0, 20)
        });
    } catch (error) {
        console.error(`❌ [ADMIN] Failed logins endpoint error: ${error.message}`);
        res.status(500).json({ error: 'Failed to retrieve failed login data' });
    }
});

// GET /admin/performance - Performance analytics and bottleneck detection
app.get('/admin/performance', requireLogin, requireAdmin, async (req, res) => {
    try {
        const apiHealthCollection = db.collection('api_health');
        const hours = parseInt(req.query.hours || '24');
        const sinceDatetime = new Date(Date.now() - hours * 60 * 60 * 1000);
        const threshold = parseInt(req.query.slowThreshold || '1000'); // milliseconds
        
        const healthData = await apiHealthCollection.find({
            timestamp: { $gte: sinceDatetime }
        }).toArray();
        
        // Slow endpoints analysis
        const slowEndpoints = {};
        const endpointLatencies = {};
        
        healthData.forEach(record => {
            if (!endpointLatencies[record.endpoint]) {
                endpointLatencies[record.endpoint] = [];
            }
            // Convert responseTime to number in case it's a string
            const responseTime = parseFloat(record.responseTime || 0);
            endpointLatencies[record.endpoint].push(responseTime);
            
            if (responseTime > threshold) {
                if (!slowEndpoints[record.endpoint]) {
                    slowEndpoints[record.endpoint] = [];
                }
                slowEndpoints[record.endpoint].push({
                    responseTime: responseTime,
                    timestamp: record.timestamp,
                    status: record.status
                });
            }
        });
        
        // Calculate percentiles for each endpoint
        const percentileData = Object.entries(endpointLatencies).map(([endpoint, times]) => {
            const sorted = times.sort((a, b) => a - b);
            const p50 = sorted[Math.floor(sorted.length * 0.5)] || 0;
            const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;
            const p99 = sorted[Math.floor(sorted.length * 0.99)] || 0;
            const max = Math.max(...sorted);
            const avg = (sorted.reduce((a, b) => a + b, 0) / sorted.length).toFixed(2);
            
            return {
                endpoint,
                requestCount: sorted.length,
                avgLatency: parseFloat(avg),
                p50: parseFloat(p50.toFixed(0)),
                p95: parseFloat(p95.toFixed(0)),
                p99: parseFloat(p99.toFixed(0)),
                maxLatency: parseFloat(max.toFixed(0)),
                slowRequests: (slowEndpoints[endpoint] || []).length,
                slowPercentage: ((slowEndpoints[endpoint] || []).length / sorted.length * 100).toFixed(2)
            };
        }).sort((a, b) => parseFloat(b.avgLatency) - parseFloat(a.avgLatency));
        
        
        res.json({
            timeRange: { hours, since: sinceDatetime, until: new Date() },
            slowThreshold: threshold,
            totalRequests: healthData.length,
            performanceByEndpoint: percentileData,
            bottlenecks: percentileData.filter(p => p.slowPercentage > 10).slice(0, 5)
        });
    } catch (error) {
        console.error(`❌ [ADMIN] Performance endpoint error: ${error.message}`);
        res.status(500).json({ error: 'Failed to retrieve performance data' });
    }
});

// GET /admin/status - System status and health check
app.get('/admin/status', requireLogin, requireAdmin, async (req, res) => {
    try {
        const apiHealthCollection = db.collection('api_health');
        const failedLoginCollection = db.collection('failed_login_attempts');
        
        // Last request to check API connectivity
        const lastRequest = await apiHealthCollection.findOne({}, { sort: { timestamp: -1 } });
        
        // Current metrics (last 1 hour)
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        const recentRequests = await apiHealthCollection.find({
            timestamp: { $gte: oneHourAgo }
        }).toArray();
        
        const recentFailures = recentRequests.filter(r => r.status >= 400).length;
        const recentErrorRate = recentRequests.length > 0 
            ? ((recentFailures / recentRequests.length) * 100).toFixed(2)
            : 0;
        
        // Failed login monitoring
        const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
        const recentFailedLogins = await failedLoginCollection.countDocuments({
            timestamp: { $gte: fiveMinAgo }
        });
        
        // Determine system status
        let systemStatus = 'HEALTHY';
        const issues = [];
        
        if (!lastRequest) {
            systemStatus = 'UNKNOWN';
            issues.push('No API health data available');
        } else if (recentErrorRate > 10) {
            systemStatus = 'DEGRADED';
            issues.push(`High error rate: ${recentErrorRate}%`);
        }
        
        if (recentFailedLogins > 5) {
            systemStatus = 'ALERT';
            issues.push(`Suspicious login attempts: ${recentFailedLogins} in last 5 minutes`);
        }
        
        // Verify MongoDB connection
        let dbStatus = 'CONNECTED';
        try {
            await db.admin().ping();
        } catch (e) {
            dbStatus = 'DISCONNECTED';
            systemStatus = 'CRITICAL';
            issues.push('Database connection failed');
        }
        
        res.json({
            timestamp: new Date(),
            systemStatus,
            components: {
                database: {
                    status: dbStatus,
                    lastConnected: lastRequest?.timestamp || null
                },
                api: {
                    status: lastRequest ? 'OPERATIONAL' : 'NO DATA',
                    lastRequest: lastRequest?.timestamp || null,
                    errorRateLastHour: parseFloat(recentErrorRate),
                    requestsLastHour: recentRequests.length
                },
                security: {
                    status: recentFailedLogins > 5 ? 'ALERT' : 'NORMAL',
                    failedLoginAttemptsLast5Min: recentFailedLogins
                }
            },
            issues,
            adminUser: req.session.user.email
        });
    } catch (error) {
        console.error(`❌ [ADMIN] Status endpoint error: ${error.message}`);
        res.status(500).json({ 
            error: 'Failed to retrieve system status',
            timestamp: new Date(),
            systemStatus: 'ERROR'
        });
    }
});

// POST /api/dark-mode - Save user's dark mode preference
app.post('/api/dark-mode', requireLogin, async (req, res) => {
    try {
        const { enabled } = req.body;
        
        if (typeof enabled !== 'boolean') {
            return res.status(400).json({ error: 'enabled must be a boolean' });
        }
        
        // Update user preference in database
        await userProfilesCollection.updateOne(
            { email: req.session.user.email },
            { 
                $set: { 
                    darkModeEnabled: enabled,
                    lastModified: new Date()
                } 
            },
            { upsert: true }
        );
        
        // Also save in session
        req.session.user.darkModeEnabled = enabled;
        
        res.json({ success: true, darkModeEnabled: enabled });
    } catch (error) {
        console.error(`❌ Failed to save dark mode preference: ${error.message}`);
        res.status(500).json({ error: 'Failed to save preference' });
    }
});

// GET /api/user-preferences - Get user settings including dark mode
app.get('/api/user-preferences', requireLogin, async (req, res) => {
    try {
        const userProfile = await userProfilesCollection.findOne({
            email: req.session.user.email
        });
        
        res.json({
            darkModeEnabled: userProfile?.darkModeEnabled || false,
            email: req.session.user.email
        });
    } catch (error) {
        console.error(`❌ Failed to retrieve user preferences: ${error.message}`);
        res.status(500).json({ error: 'Failed to retrieve preferences' });
    }
});

// GET /admin/db-health - Database monitoring and health metrics
app.get('/admin/db-health', requireLogin, requireAdmin, async (req, res) => {
    try {
        const dbHealthCollection = db.collection('db_health');
        const hours = parseInt(req.query.hours || '24');
        const sinceDatetime = new Date(Date.now() - hours * 60 * 60 * 1000);
        
        // Get real-time storage stats directly from MongoDB
        let currentStorage = { dataSize: 0, indexSize: 0, storageSize: 0 };
        try {
            const dbStats = await db.stats();
            currentStorage = {
                dataSize: dbStats.dataSize || 0,
                indexSize: dbStats.indexSize || 0,
                storageSize: dbStats.storageSize || 0
            };
        } catch (statsError) {
            console.warn(`⚠️ [DB HEALTH] Could not retrieve storage stats: ${statsError.message}`);
        }
        
        // Get recent health records first (these contain cached stats)
        const healthRecords = await dbHealthCollection.find({
            timestamp: { $gte: sinceDatetime }
        }).sort({ timestamp: -1 }).limit(100).toArray();
        
        // If no health records, return response with current storage
        if (healthRecords.length === 0) {
            return res.json({
                status: 'CONNECTED',
                uptime: 0,
                connections: {
                    current: 0,
                    available: 0,
                    totalCreated: 0,
                    avgActive: 0
                },
                storage: {
                    dataSize: currentStorage.dataSize,
                    indexSize: currentStorage.indexSize,
                    totalSize: currentStorage.dataSize + currentStorage.indexSize
                },
                performance: {
                    avgQueryTime: 0,
                    recentRecords: []
                },
                operations: {}
            });
        }
        
        // Calculate averages from health records
        const avgQueryTime = healthRecords.length > 0
            ? healthRecords.reduce((sum, h) => sum + (h.avgQueryTime || 0), 0) / healthRecords.length
            : 0;
        
        const avgConnections = healthRecords.length > 0
            ? healthRecords.reduce((sum, h) => sum + (h.activeConnections || 0), 0) / healthRecords.length
            : 0;
        
        // Get latest health record for current stats
        const latestRecord = healthRecords[0] || {};
        
        res.json({
            status: 'CONNECTED',
            uptime: latestRecord.uptime || 0,
            connections: {
                current: latestRecord.activeConnections || 0,
                available: 10,
                totalCreated: 0,
                avgActive: Math.round(avgConnections)
            },
            storage: {
                dataSize: currentStorage.dataSize,
                indexSize: currentStorage.indexSize,
                totalSize: currentStorage.dataSize + currentStorage.indexSize
            },
            performance: {
                avgQueryTime: parseFloat(avgQueryTime.toFixed(2)),
                recentRecords: healthRecords.slice(0, 10)
            },
            operations: {
                insert: latestRecord.operations?.insert || 0,
                query: latestRecord.operations?.query || 0,
                update: latestRecord.operations?.update || 0,
                delete: latestRecord.operations?.delete || 0
            }
        });
    } catch (error) {
        console.error(`❌ [ADMIN] Database health endpoint error: ${error.message}`);
        res.status(500).json({ status: 'ERROR', error: error.message });
    }
});

// Background task: Track database health every minute
setInterval(async () => {
    try {
        if (!db) return;
        const dbHealthCollection = db.collection('db_health');
        
        const startTime = Date.now();
        // Simple health check - just try to access collections
        const collections = await db.listCollections().toArray();
        const queryTime = Date.now() - startTime;
        
        // Get database statistics for storage tracking
        let storageStats = {
            dataSize: 0,
            indexSize: 0,
            storageSize: 0
        };
        
        try {
            const dbStats = await db.stats();
            storageStats = {
                dataSize: dbStats.dataSize || 0,
                indexSize: dbStats.indexSize || 0,
                storageSize: dbStats.storageSize || 0
            };
        } catch (statsError) {
            console.warn(`⚠️ [DB HEALTH] Could not retrieve storage stats: ${statsError.message}`);
        }
        
        // Count operations from the last hour
        const lastHour = new Date(Date.now() - 60 * 60 * 1000);
        const insertCount = await db.collection('audit_logs')
            .countDocuments({ timestamp: { $gte: lastHour }, action: { $in: ['PLATE_ADDED', 'VISITOR_PLATE_ADDED', 'INVITE_SENT'] } });
        const updateCount = await db.collection('audit_logs')
            .countDocuments({ timestamp: { $gte: lastHour }, action: { $in: ['PIN_CHANGED', 'VISITOR_MODIFIED'] } });
        const deleteCount = await db.collection('audit_logs')
            .countDocuments({ timestamp: { $gte: lastHour }, action: { $in: ['PLATE_REMOVED', 'VISITOR_PLATE_REMOVED', 'VISITOR_DELETED'] } });
        const queryCount = await db.collection('audit_logs')
            .countDocuments({ timestamp: { $gte: lastHour }, action: { $in: ['CODE_SENT'] } });
        
        await dbHealthCollection.insertOne({
            timestamp: new Date(),
            status: 'HEALTHY',
            uptime: Math.floor(process.uptime()),
            activeConnections: 1,
            avgQueryTime: queryTime,
            memory: process.memoryUsage(),
            storage: storageStats,
            operations: {
                insert: insertCount,
                update: updateCount,
                delete: deleteCount,
                query: queryCount
            }
        });
        
        // Keep only last 14 days of health records
        const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
        await dbHealthCollection.deleteMany({ timestamp: { $lt: twoWeeksAgo } });
    } catch (error) {
        console.error(`❌ [DB HEALTH] Tracking error: ${error.message}`);
    }
}, 60000); // Every minute
// ==================== SESSION MANAGEMENT ENDPOINTS ====================

// GET /admin/sessions - List all active sessions
app.get('/admin/sessions', requireLogin, requireAdmin, async (req, res) => {
    try {
        // Get sessions directly from MongoDB (the source of truth)
        if (!db) {
            return res.status(500).json({ error: 'Database connection not available' });
        }
        
        const sessionsCollection = db.collection('sessions');
        const mongoSessions = await sessionsCollection.find({}).toArray();
        
        // Parse session data and return
        const sessionData = mongoSessions.map(doc => {
            let session = {};
            // Session data is stored as JSON string in MongoStore
            try {
                session = typeof doc.session === 'string' ? JSON.parse(doc.session) : doc.session;
            } catch (e) {
                // Silently continue if session parse fails
            }
            
            return {
                sessionId: doc._id,  // Use MongoDB _id as the session ID
                email: session.email || session.user?.email || 'unknown',
                loginTime: session.loginTime || new Date(doc.createdAt || Date.now()),
                lastActivity: session.lastActivity || new Date(),
                ipAddress: session.ipAddress || 'unknown'
            };
        });
        res.json(sessionData);
    } catch (error) {
        console.error(`❌ [ADMIN] Sessions endpoint error: ${error.message}`);
        res.status(500).json({ error: 'Failed to fetch sessions' });
    }
});

// POST /admin/sessions/:sessionId/revoke - Revoke/logout a session
app.post('/admin/sessions/:sessionId/revoke', requireLogin, requireAdmin, async (req, res) => {
    const { sessionId } = req.params;
    const adminEmail = req.session.email;
    
    try {
        if (!db) {
            return res.status(500).json({ error: 'Database connection not available' });
        }
        
        const sessionsCollection = db.collection('sessions');
        
        // Delete the session from MongoDB using the _id
        const result = await sessionsCollection.deleteOne({ _id: sessionId });
        
        if (result.deletedCount > 0) {
            // Log the action
            logAdminAction(adminEmail, 'SESSION_REVOKED', {
                targetSessionId: sessionId,
                revokedBy: adminEmail,
                timestamp: new Date()
            });
            
            return res.json({ success: true, message: 'Session revoked successfully' });
        } else {
            console.error(`❌ [SESSIONS] Session not found in MongoDB: ${sessionId}`);
            return res.status(404).json({ error: 'Session not found' });
        }
    } catch (error) {
        console.error(`❌ [ADMIN] Revoke session error: ${error.message}`);
        res.status(500).json({ error: 'Failed to revoke session' });
    }
});

// POST /admin/sessions/revoke-all - Revoke all active sessions
app.post('/admin/sessions/revoke-all', requireLogin, requireAdmin, async (req, res) => {
    try {
        const adminEmail = req.session.email;
        
        if (!db) {
            return res.status(500).json({ error: 'Database connection not available' });
        }
        
        const sessionsCollection = db.collection('sessions');
        
        // Get all sessions from MongoDB
        const allSessions = await sessionsCollection.find({}).toArray();
        
        if (!allSessions || allSessions.length === 0) {
            logAdminAction(adminEmail, 'REVOKE_ALL_SESSIONS', {
                revokedCount: 0,
                timestamp: new Date()
            });
            return res.json({ success: true, revokedCount: 0, message: 'No sessions to revoke' });
        }
        
        // Get the current session ID from the request
        const currentSessionId = req.sessionID;
        
        // Filter out the admin's own session
        const sessionsToRevoke = allSessions.filter(session => session._id !== currentSessionId);
        
        if (sessionsToRevoke.length === 0) {
            logAdminAction(adminEmail, 'REVOKE_ALL_SESSIONS', {
                revokedCount: 0,
                timestamp: new Date()
            });
            return res.json({ success: true, revokedCount: 0, message: 'No other sessions to revoke' });
        }
        
        // Delete all other sessions from MongoDB
        const sessionIdsToRevoke = sessionsToRevoke.map(s => s._id);
        const result = await sessionsCollection.deleteMany({
            _id: { $in: sessionIdsToRevoke }
        });
        
        const revokedCount = result.deletedCount || 0;
        
        logAdminAction(adminEmail, 'REVOKE_ALL_SESSIONS', {
            revokedCount: revokedCount,
            revokedIds: sessionIdsToRevoke,
            timestamp: new Date()
        });
        
        res.json({ 
            success: true, 
            revokedCount: revokedCount, 
            message: `Revoked ${revokedCount} sessions` 
        });
    } catch (error) {
        console.error(`❌ [ADMIN] Revoke all sessions error: ${error.message}`);
        res.status(500).json({ error: 'Failed to revoke sessions' });
    }
});

// ==================== AUDIT LOG ENDPOINTS ====================

// GET /admin/audit-logs - List audit logs
app.get('/admin/audit-logs', requireLogin, requireAdmin, async (req, res) => {
    try {
        const auditCollection = db.collection('audit_logs');
        const limit = parseInt(req.query.limit) || 100;
        
        let logs = await auditCollection
            .find({})
            .sort({ timestamp: -1 })
            .limit(limit)
            .toArray();
        
        // Enrich logs with user names
        if (usersCollection) {
            const enrichedLogs = await Promise.all(logs.map(async (log) => {
                try {
                    const user = await usersCollection.findOne({ email: log.email });
                    let userName = '-';
                    if (user) {
                        // Construct name from UniFi user object
                        if (user.first_name && user.last_name) {
                            userName = `${user.first_name} ${user.last_name}`;
                        } else if (user.first_name) {
                            userName = user.first_name;
                        } else if (user.last_name) {
                            userName = user.last_name;
                        } else if (user.name) {
                            userName = user.name;
                        }
                    }
                    return {
                        ...log,
                        userName: userName
                    };
                } catch (error) {
                    return {
                        ...log,
                        userName: '-'
                    };
                }
            }));
            res.json(enrichedLogs);
        } else {
            res.json(logs);
        }
    } catch (error) {
        console.error(`❌ [ADMIN] Audit logs error: ${error.message}`);
        res.status(500).json({ error: 'Failed to fetch audit logs' });
    }
});

// GET /admin/comprehensive-metrics - All dashboard metrics
app.get('/admin/comprehensive-metrics', requireLogin, requireAdmin, async (req, res) => {
    try {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const last7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const last30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

        // User Activity
        const activeUsersLast7d = await db.collection('audit_logs')
            .distinct('email', { timestamp: { $gte: last7Days } });
        const activeUsersLast30d = await db.collection('audit_logs')
            .distinct('email', { timestamp: { $gte: last30Days } });
        const loginToday = await db.collection('audit_logs')
            .countDocuments({ timestamp: { $gte: today }, action: { $in: ['PIN_CHANGED', 'PLATE_ADDED', 'PLATE_REMOVED', 'INVITE_SENT'] } });

        // License Plate Operations
        const totalPlates = await db.collection('user_data')
            .aggregate([
                { $match: { plates: { $exists: true } } },
                { $project: { count: { $size: '$plates' } } },
                { $group: { _id: null, total: { $sum: '$count' } } }
            ]).toArray();
        const platesAddedToday = await db.collection('audit_logs')
            .countDocuments({ timestamp: { $gte: today }, action: 'PLATE_ADDED' });
        const platesRemovedToday = await db.collection('audit_logs')
            .countDocuments({ timestamp: { $gte: today }, action: 'PLATE_REMOVED' });

        // PIN Management
        const pinChangesToday = await db.collection('audit_logs')
            .countDocuments({ timestamp: { $gte: today }, action: 'PIN_CHANGED' });

        // Visitor Management
        const totalVisitors = await db.collection('visitors_cache')
            .countDocuments({});
        
        // Visitors modified today (from modification history)
        const visitorsModifiedToday = await db.collection('visitor_modification_history')
            .countDocuments({ timestamp: { $gte: today } });
        
        // Visitors expiring soon (next 7 days) - check if they have an expiry date
        const expiringVisitors = await db.collection('visitors_cache')
            .aggregate([
                { 
                    $match: { 
                        $or: [
                            { access_end_date: { $gte: now, $lte: nextWeek } },
                            { expiry_date: { $gte: now, $lte: nextWeek } }
                        ]
                    }
                },
                { $sort: { access_end_date: 1, expiry_date: 1 } },
                { $limit: 10 }
            ])
            .toArray();

        // Authentication Health
        const failedLogins = await db.collection('failed_login_attempts')
            .countDocuments({ timestamp: { $gte: last24Hours } });
        const invalidEmailAttempts = await db.collection('failed_login_attempts')
            .countDocuments({ timestamp: { $gte: last24Hours }, reason: 'user_not_found' });

        // Invitations
        const pendingInvites = await db.collection('visitor_invites')
            .countDocuments({ status: 'pending' });
        const acceptedToday = await db.collection('audit_logs')
            .countDocuments({ timestamp: { $gte: today }, action: 'INVITE_ACCEPTED' });
        const invitesSentToday = await db.collection('audit_logs')
            .countDocuments({ timestamp: { $gte: today }, action: 'INVITE_SENT' });

        // System Health - Last sync time
        const usersCacheLastSync = await db.collection('users_cache')
            .aggregate([
                { $sort: { lastSync: -1 } },
                { $limit: 1 }
            ])
            .toArray();
        const lastSyncTime = usersCacheLastSync && usersCacheLastSync.length > 0 ? usersCacheLastSync[0].lastSync : 'Never';

        // Top Users by Actions (last 7 days)
        const topUsersRaw = await db.collection('audit_logs')
            .aggregate([
                { $match: { timestamp: { $gte: last7Days }, email: { $ne: null, $ne: '' } } },
                { $group: { _id: { $toLower: '$email' }, count: { $sum: 1 } } },
                { $sort: { count: -1 } },
                { $limit: 10 }
            ]).toArray();
        
        // Enrich top users with names
        const topUsers = (await Promise.all(topUsersRaw.map(async (user) => {
            let userName = user._id; // Default to email
            if (usersCollection) {
                try {
                    // Case-insensitive email lookup
                    const userDoc = await usersCollection.findOne({ 
                        email: { $regex: `^${user._id}$`, $options: 'i' }
                    });
                    if (userDoc) {
                        // Construct name from UniFi user object
                        const firstName = userDoc.first_name?.trim() || '';
                        const lastName = userDoc.last_name?.trim() || '';
                        
                        if (firstName && lastName) {
                            userName = `${firstName} ${lastName}`;
                        } else if (firstName) {
                            userName = firstName;
                        } else if (lastName) {
                            userName = lastName;
                        }
                        // If still no name found, keep the email as fallback
                    }
                } catch (error) {
                    // Keep email as fallback
                }
            }
            return {
                ...user,
                name: userName || user._id  // Ensure name is never null

            };
        })));

        // Top Actions (last 7 days) - exclude admin actions, dashboard access, codes sent, and null values
        const topActions = await db.collection('audit_logs')
            .aggregate([
                { $match: { 
                    timestamp: { $gte: last7Days },
                    action: { 
                        $nin: ['DASHBOARD_ACCESS', 'SESSION_REVOKED', 'REVOKE_ALL_SESSIONS', 'ADMIN_ALERT_SENT', 'CODE_SENT', null] 
                    }
                } },
                { $group: { _id: '$action', count: { $sum: 1 } } },
                { $sort: { count: -1 } }
            ]).toArray();

        // User activity by day (last 7 days)
        const activityByDay = await db.collection('audit_logs')
            .aggregate([
                { $match: { timestamp: { $gte: last7Days } } },
                { $group: { 
                    _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
                    count: { $sum: 1 }
                } },
                { $sort: { _id: 1 } }
            ]).toArray();

        res.json({
            userActivity: {
                activeUsersLast7d: activeUsersLast7d.length,
                activeUsersLast30d: activeUsersLast30d.length,
                actionsToday: loginToday
            },
            licensePlates: {
                total: totalPlates[0]?.total || 0,
                addedToday: platesAddedToday,
                removedToday: platesRemovedToday
            },
            pins: {
                changedToday: pinChangesToday
            },
            visitors: {
                total: totalVisitors,
                modifiedToday: visitorsModifiedToday,
                expiringNext7Days: expiringVisitors.length,
                expiringList: expiringVisitors.slice(0, 5).map(v => ({
                    id: v.id || v._id,
                    name: v.name || v.first_name + ' ' + v.last_name || 'Unknown',
                    endDate: v.access_end_date || v.expiry_date
                }))
            },
            authentication: {
                failedLoginsLast24h: failedLogins,
                invalidEmailAttempts: invalidEmailAttempts
            },
            invitations: {
                pending: pendingInvites,
                acceptedToday: acceptedToday,
                sentToday: invitesSentToday
            },
            systemHealth: {
                lastSyncTime: lastSyncTime
            },
            topUsers: topUsers,
            topActions: topActions,
            activityByDay: activityByDay
        });
    } catch (error) {
        console.error(`❌ [ADMIN] Metrics error: ${error.message}`);
        res.status(500).json({ error: 'Failed to fetch metrics' });
    }
});

// Get last seen date for visitor based on their license plates
app.get('/api/visitor-last-seen/:visitorId', requireLogin, async (req, res) => {
    try {
        const { visitorId } = req.params;
        
        // Fetch visitor to get their license plates
        const UNIFA_API_URL = process.env.UNIFA_API_URL;
        const UNIFA_BEARER_TOKEN = process.env.UNIFA_BEARER_TOKEN;
        if (!UNIFA_API_URL) {
            console.error('UNIFA_API_URL not set. See .env.example');
            return res.status(500).json({ error: 'Server configuration error' });
        }
        if (!UNIFA_BEARER_TOKEN) {
            console.error('UNIFA_BEARER_TOKEN not set. See .env.example');
            return res.status(500).json({ error: 'Server configuration error' });
        }
        const API_BASE = `${UNIFA_API_URL}/api/v1/developer`;
        const AUTH_HEADER = `Authorization: Bearer ${UNIFA_BEARER_TOKEN}`;
        const getCommand = `curl -s -k "${API_BASE}/visitors/${visitorId}" -H "${AUTH_HEADER}"`;
        
        exec(getCommand, { timeout: 30000 }, async (error, stdout, stderr) => {
            if (error) {
                return res.status(500).json({ error: 'Failed to fetch visitor details' });
            }
            
            try {
                const visitorData = JSON.parse(stdout);
                const visitor = visitorData.data || visitorData;
                
                if (!visitor) {
                    return res.status(404).json({ error: 'Visitor not found' });
                }
                
                const plates = visitor.license_plates || [];
                
                if (plates.length === 0) {
                    return res.json({ lastSeen: null, plateDetails: [] });
                }
                
                // Find the most recent capture for any of the visitor's plates
                const lprTable = db.collection('license_plates');
                const plateList = plates.map(p => typeof p === 'string' ? p : p.credential);
                
                // Get the last seen date for each plate
                const plateDates = [];
                
                for (const plate of plateList) {
                    const lastCapture = await lprTable.findOne(
                        { license_plate: plate },
                        { sort: { timestamp: -1 } }
                    );
                    
                    plateDates.push({
                        plate: plate,
                        lastSeen: lastCapture ? lastCapture.timestamp : null
                    });
                }
                
                // Get the overall most recent capture
                const allRecentCaptures = await lprTable
                    .find({ license_plate: { $in: plateList } })
                    .sort({ timestamp: -1 })
                    .limit(1)
                    .toArray();
                
                const lastSeen = allRecentCaptures.length > 0 ? allRecentCaptures[0].timestamp : null;
                
                res.json({ 
                    lastSeen: lastSeen,
                    plateDetails: plateDates
                });
                
            } catch (parseError) {
                res.status(500).json({ error: 'Failed to parse visitor data' });
            }
        });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get last seen date for a specific license plate
app.get('/api/license-plate-last-seen/:plate', (req, res) => {
    try {
        const { plate } = req.params;
        const sanitizedPlate = plate.trim().toUpperCase();
        
        if (!db) {
            return res.status(500).json({ error: 'Database connection not available' });
        }
        
        const lprTable = db.collection('license_plates');
        lprTable.findOne(
            { license_plate: sanitizedPlate },
            { sort: { timestamp: -1 } }
        ).then(result => {
            if (result) {
                res.json({ lastSeen: result.timestamp });
            } else {
                res.json({ lastSeen: null });
            }
        }).catch(error => {
            console.error(`Error fetching last seen for plate ${sanitizedPlate}:`, error);
            res.status(500).json({ error: 'Failed to fetch last seen date' });
        });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get plate detection count for last 7 days
app.get('/api/license-plate-7day-count/:plate', (req, res) => {
    try {
        const { plate } = req.params;
        const sanitizedPlate = plate.trim().toUpperCase();
        
        if (!db) {
            return res.status(500).json({ error: 'Database connection not available' });
        }
        
        const last7days = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const lprTable = db.collection('license_plates');
        
        lprTable.countDocuments({
            license_plate: sanitizedPlate,
            timestamp: { $gte: last7days }
        }).then(count => {
            res.json({ count: count });
        }).catch(error => {
            console.error(`Error counting detections for plate ${sanitizedPlate}:`, error);
            res.status(500).json({ error: 'Failed to count detections' });
        });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get plate detection count for last 24 hours
app.get('/api/license-plate-24hour-count/:plate', (req, res) => {
    try {
        const { plate } = req.params;
        const sanitizedPlate = plate.trim().toUpperCase();
        
        if (!db) {
            return res.status(500).json({ error: 'Database connection not available' });
        }
        
        const last24hours = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const lprTable = db.collection('license_plates');
        
        lprTable.countDocuments({
            license_plate: sanitizedPlate,
            timestamp: { $gte: last24hours }
        }).then(count => {
            res.json({ count: count });
        }).catch(error => {
            console.error(`Error counting 24h detections for plate ${sanitizedPlate}:`, error);
            res.status(500).json({ error: 'Failed to count detections' });
        });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get plate detection count for last 30 days
app.get('/api/license-plate-30day-count/:plate', (req, res) => {
    try {
        const { plate } = req.params;
        const sanitizedPlate = plate.trim().toUpperCase();
        
        if (!db) {
            return res.status(500).json({ error: 'Database connection not available' });
        }
        
        const last30days = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const lprTable = db.collection('license_plates');
        
        lprTable.countDocuments({
            license_plate: sanitizedPlate,
            timestamp: { $gte: last30days }
        }).then(count => {
            res.json({ count: count });
        }).catch(error => {
            console.error(`Error counting 30d detections for plate ${sanitizedPlate}:`, error);
            res.status(500).json({ error: 'Failed to count detections' });
        });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});