const express = require('express');
const app = express();
const bodyParser = require('body-parser');
const mysql = require('mysql2');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const bcrypt = require('bcryptjs');
const fs = require('fs');

// Database connection
const conn = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'pension_loan_system'
});

conn.connect((err) => {
    if (err) {
        console.error('Database connection failed: ' + err.stack);
        return;
    }
    console.log('Connected to database');
});

// Middleware
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use(session({
    secret: 'pension-loan-secret-key-2024',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));

// File upload configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadPath = 'public/uploads/documents/';
        // Create directory if it doesn't exist
        if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
        }
        cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (req, file, cb) => {
        const filetypes = /jpeg|jpg|png|pdf|doc|docx/;
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = filetypes.test(file.mimetype);
        
        if (extname && mimetype) {
            return cb(null, true);
        }
        cb(new Error('Only documents and images are allowed (JPEG, JPG, PNG, PDF, DOC, DOCX)'));
    }
});

// Authentication middleware
function requireAuth(requiredTypes = []) {
    return (req, res, next) => {
        if (!req.session.user) {
            return res.redirect('/login');
        }
        
        if (requiredTypes.length > 0 && !requiredTypes.includes(req.session.user.user_type)) {
            return res.status(403).render('error', { 
                message: 'Access denied. Insufficient permissions.' 
            });
        }
        next();
    };
}

// Debug middleware for registration
app.use('/employee/register-customer', (req, res, next) => {
    if (req.method === 'POST') {
        console.log('=== REGISTRATION DEBUG ===');
        console.log('Method:', req.method);
        console.log('Body keys:', Object.keys(req.body));
        console.log('Files:', req.files ? Object.keys(req.files) : 'No files');
        console.log('Session user:', req.session.user ? req.session.user.user_id : 'No session');
        console.log('========================');
    }
    next();
});

// Routes

// Home page
app.get('/', (req, res) => {
    if (req.session.user) {
        return res.redirect('/dashboard');
    }
    
    res.render('home', { 
        title: 'Millenium Cash - Home',
        error: req.query.error,
        success: req.query.success
    });
});

// Login routes
app.get('/login', (req, res) => {
    if (req.session.user) {
        return res.redirect('/dashboard');
    }
    res.render('login', { 
        title: 'Login',
        error: req.query.error,
        success: req.query.success
    });
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;

    const query = 'SELECT * FROM users WHERE email = ? AND is_active = TRUE';
    conn.query(query, [email], async (err, results) => {
        if (err) {
            console.error('Login error:', err);
            return res.redirect('/login?error=Internal server error');
        }

        if (results.length === 0) {
            return res.redirect('/login?error=Invalid email or password');
        }

        const user = results[0];
        
        // For demo - check both plain text and hashed passwords
        let isPasswordValid = false;
        
        // Check if password is hashed (starts with $2b$)
        if (user.password.startsWith('$2b$')) {
            // Compare hashed password
            isPasswordValid = await bcrypt.compare(password, user.password);
        } else {
            // Compare plain text (for existing demo users)
            isPasswordValid = user.password === password;
        }

        if (!isPasswordValid) {
            return res.redirect('/login?error=Invalid email or password');
        }

        // Log login action
        conn.query(
            'INSERT INTO audit_logs (user_id, action, description, ip_address) VALUES (?, ?, ?, ?)',
            [user.user_id, 'LOGIN', 'User logged into the system', req.ip]
        );

        req.session.user = user;
        res.redirect('/dashboard');
    });
});

// Dashboard
app.get('/dashboard', requireAuth(), (req, res) => {
    const user = req.session.user;
    
    // Different dashboards based on user type
    if (user.user_type === 'admin') {
        // Enhanced Admin dashboard with activity monitoring
        const queries = [
            // Basic stats
            'SELECT COUNT(*) as total_users FROM users WHERE user_type IN ("employee", "manager")',
            'SELECT COUNT(*) as total_customers FROM customers',
            'SELECT COUNT(*) as total_loans FROM loans',
            'SELECT COUNT(*) as pending_loans FROM loans WHERE status = "pending"',
            'SELECT COUNT(*) as active_employees FROM users WHERE user_type IN ("employee", "manager") AND is_active = TRUE',
            'SELECT SUM(loan_amount) as total_disbursed FROM loans WHERE status = "disbursed"',
            
            // Recent activities from audit logs
            `SELECT a.*, u.full_name, u.user_type 
             FROM audit_logs a 
             JOIN users u ON a.user_id = u.user_id 
             ORDER BY a.created_at DESC 
             LIMIT 10`,
            
            // Recent loans
            `SELECT l.*, c.first_name, c.last_name 
             FROM loans l 
             JOIN customers c ON l.borrower_id = c.customer_id 
             ORDER BY l.applied_date DESC 
             LIMIT 8`,
            
            // User statistics by type
            `SELECT 
                SUM(CASE WHEN user_type = 'admin' THEN 1 ELSE 0 END) as admins,
                SUM(CASE WHEN user_type = 'manager' THEN 1 ELSE 0 END) as managers,
                SUM(CASE WHEN user_type = 'employee' THEN 1 ELSE 0 END) as employees
             FROM users 
             WHERE is_active = TRUE`
        ];

        Promise.all(queries.map(query => 
            new Promise((resolve, reject) => {
                conn.query(query, (err, results) => {
                    if (err) reject(err);
                    else resolve(results);
                });
            })
        )).then(results => {
            res.render('admin/dashboard', {
                title: 'Admin Dashboard',
                user: user,
                stats: {
                    totalUsers: results[0][0].total_users,
                    totalCustomers: results[1][0].total_customers,
                    totalLoans: results[2][0].total_loans,
                    pendingLoans: results[3][0].pending_loans,
                    activeEmployees: results[4][0].active_employees,
                    totalDisbursed: results[5][0].total_disbursed || 0
                },
                recentActivities: results[6],
                recentLoans: results[7],
                userStats: results[8][0]
            });
        }).catch(err => {
            console.error('Admin dashboard error:', err);
            res.render('admin/dashboard', {
                title: 'Admin Dashboard',
                user: user,
                stats: {},
                recentActivities: [],
                recentLoans: [],
                userStats: {}
            });
        });

    } else if (user.user_type === 'manager') {
        // Enhanced Manager dashboard with operational statistics
        const queries = [
            // Basic stats
            'SELECT COUNT(*) as team_members FROM users WHERE user_type = "employee" AND is_active = TRUE',
            'SELECT COUNT(*) as total_customers FROM customers',
            'SELECT COUNT(*) as pending_loans FROM loans WHERE status = "pending"',
            'SELECT COUNT(*) as approved_loans FROM loans WHERE status = "approved"',
            'SELECT SUM(loan_amount) as total_processed FROM loans WHERE status IN ("approved", "disbursed")',
            
            // Team performance
            `SELECT u.full_name, u.email, 
                    COUNT(l.loan_id) as loans_processed,
                    SUM(CASE WHEN l.status = 'approved' THEN 1 ELSE 0 END) as approved_count,
                    SUM(CASE WHEN l.status = 'pending' THEN 1 ELSE 0 END) as pending_count
             FROM users u 
             LEFT JOIN loans l ON u.user_id = l.created_by 
             WHERE u.user_type = 'employee' AND u.is_active = TRUE
             GROUP BY u.user_id, u.full_name, u.email
             ORDER BY loans_processed DESC 
             LIMIT 5`,
            
            // Recent team activities
            `SELECT a.*, u.full_name, u.user_type 
             FROM audit_logs a 
             JOIN users u ON a.user_id = u.user_id 
             WHERE u.user_type IN ('employee', 'manager')
             ORDER BY a.created_at DESC 
             LIMIT 8`,
            
            // Payment statistics
            `SELECT COUNT(*) as total_payments FROM loan_payments WHERE payment_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)`,
            
            // Today's payments
            `SELECT COUNT(*) as today_payments FROM loan_payments WHERE DATE(payment_date) = CURDATE()`
        ];

        Promise.all(queries.map(query => 
            new Promise((resolve, reject) => {
                conn.query(query, (err, results) => {
                    if (err) reject(err);
                    else resolve(results);
                });
            })
        )).then(results => {
            res.render('manager/dashboard', {
                title: 'Manager Dashboard',
                user: user,
                stats: {
                    team_members: results[0][0].team_members,
                    total_customers: results[1][0].total_customers,
                    pending_loans: results[2][0].pending_loans,
                    approved_loans: results[3][0].approved_loans,
                    total_processed: results[4][0].total_processed || 0,
                    total_payments: results[7][0].total_payments,
                    today_payments: results[8][0].today_payments
                },
                teamPerformance: results[5],
                recentActivities: results[6]
            });
        }).catch(err => {
            console.error('Manager dashboard error:', err);
            res.render('manager/dashboard', {
                title: 'Manager Dashboard',
                user: user,
                stats: {},
                teamPerformance: [],
                recentActivities: []
            });
        });

    } else if (user.user_type === 'employee') {
        // Enhanced Employee dashboard with customer data and recent activity
        const queries = [
            // Get customer count
            'SELECT COUNT(*) as total_customers FROM customers',
            
            // Get pending loans count
            'SELECT COUNT(*) as pending_loans FROM loans WHERE status = "pending"',
            
            // Get processed loans count
            'SELECT COUNT(*) as processed_loans FROM loans WHERE status IN ("approved", "rejected", "disbursed")',
            
            // Get total processed amount
            'SELECT SUM(loan_amount) as total_processed FROM loans WHERE status IN ("approved", "disbursed")',
            
            // Get all customers with their details
            'SELECT customer_id, first_name, last_name, email, mobile_number, pension_number, pension_system, monthly_pension, city, created_at FROM customers ORDER BY created_at DESC',
            
            // Get all loans for status display
            'SELECT loan_id, borrower_id, loan_amount, status, applied_date FROM loans ORDER BY applied_date DESC',
            
            // Get employee's recent activities
            `SELECT a.* 
             FROM audit_logs a 
             WHERE a.user_id = ? 
             ORDER BY a.created_at DESC 
             LIMIT 6`,
            
            // Get quick stats for employee performance
            `SELECT 
                COUNT(*) as total_customers_registered,
                COUNT(DISTINCT l.borrower_id) as unique_customers_served,
                SUM(CASE WHEN l.status = 'approved' THEN 1 ELSE 0 END) as loans_approved_this_month
             FROM customers c 
             LEFT JOIN loans l ON c.customer_id = l.borrower_id 
             WHERE (l.created_by = ? OR l.created_by IS NULL)
             AND MONTH(l.applied_date) = MONTH(CURRENT_DATE())`
        ];

        Promise.all(queries.map((query, index) => 
            new Promise((resolve, reject) => {
                // For queries that need user_id parameter
                if (index === 6 || index === 7) {
                    conn.query(query, [user.user_id], (err, results) => {
                        if (err) reject(err);
                        else resolve(results);
                    });
                } else {
                    conn.query(query, (err, results) => {
                        if (err) reject(err);
                        else resolve(results);
                    });
                }
            })
        )).then(results => {
            res.render('employee/dashboard', {
                title: 'Employee Dashboard',
                user: user,
                stats: {
                    total_customers: results[0][0].total_customers,
                    pending_loans: results[1][0].pending_loans,
                    processed_loans: results[2][0].processed_loans,
                    total_processed: results[3][0].total_processed || 0,
                    total_customers_registered: results[7][0].total_customers_registered,
                    unique_customers_served: results[7][0].unique_customers_served,
                    loans_approved_this_month: results[7][0].loans_approved_this_month || 0
                },
                customers: results[4], // All customers
                loans: results[5], // All loans for status display
                recentActivities: results[6] // Employee's recent activities
            });
        }).catch(err => {
            console.error('Employee dashboard error:', err);
            res.render('employee/dashboard', {
                title: 'Employee Dashboard',
                user: user,
                stats: {},
                customers: [],
                loans: [],
                recentActivities: []
            });
        });

    } else {
        // Customer dashboard (for users table customers - legacy support)
        const queries = [
            // Recent loans
            'SELECT * FROM loans WHERE borrower_id = ? ORDER BY applied_date DESC LIMIT 5',
            
            // Basic stats
            'SELECT COUNT(*) as total_loans FROM loans WHERE borrower_id = ?',
            'SELECT COUNT(*) as active_loans FROM loans WHERE borrower_id = ? AND status IN ("approved", "disbursed")',
            'SELECT SUM(loan_amount) as total_borrowed FROM loans WHERE borrower_id = ? AND status IN ("approved", "disbursed")',
            
            // Notifications
            'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 5'
        ];

        Promise.all(queries.map((query, index) => 
            new Promise((resolve, reject) => {
                conn.query(query, [user.user_id], (err, results) => {
                    if (err) reject(err);
                    else resolve(results);
                });
            })
        )).then(results => {
            res.render('customer/dashboard', {
                title: 'My Dashboard',
                user: user,
                recentLoans: results[0],
                stats: {
                    totalLoans: results[1][0].total_loans,
                    activeLoans: results[2][0].active_loans,
                    totalBorrowed: results[3][0].total_borrowed || 0
                },
                notifications: results[4]
            });
        }).catch(err => {
            console.error('Customer dashboard error:', err);
            res.render('customer/dashboard', {
                title: 'My Dashboard',
                user: user,
                recentLoans: [],
                stats: {},
                notifications: []
            });
        });
    }
});

// Admin Routes

// User management (Admin only)
app.get('/admin/users', requireAuth(['admin']), (req, res) => {
    const query = `
        SELECT user_id, full_name, email, user_type, created_at, is_active, verification_status 
        FROM users 
        WHERE user_type IN ('manager', 'employee')
        ORDER BY created_at DESC
    `;
    
    conn.query(query, (err, users) => {
        if (err) {
            console.error('Error fetching users:', err);
            return res.render('error', { message: 'Error loading users' });
        }
        
        res.render('admin/users', {
            title: 'User Management',
            user: req.session.user,
            users: users
        });
    });
});

// Customer management (Admin only)
app.get('/admin/customers', requireAuth(['admin']), (req, res) => {
    const query = `
        SELECT customer_id, first_name, last_name, email, mobile_number, pension_number, 
               pension_system, monthly_pension, verification_status, is_active, created_at 
        FROM customers 
        ORDER BY created_at DESC
    `;
    
    conn.query(query, (err, customers) => {
        if (err) {
            console.error('Error fetching customers:', err);
            return res.render('error', { message: 'Error loading customers' });
        }
        
        res.render('admin/customers', {
            title: 'Customer Management',
            user: req.session.user,
            customers: customers
        });
    });
});

// ==================== ADMIN REPORTS ROUTES ====================

// Main Reports Page
app.get('/admin/reports', requireAuth(['admin', 'manager']), (req, res) => {
    const user = req.session.user;
    const reportType = req.query.type || 'overview';
    const dateRange = req.query.range || 'month';
    
    console.log('=== REPORTS PAGE ===');
    console.log('Report Type:', reportType);
    console.log('Date Range:', dateRange);
    
    // Get date range based on selection
    let startDate, endDate;
    const today = new Date();
    
    switch(dateRange) {
        case 'today':
            startDate = new Date(today.setHours(0,0,0,0));
            endDate = new Date();
            break;
        case 'week':
            startDate = new Date(today.setDate(today.getDate() - 7));
            endDate = new Date();
            break;
        case 'month':
            startDate = new Date(today.setMonth(today.getMonth() - 1));
            endDate = new Date();
            break;
        case 'quarter':
            startDate = new Date(today.setMonth(today.getMonth() - 3));
            endDate = new Date();
            break;
        case 'year':
            startDate = new Date(today.setFullYear(today.getFullYear() - 1));
            endDate = new Date();
            break;
        default:
            startDate = new Date(today.setMonth(today.getMonth() - 1));
            endDate = new Date();
    }
    
    // Format dates for SQL
    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];
    
    res.render('admin/reports', {
        title: 'System Reports - Millenium Cash',
        user: user,
        reportType: reportType,
        dateRange: dateRange,
        startDate: startDateStr,
        endDate: endDateStr,
        error: req.query.error,
        success: req.query.success
    });
});

