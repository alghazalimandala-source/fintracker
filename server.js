// ============================================
// FINTrack PRO - Backend Server
// Database Management & API Endpoints
// ============================================

const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// MIDDLEWARE CONFIGURATION
// ============================================

// CORS Configuration
app.use(cors({
    origin: ['http://localhost:5500', 'http://127.0.0.1:5500', 'http://localhost:3000'],
    credentials: true
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve static files
app.use(express.static('public'));

// ============================================
// FIREBASE ADMIN INITIALIZATION
// ============================================

// Initialize Firebase Admin
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "absensi-ca90c.firebasestorage.app"
});

const db = admin.firestore();
const auth = admin.auth();
const storage = admin.storage().bucket();

// ============================================
// MULTER CONFIGURATION (File Upload)
// ============================================

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage_multer = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueName = `${Date.now()}_${uuidv4()}${path.extname(file.originalname)}`;
        cb(null, uniqueName);
    }
});

const upload = multer({
    storage: storage_multer,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|webp/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        
        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Hanya file gambar yang diperbolehkan!'));
        }
    }
});

// ============================================
// AUTH MIDDLEWARE
// ============================================

const verifyToken = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.split('Bearer ')[1];
        
        if (!token) {
            return res.status(401).json({
                success: false,
                message: 'Token tidak ditemukan'
            });
        }

        const decodedToken = await auth.verifyIdToken(token);
        req.user = decodedToken;
        next();
    } catch (error) {
        console.error('Auth Error:', error);
        return res.status(401).json({
            success: false,
            message: 'Token tidak valid',
            error: error.message
        });
    }
};

// ============================================
// DATABASE HELPERS
// ============================================

class DatabaseHelper {
    constructor() {
        this.db = db;
    }

    // Get collection reference with optional filters
    getCollectionRef(collectionName, filters = {}) {
        let ref = this.db.collection(collectionName);
        
        if (filters.uid) {
            ref = ref.where('uid', '==', filters.uid);
        }
        
        if (filters.type) {
            ref = ref.where('type', '==', filters.type);
        }
        
        if (filters.category) {
            ref = ref.where('category', '==', filters.category);
        }
        
        if (filters.startDate && filters.endDate) {
            ref = ref.where('date', '>=', filters.startDate)
                     .where('date', '<=', filters.endDate);
        }
        
        return ref;
    }

