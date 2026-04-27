// Main JavaScript functionality
document.addEventListener('DOMContentLoaded', function() {
    // Auto-dismiss alerts after 5 seconds
    const alerts = document.querySelectorAll('.alert');
    alerts.forEach(alert => {
        setTimeout(() => {
            const bsAlert = new bootstrap.Alert(alert);
            bsAlert.close();
        }, 5000);
    });

    // Form validation enhancement
    const forms = document.querySelectorAll('form');
    forms.forEach(form => {
        form.addEventListener('submit', function(e) {
            const submitBtn = this.querySelector('button[type="submit"]');
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Processing...';
            }
        });
    });

    // Loan amount formatter
    const loanAmountInputs = document.querySelectorAll('input[name="loan_amount"]');
    loanAmountInputs.forEach(input => {
        input.addEventListener('input', function(e) {
            let value = this.value.replace(/[^\d]/g, '');
            if (value) {
                value = parseInt(value).toLocaleString();
                this.value = value;
            }
        });
    });

    // Calculate loan payments
    const loanCalculator = document.getElementById('loanCalculator');
    if (loanCalculator) {
        loanCalculator.addEventListener('input', calculateLoanPayment);
    }

    // Notification system
    function showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `alert alert-${type} alert-dismissible fade show`;
        notification.innerHTML = `
            ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        `;
        document.querySelector('main .container').prepend(notification);
        
        setTimeout(() => {
            notification.remove();
        }, 5000);
    }

    // Export functions to global scope
    window.showNotification = showNotification;
});

function calculateLoanPayment() {
    const amount = parseFloat(document.getElementById('loanAmount')?.value.replace(/,/g, '')) || 0;
    const months = parseInt(document.getElementById('loanDuration')?.value) || 1;
    const interestRate = 5.0; // 5% annual

    if (amount > 0 && months > 0) {
        const monthlyRate = interestRate / 100 / 12;
        const monthlyPayment = amount * monthlyRate * Math.pow(1 + monthlyRate, months) / 
                              (Math.pow(1 + monthlyRate, months) - 1);
        const totalPayment = monthlyPayment * months;
        const totalInterest = totalPayment - amount;

        document.getElementById('monthlyPayment').textContent = monthlyPayment.toFixed(2);
        document.getElementById('totalPayment').textContent = totalPayment.toFixed(2);
        document.getElementById('totalInterest').textContent = totalInterest.toFixed(2);
    }
}

// Confirm actions
function confirmAction(message) {
    return confirm(message);
}

// Format currency
function formatCurrency(amount) {
    return '₱' + parseFloat(amount).toLocaleString('en-PH', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}