// API: Get Overview Report Data
app.get('/api/reports/overview', requireAuth(['admin', 'manager']), (req, res) => {
    const { startDate, endDate } = req.query;
    
    console.log('=== OVERVIEW REPORT API ===');
    console.log('Date Range:', startDate, 'to', endDate);
    
    const queries = {
        // Loan statistics
        loanStats: `
            SELECT 
                COUNT(*) as total_loans,
                SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_loans,
                SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved_loans,
                SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected_loans,
                SUM(CASE WHEN status = 'disbursed' THEN 1 ELSE 0 END) as disbursed_loans,
                SUM(loan_amount) as total_loan_amount,
                SUM(CASE WHEN status = 'disbursed' THEN loan_amount ELSE 0 END) as total_disbursed,
                AVG(loan_amount) as avg_loan_amount,
                AVG(interest_rate) as avg_interest_rate
            FROM loans
            WHERE applied_date BETWEEN ? AND ?
        `,
        
        // Customer statistics
        customerStats: `
            SELECT 
                COUNT(*) as total_customers,
                SUM(CASE WHEN verification_status = 'verified' THEN 1 ELSE 0 END) as verified_customers,
                SUM(CASE WHEN verification_status = 'pending' THEN 1 ELSE 0 END) as pending_verification,
                COUNT(DISTINCT pension_system) as pension_systems_count,
                AVG(monthly_pension) as avg_monthly_pension
            FROM customers
            WHERE created_at BETWEEN ? AND ?
        `,
        
        // Payment statistics
        paymentStats: `
            SELECT 
                COUNT(*) as total_payments,
                SUM(amount_paid) as total_collected,
                AVG(amount_paid) as avg_payment,
                COUNT(CASE WHEN payment_status = 'paid' THEN 1 END) as full_payments,
                COUNT(CASE WHEN payment_status = 'partial' THEN 1 END) as partial_payments,
                COUNT(CASE WHEN payment_status = 'overdue' THEN 1 END) as overdue_payments
            FROM loan_payments
            WHERE payment_date BETWEEN ? AND ?
        `,
        
        // User activity
        userActivity: `
            SELECT 
                COUNT(DISTINCT user_id) as active_users,
                COUNT(*) as total_actions,
                SUM(CASE WHEN action = 'LOGIN' THEN 1 ELSE 0 END) as logins,
                SUM(CASE WHEN action = 'CREATE_LOAN' THEN 1 ELSE 0 END) as loans_created,
                SUM(CASE WHEN action = 'CREATE_CUSTOMER' THEN 1 ELSE 0 END) as customers_created
            FROM audit_logs
            WHERE created_at BETWEEN ? AND ?
        `,
        
        // Daily trends
        dailyTrends: `
            SELECT 
                DATE(applied_date) as date,
                COUNT(*) as loan_count,
                SUM(loan_amount) as total_amount
            FROM loans
            WHERE applied_date BETWEEN ? AND ?
            GROUP BY DATE(applied_date)
            ORDER BY date
        `,
        
        // Loan purpose distribution
        purposeDistribution: `
            SELECT 
                purpose_category,
                COUNT(*) as count,
                SUM(loan_amount) as total_amount
            FROM loans
            WHERE applied_date BETWEEN ? AND ?
            GROUP BY purpose_category
            ORDER BY count DESC
        `,
        
        // Performance by employee
        employeePerformance: `
            SELECT 
                u.full_name,
                u.email,
                COUNT(l.loan_id) as loans_processed,
                SUM(CASE WHEN l.status = 'approved' THEN 1 ELSE 0 END) as approved_loans,
                SUM(l.loan_amount) as total_amount,
                AVG(l.loan_amount) as avg_amount
            FROM users u
            LEFT JOIN loans l ON u.user_id = l.created_by AND l.applied_date BETWEEN ? AND ?
            WHERE u.user_type IN ('employee', 'manager')
            GROUP BY u.user_id, u.full_name, u.email
            ORDER BY loans_processed DESC
            LIMIT 10
        `,
        
        // Pension system distribution
        pensionDistribution: `
            SELECT 
                pension_system,
                COUNT(*) as customer_count,
                AVG(monthly_pension) as avg_pension,
                SUM(monthly_pension) as total_monthly_pension
            FROM customers
            WHERE created_at BETWEEN ? AND ?
            GROUP BY pension_system
            ORDER BY customer_count DESC
        `
    };
    
    // Execute all queries in parallel
    Promise.all(Object.entries(queries).map(([key, query]) => 
        new Promise((resolve, reject) => {
            conn.query(query, [startDate, endDate], (err, results) => {
                if (err) {
                    console.error(`Error in ${key} query:`, err);
                    reject(err);
                } else {
                    resolve({ key, data: results });
                }
            });
        })
    ))
    .then(results => {
        const reportData = {};
        results.forEach(({ key, data }) => {
            reportData[key] = data;
        });
        
        res.json({
            success: true,
            data: reportData,
            dateRange: { startDate, endDate }
        });
    })
    .catch(err => {
        console.error('Error generating overview report:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Error generating report data' 
        });
    });
});

// API: Get Loan Performance Report
app.get('/api/reports/loans', requireAuth(['admin', 'manager']), (req, res) => {
    const { startDate, endDate, status, type } = req.query;
    
    let query = `
        SELECT 
            l.*,
            c.first_name,
            c.last_name,
            c.pension_number,
            c.pension_system,
            u.full_name as processed_by_name,
            DATEDIFF(CURDATE(), l.applied_date) as days_pending
        FROM loans l
        LEFT JOIN customers c ON l.borrower_id = c.customer_id
        LEFT JOIN users u ON l.created_by = u.user_id
        WHERE l.applied_date BETWEEN ? AND ?
    `;
    
    const params = [startDate, endDate];
    
    if (status && status !== 'all') {
        query += ' AND l.status = ?';
        params.push(status);
    }
    
    if (type && type !== 'all') {
        query += ' AND l.loan_type = ?';
        params.push(type);
    }
    
    query += ' ORDER BY l.applied_date DESC';
    
    conn.query(query, params, (err, loans) => {
        if (err) {
            console.error('Error fetching loan report:', err);
            return res.status(500).json({ success: false, message: 'Error fetching loan data' });
        }
        
        // Calculate summary statistics
        const summary = {
            total_loans: loans.length,
            total_amount: loans.reduce((sum, loan) => sum + parseFloat(loan.loan_amount || 0), 0),
            avg_amount: 0,
            by_status: {},
            by_type: {}
        };
        
        if (loans.length > 0) {
            summary.avg_amount = summary.total_amount / loans.length;
        }
        
        // Group by status
        loans.forEach(loan => {
            // By status
            if (!summary.by_status[loan.status]) {
                summary.by_status[loan.status] = {
                    count: 0,
                    amount: 0
                };
            }
            summary.by_status[loan.status].count++;
            summary.by_status[loan.status].amount += parseFloat(loan.loan_amount || 0);
            
            // By type
            if (!summary.by_type[loan.loan_type || 'regular']) {
                summary.by_type[loan.loan_type || 'regular'] = {
                    count: 0,
                    amount: 0
                };
            }
            summary.by_type[loan.loan_type || 'regular'].count++;
            summary.by_type[loan.loan_type || 'regular'].amount += parseFloat(loan.loan_amount || 0);
        });
        
        res.json({
            success: true,
            data: {
                loans: loans,
                summary: summary
            }
        });
    });
});

// API: Get Payment Report
app.get('/api/reports/payments', requireAuth(['admin', 'manager']), (req, res) => {
    const { startDate, endDate, status } = req.query;
    
    let query = `
        SELECT 
            lp.*,
            l.loan_id,
            l.loan_amount,
            c.first_name,
            c.last_name,
            c.pension_number,
            u.full_name as posted_by_name,
            pr.receipt_number
        FROM loan_payments lp
        LEFT JOIN loans l ON lp.loan_id = l.loan_id
        LEFT JOIN customers c ON l.borrower_id = c.customer_id
        LEFT JOIN users u ON lp.posted_by = u.user_id
        LEFT JOIN payment_receipts pr ON lp.payment_id = pr.payment_id
        WHERE lp.payment_date BETWEEN ? AND ?
    `;
    
    const params = [startDate, endDate];
    
    if (status && status !== 'all') {
        query += ' AND lp.payment_status = ?';
        params.push(status);
    }
    
    query += ' ORDER BY lp.payment_date DESC';
    
    conn.query(query, params, (err, payments) => {
        if (err) {
            console.error('Error fetching payment report:', err);
            return res.status(500).json({ success: false, message: 'Error fetching payment data' });
        }
        
        // Calculate summary
        const summary = {
            total_payments: payments.length,
            total_collected: payments.reduce((sum, p) => sum + parseFloat(p.amount_paid || 0), 0),
            avg_payment: 0,
            by_method: {},
            by_status: {}
        };
        
        if (payments.length > 0) {
            summary.avg_payment = summary.total_collected / payments.length;
        }
        
        payments.forEach(payment => {
            // By method
            if (!summary.by_method[payment.payment_method || 'cash']) {
                summary.by_method[payment.payment_method || 'cash'] = {
                    count: 0,
                    amount: 0
                };
            }
            summary.by_method[payment.payment_method || 'cash'].count++;
            summary.by_method[payment.payment_method || 'cash'].amount += parseFloat(payment.amount_paid || 0);
            
            // By status
            if (!summary.by_status[payment.payment_status]) {
                summary.by_status[payment.payment_status] = {
                    count: 0,
                    amount: 0
                };
            }
            summary.by_status[payment.payment_status].count++;
            summary.by_status[payment.payment_status].amount += parseFloat(payment.amount_paid || 0);
        });
        
        res.json({
            success: true,
            data: {
                payments: payments,
                summary: summary
            }
        });
    });
});

// API: Get Customer Report
app.get('/api/reports/customers', requireAuth(['admin', 'manager']), (req, res) => {
    const { startDate, endDate, status, system } = req.query;
    
    let query = `
        SELECT 
            c.*,
            COUNT(l.loan_id) as total_loans,
            SUM(l.loan_amount) as total_borrowed,
            MAX(l.applied_date) as last_loan_date,
            (
                SELECT COUNT(*) 
                FROM loans l2 
                WHERE l2.borrower_id = c.customer_id 
                AND l2.status = 'active'
            ) as active_loans
        FROM customers c
        LEFT JOIN loans l ON c.customer_id = l.borrower_id
        WHERE c.created_at BETWEEN ? AND ?
    `;
    
    const params = [startDate, endDate];
    
    if (status && status !== 'all') {
        query += ' AND c.verification_status = ?';
        params.push(status);
    }
    
    if (system && system !== 'all') {
        query += ' AND c.pension_system = ?';
        params.push(system);
    }
    
    query += ' GROUP BY c.customer_id ORDER BY c.created_at DESC';
    
    conn.query(query, params, (err, customers) => {
        if (err) {
            console.error('Error fetching customer report:', err);
            return res.status(500).json({ success: false, message: 'Error fetching customer data' });
        }
        
        // Calculate summary
        const summary = {
            total_customers: customers.length,
            verified: customers.filter(c => c.verification_status === 'verified').length,
            pending: customers.filter(c => c.verification_status === 'pending').length,
            by_system: {},
            by_city: {}
        };
        
        customers.forEach(customer => {
            // By pension system
            if (!summary.by_system[customer.pension_system || 'Unknown']) {
                summary.by_system[customer.pension_system || 'Unknown'] = 0;
            }
            summary.by_system[customer.pension_system || 'Unknown']++;
            
            // By city
            if (!summary.by_city[customer.city || 'Unknown']) {
                summary.by_city[customer.city || 'Unknown'] = 0;
            }
            summary.by_city[customer.city || 'Unknown']++;
        });
        
        res.json({
            success: true,
            data: {
                customers: customers,
                summary: summary
            }
        });
    });
});

// API: Export Report to CSV
app.get('/api/reports/export/:type', requireAuth(['admin', 'manager']), (req, res) => {
    const reportType = req.params.type;
    const { startDate, endDate, format = 'csv' } = req.query;
    
    console.log('=== EXPORT REPORT ===');
    console.log('Type:', reportType);
    console.log('Date Range:', startDate, 'to', endDate);
    
    let query, filename, headers;
    
    switch(reportType) {
        case 'loans':
            filename = `loans_report_${startDate}_to_${endDate}.csv`;
            headers = ['Loan ID', 'Customer', 'Pension Number', 'Amount', 'Interest Rate', 'Term', 'Status', 'Applied Date', 'Processed By'];
            query = `
                SELECT 
                    l.loan_id,
                    CONCAT(c.first_name, ' ', c.last_name) as customer_name,
                    c.pension_number,
                    l.loan_amount,
                    l.interest_rate,
                    l.duration_months,
                    l.status,
                    l.applied_date,
                    u.full_name as processed_by
                FROM loans l
                LEFT JOIN customers c ON l.borrower_id = c.customer_id
                LEFT JOIN users u ON l.created_by = u.user_id
                WHERE l.applied_date BETWEEN ? AND ?
                ORDER BY l.applied_date DESC
            `;
            break;
            
        case 'payments':
            filename = `payments_report_${startDate}_to_${endDate}.csv`;
            headers = ['Payment ID', 'Loan ID', 'Customer', 'Amount Paid', 'Amount Due', 'Payment Date', 'Method', 'Status', 'Receipt No', 'Posted By'];
            query = `
                SELECT 
                    lp.payment_id,
                    lp.loan_id,
                    CONCAT(c.first_name, ' ', c.last_name) as customer_name,
                    lp.amount_paid,
                    lp.amount_due,
                    lp.payment_date,
                    lp.payment_method,
                    lp.payment_status,
                    pr.receipt_number,
                    u.full_name as posted_by
                FROM loan_payments lp
                LEFT JOIN loans l ON lp.loan_id = l.loan_id
                LEFT JOIN customers c ON l.borrower_id = c.customer_id
                LEFT JOIN users u ON lp.posted_by = u.user_id
                LEFT JOIN payment_receipts pr ON lp.payment_id = pr.payment_id
                WHERE lp.payment_date BETWEEN ? AND ?
                ORDER BY lp.payment_date DESC
            `;
            break;
            
        case 'customers':
            filename = `customers_report_${startDate}_to_${endDate}.csv`;
            headers = ['Customer ID', 'Name', 'Pension Number', 'Pension System', 'Monthly Pension', 'Mobile', 'Email', 'City', 'Status', 'Registered Date'];
            query = `
                SELECT 
                    customer_id,
                    CONCAT(first_name, ' ', last_name) as full_name,
                    pension_number,
                    pension_system,
                    monthly_pension,
                    mobile_number,
                    email,
                    city,
                    verification_status,
                    created_at
                FROM customers
                WHERE created_at BETWEEN ? AND ?
                ORDER BY created_at DESC
            `;
            break;
            
        default:
            return res.status(400).json({ success: false, message: 'Invalid report type' });
    }
    
    conn.query(query, [startDate, endDate], (err, results) => {
        if (err) {
            console.error('Error exporting report:', err);
            return res.status(500).json({ success: false, message: 'Error generating export' });
        }
        
        // Convert to CSV
        let csv = headers.join(',') + '\n';
        
        results.forEach(row => {
            const values = headers.map(header => {
                const key = header.toLowerCase().replace(/ /g, '_');
                let value = row[key] || row[header] || '';
                
                // Handle special formatting
                if (typeof value === 'string' && value.includes(',')) {
                    value = `"${value}"`;
                }
                if (value instanceof Date) {
                    value = value.toISOString().split('T')[0];
                }
                return value;
            });
            csv += values.join(',') + '\n';
        });
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(csv);
    });
});

// API: Get Dashboard Chart Data
app.get('/api/reports/chart-data', requireAuth(['admin', 'manager']), (req, res) => {
    const { period = 'month' } = req.query;
    
    let interval, dateFormat;
    switch(period) {
        case 'week':
            interval = '7 DAY';
            dateFormat = '%a';
            break;
        case 'month':
            interval = '30 DAY';
            dateFormat = '%b %d';
            break;
        case 'quarter':
            interval = '90 DAY';
            dateFormat = '%b';
            break;
        case 'year':
            interval = '12 MONTH';
            dateFormat = '%b %Y';
            break;
        default:
            interval = '30 DAY';
            dateFormat = '%b %d';
    }
    
    const queries = {
        loanTrends: `
            SELECT 
                DATE_FORMAT(applied_date, '${dateFormat}') as label,
                COUNT(*) as value
            FROM loans
            WHERE applied_date >= DATE_SUB(CURDATE(), INTERVAL ${interval})
            GROUP BY DATE(applied_date)
            ORDER BY MIN(applied_date)
        `,
        
        amountTrends: `
            SELECT 
                DATE_FORMAT(applied_date, '${dateFormat}') as label,
                SUM(loan_amount) as value
            FROM loans
            WHERE applied_date >= DATE_SUB(CURDATE(), INTERVAL ${interval})
            GROUP BY DATE(applied_date)
            ORDER BY MIN(applied_date)
        `,
        
        statusDistribution: `
            SELECT 
                status as label,
                COUNT(*) as value
            FROM loans
            WHERE applied_date >= DATE_SUB(CURDATE(), INTERVAL ${interval})
            GROUP BY status
        `,
        
        paymentTrends: `
            SELECT 
                DATE_FORMAT(payment_date, '${dateFormat}') as label,
                SUM(amount_paid) as value
            FROM loan_payments
            WHERE payment_date >= DATE_SUB(CURDATE(), INTERVAL ${interval})
            GROUP BY DATE(payment_date)
            ORDER BY MIN(payment_date)
        `
    };
    
    Promise.all(Object.entries(queries).map(([key, query]) => 
        new Promise((resolve, reject) => {
            conn.query(query, (err, results) => {
                if (err) reject(err);
                else resolve({ key, data: results });
            });
        })
    ))
    .then(results => {
        const chartData = {};
        results.forEach(({ key, data }) => {
            chartData[key] = data;
        });
        
        res.json({
            success: true,
            data: chartData
        });
    })
    .catch(err => {
        console.error('Error fetching chart data:', err);
        res.status(500).json({ success: false, message: 'Error fetching chart data' });
    });
});