    // CRUD Operations
    async create(collectionName, data) {
        try {
            const docRef = await this.db.collection(collectionName).add({
                ...data,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            
            return {
                success: true,
                id: docRef.id,
                data: data
            };
        } catch (error) {
            console.error('Create Error:', error);
            throw error;
        }
    }

    async read(collectionName, docId) {
        try {
            const doc = await this.db.collection(collectionName).doc(docId).get();
            
            if (!doc.exists) {
                return {
                    success: false,
                    message: 'Dokumen tidak ditemukan'
                };
            }
            
            return {
                success: true,
                id: doc.id,
                data: doc.data()
            };
        } catch (error) {
            console.error('Read Error:', error);
            throw error;
        }
    }

    async update(collectionName, docId, data) {
        try {
            await this.db.collection(collectionName).doc(docId).update({
                ...data,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            
            return {
                success: true,
                message: 'Dokumen berhasil diupdate'
            };
        } catch (error) {
            console.error('Update Error:', error);
            throw error;
        }
    }

    async delete(collectionName, docId) {
        try {
            await this.db.collection(collectionName).doc(docId).delete();
            
            return {
                success: true,
                message: 'Dokumen berhasil dihapus'
            };
        } catch (error) {
            console.error('Delete Error:', error);
            throw error;
        }
    }

    async list(collectionName, filters = {}, orderByField = 'date', orderDirection = 'desc', limit = 50) {
        try {
            let ref = this.getCollectionRef(collectionName, filters);
            ref = ref.orderBy(orderByField, orderDirection).limit(limit);
            
            const snapshot = await ref.get();
            const documents = [];
            
            snapshot.forEach(doc => {
                documents.push({
                    id: doc.id,
                    ...doc.data()
                });
            });
            
            return {
                success: true,
                count: documents.length,
                data: documents
            };
        } catch (error) {
            console.error('List Error:', error);
            throw error;
        }
    }

    // Bulk operations
    async bulkCreate(collectionName, dataArray) {
        try {
            const batch = this.db.batch();
            const results = [];
            
            dataArray.forEach(data => {
                const docRef = this.db.collection(collectionName).doc();
                batch.set(docRef, {
                    ...data,
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });
                results.push({ id: docRef.id, data });
            });
            
            await batch.commit();
            
            return {
                success: true,
                count: results.length,
                data: results
            };
        } catch (error) {
            console.error('Bulk Create Error:', error);
            throw error;
        }
    }

    async bulkDelete(collectionName, filters) {
        try {
            const snapshot = await this.getCollectionRef(collectionName, filters).get();
            const batch = this.db.batch();
            
            snapshot.forEach(doc => {
                batch.delete(doc.ref);
            });
            
            await batch.commit();
            
            return {
                success: true,
                count: snapshot.size,
                message: `${snapshot.size} dokumen berhasil dihapus`
            };
        } catch (error) {
            console.error('Bulk Delete Error:', error);
            throw error;
        }
    }

    // Aggregation queries
    async getStats(collectionName, uid) {
        try {
            const snapshot = await this.db.collection(collectionName)
                .where('uid', '==', uid)
                .get();
            
            let totalIncome = 0;
            let totalExpense = 0;
            let count = 0;
            const categories = {};
            const monthlyData = {};
            
            snapshot.forEach(doc => {
                const data = doc.data();
                count++;
                
                if (data.type === 'income') {
                    totalIncome += data.amount || 0;
                } else {
                    totalExpense += data.amount || 0;
                }
                
                // Track categories
                if (data.category) {
                    categories[data.category] = (categories[data.category] || 0) + (data.amount || 0);
                }
                
                // Track monthly data
                if (data.date) {
                    const month = data.date.substring(0, 7); // YYYY-MM
                    if (!monthlyData[month]) {
                        monthlyData[month] = { income: 0, expense: 0 };
                    }
                    if (data.type === 'income') {
                        monthlyData[month].income += data.amount || 0;
                    } else {
                        monthlyData[month].expense += data.amount || 0;
                    }
                }
            });
            
            return {
                success: true,
                data: {
                    totalIncome,
                    totalExpense,
                    balance: totalIncome - totalExpense,
                    totalTransactions: count,
                    categories,
                    monthlyData
                }
            };
        } catch (error) {
            console.error('Stats Error:', error);
            throw error;
        }
    }
}

const dbHelper = new DatabaseHelper();

// ============================================
// STORAGE HELPERS
// ============================================

class StorageHelper {
    async uploadFile(filePath, destination, metadata = {}) {
        try {
            const [file] = await storage.upload(filePath, {
                destination: destination,
                metadata: {
                    contentType: metadata.contentType || 'application/octet-stream',
                    metadata: {
                        firebaseStorageDownloadTokens: uuidv4(),
                        ...metadata
                    }
                }
            });
            
            // Get public URL
            const [url] = await file.getSignedUrl({
                action: 'read',
                expires: '03-01-2030'
            });
            
            // Delete local file after upload
            fs.unlinkSync(filePath);
            
            return {
                success: true,
                url: url,
                fileName: destination
            };
        } catch (error) {
            console.error('Upload Error:', error);
            // Clean up local file if exists
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
            throw error;
        }
    }

    async deleteFile(fileName) {
        try {
            await storage.file(fileName).delete();
            return {
                success: true,
                message: 'File berhasil dihapus'
            };
        } catch (error) {
            console.error('Delete File Error:', error);
            throw error;
        }
    }

    async getFileUrl(fileName) {
        try {
            const [url] = await storage.file(fileName).getSignedUrl({
                action: 'read',
                expires: '03-01-2030'
            });
            
            return {
                success: true,
                url: url
            };
        } catch (error) {
            console.error('Get File URL Error:', error);
            throw error;
        }
    }
}

const storageHelper = new StorageHelper();

// ============================================
// CACHE SYSTEM
// ============================================

class CacheSystem {
    constructor(ttl = 300) { // Default TTL: 5 minutes
        this.cache = new Map();
        this.ttl = ttl * 1000;
    }

    set(key, value) {
        const expiry = Date.now() + this.ttl;
        this.cache.set(key, { value, expiry });
        
        // Auto cleanup expired items
        setTimeout(() => {
            this.cache.delete(key);
        }, this.ttl);
    }

    get(key) {
        const item = this.cache.get(key);
        
        if (!item) return null;
        
        if (Date.now() > item.expiry) {
            this.cache.delete(key);
            return null;
        }
        
        return item.value;
    }

    delete(key) {
        this.cache.delete(key);
    }

    clear() {
        this.cache.clear();
    }

    getStats() {
        return {
            size: this.cache.size,
            keys: Array.from(this.cache.keys())
        };
    }
}

const cache = new CacheSystem(300); // 5 minutes cache

// ============================================
// API ROUTES
// ============================================

// Health Check
app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        message: 'FinTrack API is running',
        timestamp: new Date().toISOString(),
        version: '1.0.0'
    });
});

