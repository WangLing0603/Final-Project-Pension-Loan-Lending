# Millenium Cash - Pension Loan Management System

A comprehensive web-based loan management system designed for pensioners, enabling streamlined loan applications, payment processing, and administrative oversight.

👥 Team Members
Role	Name	Responsibilities
Lead Programmer	- Nick Anthony Francisco	
UI/UX Designer	- Edward Allen Benjamin	
Documentor -	Vivar Arano Jr	
Documentor -	Noel Sucayan	

- [Overview](#overview)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Database Schema](#database-schema)
- [Installation](#installation)
- [Configuration](#configuration)
- [User Roles](#user-roles)
- [Access Credentials](#access-credentials)
- [System Workflow](#system-workflow)
- [API Endpoints](#api-endpoints)
- [Directory Structure](#directory-structure)
- [Reporting](#reporting)
- [Troubleshooting](#troubleshooting)
- [License](#license)

## Overview

Millenium Cash is a loan management system specifically tailored for pensioners. It allows employees to register customers, process loan applications, manage pension withdrawals, and handle collection postings. The system includes role-based access control for admins, managers, and employees.

## Features

### Core Features
- **Customer Management** - Register and manage pensioner customers with complete profile information
- **Loan Processing** - Create, approve, disburse, and track loans with automated payment schedules
- **Payment Collection** - Post payments, generate receipts, and track payment history
- **Pension Withdrawals** - Process pension withdrawals with collection posting
- **Document Management** - Upload and store customer documents (IDs, bank statements, etc.)

### Administrative Features
- User management (employees and managers)
- System-wide reporting and analytics
- Audit logs for all system actions
- Customer and loan oversight

### Manager Features
- Team performance tracking
- Loan approval workflow
- Operational statistics dashboard
- Monthly disbursement reports

### Employee Features
- Customer registration with document upload
- Loan application creation
- Payment posting and receipt generation
- Pension withdrawal processing
- Customer profile management

## Tech Stack

- **Backend**: Node.js with Express.js
- **Database**: MySQL (using mysql2 driver)
- **Template Engine**: EJS (Embedded JavaScript)
- **Authentication**: Session-based with bcrypt password hashing
- **File Upload**: Multer
- **Frontend**: HTML5, CSS3, JavaScript, Bootstrap 5
- **Charts**: Chart.js for analytics

## Database Schema

The system uses the following main tables:

| Table | Description |
|-------|-------------|
| `users` | System users (admin, manager, employee) |
| `customers` | Pensioner customer information |
| `loans` | Loan applications and details |
| `loan_applications` | Extended loan application data |
| `payment_schedule` | Scheduled loan payments |
| `loan_payments` | Actual payment records |
| `payment_receipts` | Receipts for payments |
| `pension_withdrawals` | Pension withdrawal requests |
| `collection_postings` | Collection postings for withdrawals |
| `customer_documents` | Uploaded customer documents |
| `beneficiaries` | Customer beneficiaries |
| `audit_logs` | System activity logs |

## Installation

### Prerequisites
- Node.js (v14 or higher)
- MySQL (v5.7 or higher)
- npm or yarn package manager

### Steps

1. **Clone the repository**
```bash
git clone https://github.com/yourusername/millenium-cash.git
cd millenium-cash
```

2. **Install dependencies**
```bash
npm install
```

3. **Create MySQL database**
```sql
CREATE DATABASE pension_loan_system;
USE pension_loan_system;
```

4. **Run database migration** (create tables - see schema.sql in repository)

5. **Configure environment variables** (create `.env` file)
```env
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=pension_loan_system
SESSION_SECRET=your-secret-key
PORT=3000
```

6. **Start the application**
```bash
npm start
```

For development with auto-reload:
```bash
npm run dev
```

7. **Access the application**
```
http://localhost:3000
```

## Configuration

### File Upload Settings
- Maximum file size: 10MB
- Allowed file types: JPEG, JPG, PNG, PDF, DOC, DOCX
- Upload directory: `public/uploads/documents/`

### Session Configuration
- Session duration: 24 hours
- Secure flag: false (set to true for HTTPS)
- Secret key configured via environment variable

### Loan Configuration
- Maximum loan amount: Monthly pension × 12
- Minimum loan amount: ₱1,000
- Interest rate: 8% per annum
- Loan term: 1-24 months

## User Roles

### 👑 Administrator
- Full system access
- Create manager and employee accounts
- System-wide reporting
- User management
- Audit log viewing

### 📊 Manager
- Loan approval authority
- Team performance monitoring
- Operational reports
- Analytics dashboard
- Employee oversight

### 👔 Employee
- Customer registration
- Loan application processing
- Payment collection
- Pension withdrawal processing
- Customer profile management

## Access Credentials

### Demo Accounts

| Role | Email | Password |
|------|-------|----------|
| Administrator | admin@milleniumcash.com | admin123 |
| Manager | manager@milleniumcash.com | manager123 |
| Employee | employee@milleniumcash.com | employee123 |

> ⚠️ **Important**: Change these credentials in production!

## System Workflow

### Customer Registration Flow
1. Employee logs into the system
2. Navigates to "Register Customer"
3. Fills in personal, contact, address, and pension information
4. Uploads required documents:
   - AIM Passbook
   - Bank Statement
   - Proof of Billing
   - Barangay Clearance
5. Adds beneficiaries (optional)
6. Submits registration

### Loan Application Flow
1. Select customer from list or search
2. Click "Create Loan"
3. Enter loan details:
   - Loan amount (based on pension × 12)
   - Repayment period (1-24 months)
   - Purpose and category
   - Disbursement method (cash/check)
4. Provide ATM/Passbook number
5. Select valid IDs for verification
6. Submit for manager approval

### Approval Flow
1. Manager reviews pending loans
2. Can approve with notes or reject with reason
3. Upon approval, payment schedule is generated automatically
4. Employee can disburse funds when ready

### Payment Collection Flow
1. Search for loan by ID or customer name
2. View next due installment
3. Enter payment amount and method
4. Generate receipt automatically
5. Payment status updates in schedule

### Pension Withdrawal Flow
1. Employee selects customer
2. Creates withdrawal request with amount and method
3. Manager/Admin approves withdrawal
4. Employee creates collection posting
5. System generates posting receipt

## API Endpoints

### Reports API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/reports/overview` | GET | System-wide statistics |
| `/api/reports/loans` | GET | Loan performance data |
| `/api/reports/payments` | GET | Payment collection data |
| `/api/reports/customers` | GET | Customer demographics |
| `/api/reports/export/:type` | GET | Export reports as CSV |
| `/api/reports/chart-data` | GET | Chart visualization data |

### Loan API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/loan/:id` | GET | Get loan details |
| `/api/loan/:id` | PUT | Update loan |
| `/api/loan/:id/next-installment` | GET | Get next payment due |
| `/api/loan/:id/remaining-balance` | GET | Calculate remaining balance |
| `/api/loan/:id/installments` | GET | Get payment schedule |
| `/api/search-loan` | GET | Search loans |

### Customer API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/customer/:id/pension-details` | GET | Get pension information |

### Manager API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/manager/dashboard-stats` | GET | Dashboard statistics |
| `/api/manager/analytics` | GET | Analytics data |

## Directory Structure

```
millenium-cash/
├── public/
│   ├── css/
│   │   └── style.css
│   ├── js/
│   │   └── main.js
│   └── uploads/
│       └── documents/
├── views/
│   ├── admin/
│   │   ├── dashboard.ejs
│   │   ├── users.ejs
│   │   ├── customers.ejs
│   │   ├── register.ejs
│   │   └── reports.ejs
│   ├── employee/
│   │   ├── dashboard.ejs
│   │   ├── register-customer.ejs
│   │   ├── customers.ejs
│   │   ├── customer-profile.ejs
│   │   ├── create-loan.ejs
│   │   ├── post-payment.ejs
│   │   ├── payments.ejs
│   │   ├── pension-withdrawals.ejs
│   │   ├── create-withdrawal.ejs
│   │   ├── collection-postings.ejs
│   │   └── calculator.ejs
│   ├── manager/
│   │   ├── dashboard.ejs
│   │   ├── team.ejs
│   │   ├── reports.ejs
│   │   └── analytics.ejs
│   ├── staff/
│   │   └── loans.ejs
│   ├── loan-details.ejs
│   ├── profile.ejs
│   ├── login.ejs
│   ├── home.ejs
│   └── error.ejs
├── app.js
├── package.json
└── README.md
```

## Reporting

### Available Reports

1. **Overview Report** - System-wide KPIs including:
   - Loan statistics (total, pending, approved, rejected, disbursed)
   - Customer statistics (total, verified, by pension system)
   - Payment statistics (total collected, overdue payments)
   - User activity metrics

2. **Loan Performance Report** - Detailed loan analysis:
   - Status distribution
   - Purpose category breakdown
   - Employee performance metrics
   - Approval rate trends

3. **Payment Report** - Collection analysis:
   - Daily/weekly/monthly collection trends
   - Payment method distribution
   - Overdue payment tracking

4. **Customer Report** - Customer demographics:
   - Geographic distribution (by city)
   - Pension system analysis
   - Verification status tracking

### Export Formats
- CSV export available for all reports
- Print-friendly receipt formats

## Troubleshooting

### Common Issues

**Database Connection Error**
```
Error: ER_ACCESS_DENIED_ERROR
```
**Solution**: Verify MySQL credentials in your configuration.

**File Upload Error**
```
Error: Only documents and images are allowed
```
**Solution**: Ensure file type is JPEG, PNG, PDF, DOC, or DOCX and size is under 10MB.

**Session Issues**
```
Error: req.session.user is undefined
```
**Solution**: Clear browser cookies or restart the server.

**EJS Template Error**
```
Error: Could not find matching close tag for "%-"
```
**Solution**: Check EJS syntax in view files.

### Debug Mode
Enable debug logging by setting:
```javascript
process.env.NODE_ENV = 'development'
```

### Logs
System logs are stored in the `logs` directory (if configured). Audit logs for user actions are stored in the `audit_logs` database table.

## Security Considerations

- Password hashing using bcrypt
- Session-based authentication
- Input validation on all forms
- SQL injection prevention via parameterized queries
- File type validation for uploads
- Role-based access control (RBAC)
- XSS prevention through EJS escaping
- CSRF protection (recommended for production)

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is proprietary and confidential. Unauthorized copying, distribution, or use of this software is strictly prohibited.