// Register new manager/employee (Admin only)
app.get('/admin/register', requireAuth(['admin']), (req, res) => {
    res.render('admin/register', {
        title: 'Register Staff',
        user: req.session.user,
        error: req.query.error,
        success: req.query.success
    });
});

app.post('/admin/register', requireAuth(['admin']), (req, res) => {
    const { full_name, email, password, user_type } = req.body;
    
    // Validate user type
    if (!['manager', 'employee'].includes(user_type)) {
        return res.redirect('/admin/register?error=Invalid user type');
    }
    
    // Check if email already exists
    conn.query('SELECT * FROM users WHERE email = ?', [email], (err, results) => {
        if (err) {
            console.error('Error checking email:', err);
            return res.redirect('/admin/register?error=Internal server error');
        }
        
        if (results.length > 0) {
            return res.redirect('/admin/register?error=Email already registered');
        }
        
        // Insert new user
        const query = `
            INSERT INTO users (full_name, email, password, user_type, verification_status) 
            VALUES (?, ?, ?, ?, 'verified')
        `;
        
        conn.query(query, [full_name, email, password, user_type], (err, result) => {
            if (err) {
                console.error('Error creating user:', err);
                return res.redirect('/admin/register?error=Error creating user');
            }
            
            // Log the action
            conn.query(
                'INSERT INTO audit_logs (user_id, action, description) VALUES (?, ?, ?)',
                [req.session.user.user_id, 'CREATE_USER', `Created ${user_type} account for ${email}`]
            );
            
            res.redirect('/admin/register?success=User registered successfully');
        });
    });
});

// Manager Analytics API
app.get('/manager/analytics', requireAuth(['manager', 'admin']), (req, res) => {
    const user = req.session.user;
    
    res.render('manager/analytics', {
        title: 'Analytics Dashboard',
        user: user,
        error: req.query.error,
        success: req.query.success
    });
});

// Manager Analytics API
app.get('/api/manager/analytics', requireAuth(['manager', 'admin']), (req, res) => {
    const { startDate = '2024-01-01', endDate = '2024-12-31' } = req.query;
    
    try {
        const response = {
            kpis: {
                totalPortfolio: 1250000,
                avgLoanSize: 25000,
                approvalRate: 78.5,
                activeCustomers: 45,
                portfolioTrend: 12.3,
                sizeTrend: 5.2,
                approvalTrend: 2.1,
                customersTrend: 8.7
            },
            charts: {},
            teamEfficiency: [],
            predictive: {}
        };

        res.json(response);
        
    } catch (error) {
        console.error('Analytics API error:', error);
        res.status(500).json({ error: 'Internal server error in analytics API' });
    }
});

// Get loan details for modal
app.get('/api/loan/:id', requireAuth(['employee', 'manager', 'admin']), (req, res) => {
    const loanId = req.params.id;
    
    const query = `
        SELECT 
            l.*,
            c.first_name,
            c.last_name,
            c.pension_number,
            c.mobile_number,
            c.email,
            c.monthly_pension,
            u.full_name as created_by_name,
            la.atm_passbook_number,
            la.bank_name,
            la.id_number
        FROM loans l 
        LEFT JOIN customers c ON l.borrower_id = c.customer_id 
        LEFT JOIN users u ON l.created_by = u.user_id 
        LEFT JOIN loan_applications la ON l.loan_id = la.loan_id
        WHERE l.loan_id = ?
    `;
    
    conn.query(query, [loanId], (err, results) => {
        if (err) {
            console.error('Error fetching loan:', err);
            return res.status(500).json({ success: false, message: 'Error fetching loan details' });
        }
        
        if (results.length === 0) {
            return res.status(404).json({ success: false, message: 'Loan not found' });
        }
        
        res.json({ success: true, loan: results[0] });
    });
});

// Update loan details
app.put('/api/loan/:id', requireAuth(['admin', 'manager', 'employee']), (req, res) => {
    const loanId = req.params.id;
    const user = req.session.user;
    const {
        loan_amount,
        interest_rate,
        duration_months,
        purpose,
        purpose_category,
        disbursement_method,
        status,
        notes
    } = req.body;

    // Validate required fields
    if (!loan_amount || !interest_rate || !duration_months) {
        return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    // Validate disbursement method (cash only or check)
    if (!['cash', 'check'].includes(disbursement_method)) {
        return res.status(400).json({ success: false, message: 'Invalid disbursement method' });
    }

    // Recalculate payments based on new values
    const monthlyRate = interest_rate / 100 / 12;
    const monthlyPayment = loan_amount * monthlyRate * Math.pow(1 + monthlyRate, duration_months) / 
                          (Math.pow(1 + monthlyRate, duration_months) - 1);
    const totalPayable = monthlyPayment * duration_months;
    const totalInterest = totalPayable - loan_amount;

    const updateData = {
        loan_amount: loan_amount,
        interest_rate: interest_rate,
        duration_months: duration_months,
        monthly_payment: monthlyPayment,
        total_payable: totalPayable,
        total_interest: totalInterest,
        purpose: purpose,
        purpose_category: purpose_category,
        disbursement_method: disbursement_method,
        status: status,
        notes: notes,
        updated_at: new Date()
    };

    const query = 'UPDATE loans SET ? WHERE loan_id = ?';

    conn.query(query, [updateData, loanId], (err, result) => {
        if (err) {
            console.error('Error updating loan:', err);
            return res.status(500).json({ success: false, message: 'Error updating loan' });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'Loan not found' });
        }

        // Log the action
        conn.query(
            'INSERT INTO audit_logs (user_id, action, description) VALUES (?, ?, ?)',
            [user.user_id, 'UPDATE_LOAN', `Updated loan #${loanId} - New amount: ₱${loan_amount}`]
        );

        res.json({ 
            success: true, 
            message: 'Loan updated successfully',
            recalculated: {
                monthlyPayment: monthlyPayment,
                totalPayable: totalPayable,
                totalInterest: totalInterest
            }
        });
    });
});

app.get('/api/manager/dashboard-stats', requireAuth(['manager', 'admin']), (req, res) => {
    const queries = [
        'SELECT COUNT(*) as team_members FROM users WHERE user_type = "employee" AND is_active = TRUE',
        'SELECT COUNT(*) as pending_loans FROM loans WHERE status = "pending"',
        'SELECT COUNT(*) as approved_loans FROM loans WHERE status = "approved"',
        'SELECT COUNT(*) as total_payments FROM loan_payments WHERE payment_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)',
        'SELECT COUNT(*) as today_payments FROM loan_payments WHERE DATE(payment_date) = CURDATE()'
    ];

    Promise.all(queries.map(query => 
        new Promise((resolve, reject) => {
            conn.query(query, (err, results) => {
                if (err) reject(err);
                else resolve(results[0]);
            });
        })
    )).then(results => {
        res.json({
            success: true,
            stats: {
                team_members: results[0].team_members,
                pending_loans: results[1].pending_loans,
                approved_loans: results[2].approved_loans,
                total_payments: results[3].total_payments,
                today_payments: results[4].today_payments
            }
        });
    }).catch(err => {
        console.error('API dashboard stats error:', err);
        res.json({ success: false, error: 'Failed to fetch dashboard stats' });
    });
});

// Employee Routes

// Register customer (Employee only)
app.get('/employee/register-customer', requireAuth(['employee']), (req, res) => {
    res.render('employee/register-customer', {
        title: 'Register Customer',
        user: req.session.user,
        error: req.query.error,
        success: req.query.success
    });
});