// ============================================
// USER MANAGEMENT ROUTES
// ============================================

// Get user profile
app.get('/api/users/profile', verifyToken, async (req, res) => {
    try {
        const cacheKey = `user_${req.user.uid}`;
        const cachedData = cache.get(cacheKey);
        
        if (cachedData) {
            return res.json({
                success: true,
                data: cachedData,
                fromCache: true
            });
        }
        
        const result = await dbHelper.read('users', req.user.uid);
        
        if (result.success) {
            cache.set(cacheKey, result.data);
        }
        
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Gagal mengambil profil',
            error: error.message
        });
    }
});

// Create/Update user profile
app.post('/api/users/profile', verifyToken, async (req, res) => {
    try {
        const { username, email } = req.body;
        
        const userData = {
            username: username || req.user.name,
            email: email || req.user.email,
            uid: req.user.uid
        };
        
        // Check if user exists
        const existingUser = await dbHelper.read('users', req.user.uid);
        
        let result;
        if (existingUser.success) {
            result = await dbHelper.update('users', req.user.uid, userData);
        } else {
            result = await dbHelper.create('users', { id: req.user.uid, ...userData });
        }
        
        // Clear cache
        cache.delete(`user_${req.user.uid}`);
        
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Gagal menyimpan profil',
            error: error.message
        });
    }
});

// Upload profile photo
app.post('/api/users/profile/photo', verifyToken, upload.single('photo'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'File foto tidak ditemukan'
            });
        }
        
        const fileName = `profile_photos/${req.user.uid}/${Date.now()}_${req.file.originalname}`;
        
        const result = await storageHelper.uploadFile(req.file.path, fileName, {
            contentType: req.file.mimetype
        });
        
        // Update user profile with photo URL
        await dbHelper.update('users', req.user.uid, {
            photoURL: result.url
        });
        
        // Clear cache
        cache.delete(`user_${req.user.uid}`);
        
        res.json({
            success: true,
            photoURL: result.url,
            message: 'Foto profil berhasil diupload'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Gagal upload foto',
            error: error.message
        });
    }
});

// ============================================
// TRANSACTION MANAGEMENT ROUTES
// ============================================

// Get all transactions
app.get('/api/transactions', verifyToken, async (req, res) => {
    try {
        const { 
            type, 
            category, 
            startDate, 
            endDate, 
            orderBy = 'date', 
            orderDirection = 'desc',
            limit = 50 
        } = req.query;
        
        const filters = { uid: req.user.uid };
        
        if (type) filters.type = type;
        if (category) filters.category = category;
        if (startDate && endDate) {
            filters.startDate = startDate;
            filters.endDate = endDate;
        }
        
        const cacheKey = `transactions_${req.user.uid}_${JSON.stringify(filters)}`;
        const cachedData = cache.get(cacheKey);
        
        if (cachedData) {
            return res.json({
                success: true,
                data: cachedData,
                fromCache: true
            });
        }
        
        const result = await dbHelper.list(
            'transactions', 
            filters, 
            orderBy, 
            orderDirection, 
            parseInt(limit)
        );
        
        if (result.success) {
            cache.set(cacheKey, result.data);
        }
        
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Gagal mengambil transaksi',
            error: error.message
        });
    }
});