// Register Customer Route
app.post('/employee/register-customer', requireAuth(['employee']), upload.fields([
    { name: 'aim_passbook', maxCount: 1 },
    { name: 'bank_statement', maxCount: 1 },
    { name: 'proof_of_billing', maxCount: 1 },
    { name: 'brgy_clearance', maxCount: 1 }
]), async (req, res) => {
    const { 
        // Personal Information
        last_name, first_name, middle_name, suffix, gender, civil_status, date_of_birth,
        // Contact Information
        mobile_number, telephone_number, email,
        // Address Information
        street_address, barangay, city, province, region, zip_code,
        // Pension Information
        pension_system, pension_number, monthly_pension, pension_start_date,
        // Employment Information
        last_employer, last_position, years_of_service, retirement_date,
        // Beneficiaries (arrays)
        beneficiary_name, beneficiary_relationship, beneficiary_birthdate, beneficiary_percentage
    } = req.body;
    
    try {
        console.log('Starting customer registration...');

        // Check if files were uploaded
        if (!req.files) {
            console.log('No files uploaded');
            return res.redirect('/employee/register-customer?error=All required documents must be uploaded');
        }

        const files = req.files;
        
        // Validate all required files are present
        const requiredFiles = ['aim_passbook', 'bank_statement', 'proof_of_billing', 'brgy_clearance'];
        for (const fileField of requiredFiles) {
            if (!files[fileField] || files[fileField].length === 0) {
                console.log(`Missing file: ${fileField}`);
                return res.redirect(`/employee/register-customer?error=Missing required document: ${fileField}`);
            }
        }

        // Check if email already exists in customers table
        conn.query('SELECT * FROM customers WHERE email = ?', [email], async (err, results) => {
            if (err) {
                console.error('Error checking email:', err);
                return res.redirect('/employee/register-customer?error=Internal server error');
            }
            
            if (results.length > 0) {
                return res.redirect('/employee/register-customer?error=Email already registered');
            }

            // Check if pension number already exists
            conn.query('SELECT * FROM customers WHERE pension_number = ?', [pension_number], async (err, pensionResults) => {
                if (err) {
                    console.error('Error checking pension number:', err);
                    return res.redirect('/employee/register-customer?error=Internal server error');
                }
                
                if (pensionResults.length > 0) {
                    return res.redirect('/employee/register-customer?error=Pension number already registered');
                }

                // Insert into customers table
                const customerQuery = `
                    INSERT INTO customers (
                        last_name, first_name, middle_name, suffix, gender, civil_status, date_of_birth,
                        mobile_number, telephone_number, email,
                        street_address, barangay, city, province, region, zip_code,
                        pension_system, pension_number, monthly_pension, pension_start_date,
                        last_employer, last_position, years_of_service, retirement_date,
                        created_by
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `;

                conn.query(customerQuery, [
                    last_name, first_name, middle_name || null, suffix || null, gender, civil_status, date_of_birth,
                    mobile_number, telephone_number || null, email,
                    street_address, barangay, city, province, region, zip_code,
                    pension_system, pension_number, monthly_pension, pension_start_date || null,
                    last_employer || null, last_position || null, years_of_service || null, retirement_date || null,
                    req.session.user.user_id
                ], (err, result) => {
                    if (err) {
                        console.error('Error creating customer:', err);
                        console.error('SQL Error:', err.sqlMessage);
                        return res.redirect('/employee/register-customer?error=Error creating customer: ' + err.sqlMessage);
                    }

                    const customerId = result.insertId;
                    console.log('Customer created with ID:', customerId);

                    // Insert document records
                    const documentQuery = `
                        INSERT INTO customer_documents (customer_id, document_type, file_path, file_name, uploaded_by) 
                        VALUES (?, ?, ?, ?, ?)
                    `;
                    
                    // Process each document
                    const documentPromises = [];
                    
                    Object.keys(files).forEach(fileField => {
                        if (files[fileField] && files[fileField][0]) {
                            documentPromises.push(new Promise((resolve, reject) => {
                                conn.query(documentQuery, [
                                    customerId, fileField, files[fileField][0].path, files[fileField][0].filename, req.session.user.user_id
                                ], (err) => {
                                    if (err) {
                                        console.error(`Error saving ${fileField}:`, err);
                                        reject(err);
                                    } else {
                                        resolve();
                                    }
                                });
                            }));
                        }
                    });

                    // Wait for all document inserts to complete
                    Promise.all(documentPromises)
                        .then(() => {
                            console.log('All documents saved successfully');

                            // Insert beneficiaries if provided
                            if (beneficiary_name && Array.isArray(beneficiary_name) && beneficiary_name.length > 0) {
                                const beneficiaryQuery = `
                                    INSERT INTO beneficiaries (customer_id, full_name, relationship, birthdate, percentage) 
                                    VALUES (?, ?, ?, ?, ?)
                                `;
                                
                                const beneficiaryPromises = beneficiary_name.map((name, index) => {
                                    if (name && name.trim() !== '') {
                                        return new Promise((resolve, reject) => {
                                            conn.query(beneficiaryQuery, [
                                                customerId,
                                                name,
                                                beneficiary_relationship[index] || null,
                                                beneficiary_birthdate[index] || null,
                                                beneficiary_percentage[index] || 0
                                            ], (err) => {
                                                if (err) {
                                                    console.error('Error adding beneficiary:', err);
                                                    reject(err);
                                                } else {
                                                    resolve();
                                                }
                                            });
                                        });
                                    }
                                    return Promise.resolve();
                                });

                                Promise.all(beneficiaryPromises)
                                    .then(() => {
                                        console.log('All beneficiaries saved');
                                        finalizeRegistration();
                                    })
                                    .catch(beneficiaryErr => {
                                        console.error('Error saving beneficiaries:', beneficiaryErr);
                                        finalizeRegistration();
                                    });
                            } else {
                                finalizeRegistration();
                            }

                            function finalizeRegistration() {
                                // Log the action
                                conn.query(
                                    'INSERT INTO audit_logs (user_id, action, description) VALUES (?, ?, ?)',
                                    [req.session.user.user_id, 'CREATE_CUSTOMER', `Registered customer: ${first_name} ${last_name} (${pension_number}) with documents`]
                                );

                                console.log('Customer registration completed successfully');
                                res.redirect('/employee/register-customer?success=Customer registered successfully with all documents');
                            }
                        })
                        .catch(docErr => {
                            console.error('Error saving documents:', docErr);
                            res.redirect('/employee/register-customer?success=Customer registered but there was an issue saving some documents');
                        });
                });
            });
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.redirect('/employee/register-customer?error=Error creating customer: ' + error.message);
    }
});

// View all customers
app.get('/employee/customers', requireAuth(['employee']), (req, res) => {
    const query = 'SELECT * FROM customers ORDER BY created_at DESC';
    
    conn.query(query, (err, customers) => {
        if (err) {
            console.error('Error fetching customers:', err);
            return res.render('error', { message: 'Error loading customers' });
        }
        
        res.render('employee/customers', {
            title: 'All Customers',
            user: req.session.user,
            customers: customers
        });
    });
});

// View customer documents
app.get('/employee/customer/:id/documents', requireAuth(['employee', 'manager', 'admin']), (req, res) => {
    const customerId = req.params.id;
    const user = req.session.user;
    
    const queries = [
        'SELECT * FROM customers WHERE customer_id = ?',
        'SELECT * FROM customer_documents WHERE customer_id = ? ORDER BY uploaded_at DESC'
    ];

    Promise.all(queries.map(query => 
        new Promise((resolve, reject) => {
            conn.query(query, [customerId], (err, results) => {
                if (err) reject(err);
                else resolve(results);
            });
        })
    )).then(results => {
        if (results[0].length === 0) {
            return res.render('error', { message: 'Customer not found' });
        }

        const customer = results[0][0];
        
        res.render('employee/customer-documents', {
            title: `Documents - ${customer.first_name} ${customer.last_name}`,
            user: user,
            customer: customer,
            documents: results[1]
        });
    }).catch(err => {
        console.error('Error loading customer documents:', err);
        res.render('error', { message: 'Error loading customer documents' });
    });
});

// Employee create loan form submission - UPDATED WITH NEW REQUIREMENTS
app.post('/employee/create-loan', requireAuth(['employee']), (req, res) => {
    console.log('=== CREATE LOAN ENDPOINT HIT ===');
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    console.log('Session user:', req.session.user ? req.session.user.user_id : 'No session');
    console.log('Request headers:', req.headers);
    
    const { 
        customer_id,
        loan_amount, 
        duration_months, 
        purpose,
        purpose_category,
        disbursement_method,
        valid_ids,
        id_number,
        notes,
        atm_passbook_number,
        bank_name
    } = req.body;

    console.log('Parsed fields:', {
        customer_id,
        loan_amount,
        duration_months,
        purpose: purpose ? purpose.substring(0, 30) + '...' : 'missing',
        purpose_category,
        disbursement_method,
        valid_ids,
        atm_passbook_number
    });

    const user = req.session.user;

    // Validate required fields
    if (!customer_id || !loan_amount || !duration_months || !purpose || !disbursement_method) {
        console.log('Missing required fields');
        return res.redirect(`/employee/customer/${customer_id}/create-loan?error=Please fill all required fields`);
    }

    // Validate ID verification
    if (!valid_ids || valid_ids === '') {
        console.log('No valid IDs selected, valid_ids:', valid_ids);
        return res.redirect(`/employee/customer/${customer_id}/create-loan?error=At least one valid ID must be verified`);
    }

    // Validate ATM passbook
    if (!atm_passbook_number) {
        console.log('No ATM passbook number provided');
        return res.redirect(`/employee/customer/${customer_id}/create-loan?error=ATM passbook number is required`);
    }

    // Loan configuration - Regular loan only with 1-24 months term
    const loanConfig = {
        maxMultiplier: 12,
        interestRate: 8,
        minTerm: 1,
        maxTerm: 24
    };
    
    // Get customer's monthly pension for validation
    conn.query('SELECT monthly_pension, first_name, last_name FROM customers WHERE customer_id = ?', [customer_id], (err, results) => {
        if (err) {
            console.error('Error fetching customer:', err);
            return res.redirect(`/employee/customer/${customer_id}/create-loan?error=Error fetching customer data`);
        }

        if (results.length === 0) {
            console.log('Customer not found');
            return res.redirect(`/employee/customer/${customer_id}/create-loan?error=Customer not found`);
        }

        const customer = results[0];
        console.log('Customer found:', customer);

        const customerPension = customer.monthly_pension;
        const maxLoanAmount = customerPension * loanConfig.maxMultiplier;

        // Validate loan amount
        if (loan_amount > maxLoanAmount) {
            return res.redirect(`/employee/customer/${customer_id}/create-loan?error=Loan amount exceeds maximum eligible amount of ₱${maxLoanAmount.toLocaleString()}`);
        }

        if (loan_amount < 1000) {
            return res.redirect(`/employee/customer/${customer_id}/create-loan?error=Loan amount must be at least ₱1,000`);
        }

        // Validate term (1-24 months)
        if (duration_months < 1 || duration_months > 24) {
            return res.redirect(`/employee/customer/${customer_id}/create-loan?error=Repayment period must be between 1 and 24 months`);
        }

        // Validate disbursement method (cash only or check)
        if (!['cash', 'check'].includes(disbursement_method)) {
            return res.redirect(`/employee/customer/${customer_id}/create-loan?error=Invalid disbursement method`);
        }

        // Calculate payments
        const monthlyRate = loanConfig.interestRate / 100 / 12;
        const monthlyPayment = loan_amount * monthlyRate * Math.pow(1 + monthlyRate, duration_months) / 
                              (Math.pow(1 + monthlyRate, duration_months) - 1);
        const totalPayable = monthlyPayment * duration_months;
        const totalInterest = totalPayable - loan_amount;

        console.log('Loan calculations:', {
            loan_amount,
            interestRate: loanConfig.interestRate,
            duration_months,
            monthlyPayment,
            totalPayable,
            totalInterest
        });

        // Start transaction
        conn.beginTransaction((err) => {
            if (err) {
                console.error('Transaction error:', err);
                return res.redirect(`/employee/customer/${customer_id}/create-loan?error=Database error`);
            }

            // Insert loan into database
            const loanQuery = `
                INSERT INTO loans (
                    borrower_id, 
                    loan_type, 
                    loan_amount, 
                    interest_rate, 
                    duration_months, 
                    monthly_payment, 
                    total_payable, 
                    total_interest, 
                    purpose, 
                    purpose_category, 
                    disbursement_method,
                    status, 
                    created_by,
                    notes
                ) VALUES (?, 'regular', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
            `;

            const loanValues = [
                customer_id, 
                parseFloat(loan_amount), 
                loanConfig.interestRate, 
                parseInt(duration_months), 
                parseFloat(monthlyPayment), 
                parseFloat(totalPayable),
                parseFloat(totalInterest),
                purpose,
                purpose_category,
                disbursement_method,
                user.user_id,
                notes || null
            ];

            console.log('Insert values:', loanValues);

            conn.query(loanQuery, loanValues, (err, result) => {
                if (err) {
                    console.error('Error creating loan:', err);
                    console.error('SQL Error:', err.sqlMessage);
                    return conn.rollback(() => {
                        res.redirect(`/employee/customer/${customer_id}/create-loan?error=Database error: ${err.sqlMessage}`);
                    });
                }

                const loanId = result.insertId;
                console.log('Loan created successfully with ID:', loanId);

                // Generate contract number
                const now = new Date();
                const contractNumber = 'MC' + now.getFullYear() + 
                    (now.getMonth() + 1).toString().padStart(2, '0') + 
                    now.getDate().toString().padStart(2, '0') + 
                    Math.floor(Math.random() * 1000).toString().padStart(3, '0');

                // Insert loan application details with ATM passbook info
                const applicationQuery = `
                    INSERT INTO loan_applications (
                        loan_id,
                        withdrawal_method,
                        id_verified,
                        customer_consent,
                        terms_agreed,
                        contract_number,
                        application_status,
                        atm_passbook_number,
                        bank_name,
                        id_number
                    ) VALUES (?, 'cash_only', TRUE, TRUE, TRUE, ?, 'submitted', ?, ?, ?)
                `;

                conn.query(applicationQuery, [
                    loanId,
                    contractNumber,
                    atm_passbook_number,
                    bank_name || null,
                    id_number || null
                ], (err) => {
                    if (err) {
                        console.error('Error creating loan application:', err);
                        return conn.rollback(() => {
                            res.redirect(`/employee/customer/${customer_id}/create-loan?error=Error saving application details`);
                        });
                    }

                    console.log('Loan application created, now processing IDs. valid_ids:', valid_ids);
                    
                    // Parse valid_ids - handle both string and array formats
                    let idArray = [];
                    if (typeof valid_ids === 'string') {
                        idArray = valid_ids.split(',').filter(id => id.trim() !== '');
                    } else if (Array.isArray(valid_ids)) {
                        idArray = valid_ids;
                    }
                    
                    console.log('ID array to process:', idArray);

                    if (idArray.length > 0) {
                        const idQuery = `
                            INSERT INTO loan_id_verification (loan_id, id_type, id_number, is_verified, verified_by) 
                            VALUES (?, ?, ?, TRUE, ?)
                        `;

                        let idPromises = [];
                        
                        idArray.forEach(idType => {
                            idPromises.push(new Promise((resolve, reject) => {
                                conn.query(idQuery, [
                                    loanId,
                                    idType.trim(),
                                    id_number || null,
                                    user.user_id
                                ], (err) => {
                                    if (err) {
                                        console.error('Error inserting ID:', idType, err);
                                        reject(err);
                                    } else {
                                        console.log('ID inserted successfully:', idType);
                                        resolve();
                                    }
                                });
                            }));
                        });

                        Promise.all(idPromises)
                            .then(() => {
                                console.log('All IDs processed successfully');
                                // Generate payment schedule
                                generatePaymentSchedule(loanId, loan_amount, monthlyPayment, monthlyRate, duration_months, loanConfig.interestRate);
                                
                                // Commit transaction
                                conn.commit((err) => {
                                    if (err) {
                                        console.error('Commit error:', err);
                                        return conn.rollback(() => {
                                            res.redirect(`/employee/customer/${customer_id}/create-loan?error=Transaction failed`);
                                        });
                                    }

                                    // Log the action
                                    conn.query(
                                        'INSERT INTO audit_logs (user_id, action, description) VALUES (?, ?, ?)',
                                        [user.user_id, 'CREATE_LOAN', `Created loan #${loanId} for customer ${customer_id} - ₱${loan_amount} - ATM Passbook: ${atm_passbook_number}`],
                                        (logErr) => {
                                            if (logErr) {
                                                console.error('Error logging action:', logErr);
                                            }
                                        }
                                    );

                                    console.log('Loan application completed successfully, redirecting to dashboard');
                                    res.redirect(`/dashboard?success=Loan application created successfully for ${customer.first_name} ${customer.last_name} (Contract #${contractNumber})`);
                                });
                            })
                            .catch(idErr => {
                                console.error('Error saving ID verification:', idErr);
                                conn.rollback(() => {
                                    res.redirect(`/employee/customer/${customer_id}/create-loan?error=Error saving ID verification`);
                                });
                            });
                    } else {
                        console.log('No IDs to process, committing transaction');
                        // Commit transaction even if no IDs
                        conn.commit((err) => {
                            if (err) {
                                console.error('Commit error:', err);
                                return conn.rollback(() => {
                                    res.redirect(`/employee/customer/${customer_id}/create-loan?error=Transaction failed`);
                                });
                            }
                            console.log('Loan created without IDs, redirecting to dashboard');
                            res.redirect(`/dashboard?success=Loan application created successfully for ${customer.first_name} ${customer.last_name} (Contract #${contractNumber})`);
                        });
                    }
                });
            });
        });
    });
});
// Function to generate payment schedule
function generatePaymentSchedule(loanId, loanAmount, monthlyPayment, monthlyRate, durationMonths, interestRate) {
    let remainingBalance = parseFloat(loanAmount);
    const paymentDate = new Date();
    
    // Clear existing schedule (if any)
    conn.query('DELETE FROM payment_schedule WHERE loan_id = ?', [loanId], (err) => {
        if (err) {
            console.error('Error clearing payment schedule:', err);
            return;
        }
        
        // Generate schedule for each month
        for (let month = 1; month <= durationMonths; month++) {
            const interest = remainingBalance * monthlyRate;
            const principal = monthlyPayment - interest;
            const dueDate = new Date(paymentDate);
            dueDate.setMonth(dueDate.getMonth() + month);
            
            // Format date as YYYY-MM-DD
            const formattedDueDate = dueDate.toISOString().split('T')[0];
            
            const scheduleQuery = `
                INSERT INTO payment_schedule (
                    loan_id, 
                    installment_number, 
                    due_date, 
                    principal_amount, 
                    interest_amount, 
                    total_amount, 
                    remaining_balance, 
                    status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
            `;
            
            conn.query(scheduleQuery, [
                loanId,
                month,
                formattedDueDate,
                principal,
                interest,
                monthlyPayment,
                remainingBalance - principal
            ], (err) => {
                if (err) {
                    console.error(`Error creating payment schedule for month ${month}:`, err);
                }
            });
            
            remainingBalance -= principal;
        }
        
        console.log(`Payment schedule generated for loan #${loanId} with ${durationMonths} installments`);
    });
}

// View customer profile
app.get('/employee/customer/:id', requireAuth(['employee']), (req, res) => {
    const customerId = req.params.id;
    const user = req.session.user;
    
    const queries = [
        'SELECT * FROM customers WHERE customer_id = ?',
        'SELECT * FROM loans WHERE borrower_id = ? ORDER BY applied_date DESC',
        'SELECT * FROM beneficiaries WHERE customer_id = ?',
        'SELECT * FROM customer_documents WHERE customer_id = ? ORDER BY uploaded_at DESC'
    ];

    Promise.all(queries.map(query => 
        new Promise((resolve, reject) => {
            conn.query(query, [customerId], (err, results) => {
                if (err) reject(err);
                else resolve(results);
            })
        })
    )).then(results => {
        if (results[0].length === 0) {
            return res.render('error', { message: 'Customer not found' });
        }

        const customer = results[0][0];
        
        res.render('employee/customer-profile', {
            title: `Customer Profile - ${customer.first_name} ${customer.last_name}`,
            user: user,
            customer: customer,
            loans: results[1],
            beneficiaries: results[2],
            documents: results[3]
        });
    }).catch(err => {
        console.error('Error loading customer profile:', err);
        res.render('error', { message: 'Error loading customer profile' });
    });
});

// Create loan for customer page
app.get('/employee/customer/:id/create-loan', requireAuth(['employee']), (req, res) => {
    const customerId = req.params.id;
    const user = req.session.user;
    
    console.log('Create loan page for customer:', customerId);
    
    // Verify customer exists
    conn.query('SELECT * FROM customers WHERE customer_id = ?', [customerId], (err, results) => {
        if (err) {
            console.error('Error fetching customer:', err);
            return res.render('error', { message: 'Error loading customer data' });
        }

        if (results.length === 0) {
            return res.render('error', { message: 'Customer not found' });
        }

        const customer = results[0];
        
        console.log('Customer found:', customer.first_name, customer.last_name);
        
        res.render('employee/create-loan', {
            title: `Create Loan for ${customer.first_name} ${customer.last_name}`,
            user: user,
            customer: customer,
            error: req.query.error
        });
    });
});

// View customer loans
app.get('/employee/customer/:id/loans', requireAuth(['employee', 'manager', 'admin']), (req, res) => {
    const customerId = req.params.id;
    const user = req.session.user;
    
    // Verify customer exists and get their info
    conn.query('SELECT * FROM customers WHERE customer_id = ?', [customerId], (err, results) => {
        if (err || results.length === 0) {
            return res.render('error', { message: 'Customer not found' });
        }

        const customer = results[0];
        
        // Get loans for this specific customer
        const query = `
            SELECT l.*, c.first_name, c.last_name 
            FROM loans l 
            JOIN customers c ON l.borrower_id = c.customer_id 
            WHERE l.borrower_id = ?
            ORDER BY l.applied_date DESC
        `;

        conn.query(query, [customerId], (err, loans) => {
            if (err) {
                console.error('Error fetching loans:', err);
                return res.render('error', { message: 'Error loading loans' });
            }

            res.render('staff/loans', {
                title: `Loans - ${customer.first_name} ${customer.last_name}`,
                user: user,
                loans: loans,
                customer: customer,
                currentFilter: 'all',
                error: req.query.error,
                success: req.query.success
            });
        });
    });
});

// Add beneficiary
app.post('/employee/add-beneficiary', requireAuth(['employee']), (req, res) => {
    const { customer_id, full_name, relationship, birthdate, percentage } = req.body;
    
    const query = `
        INSERT INTO beneficiaries (customer_id, full_name, relationship, birthdate, percentage)
        VALUES (?, ?, ?, ?, ?)
    `;
    
    conn.query(query, [customer_id, full_name, relationship, birthdate, percentage], (err, result) => {
        if (err) {
            console.error('Error adding beneficiary:', err);
            return res.json({ success: false, message: 'Error adding beneficiary' });
        }
        
        res.json({ success: true, message: 'Beneficiary added successfully' });
    });
});

// Loan Calculator Page
app.get('/employee/calculator', requireAuth(['employee']), (req, res) => {
    const user = req.session.user;
    
    res.render('employee/calculator', {
        title: 'Loan Calculator & Contract Generator',
        user: user
    });
});

// Manager Reports Route
app.get('/manager/reports', requireAuth(['manager', 'admin']), (req, res) => {
    const user = req.session.user;
    
    // Get report data
    const queries = [
        // Monthly loan statistics
        `SELECT 
            MONTH(applied_date) as month,
            COUNT(*) as total_loans,
            SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved_loans,
            SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_loans,
            SUM(loan_amount) as total_amount
         FROM loans 
         WHERE YEAR(applied_date) = YEAR(CURRENT_DATE())
         GROUP BY MONTH(applied_date)
         ORDER BY month`,

        // Team performance
        `SELECT 
            u.full_name,
            u.email,
            COUNT(l.loan_id) as total_loans,
            SUM(CASE WHEN l.status = 'approved' THEN 1 ELSE 0 END) as approved_loans,
            SUM(CASE WHEN l.status = 'pending' THEN 1 ELSE 0 END) as pending_loans
         FROM users u
         LEFT JOIN loans l ON u.user_id = l.created_by
         WHERE u.user_type = 'employee' AND u.is_active = TRUE
         GROUP BY u.user_id, u.full_name, u.email
         ORDER BY total_loans DESC`,

        // Loan types distribution
        `SELECT 
            loan_type,
            COUNT(*) as count,
            SUM(loan_amount) as total_amount
         FROM loans 
         WHERE YEAR(applied_date) = YEAR(CURRENT_DATE())
         GROUP BY loan_type`,

        // Monthly disbursement
        `SELECT 
            MONTH(disbursed_date) as month,
            COUNT(*) as disbursed_loans,
            SUM(loan_amount) as disbursed_amount
         FROM loans 
         WHERE status = 'disbursed' AND YEAR(disbursed_date) = YEAR(CURRENT_DATE())
         GROUP BY MONTH(disbursed_date)
         ORDER BY month`
    ];

    Promise.all(queries.map(query => 
        new Promise((resolve, reject) => {
            conn.query(query, (err, results) => {
                if (err) reject(err);
                else resolve(results);
            });
        })
    )).then(results => {
        res.render('manager/reports', {
            title: 'Manager Reports',
            user: user,
            monthlyStats: results[0],
            teamPerformance: results[1],
            loanTypes: results[2],
            disbursements: results[3]
        });
    }).catch(err => {
        console.error('Reports error:', err);
        res.render('manager/reports', {
            title: 'Manager Reports',
            user: user,
            monthlyStats: [],
            teamPerformance: [],
            loanTypes: [],
            disbursements: []
        });
    });
});

// Manager Analytics Route
app.get('/manager/analytics', requireAuth(['manager', 'admin']), (req, res) => {
    const user = req.session.user;
    
    res.render('manager/analytics', {
        title: 'Loan Analytics',
        user: user
    });
});

app.get('/employee/pension-withdrawals', requireAuth(['employee', 'manager', 'admin']), (req, res) => {
    const user = req.session.user;
    const statusFilter = req.query.status || 'all';
    const dateFilter = req.query.date || 'all';
    
    console.log('=== PENSION WITHDRAWALS PAGE ===');
    
    let query = `
        SELECT 
            pw.*,
            c.first_name,
            c.last_name,
            c.pension_number,
            c.pension_system,
            c.monthly_pension,
            u.full_name as processed_by_name
        FROM pension_withdrawals pw
        LEFT JOIN customers c ON pw.customer_id = c.customer_id
        LEFT JOIN users u ON pw.processed_by = u.user_id
    `;
    
    let conditions = [];
    let params = [];
    
    // Apply status filter
    if (statusFilter !== 'all') {
        conditions.push('pw.status = ?');
        params.push(statusFilter);
    }
    
    // Apply date filter
    if (dateFilter === 'today') {
        conditions.push('DATE(pw.withdrawal_date) = CURDATE()');
    } else if (dateFilter === 'week') {
        conditions.push('pw.withdrawal_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)');
    } else if (dateFilter === 'month') {
        conditions.push('pw.withdrawal_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)');
    }
    
    if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
    }
    
    query += ' ORDER BY pw.created_at DESC';
    
    conn.query(query, params, (err, withdrawals) => {
        if (err) {
            console.error('Error fetching pension withdrawals:', err);
            return res.render('error', { message: 'Error loading pension withdrawals' });
        }
        
        // Get summary statistics
        const statsQuery = `
            SELECT 
                COUNT(*) as total_withdrawals,
                SUM(withdrawal_amount) as total_amount,
                COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_count,
                COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_count,
                SUM(CASE WHEN status = 'completed' THEN withdrawal_amount ELSE 0 END) as completed_amount
            FROM pension_withdrawals
            WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
        `;
        
        conn.query(statsQuery, (err, statsResults) => {
            const stats = statsResults.length > 0 ? statsResults[0] : {};
            
            res.render('employee/pension-withdrawals', {
                title: 'Pension Withdrawals',
                user: user,
                withdrawals: withdrawals,
                stats: stats,
                currentFilter: statusFilter,
                dateFilter: dateFilter,
                error: req.query.error,
                success: req.query.success
            });
        });
    });
});

// Create withdrawal form
app.get('/employee/create-withdrawal', requireAuth(['employee', 'manager', 'admin']), (req, res) => {
    const user = req.session.user;
    const customerId = req.query.customer_id;
    
    console.log('=== CREATE WITHDRAWAL PAGE ===');
    console.log('Customer ID from query:', customerId);
    
    // Get all active customers for dropdown
    const customerQuery = `
        SELECT 
            customer_id, 
            first_name, 
            last_name, 
            pension_number, 
            pension_system, 
            monthly_pension,
            CONCAT(first_name, ' ', last_name, ' - ', pension_number, ' (₱', monthly_pension, '/month)') as display_name
        FROM customers 
        WHERE is_active = TRUE 
        AND monthly_pension IS NOT NULL 
        AND monthly_pension > 0
        ORDER BY first_name, last_name
    `;
    
    conn.query(customerQuery, (err, customers) => {
        if (err) {
            console.error('Error fetching customers:', err);
            return res.render('error', { message: 'Error loading customers' });
        }
        
        res.render('employee/create-withdrawal', {
            title: 'Create Pension Withdrawal',
            user: user,
            customers: customers,
            customer_id: customerId,
            error: req.query.error,
            success: req.query.success
        });
    });
});

// Process withdrawal form submission - COMPLETELY FIXED (no reference_number)
// Process withdrawal form submission
app.post('/employee/process-withdrawal', requireAuth(['employee', 'manager', 'admin']), (req, res) => {
    const { customer_id, withdrawal_amount, withdrawal_method, withdrawal_date, notes } = req.body;
    const user = req.session.user;
    
    // Validation
    if (!customer_id || !withdrawal_amount || !withdrawal_method || !withdrawal_date) {
        return res.redirect('/employee/create-withdrawal?error=Please fill all required fields');
    }
    
    // Insert withdrawal
    const query = `
        INSERT INTO pension_withdrawals (
            customer_id, withdrawal_amount, withdrawal_method, 
            withdrawal_date, status, processed_by, notes, created_at
        ) VALUES (?, ?, ?, ?, 'pending', ?, ?, NOW())
    `;
    
    conn.query(query, [customer_id, withdrawal_amount, withdrawal_method, withdrawal_date, user.user_id, notes || null], (err, result) => {
        if (err) {
            console.error('Error creating withdrawal:', err);
            return res.redirect(`/employee/create-withdrawal?customer_id=${customer_id}&error=Error creating withdrawal: ${err.message}`);
        }
        
        res.redirect('/employee/pension-withdrawals?success=Withdrawal created successfully');
    });
});

// Update withdrawal status
app.post('/employee/withdrawal/:id/status', requireAuth(['employee', 'manager', 'admin']), (req, res) => {
    const withdrawalId = req.params.id;
    const { status, reason } = req.body;
    const user = req.session.user;
    
    let updateQuery = 'UPDATE pension_withdrawals SET status = ?, updated_at = NOW()';
    let params = [status];
    
    if (status === 'completed') {
        updateQuery += ', completed_date = NOW(), completed_by = ?';
        params.push(user.user_id);
    } else if (status === 'cancelled') {
        updateQuery += ', cancelled_date = NOW(), cancelled_by = ?, cancellation_reason = ?';
        params.push(user.user_id, reason);
    }
    
    updateQuery += ' WHERE withdrawal_id = ?';
    params.push(withdrawalId);
    
    conn.query(updateQuery, params, (err, result) => {
        if (err) {
            return res.json({ success: false, message: err.message });
        }
        res.json({ success: true, message: `Withdrawal ${status} successfully` });
    });
});
// Get next installment for a loan
app.get('/api/loan/:id/next-installment', requireAuth(), (req, res) => {
    const loanId = req.params.id;
    const query = `
        SELECT installment_number, due_date, total_amount 
        FROM payment_schedule 
        WHERE loan_id = ? AND status = 'pending' 
        ORDER BY installment_number 
        LIMIT 1
    `;
    conn.query(query, [loanId], (err, results) => {
        if (err || results.length === 0) {
            return res.json({ success: false });
        }
        res.json({ 
            success: true, 
            installment_number: results[0].installment_number,
            due_date: results[0].due_date,
            amount: results[0].total_amount
        });
    });
});

// Get remaining balance for a loan
app.get('/api/loan/:id/remaining-balance', requireAuth(), (req, res) => {
    const loanId = req.params.id;
    
    const query = `
        SELECT 
            l.loan_amount,
            l.total_payable,
            COALESCE(SUM(lp.amount_paid), 0) as total_paid
        FROM loans l
        LEFT JOIN loan_payments lp ON l.loan_id = lp.loan_id AND lp.payment_status IN ('paid', 'partial')
        WHERE l.loan_id = ?
        GROUP BY l.loan_id
    `;
    
    conn.query(query, [loanId], (err, results) => {
        if (err) {
            console.error('Error calculating remaining balance:', err);
            return res.json({ success: false, message: 'Error calculating balance' });
        }
        
        if (results.length === 0) {
            return res.json({ success: false, message: 'Loan not found' });
        }
        
        const loan = results[0];
        const remainingBalance = parseFloat(loan.total_payable) - parseFloat(loan.total_paid);
        
        res.json({
            success: true,
            remaining_balance: remainingBalance,
            total_paid: loan.total_paid,
            total_payable: loan.total_payable
        });
    });
});

// Get installments for a loan
app.get('/api/loan/:id/installments', requireAuth(), (req, res) => {
    const loanId = req.params.id;
    
    const query = `
        SELECT 
            installment_number,
            due_date,
            total_amount,
            status,
            paid_date
        FROM payment_schedule
        WHERE loan_id = ?
        ORDER BY installment_number
    `;
    
    conn.query(query, [loanId], (err, results) => {
        if (err) {
            console.error('Error fetching installments:', err);
            return res.json({ success: false, message: 'Error fetching installments' });
        }
        
        res.json({
            success: true,
            installments: results
        });
    });
});

// Search loan API
app.get('/api/search-loan', requireAuth(), (req, res) => {
    const searchTerm = req.query.q;
    
    if (!searchTerm) {
        return res.json({ success: false, message: 'No search term provided' });
    }
    
    let query = `
        SELECT 
            l.loan_id,
            l.loan_amount,
            l.monthly_payment,
            l.status,
            c.first_name,
            c.last_name,
            c.pension_number
        FROM loans l
        LEFT JOIN customers c ON l.borrower_id = c.customer_id
        WHERE l.loan_id = ? 
           OR c.first_name LIKE ? 
           OR c.last_name LIKE ? 
           OR c.pension_number LIKE ?
        LIMIT 5
    `;
    
    const searchPattern = `%${searchTerm}%`;
    conn.query(query, [searchTerm, searchPattern, searchPattern, searchPattern], (err, results) => {
        if (err) {
            console.error('Error searching loans:', err);
            return res.json({ success: false, message: 'Error searching loans' });
        }
        
        if (results.length === 0) {
            return res.json({ success: false, message: 'No loans found' });
        }
        
        res.json({
            success: true,
            loans: results
        });
    });
});

// Get payment receipt data (for modal)
app.get('/api/payment-receipt/:id', requireAuth(), (req, res) => {
    const paymentId = req.params.id;
    
    const query = `
        SELECT 
            lp.*,
            pr.receipt_number,
            l.loan_id,
            c.first_name,
            c.last_name,
            c.pension_number,
            u.full_name as posted_by_name
        FROM loan_payments lp
        LEFT JOIN payment_receipts pr ON lp.payment_id = pr.payment_id
        LEFT JOIN loans l ON lp.loan_id = l.loan_id
        LEFT JOIN customers c ON l.borrower_id = c.customer_id
        LEFT JOIN users u ON pr.issued_by = u.user_id
        WHERE lp.payment_id = ?
    `;
    
    conn.query(query, [paymentId], (err, results) => {
        if (err || results.length === 0) {
            return res.json({ success: false, message: 'Receipt not found' });
        }
        
        res.json({
            success: true,
            receipt: results[0]
        });
    });
});

// Export payments to CSV
app.get('/api/export-payments', requireAuth(), (req, res) => {
    const { status, date } = req.query;
    
    let query = `
        SELECT 
            pr.receipt_number,
            c.first_name,
            c.last_name,
            c.pension_number,
            l.loan_id,
            lp.amount_paid,
            lp.payment_method,
            lp.payment_status,
            lp.payment_date,
            u.full_name as posted_by
        FROM loan_payments lp
        LEFT JOIN payment_receipts pr ON lp.payment_id = pr.payment_id
        LEFT JOIN loans l ON lp.loan_id = l.loan_id
        LEFT JOIN customers c ON l.borrower_id = c.customer_id
        LEFT JOIN users u ON lp.posted_by = u.user_id
        WHERE 1=1
    `;
    
    const params = [];
    
    if (status && status !== 'all') {
        query += ' AND lp.payment_status = ?';
        params.push(status);
    }
    
    if (date === 'today') {
        query += ' AND DATE(lp.payment_date) = CURDATE()';
    } else if (date === 'week') {
        query += ' AND lp.payment_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)';
    } else if (date === 'month') {
        query += ' AND lp.payment_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)';
    }
    
    query += ' ORDER BY lp.payment_date DESC';
    
    conn.query(query, params, (err, results) => {
        if (err) {
            console.error('Error exporting payments:', err);
            return res.status(500).json({ success: false, message: 'Error exporting data' });
        }
        
        // Create CSV
        const headers = ['Receipt Number', 'Customer Name', 'Pension Number', 'Loan ID', 'Amount Paid', 'Payment Method', 'Status', 'Payment Date', 'Posted By'];
        let csv = headers.join(',') + '\n';
        
        results.forEach(row => {
            const values = [
                row.receipt_number || 'N/A',
                `${row.first_name} ${row.last_name}`,
                row.pension_number || 'N/A',
                row.loan_id,
                row.amount_paid,
                row.payment_method,
                row.payment_status,
                new Date(row.payment_date).toLocaleDateString(),
                row.posted_by
            ].map(v => `"${v}"`).join(',');
            csv += values + '\n';
        });
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=payments_export_${new Date().toISOString().split('T')[0]}.csv`);
        res.send(csv);
    });
});
// Post Payment Page Route
app.get('/employee/post-payment', requireAuth(['employee', 'manager', 'admin']), (req, res) => {
    res.render('employee/post-payment', {
        title: 'Post Loan Payment',
        user: req.session.user,
        error: req.query.error,
        success: req.query.success
    });
});

// Post Payment Page with specific loan ID
app.get('/employee/post-payment/:loanId', requireAuth(['employee', 'manager', 'admin']), (req, res) => {
    const loanId = req.params.loanId;
    
    // Fetch loan details
    const query = `
        SELECT l.*, c.first_name, c.last_name, c.pension_number, c.monthly_pension
        FROM loans l
        LEFT JOIN customers c ON l.borrower_id = c.customer_id
        WHERE l.loan_id = ?
    `;
    
    conn.query(query, [loanId], (err, results) => {
        if (err || results.length === 0) {
            return res.redirect('/employee/post-payment?error=Loan not found');
        }
        
        res.render('employee/post-payment', {
            title: 'Post Loan Payment',
            user: req.session.user,
            preSelectedLoan: results[0],
            error: req.query.error,
            success: req.query.success
        });
    });
});

// Update the post-payment page route
app.get('/employee/post-payment/:loanId', requireAuth(['employee', 'manager', 'admin']), (req, res) => {
    const loanId = req.params.loanId;
    
    const queries = [
        `SELECT l.*, c.first_name, c.last_name, c.pension_number, c.monthly_pension 
         FROM loans l 
         LEFT JOIN customers c ON l.borrower_id = c.customer_id 
         WHERE l.loan_id = ?`,
        `SELECT * FROM payment_schedule 
         WHERE loan_id = ? AND status IN ('pending', 'overdue') 
         ORDER BY installment_number LIMIT 1`
    ];
    
    Promise.all(queries.map(query => 
        new Promise((resolve, reject) => {
            conn.query(query, [loanId], (err, results) => {
                if (err) reject(err);
                else resolve(results);
            });
        })
    )).then(results => {
        if (results[0].length === 0) {
            return res.redirect('/loans?error=Loan not found');
        }
        
        const loan = results[0][0];
        const nextInstallment = results[1].length > 0 ? results[1][0] : null;
        
        // Get remaining balance
        const balanceQuery = `
            SELECT 
                COALESCE(SUM(amount_paid), 0) as total_paid
            FROM loan_payments 
            WHERE loan_id = ? AND payment_status IN ('paid', 'partial')
        `;
        
        conn.query(balanceQuery, [loanId], (err, balanceResults) => {
            const totalPaid = balanceResults && balanceResults[0] ? balanceResults[0].total_paid : 0;
            const remainingBalance = loan.total_payable - totalPaid;
            
            res.render('employee/post-payment', {
                title: `Post Payment - Loan #${loanId}`,
                user: req.session.user,
                loan: loan,
                nextInstallment: nextInstallment,
                remainingBalance: remainingBalance,
                error: req.query.error,
                success: req.query.success
            });
        });
    }).catch(err => {
        console.error('Error loading post payment page:', err);
        res.redirect('/loans?error=Error loading payment form');
    });
});
// View withdrawal details
app.get('/employee/withdrawal/:id', requireAuth(['employee', 'manager', 'admin']), (req, res) => {
    const withdrawalId = req.params.id;
    const user = req.session.user;
    
    console.log('=== VIEW WITHDRAWAL DETAILS ===');
    console.log('Withdrawal ID:', withdrawalId);
    
    const query = `
        SELECT 
            pw.*,
            c.first_name,
            c.last_name,
            c.pension_number,
            c.pension_system,
            c.monthly_pension,
            c.mobile_number,
            c.email,
            u.full_name as processed_by_name
        FROM pension_withdrawals pw
        LEFT JOIN customers c ON pw.customer_id = c.customer_id
        LEFT JOIN users u ON pw.processed_by = u.user_id
        WHERE pw.withdrawal_id = ?
    `;
    
    conn.query(query, [withdrawalId], (err, results) => {
        if (err) {
            console.error('Error fetching withdrawal:', err);
            return res.redirect('/employee/pension-withdrawals?error=Error loading withdrawal details');
        }
        
        if (results.length === 0) {
            return res.redirect('/employee/pension-withdrawals?error=Withdrawal not found');
        }
        
        const withdrawal = results[0];
        
        res.render('employee/withdrawal-details', {
            title: `Withdrawal #${withdrawalId} Details`,
            user: user,
            withdrawal: withdrawal,
            error: req.query.error,
            success: req.query.success
        });
    });
});