// Get transaction by ID
app.get('/api/transactions/:id', verifyToken, async (req, res) => {
    try {
        const result = await dbHelper.read('transactions', req.params.id);
        
        // Verify ownership
        if (result.success && result.data.uid !== req.user.uid) {
            return res.status(403).json({
                success: false,
                message: 'Anda tidak memiliki akses ke transaksi ini'
            });
        }
        
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Gagal mengambil transaksi',
            error: error.message
        });
    }
});

// Create transaction
app.post('/api/transactions', verifyToken, async (req, res) => {
    try {
        const { title, amount, type, category, date, note } = req.body;
        
        // Validation
        if (!title || !amount || !type || !category || !date) {
            return res.status(400).json({
                success: false,
                message: 'Semua field wajib diisi'
            });
        }
        
        if (!['income', 'expense'].includes(type)) {
            return res.status(400).json({
                success: false,
                message: 'Tipe transaksi tidak valid'
            });
        }
        
        const transactionData = {
            uid: req.user.uid,
            title,
            amount: parseFloat(amount),
            type,
            category,
            date,
            note: note || '',
            createdBy: req.user.email
        };
        
        const result = await dbHelper.create('transactions', transactionData);
        
        // Clear cache
        cache.clear(); // Clear all transaction caches
        
        res.status(201).json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Gagal membuat transaksi',
            error: error.message
        });
    }
});

// Update transaction
app.put('/api/transactions/:id', verifyToken, async (req, res) => {
    try {
        // Verify ownership first
        const existing = await dbHelper.read('transactions', req.params.id);
        if (existing.success && existing.data.uid !== req.user.uid) {
            return res.status(403).json({
                success: false,
                message: 'Anda tidak memiliki akses ke transaksi ini'
            });
        }
        
        const { title, amount, type, category, date, note } = req.body;
        
        const updateData = {};
        if (title) updateData.title = title;
        if (amount) updateData.amount = parseFloat(amount);
        if (type) updateData.type = type;
        if (category) updateData.category = category;
        if (date) updateData.date = date;
        if (note !== undefined) updateData.note = note;
        
        const result = await dbHelper.update('transactions', req.params.id, updateData);
        
        // Clear cache
        cache.clear();
        
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Gagal mengupdate transaksi',
            error: error.message
        });
    }
});

// Delete transaction
app.delete('/api/transactions/:id', verifyToken, async (req, res) => {
    try {
        // Verify ownership first
        const existing = await dbHelper.read('transactions', req.params.id);
        if (existing.success && existing.data.uid !== req.user.uid) {
            return res.status(403).json({
                success: false,
                message: 'Anda tidak memiliki akses ke transaksi ini'
            });
        }
        
        const result = await dbHelper.delete('transactions', req.params.id);
        
        // Clear cache
        cache.clear();
        
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Gagal menghapus transaksi',
            error: error.message
        });
    }
});

// Bulk create transactions
app.post('/api/transactions/bulk', verifyToken, async (req, res) => {
    try {
        const { transactions } = req.body;
        
        if (!Array.isArray(transactions) || transactions.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Data transaksi tidak valid'
            });
        }
        
        // Add uid to each transaction
        const transactionsWithUid = transactions.map(t => ({
            ...t,
            uid: req.user.uid,
            createdBy: req.user.email
        }));
        
        const result = await dbHelper.bulkCreate('transactions', transactionsWithUid);
        
        // Clear cache
        cache.clear();
        
        res.status(201).json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Gagal membuat transaksi bulk',
            error: error.message
        });
    }
});

// ============================================
// STATISTICS & ANALYTICS ROUTES
// ============================================