// Generate withdrawal receipt
app.get('/employee/withdrawal/:id/receipt', requireAuth(['employee', 'manager', 'admin']), (req, res) => {
    const withdrawalId = req.params.id;
    
    const query = `
        SELECT 
            pw.*,
            c.first_name,
            c.last_name,
            c.pension_number,
            c.pension_system,
            c.monthly_pension,
            u.full_name as processed_by_name
        FROM pension_withdrawals pw
        LEFT JOIN customers c ON pw.customer_id = c.customer_id
        LEFT JOIN users u ON pw.processed_by = u.user_id
        WHERE pw.withdrawal_id = ?
    `;
    
    conn.query(query, [withdrawalId], (err, results) => {
        if (err || results.length === 0) {
            return res.redirect('/employee/pension-withdrawals?error=Withdrawal not found');
        }
        
        res.render('employee/withdrawal-receipt', {
            title: `Receipt - Withdrawal #${withdrawalId}`,
            user: req.session.user,
            withdrawal: results[0]
        });
    });
});
// Update withdrawal status (complete, cancel)
app.post('/employee/withdrawal/:id/status', requireAuth(['employee', 'manager', 'admin']), (req, res) => {
    const withdrawalId = req.params.id;
    const { status, reason } = req.body;
    const user = req.session.user;
    
    console.log('=== UPDATE WITHDRAWAL STATUS ===');
    console.log('Withdrawal ID:', withdrawalId);
    console.log('New Status:', status);
    
    if (!['completed', 'cancelled', 'processing'].includes(status)) {
        return res.json({ success: false, message: 'Invalid status' });
    }
    
    conn.beginTransaction((err) => {
        if (err) {
            console.error('Transaction error:', err);
            return res.json({ success: false, message: 'Database error' });
        }
        
        const updateData = {
            status: status,
            updated_at: new Date()
        };
        
        if (status === 'completed') {
            updateData.completed_date = new Date();
            updateData.completed_by = user.user_id;
        } else if (status === 'cancelled' && reason) {
            updateData.cancellation_reason = reason;
            updateData.cancelled_by = user.user_id;
            updateData.cancelled_date = new Date();
        }
        
        const updateQuery = 'UPDATE pension_withdrawals SET ? WHERE withdrawal_id = ?';
        
        conn.query(updateQuery, [updateData, withdrawalId], (err, result) => {
            if (err) {
                console.error('Error updating withdrawal:', err);
                return conn.rollback(() => {
                    res.json({ success: false, message: 'Error updating withdrawal status' });
                });
            }
            
            if (result.affectedRows === 0) {
                return conn.rollback(() => {
                    res.json({ success: false, message: 'Withdrawal not found' });
                });
            }
            
            // Log the action
            conn.query(
                'INSERT INTO audit_logs (user_id, action, description, ip_address) VALUES (?, ?, ?, ?)',
                [user.user_id, 'UPDATE_WITHDRAWAL', `Updated withdrawal #${withdrawalId} status to ${status}`, req.ip],
                (logErr) => {
                    if (logErr) {
                        console.error('Error logging action:', logErr);
                    }
                }
            );
            
            conn.commit((err) => {
                if (err) {
                    console.error('Commit error:', err);
                    return conn.rollback(() => {
                        res.json({ success: false, message: 'Transaction failed' });
                    });
                }   
                
                res.json({ 
                    success: true, 
                    message: `Withdrawal marked as ${status} successfully` 
                });
            });
        });
    });
});

// Generate receipt for withdrawal
app.get('/employee/withdrawal/:id/receipt', requireAuth(['employee', 'manager', 'admin']), (req, res) => {
    const withdrawalId = req.params.id;
    const user = req.session.user;
    
    console.log('=== GENERATE WITHDRAWAL RECEIPT ===');
    
    const query = `
        SELECT 
            pw.*,
            c.first_name,
            c.last_name,
            c.pension_number,
            c.pension_system,
            c.monthly_pension,
            c.mobile_number,
            c.email,
            u.full_name as processed_by_name
        FROM pension_withdrawals pw
        LEFT JOIN customers c ON pw.customer_id = c.customer_id
        LEFT JOIN users u ON pw.processed_by = u.user_id
        WHERE pw.withdrawal_id = ?
    `;
    
    conn.query(query, [withdrawalId], (err, results) => {
        if (err) {
            console.error('Error fetching withdrawal:', err);
            return res.redirect('/employee/pension-withdrawals?error=Error generating receipt');
        }
        
        if (results.length === 0) {
            return res.redirect('/employee/pension-withdrawals?error=Withdrawal not found');
        }
        
        const withdrawal = results[0];
        
        res.render('employee/withdrawal-receipt', {
            title: `Receipt - ${withdrawal.reference_number}`,
            user: user,
            withdrawal: withdrawal
        });
    });
});

// API endpoint to get customer pension details
app.get('/api/customer/:id/pension-details', requireAuth(['employee', 'manager', 'admin']), (req, res) => {
    const customerId = req.params.id;
    
    console.log('=== FETCH PENSION DETAILS API ===');
    console.log('Customer ID:', customerId);
    
    const query = `
        SELECT 
            customer_id,
            first_name,
            last_name,
            pension_number,
            pension_system,
            monthly_pension,
            pension_start_date,
            CONCAT(first_name, ' ', last_name) as full_name
        FROM customers 
        WHERE customer_id = ? AND is_active = TRUE
    `;
    
    conn.query(query, [customerId], (err, results) => {
        if (err) {
            console.error('Error fetching pension details:', err);
            return res.status(500).json({ 
                success: false, 
                message: 'Error fetching pension details' 
            });
        }
        
        if (results.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Customer not found' 
            });
        }
        
        const customer = results[0];
        
        // Check recent withdrawals (last 30 days)
        const withdrawalQuery = `
            SELECT 
                COUNT(*) as withdrawal_count,
                SUM(withdrawal_amount) as total_withdrawn
            FROM pension_withdrawals 
            WHERE customer_id = ? 
            AND status IN ('completed', 'processing')
            AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        `;
        
        conn.query(withdrawalQuery, [customerId], (err, withdrawalResults) => {
            const withdrawalStats = withdrawalResults && withdrawalResults.length > 0 ? withdrawalResults[0] : { withdrawal_count: 0, total_withdrawn: 0 };
            
            res.json({
                success: true,
                data: {
                    ...customer,
                    max_withdrawal: customer.monthly_pension,
                    recent_withdrawals: withdrawalStats.withdrawal_count || 0,
                    total_withdrawn_recent: withdrawalStats.total_withdrawn || 0,
                    has_pension: !!(customer.monthly_pension && customer.pension_number),
                    pension_status: customer.monthly_pension ? 'Active' : 'No pension data'
                }
            });
        });
    });
});
    
// Customer profile view (for employees viewing customer profiles)
app.get('/profile/:id', requireAuth(['employee', 'manager', 'admin']), (req, res) => {
    const profileId = req.params.id;
    const user = req.session.user;
    
    // If employee is viewing their own profile, redirect to regular profile
    if (profileId == user.user_id) {
        return res.redirect('/profile');
    }
    
    const queries = [
        'SELECT * FROM customers WHERE customer_id = ?',
        'SELECT * FROM loans WHERE borrower_id = ? ORDER BY applied_date DESC',
        'SELECT * FROM beneficiaries WHERE customer_id = ?',
        'SELECT * FROM customer_documents WHERE customer_id = ? ORDER BY uploaded_at DESC'
    ];

    Promise.all(queries.map(query => 
        new Promise((resolve, reject) => {
            conn.query(query, [profileId], (err, results) => {
                if (err) reject(err);
                else resolve(results);
            });
        })
    )).then(results => {
        if (results[0].length === 0) {
            return res.render('error', { message: 'Customer not found' });
        }

        const customer = results[0][0];
        
        res.render('employee/customer-profile', {
            title: `Customer Profile - ${customer.first_name} ${customer.last_name}`,
            user: user,
            customer: customer,
            loans: results[1],
            beneficiaries: results[2],
            documents: results[3]
        });
    }).catch(err => {
        console.error('Error loading profile:', err);
        res.render('error', { message: 'Error loading profile' });
    });
});

// Manager Team Management Route
app.get('/manager/team', requireAuth(['manager', 'admin']), (req, res) => {
    const user = req.session.user;
    
    const query = `
        SELECT 
            u.user_id, 
            u.full_name, 
            u.email, 
            u.user_type, 
            u.created_at, 
            u.is_active, 
            u.verification_status,
            COUNT(l.loan_id) as total_loans,
            SUM(CASE WHEN l.status = 'approved' THEN 1 ELSE 0 END) as approved_loans
        FROM users u 
        LEFT JOIN loans l ON u.user_id = l.created_by 
        WHERE u.user_type IN ('employee')
        GROUP BY u.user_id, u.full_name, u.email, u.user_type, u.created_at, u.is_active, u.verification_status
        ORDER BY u.created_at DESC
    `;
    
    conn.query(query, (err, employees) => {
        if (err) {
            console.error('Error fetching team:', err);
            return res.render('error', { message: 'Error loading team management' });
        }
        
        res.render('manager/team', {
            title: 'Team Management',
            user: user,
            employees: employees
        });
    });
});

app.get('/loan-details/:id', requireAuth(['employee', 'manager', 'admin']), (req, res) => {
    const loanId = req.params.id;
    const user = req.session.user;
    
    console.log(`Loading loan details for ID: ${loanId}, User: ${user.user_id}`);
    
    // Validate loan ID
    if (!loanId || isNaN(loanId)) {
        return res.redirect('/loans?error=Invalid loan ID');
    }

    const query = `
        SELECT 
            l.*,
            c.first_name,
            c.last_name,
            c.pension_number,
            c.mobile_number,
            c.email,
            c.monthly_pension,
            c.pension_system,
            u.full_name as created_by_name,
            la.atm_passbook_number,
            la.bank_name,
            la.id_number
        FROM loans l 
        LEFT JOIN customers c ON l.borrower_id = c.customer_id 
        LEFT JOIN users u ON l.created_by = u.user_id 
        LEFT JOIN loan_applications la ON l.loan_id = la.loan_id
        WHERE l.loan_id = ?
    `;
    
    conn.query(query, [loanId], (err, results) => {
        if (err) {
            console.error('Error fetching loan details:', err);
            return res.redirect('/loans?error=Database error loading loan details');
        }
        
        if (results.length === 0) {
            console.log('Loan not found:', loanId);
            return res.redirect('/loans?error=Loan not found');
        }

        const loan = results[0];
        console.log('Loan found:', loan.loan_id, loan.first_name, loan.last_name);
        
        try {
            res.render('loan-details', {
                title: `Loan Details #${loanId}`,
                user: user,
                loan: loan,
                error: req.query.error || null,
                success: req.query.success || null
            });
        } catch (renderError) {
            console.error('Error rendering loan details:', renderError);
            res.redirect('/loans?error=Error displaying loan details');
        }
    });
});

// Manager View Employee Details
app.get('/manager/employee/:id', requireAuth(['manager', 'admin']), (req, res) => {
    const employeeId = req.params.id;
    const user = req.session.user;
    
    const queries = [
        // Employee basic info
        'SELECT * FROM users WHERE user_id = ? AND user_type = "employee"',
        
        // Loan statistics
        `SELECT 
            COUNT(*) as total_loans,
            SUM(CASE WHEN status = "approved" THEN 1 ELSE 0 END) as approved_loans,
            SUM(CASE WHEN status = "pending" THEN 1 ELSE 0 END) as pending_loans,
            SUM(CASE WHEN status = "rejected" THEN 1 ELSE 0 END) as rejected_loans,
            SUM(loan_amount) as total_loan_amount
         FROM loans WHERE created_by = ?`,
        
        // Recent loans (last 10)
        `SELECT l.*, c.first_name, c.last_name 
         FROM loans l 
         LEFT JOIN customers c ON l.borrower_id = c.customer_id 
         WHERE l.created_by = ? 
         ORDER BY l.applied_date DESC 
         LIMIT 10`,
        
        // Monthly performance data
        `SELECT 
            MONTH(applied_date) as month,
            YEAR(applied_date) as year,
            COUNT(*) as total_loans,
            SUM(CASE WHEN status = "approved" THEN 1 ELSE 0 END) as approved_loans
         FROM loans 
         WHERE created_by = ? AND applied_date >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
         GROUP BY YEAR(applied_date), MONTH(applied_date)
         ORDER BY year, month`
    ];

    Promise.all(queries.map((query, index) => 
        new Promise((resolve, reject) => {
            conn.query(query, [employeeId], (err, results) => {
                if (err) reject(err);
                else resolve(results);
            });
        })
    )).then(results => {
        if (results[0].length === 0) {
            return res.render('error', { message: 'Employee not found' });
        }

        const employee = results[0][0];
        const loanStats = results[1][0] || {};
        const recentLoans = results[2] || [];
        const monthlyPerformance = results[3] || [];
        
        res.render('manager/employee-profile', {
            title: `Employee - ${employee.full_name}`,
            user: user,
            employee: employee,
            stats: {
                totalLoans: loanStats.total_loans || 0,
                approvedLoans: loanStats.approved_loans || 0,
                pendingLoans: loanStats.pending_loans || 0,
                rejectedLoans: loanStats.rejected_loans || 0,
                totalLoanAmount: loanStats.total_loan_amount || 0
            },
            recentLoans: recentLoans,
            monthlyPerformance: monthlyPerformance
        });
    }).catch(err => {
        console.error('Error loading employee profile:', err);
        res.render('error', { message: 'Error loading employee profile' });
    });
});

// Employee reports page
app.get('/employee/reports', requireAuth(['employee']), (req, res) => {
    res.render('employee/reports', {
        title: 'Reports & Analytics',
        user: req.session.user
    });
});