// Get transaction statistics
app.get('/api/stats', verifyToken, async (req, res) => {
    try {
        const cacheKey = `stats_${req.user.uid}`;
        const cachedData = cache.get(cacheKey);
        
        if (cachedData) {
            return res.json({
                success: true,
                data: cachedData,
                fromCache: true
            });
        }
        
        const result = await dbHelper.getStats('transactions', req.user.uid);
        
        if (result.success) {
            cache.set(cacheKey, result.data);
        }
        
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Gagal mengambil statistik',
            error: error.message
        });
    }
});

// Get monthly report
app.get('/api/reports/monthly', verifyToken, async (req, res) => {
    try {
        const { year, month } = req.query;
        
        if (!year || !month) {
            return res.status(400).json({
                success: false,
                message: 'Parameter tahun dan bulan diperlukan'
            });
        }
        
        const startDate = `${year}-${month.padStart(2, '0')}-01`;
        const endDate = `${year}-${month.padStart(2, '0')}-31`;
        
        const filters = {
            uid: req.user.uid,
            startDate,
            endDate
        };
        
        const result = await dbHelper.list('transactions', filters);
        
        let totalIncome = 0;
        let totalExpense = 0;
        const categoryBreakdown = {};
        
        result.data.forEach(t => {
            if (t.type === 'income') {
                totalIncome += t.amount;
            } else {
                totalExpense += t.amount;
            }
            
            if (!categoryBreakdown[t.category]) {
                categoryBreakdown[t.category] = { income: 0, expense: 0 };
            }
            categoryBreakdown[t.category][t.type] += t.amount;
        });
        
        res.json({
            success: true,
            data: {
                year,
                month,
                totalIncome,
                totalExpense,
                balance: totalIncome - totalExpense,
                transactionCount: result.count,
                categoryBreakdown,
                transactions: result.data
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Gagal membuat laporan',
            error: error.message
        });
    }
});

// Export data
app.get('/api/export/:format', verifyToken, async (req, res) => {
    try {
        const { format } = req.params;
        const { startDate, endDate } = req.query;
        
        const filters = { uid: req.user.uid };
        if (startDate && endDate) {
            filters.startDate = startDate;
            filters.endDate = endDate;
        }
        
        const result = await dbHelper.list('transactions', filters, 'date', 'asc', 1000);
        
        if (format === 'json') {
            res.json(result);
        } else if (format === 'csv') {
            // Generate CSV
            const csvHeaders = ['Judul', 'Nominal', 'Kategori', 'Tipe', 'Tanggal', 'Keterangan'];
            const csvData = result.data.map(t => [
                t.title,
                t.amount,
                t.category,
                t.type === 'income' ? 'Pemasukan' : 'Pengeluaran',
                t.date,
                t.note || '-'
            ]);
            
            let csv = csvHeaders.join(',') + '\n';
            csvData.forEach(row => {
                csv += row.map(cell => `"${cell}"`).join(',') + '\n';
            });
            
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename=transactions_${Date.now()}.csv`);
            res.send(csv);
        } else {
            res.status(400).json({
                success: false,
                message: 'Format export tidak didukung'
            });
        }
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Gagal export data',
            error: error.message
        });
    }
});

// ============================================
// ADMIN ROUTES (Protected)
// ============================================

// Get all users (Admin only)
app.get('/api/admin/users', verifyToken, async (req, res) => {
    try {
        // You should add admin check here
        const snapshot = await db.collection('users').get();
        const users = [];
        
        snapshot.forEach(doc => {
            users.push({
                id: doc.id,
                ...doc.data()
            });
        });
        
        res.json({
            success: true,
            count: users.length,
            data: users
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Gagal mengambil data users',
            error: error.message
        });
    }
});

// Get system statistics (Admin only)
app.get('/api/admin/stats', verifyToken, async (req, res) => {
    try {
        const [usersSnapshot, transactionsSnapshot] = await Promise.all([
            db.collection('users').get(),
            db.collection('transactions').get()
        ]);
        
        const stats = {
            totalUsers: usersSnapshot.size,
            totalTransactions: transactionsSnapshot.size,
            cacheStats: cache.getStats(),
            serverUptime: process.uptime(),
            memoryUsage: process.memoryUsage()
        };
        
        res.json({
            success: true,
            data: stats
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Gagal mengambil statistik sistem',
            error: error.message
        });
    }
});

// ============================================
// ERROR HANDLING MIDDLEWARE
// ============================================

app.use((err, req, res, next) => {
    console.error('Global Error:', err);
    
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                success: false,
                message: 'Ukuran file terlalu besar (max 5MB)'
            });
        }
    }
    
    res.status(500).json({
        success: false,
        message: 'Internal Server Error',
        error: process.env.NODE_ENV === 'development' ? err.message : 'Terjadi kesalahan'
    });
});

// 404 Handler
app.use('*', (req, res) => {
    res.status(404).json({
        success: false,
        message: 'Endpoint tidak ditemukan'
    });
});

// ============================================
// DATABASE BACKUP SYSTEM
// ============================================

class BackupSystem {
    async createBackup() {
        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupDir = path.join(__dirname, 'backups', timestamp);
            
            if (!fs.existsSync(backupDir)) {
                fs.mkdirSync(backupDir, { recursive: true });
            }
            
            // Backup all collections
            const collections = ['users', 'transactions'];
            
            for (const collectionName of collections) {
                const snapshot = await db.collection(collectionName).get();
                const data = [];
                
                snapshot.forEach(doc => {
                    data.push({
                        id: doc.id,
                        ...doc.data()
                    });
                });
                
                const filePath = path.join(backupDir, `${collectionName}.json`);
                fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
            }
            
            console.log(`✅ Backup created: ${backupDir}`);
            
            return {
                success: true,
                backupPath: backupDir,
                timestamp: timestamp
            };
        } catch (error) {
            console.error('Backup Error:', error);
            throw error;
        }
    }
    
    async restoreBackup(backupPath) {
        try {
            if (!fs.existsSync(backupPath)) {
                throw new Error('Backup path not found');
            }
            
            const files = fs.readdirSync(backupPath);
            
            for (const file of files) {
                const collectionName = path.basename(file, '.json');
                const filePath = path.join(backupPath, file);
                const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                
                const batch = db.batch();
                
                data.forEach(item => {
                    const { id, ...itemData } = item;
                    const docRef = db.collection(collectionName).doc(id);
                    batch.set(docRef, itemData);
                });
                
                await batch.commit();
            }
            
            console.log(`✅ Backup restored from: ${backupPath}`);
            
            return {
                success: true,
                message: 'Backup restored successfully'
            };
        } catch (error) {
            console.error('Restore Error:', error);
            throw error;
        }
    }
}

const backupSystem = new BackupSystem();

// Manual backup endpoint (Admin only)
app.post('/api/admin/backup', verifyToken, async (req, res) => {
    try {
        const result = await backupSystem.createBackup();
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Gagal membuat backup',
            error: error.message
        });
    }
});

// ============================================
// AUTOMATED BACKUP (Every 24 hours)
// ============================================

setInterval(async () => {
    try {
        console.log('🔄 Running automated backup...');
        await backupSystem.createBackup();
    } catch (error) {
        console.error('❌ Automated backup failed:', error);
    }
}, 24 * 60 * 60 * 1000); // 24 hours

// ============================================
// SERVER STARTUP
// ============================================

app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════╗
║        FinTrack Pro - Backend Server      ║
╠══════════════════════════════════════════╣
║  Status    : Running                      ║
║  Port      : ${PORT}                          ║
║  Mode      : ${process.env.NODE_ENV || 'development'}                       ║
║  API Base  : http://localhost:${PORT}/api    ║
║  Database  : Firestore                    ║
║  Storage   : Firebase Storage             ║
╚══════════════════════════════════════════╝
    `);
    
    // Create initial backup on startup
    backupSystem.createBackup().catch(console.error);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('👋 Shutting down gracefully...');
    
    // Create final backup
    await backupSystem.createBackup();
    
    // Clear cache
    cache.clear();
    
    process.exit(0);
});

module.exports = app;