// Loan management routes
// View loans (with filtering)
app.get('/loans', requireAuth(['employee', 'manager', 'admin']), (req, res) => {
    const user = req.session.user;
    const statusFilter = req.query.status || 'all'; // Default to 'all' if not provided
    const customerFilter = req.query.customer;
    
    console.log('=== LOANS ROUTE DEBUG ===');
    console.log('User:', user.user_id, user.full_name, user.user_type);
    console.log('Status filter:', statusFilter);
    console.log('Customer filter:', customerFilter);

    try {
        let query = `
            SELECT 
                l.loan_id,
                l.borrower_id,
                l.loan_amount,
                l.interest_rate,
                l.duration_months,
                l.monthly_payment,
                l.total_payable,
                l.purpose,
                l.status,
                l.loan_type,
                l.purpose_category,
                l.total_interest,
                l.disbursement_method,
                l.applied_date,
                l.approved_date,
                l.notes,
                c.customer_id,
                c.first_name,
                c.last_name,
                c.pension_number,
                c.mobile_number,
                c.email
            FROM loans l 
            LEFT JOIN customers c ON l.borrower_id = c.customer_id 
        `;
        
        let params = [];
        const conditions = [];
        
        // Build WHERE clause based on filters
        if (statusFilter && statusFilter !== 'all') {
            conditions.push('l.status = ?');
            params.push(statusFilter);
        }
        
        if (customerFilter) {
            conditions.push('l.borrower_id = ?');
            params.push(customerFilter);
        }
        
        // If user is employee, only show loans they created
        if (user.user_type === 'employee') {
            conditions.push('(l.created_by = ? OR l.created_by IS NULL)');
            params.push(user.user_id);
        }
        
        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }
        
        query += ' ORDER BY l.applied_date DESC';

        console.log('Final query:', query);
        console.log('Query params:', params);

        conn.query(query, params, (err, loans) => {
            if (err) {
                console.error('Database error:', err);
                console.error('SQL Error details:', err.sqlMessage);
                return res.status(500).render('error', { 
                    message: 'Database error: ' + err.message,
                    error: err 
                });
            }

            console.log(`Found ${loans.length} loans`);
            
            // Log sample loan data for debugging
            if (loans.length > 0) {
                console.log('Sample loan:', {
                    id: loans[0].loan_id,
                    amount: loans[0].loan_amount,
                    status: loans[0].status,
                    customer: loans[0].first_name + ' ' + loans[0].last_name
                });
            }

            // Get customer info if filtering by customer
            let customer = null;
            if (customerFilter) {
                conn.query('SELECT * FROM customers WHERE customer_id = ?', [customerFilter], (err, results) => {
                    if (err) {
                        console.error('Error fetching customer:', err);
                    }
                    if (!err && results.length > 0) {
                        customer = results[0];
                    }
                    renderLoansPage();
                });
            } else {
                renderLoansPage();
            }

            function renderLoansPage() {
                // Determine page title based on filters
                let pageTitle = 'All Loan Applications';
                if (statusFilter === 'pending') pageTitle = 'Pending Loan Applications';
                else if (statusFilter === 'approved') pageTitle = 'Approved Loans';
                else if (statusFilter === 'rejected') pageTitle = 'Rejected Loans';
                else if (statusFilter === 'disbursed') pageTitle = 'Disbursed Loans';
                
                if (customer) {
                    pageTitle = `Loans - ${customer.first_name} ${customer.last_name}`;
                }

                res.render('staff/loans', {
                    title: pageTitle,
                    user: user,
                    loans: loans,
                    customer: customer,
                    currentFilter: statusFilter,
                    error: req.query.error,
                    success: req.query.success
                });
            }
        });
        
    } catch (error) {
        console.error('Unexpected error in loans route:', error);
        res.status(500).render('error', { 
            message: 'Unexpected error: ' + error.message,
            error: error 
        });
    }
});

// Approve/Reject loan
app.post('/approve-loan/:id', requireAuth(['manager', 'admin']), (req, res) => {
    const loanId = req.params.id;
    const { status, reason } = req.body;
    const user = req.session.user;

    if (!['approved', 'rejected'].includes(status)) {
        return res.json({ success: false, message: 'Invalid status' });
    }

    const updateData = {
        status: status,
        approved_by: user.user_id,
        approved_date: new Date(),
        updated_at: new Date()
    };

    if (reason) {
        updateData.notes = reason;
    }

    const query = 'UPDATE loans SET ? WHERE loan_id = ?';

    conn.query(query, [updateData, loanId], (err, result) => {
        if (err) {
            console.error('Error updating loan:', err);
            return res.json({ success: false, message: 'Error updating loan status: ' + err.message });
        }

        if (result.affectedRows === 0) {
            return res.json({ success: false, message: 'Loan not found' });
        }

        // If approved, generate payment schedule
        if (status === 'approved') {
            conn.query('SELECT * FROM loans WHERE loan_id = ?', [loanId], (err, loanResults) => {
                if (!err && loanResults.length > 0) {
                    const loan = loanResults[0];
                    const monthlyRate = loan.interest_rate / 100 / 12;
                    generatePaymentSchedule(
                        loanId, 
                        loan.loan_amount, 
                        loan.monthly_payment, 
                        monthlyRate, 
                        loan.duration_months,
                        loan.interest_rate
                    );
                }
            });
        }

        // Log the action
        conn.query(
            'INSERT INTO audit_logs (user_id, action, description, ip_address) VALUES (?, ?, ?, ?)',
            [user.user_id, 'UPDATE_LOAN_STATUS', `Changed loan #${loanId} status to ${status}`, req.ip]
        );

        res.json({ 
            success: true, 
            message: `Loan ${status} successfully` 
        });
    });
});
// Mark loan as disbursed
app.post('/disburse-loan/:id', requireAuth(['employee', 'manager', 'admin']), (req, res) => {
    const loanId = req.params.id;
    const user = req.session.user;

    const query = `
        UPDATE loans 
        SET status = 'disbursed', 
            disbursed_date = NOW(), 
            disbursed_by = ?
        WHERE loan_id = ? AND status = 'approved'
    `;

    conn.query(query, [user.user_id, loanId], (err, result) => {
        if (err) {
            console.error('Error updating loan:', err);
            return res.json({ success: false, message: 'Error updating loan status: ' + err.message });
        }

        if (result.affectedRows === 0) {
            return res.json({ success: false, message: 'Loan not found or not in approved status' });
        }

        // Log the action
        conn.query(
            'INSERT INTO audit_logs (user_id, action, description, ip_address) VALUES (?, ?, ?, ?)',
            [user.user_id, 'DISBURSE_LOAN', `Disbursed loan #${loanId}`, req.ip]
        );

        res.json({ success: true, message: 'Loan marked as disbursed successfully' });
    });
});

// View payment schedule for a loan
app.get('/employee/loan/:id/payments', requireAuth(['employee', 'manager', 'admin']), (req, res) => {
    const loanId = req.params.id;
    
    const queries = [
        `SELECT l.*, c.first_name, c.last_name, c.pension_number 
         FROM loans l 
         LEFT JOIN customers c ON l.borrower_id = c.customer_id 
         WHERE l.loan_id = ?`,
        `SELECT * FROM payment_schedule WHERE loan_id = ? ORDER BY installment_number`,
        `SELECT * FROM loan_payments WHERE loan_id = ? ORDER BY payment_date DESC`
    ];
    
    Promise.all(queries.map(query => 
        new Promise((resolve, reject) => {
            conn.query(query, [loanId], (err, results) => {
                if (err) reject(err);
                else resolve(results);
            });
        })
    )).then(results => {
        if (results[0].length === 0) {
            return res.redirect('/loans?error=Loan not found');
        }
        
        const loan = results[0][0];
        const schedule = results[1];
        const paymentHistory = results[2];
        
        res.render('employee/loan-payments', {
            title: `Payments - Loan #${loanId}`,
            user: req.session.user,
            loan: loan,
            schedule: schedule,
            paymentHistory: paymentHistory,
            error: req.query.error,
            success: req.query.success
        });
    }).catch(err => {
        console.error('Error loading loan payments:', err);
        res.redirect('/loans?error=Error loading payment information');
    });
});

// Post payment page
app.get('/employee/post-payment/:loanId', requireAuth(['employee']), (req, res) => {
    const loanId = req.params.loanId;
    
    const queries = [
        `SELECT l.*, c.first_name, c.last_name, c.pension_number 
         FROM loans l 
         LEFT JOIN customers c ON l.borrower_id = c.customer_id 
         WHERE l.loan_id = ?`,
        `SELECT * FROM payment_schedule 
         WHERE loan_id = ? AND status IN ('pending', 'overdue') 
         ORDER BY due_date LIMIT 1`
    ];
    
    Promise.all(queries.map(query => 
        new Promise((resolve, reject) => {
            conn.query(query, [loanId], (err, results) => {
                if (err) reject(err);
                else resolve(results);
            });
        })
    )).then(results => {
        if (results[0].length === 0) {
            return res.redirect('/loans?error=Loan not found');
        }
        
        const loan = results[0][0];
        const nextInstallment = results[1].length > 0 ? results[1][0] : null;
        
        res.render('employee/post-payment', {
            title: `Post Payment - Loan #${loanId}`,
            user: req.session.user,
            loan: loan,
            nextInstallment: nextInstallment,
            error: req.query.error,
            success: req.query.success
        });
    }).catch(err => {
        console.error('Error loading post payment page:', err);
        res.redirect('/loans?error=Error loading payment form');
    });
});

// Process payment posting
app.post('/employee/process-payment', requireAuth(['employee']), (req, res) => {
    const { 
        loan_id, 
        payment_date, 
        amount_paid, 
        payment_method, 
        reference_number,
        installment_number,
        notes 
    } = req.body;
    
    const user = req.session.user;
    
    conn.beginTransaction((err) => {
        if (err) {
            console.error('Transaction error:', err);
            return res.redirect('/employee/payments?error=Database error');
        }
        
        // 1. Get loan details and next due installment
        const loanQuery = 'SELECT monthly_payment FROM loans WHERE loan_id = ?';
        const scheduleQuery = 'SELECT * FROM payment_schedule WHERE loan_id = ? AND installment_number = ?';
        
        conn.query(loanQuery, [loan_id], (err, loanResults) => {
            if (err || loanResults.length === 0) {
                return conn.rollback(() => {
                    res.redirect('/employee/payments?error=Loan not found');
                });
            }
            
            const monthlyPayment = parseFloat(loanResults[0].monthly_payment);
            const amountPaid = parseFloat(amount_paid);
            
            conn.query(scheduleQuery, [loan_id, installment_number], (err, scheduleResults) => {
                if (err) {
                    return conn.rollback(() => {
                        res.redirect('/employee/payments?error=Error fetching payment schedule');
                    });
                }
                
                let paymentStatus = 'paid';
                if (amountPaid < monthlyPayment) {
                    paymentStatus = 'partial';
                } else if (amountPaid > monthlyPayment) {
                    paymentStatus = 'paid'; // Overpayment
                }
                
                // 2. Insert payment record
                const paymentQuery = `
                    INSERT INTO loan_payments (
                        loan_id, payment_date, amount_due, amount_paid, 
                        payment_method, payment_status, reference_number, 
                        posted_by, notes
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `;
                
                conn.query(paymentQuery, [
                    loan_id, payment_date, monthlyPayment, amountPaid,
                    payment_method, paymentStatus, reference_number,
                    user.user_id, notes
                ], (err, paymentResult) => {
                    if (err) {
                        return conn.rollback(() => {
                            res.redirect('/employee/payments?error=Error recording payment');
                        });
                    }
                    
                    const paymentId = paymentResult.insertId;
                    
                    // 3. Update payment schedule if full payment
                    if (scheduleResults.length > 0 && amountPaid >= monthlyPayment) {
                        const updateScheduleQuery = `
                            UPDATE payment_schedule 
                            SET status = 'paid', paid_date = ? 
                            WHERE loan_id = ? AND installment_number = ?
                        `;
                        
                        conn.query(updateScheduleQuery, [payment_date, loan_id, installment_number], (err) => {
                            if (err) {
                                return conn.rollback(() => {
                                    res.redirect('/employee/payments?error=Error updating payment schedule');
                                });
                            }
                            
                            // 4. Generate receipt number and commit
                            generateReceiptAndCommit();
                        });
                    } else {
                        generateReceiptAndCommit();
                    }
                    
                    function generateReceiptAndCommit() {
                        // Generate receipt number
                        const receiptNumber = 'RCP' + new Date().getFullYear() + 
                            (new Date().getMonth() + 1).toString().padStart(2, '0') + 
                            paymentId.toString().padStart(6, '0');
                        
                        const receiptQuery = `
                            INSERT INTO payment_receipts (payment_id, receipt_number, issued_date, issued_by)
                            VALUES (?, ?, CURDATE(), ?)
                        `;
                        
                        conn.query(receiptQuery, [paymentId, receiptNumber, user.user_id], (err) => {
                            if (err) {
                                return conn.rollback(() => {
                                    res.redirect('/employee/payments?error=Error generating receipt');
                                });
                            }
                            
                            conn.commit((err) => {
                                if (err) {
                                    return conn.rollback(() => {
                                        res.redirect('/employee/payments?error=Transaction failed');
                                    });
                                }
                                
                                // Log the action
                                conn.query(
                                    'INSERT INTO audit_logs (user_id, action, description) VALUES (?, ?, ?)',
                                    [user.user_id, 'POST_PAYMENT', `Posted payment for loan ${loan_id} - ₱${amount_paid} - Receipt: ${receiptNumber}`]
                                );
                                
                                res.redirect(`/employee/payments?success=Payment posted successfully! Receipt Number: ${receiptNumber}`);
                            });
                        });
                    }
                });
            });
        });
    });
});

// Generate payment receipt
app.get('/employee/payment-receipt/:paymentId', requireAuth(['employee', 'manager', 'admin']), (req, res) => {
    const paymentId = req.params.paymentId;
    
    const query = `
        SELECT 
            lp.*,
            r.receipt_number,
            l.loan_id,
            l.loan_type,
            c.first_name,
            c.last_name,
            c.pension_number,
            c.mobile_number,
            u.full_name as issued_by_name
        FROM loan_payments lp
        LEFT JOIN payment_receipts r ON lp.payment_id = r.payment_id
        LEFT JOIN loans l ON lp.loan_id = l.loan_id
        LEFT JOIN customers c ON l.borrower_id = c.customer_id
        LEFT JOIN users u ON r.issued_by = u.user_id
        WHERE lp.payment_id = ?
    `;
    
    conn.query(query, [paymentId], (err, results) => {
        if (err || results.length === 0) {
            return res.redirect('/employee/payments?error=Payment not found');
        }
        
        const payment = results[0];
        
        res.render('employee/payment-receipt', {
            title: `Receipt - ${payment.receipt_number}`,
            user: req.session.user,
            payment: payment
        });
    });
});

// Profile routes
app.get('/profile', requireAuth(), (req, res) => {
    res.render('profile', {
        title: 'My Profile',
        user: req.session.user
    });
});

app.post('/update-profile', requireAuth(), (req, res) => {
    const { full_name, contact_number, address } = req.body;
    const user = req.session.user;

    const query = `
        UPDATE users 
        SET full_name = ?, contact_number = ?, address = ?
        WHERE user_id = ?
    `;

    conn.query(query, [full_name, contact_number, address, user.user_id], (err, result) => {
        if (err) {
            console.error('Error updating profile:', err);
            return res.redirect('/profile?error=Error updating profile');
        }

        // Update session
        req.session.user.full_name = full_name;
        req.session.user.contact_number = contact_number;
        req.session.user.address = address;

        res.redirect('/profile?success=Profile updated successfully');
    });
});

// Employee payments page
app.get('/employee/payments', requireAuth(['employee', 'manager', 'admin']), (req, res) => {
    const statusFilter = req.query.status || 'all';
    const dateFilter = req.query.date || 'current';
    const user = req.session.user;
    
    let query = `
        SELECT 
            lp.*,
            l.loan_id,
            l.loan_amount,
            l.loan_type,
            c.customer_id,
            c.first_name,
            c.last_name,
            c.pension_number,
            u.full_name as posted_by_name
        FROM loan_payments lp
        LEFT JOIN loans l ON lp.loan_id = l.loan_id
        LEFT JOIN customers c ON l.borrower_id = c.customer_id
        LEFT JOIN users u ON lp.posted_by = u.user_id
    `;
    
    let params = [];
    
    // Build WHERE clause
    const conditions = [];
    if (statusFilter !== 'all') {
        conditions.push('lp.payment_status = ?');
        params.push(statusFilter);
    }
    
    if (dateFilter === 'today') {
        conditions.push('DATE(lp.payment_date) = CURDATE()');
    } else if (dateFilter === 'week') {
        conditions.push('lp.payment_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)');
    } else if (dateFilter === 'month') {
        conditions.push('lp.payment_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)');
    }
    
    if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
    }
    
    query += ' ORDER BY lp.payment_date DESC, lp.posted_at DESC';
    
    conn.query(query, params, (err, payments) => {
        if (err) {
            console.error('Error fetching payments:', err);
            return res.render('error', { message: 'Error loading payments' });
        }
        
        // Get summary statistics
        const statsQuery = `
            SELECT 
                COUNT(*) as total_payments,
                SUM(amount_paid) as total_collected,
                COUNT(CASE WHEN payment_status = 'paid' THEN 1 END) as paid_count,
                COUNT(CASE WHEN payment_status = 'pending' THEN 1 END) as pending_count,
                COUNT(CASE WHEN payment_status = 'overdue' THEN 1 END) as overdue_count
            FROM loan_payments
            WHERE payment_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
        `;
        
        conn.query(statsQuery, (err, statsResults) => {
            const stats = statsResults.length > 0 ? statsResults[0] : {};
            
            res.render('employee/payments', {
                title: 'Payment Posting',
                user: user,
                payments: payments,
                stats: stats,
                currentFilter: statusFilter,
                dateFilter: dateFilter,
                error: req.query.error || null,
                success: req.query.success || null
            });
        });
    });
});
// ==================== COLLECTION POSTING ROUTES ====================

// View all collection postings
// Collection Postings route
app.get('/employee/collection-postings', requireAuth(['employee', 'manager', 'admin']), (req, res) => {
    const user = req.session.user;
    const typeFilter = req.query.type || 'all';
    
    let query = `
        SELECT 
            cp.*,
            pw.withdrawal_amount,
            c.first_name,
            c.last_name,
            c.pension_number,
            u.full_name as posted_by_name
        FROM collection_postings cp
        LEFT JOIN pension_withdrawals pw ON cp.withdrawal_id = pw.withdrawal_id
        LEFT JOIN customers c ON pw.customer_id = c.customer_id
        LEFT JOIN users u ON cp.posted_by = u.user_id
    `;
    
    let params = [];
    
    if (typeFilter !== 'all') {
        query += ' WHERE cp.posting_type = ?';
        params.push(typeFilter);
    }
    
    query += ' ORDER BY cp.created_at DESC';
    
    conn.query(query, params, (err, postings) => {
        if (err) {
            console.error('Error fetching collection postings:', err);
            return res.render('error', { 
                message: 'Error loading collection postings: ' + err.message,
                error: process.env.NODE_ENV === 'development' ? err : null
            });
        }
        
        res.render('employee/collection-postings', {
            title: 'Collection Postings',
            user: user,
            postings: postings,
            typeFilter: typeFilter,
            changeFundBalance: 0, // Calculate this from your data
            error: req.query.error,
            success: req.query.success
        });
    });
});

// Create collection posting form (for a specific withdrawal)
app.get('/employee/create-posting', requireAuth(['employee', 'manager', 'admin']), (req, res) => {
    const withdrawalId = req.query.withdrawal_id;
    const user = req.session.user;
    
    console.log('=== CREATE POSTING PAGE ===');
    console.log('Withdrawal ID:', withdrawalId);
    
    if (!withdrawalId) {
        return res.redirect('/employee/pension-withdrawals?error=Please select a withdrawal first');
    }
    
    // Get withdrawal details
    const query = `
        SELECT 
            pw.*,
            c.first_name,
            c.last_name,
            c.pension_number,
            c.pension_system,
            c.monthly_pension
        FROM pension_withdrawals pw
        LEFT JOIN customers c ON pw.customer_id = c.customer_id
        WHERE pw.withdrawal_id = ? AND pw.status = 'completed'
    `;
    
    conn.query(query, [withdrawalId], (err, results) => {
        if (err) {
            console.error('Error fetching withdrawal:', err);
            return res.redirect('/employee/pension-withdrawals?error=Error fetching withdrawal details');
        }
        
        if (results.length === 0) {
            return res.redirect('/employee/pension-withdrawals?error=Withdrawal not found or not completed');
        }
        
        const withdrawal = results[0];
        
        // Check if posting already exists for this withdrawal
        conn.query('SELECT * FROM collection_postings WHERE withdrawal_id = ?', [withdrawalId], (err, postingResults) => {
            if (postingResults && postingResults.length > 0) {
                return res.redirect(`/employee/collection-postings?error=Posting already exists for this withdrawal (Ref: ${postingResults[0].posting_reference})`);
            }
            
            res.render('employee/create-posting', {
                title: 'Create Collection Posting',
                user: user,
                withdrawal: withdrawal,
                error: req.query.error,
                success: req.query.success
            });
        });
    });
});

// Process collection posting form submission
app.post('/employee/process-posting', requireAuth(['employee', 'manager', 'admin']), (req, res) => {
    console.log('=== PROCESS POSTING ENDPOINT HIT ===');
    console.log('Request body:', req.body);
    
    const { 
        withdrawal_id,
        amount,
        posting_type,
        bank_name,
        account_number,
        reference_number
    } = req.body;
    
    const user = req.session.user;
    
    // Validate required fields
    if (!withdrawal_id) {
        return res.redirect('/employee/pension-withdrawals?error=Invalid withdrawal');
    }
    
    if (!posting_type) {
        return res.redirect(`/employee/create-posting?withdrawal_id=${withdrawal_id}&error=Please select a posting type`);
    }
    
    // Validate bank details if posting type is bank_deposit
    if (posting_type === 'bank_deposit') {
        if (!bank_name || !account_number) {
            return res.redirect(`/employee/create-posting?withdrawal_id=${withdrawal_id}&error=Please provide bank name and account number`);
        }
    }
    
    // Start transaction
    conn.beginTransaction((err) => {
        if (err) {
            console.error('Transaction error:', err);
            return res.redirect(`/employee/create-posting?withdrawal_id=${withdrawal_id}&error=Database error`);
        }
        
        // Generate posting reference number
        const now = new Date();
        const postingReference = 'COL' + now.getFullYear() + 
            (now.getMonth() + 1).toString().padStart(2, '0') + 
            now.getDate().toString().padStart(2, '0') + 
            Math.floor(Math.random() * 10000).toString().padStart(4, '0');
        
        // Insert collection posting
        const insertQuery = `
            INSERT INTO collection_postings (
                withdrawal_id,
                amount,
                posting_type,
                bank_name,
                account_number,
                reference_number,
                posting_reference,
                status,
                posted_by,
                created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', ?, NOW())
        `;
        
        conn.query(insertQuery, [
            withdrawal_id,
            amount,
            posting_type,
            bank_name || null,
            account_number || null,
            reference_number || null,
            postingReference,
            user.user_id
        ], (err, result) => {
            if (err) {
                console.error('Error creating posting:', err);
                return conn.rollback(() => {
                    res.redirect(`/employee/create-posting?withdrawal_id=${withdrawal_id}&error=Error creating posting record`);
                });
            }
            
            const postingId = result.insertId;
            console.log('Posting created with ID:', postingId, 'Reference:', postingReference);
            
            // Update withdrawal status if needed (optional - you might want to mark as posted)
            conn.query(
                'UPDATE pension_withdrawals SET posting_status = "posted", updated_at = NOW() WHERE withdrawal_id = ?',
                [withdrawal_id],
                (err) => {
                    if (err) {
                        console.error('Error updating withdrawal:', err);
                        // Continue anyway - not critical
                    }
                }
            );
            
            // Log the action
            conn.query(
                'INSERT INTO audit_logs (user_id, action, description, ip_address) VALUES (?, ?, ?, ?)',
                [user.user_id, 'CREATE_POSTING', `Created collection posting #${postingId} for withdrawal ${withdrawal_id} - ₱${amount} - ${posting_type}`, req.ip],
                (logErr) => {
                    if (logErr) {
                        console.error('Error logging action:', logErr);
                    }
                }
            );
            
            // Commit transaction
            conn.commit((err) => {
                if (err) {
                    console.error('Commit error:', err);
                    return conn.rollback(() => {
                        res.redirect(`/employee/create-posting?withdrawal_id=${withdrawal_id}&error=Transaction failed`);
                    });
                }
                
                console.log('Posting created successfully');
                res.redirect(`/employee/collection-postings?success=Collection posted successfully! Reference: ${postingReference}`);
            });
        });
    });
});

// View single posting details
app.get('/employee/posting/:id', requireAuth(['employee', 'manager', 'admin']), (req, res) => {
    const postingId = req.params.id;
    const user = req.session.user;
    
    console.log('=== VIEW POSTING DETAILS ===');
    console.log('Posting ID:', postingId);
    
    const query = `
        SELECT 
            cp.*,
            pw.withdrawal_amount,
            pw.withdrawal_date,
            pw.reference_number as withdrawal_ref,
            c.first_name,
            c.last_name,
            c.pension_number,
            c.pension_system,
            u.full_name as posted_by_name
        FROM collection_postings cp
        LEFT JOIN pension_withdrawals pw ON cp.withdrawal_id = pw.withdrawal_id
        LEFT JOIN customers c ON pw.customer_id = c.customer_id
        LEFT JOIN users u ON cp.posted_by = u.user_id
        WHERE cp.posting_id = ?
    `;
    
    conn.query(query, [postingId], (err, results) => {
        if (err) {
            console.error('Error fetching posting:', err);
            return res.redirect('/employee/collection-postings?error=Error loading posting details');
        }
        
        if (results.length === 0) {
            return res.redirect('/employee/collection-postings?error=Posting not found');
        }
        
        const posting = results[0];
        
        res.render('employee/posting-details', {
            title: `Posting #${posting.posting_reference}`,
            user: user,
            posting: posting,
            error: req.query.error,
            success: req.query.success
        });
    });
});

// Generate posting receipt
// Generate posting receipt
app.get('/employee/posting/:id/receipt', requireAuth(['employee', 'manager', 'admin']), (req, res) => {
    const postingId = req.params.id;
    
    console.log('=== GENERATE POSTING RECEIPT ===');
    console.log('Posting ID:', postingId);
    
    const query = `
        SELECT 
            cp.*,
            pw.withdrawal_amount,
            c.first_name,
            c.last_name,
            c.pension_number,
            c.pension_system,
            u.full_name as posted_by_name
        FROM collection_postings cp
        LEFT JOIN pension_withdrawals pw ON cp.withdrawal_id = pw.withdrawal_id
        LEFT JOIN customers c ON pw.customer_id = c.customer_id
        LEFT JOIN users u ON cp.posted_by = u.user_id
        WHERE cp.posting_id = ?
    `;
    
    conn.query(query, [postingId], (err, results) => {
        if (err) {
            console.error('Error fetching posting for receipt:', err);
            return res.render('error', { 
                message: 'Error generating receipt: ' + err.message
            });
        }
        
        if (results.length === 0) {
            return res.redirect('/employee/collection-postings?error=Posting not found');
        }
        
        const posting = results[0];
        
        // Log the data for debugging
        console.log('Receipt data:', {
            id: posting.posting_id,
            reference: posting.posting_reference,
            amount: posting.amount,
            customer: posting.first_name + ' ' + posting.last_name
        });
        
        res.render('employee/posting-receipt', {
            title: `Receipt - ${posting.posting_reference}`,
            user: req.session.user,
            posting: posting
        });
    });
});
// Cancel/void posting (admin/manager only)
app.post('/employee/posting/:id/cancel', requireAuth(['manager', 'admin']), (req, res) => {
    const postingId = req.params.id;
    const { reason } = req.body;
    const user = req.session.user;
    
    console.log('=== CANCEL POSTING ===');
    console.log('Posting ID:', postingId);
    console.log('Reason:', reason);
    
    if (!reason) {
        return res.json({ success: false, message: 'Cancellation reason is required' });
    }
    
    conn.beginTransaction((err) => {
        if (err) {
            console.error('Transaction error:', err);
            return res.json({ success: false, message: 'Database error' });
        }
        
        // Update posting status
        const updateQuery = `
            UPDATE collection_postings 
            SET status = 'cancelled', 
                cancellation_reason = ?,
                cancelled_by = ?,
                cancelled_date = NOW()
            WHERE posting_id = ?
        `;
        
        conn.query(updateQuery, [reason, user.user_id, postingId], (err, result) => {
            if (err) {
                console.error('Error cancelling posting:', err);
                return conn.rollback(() => {
                    res.json({ success: false, message: 'Error cancelling posting' });
                });
            }
            
            if (result.affectedRows === 0) {
                return conn.rollback(() => {
                    res.json({ success: false, message: 'Posting not found' });
                });
            }
            
            // Get withdrawal_id to update withdrawal status
            conn.query('SELECT withdrawal_id FROM collection_postings WHERE posting_id = ?', [postingId], (err, results) => {
                if (!err && results.length > 0) {
                    const withdrawalId = results[0].withdrawal_id;
                    
                    // Update withdrawal posting status back to pending
                    conn.query(
                        'UPDATE pension_withdrawals SET posting_status = "pending", updated_at = NOW() WHERE withdrawal_id = ?',
                        [withdrawalId],
                        (err) => {
                            if (err) {
                                console.error('Error updating withdrawal:', err);
                                // Continue anyway
                            }
                        }
                    );
                }
            });
            
            // Log the action
            conn.query(
                'INSERT INTO audit_logs (user_id, action, description, ip_address) VALUES (?, ?, ?, ?)',
                [user.user_id, 'CANCEL_POSTING', `Cancelled posting #${postingId}. Reason: ${reason}`, req.ip],
                (logErr) => {
                    if (logErr) {
                        console.error('Error logging action:', logErr);
                    }
                }
            );
            
            conn.commit((err) => {
                if (err) {
                    console.error('Commit error:', err);
                    return conn.rollback(() => {
                        res.json({ success: false, message: 'Transaction failed' });
                    });
                }
                
                res.json({ 
                    success: true, 
                    message: 'Posting cancelled successfully' 
                });
            });
        });
    });
});

// Get posting details for modal
// ==================== COLLECTION POSTING DETAILS & RECEIPT ROUTES ====================

// View posting details
app.get('/employee/posting/:id', requireAuth(['employee', 'manager', 'admin']), (req, res) => {
    const postingId = req.params.id;
    const user = req.session.user;
    
    console.log('=== VIEW POSTING DETAILS ===');
    console.log('Posting ID:', postingId);
    
    const query = `
        SELECT 
            cp.*,
            pw.withdrawal_amount,
            pw.reference_number as withdrawal_ref,
            c.first_name,
            c.last_name,
            c.pension_number,
            c.pension_system,
            u.full_name as posted_by_name
        FROM collection_postings cp
        LEFT JOIN pension_withdrawals pw ON cp.withdrawal_id = pw.withdrawal_id
        LEFT JOIN customers c ON pw.customer_id = c.customer_id
        LEFT JOIN users u ON cp.posted_by = u.user_id
        WHERE cp.posting_id = ?
    `;
    
    conn.query(query, [postingId], (err, results) => {
        if (err) {
            console.error('Error fetching posting:', err);
            return res.render('error', { 
                message: 'Error loading posting details: ' + err.message,
                error: process.env.NODE_ENV === 'development' ? err : null
            });
        }
        
        if (results.length === 0) {
            return res.redirect('/employee/collection-postings?error=Posting not found');
        }
        
        const posting = results[0];
        
        res.render('employee/posting-details', {
            title: `Posting #${posting.posting_id} Details`,
            user: user,
            posting: posting,
            error: req.query.error,
            success: req.query.success
        });
    });
});

// Generate posting receipt
app.get('/employee/posting/:id/receipt', requireAuth(['employee', 'manager', 'admin']), (req, res) => {
    const postingId = req.params.id;
    const user = req.session.user;
    
    console.log('=== GENERATE POSTING RECEIPT ===');
    console.log('Posting ID:', postingId);
    
    const query = `
        SELECT 
            cp.*,
            pw.withdrawal_amount,
            pw.reference_number as withdrawal_ref,
            c.first_name,
            c.last_name,
            c.pension_number,
            c.pension_system,
            u.full_name as posted_by_name
        FROM collection_postings cp
        LEFT JOIN pension_withdrawals pw ON cp.withdrawal_id = pw.withdrawal_id
        LEFT JOIN customers c ON pw.customer_id = c.customer_id
        LEFT JOIN users u ON cp.posted_by = u.user_id
        WHERE cp.posting_id = ?
    `;
    
    conn.query(query, [postingId], (err, results) => {
        if (err) {
            console.error('Error fetching posting for receipt:', err);
            return res.render('error', { 
                message: 'Error generating receipt: ' + err.message,
                error: process.env.NODE_ENV === 'development' ? err : null
            });
        }
        
        if (results.length === 0) {
            return res.redirect('/employee/collection-postings?error=Posting not found');
        }
        
        const posting = results[0];
        
        res.render('employee/posting-receipt', {
            title: `Receipt - ${posting.posting_reference}`,
            user: user,
            posting: posting
        });
    });
});

// API endpoint for posting details (AJAX)
app.get('/api/posting/:id', requireAuth(['employee', 'manager', 'admin']), (req, res) => {
    const postingId = req.params.id;
    
    const query = `
        SELECT 
            cp.*,
            pw.withdrawal_amount,
            pw.reference_number as withdrawal_ref,
            c.first_name,
            c.last_name,
            c.pension_number,
            u.full_name as posted_by_name
        FROM collection_postings cp
        LEFT JOIN pension_withdrawals pw ON cp.withdrawal_id = pw.withdrawal_id
        LEFT JOIN customers c ON pw.customer_id = c.customer_id
        LEFT JOIN users u ON cp.posted_by = u.user_id
        WHERE cp.posting_id = ?
    `;
    
    conn.query(query, [postingId], (err, results) => {
        if (err || results.length === 0) {
            return res.status(404).json({ success: false, message: 'Posting not found' });
        }
        
        res.json({ success: true, posting: results[0] });
    });
});
// Logout
app.get('/logout', (req, res) => {
    if (req.session.user) {
        // Log logout action
        conn.query(
            'INSERT INTO audit_logs (user_id, action, description, ip_address) VALUES (?, ?, ?, ?)',
            [req.session.user.user_id, 'LOGOUT', 'User logged out of the system', req.ip]
        );
    }
    
    req.session.destroy();
    res.redirect('/login');
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).render('error', { 
        message: 'Something went wrong!',
        error: process.env.NODE_ENV === 'development' ? err : {}
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).render('error', { 
        message: 'Page not found' 
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Millenium Cash running on http://localhost:${PORT}`);
});