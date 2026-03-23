-- Database Migration Script (Phase 1)
CREATE TABLE IF NOT EXISTS import_batches (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  source_file_name VARCHAR(255) NOT NULL,
  worksheet_name VARCHAR(100),
  total_rows_scanned INT DEFAULT 0,
  rows_ready INT DEFAULT 0,
  rows_imported INT DEFAULT 0,
  rows_skipped INT DEFAULT 0,
  rows_flagged INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS review_flags (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  transaction_id BIGINT UNSIGNED NOT NULL,
  flag_type VARCHAR(100) NOT NULL,
  message TEXT NOT NULL,
  severity ENUM('Low', 'Medium', 'High') DEFAULT 'Medium',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_flags_transaction FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS settings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  business_name VARCHAR(255) DEFAULT 'Racketty Boom Enterprises',
  default_currency VARCHAR(10) DEFAULT 'USD',
  default_tax_rate DECIMAL(5,2) DEFAULT 0.00,
  date_format VARCHAR(20) DEFAULT 'MM/DD/YYYY',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Extend transactions table to act as 'records' (preserving existing data)
ALTER TABLE transactions
ADD COLUMN customer_name VARCHAR(255) NULL AFTER vendor,
ADD COLUMN invoice_number VARCHAR(100) NULL AFTER transaction_date,
ADD COLUMN subtotal DECIMAL(12,2) DEFAULT 0.00 AFTER amount,
ADD COLUMN tax DECIMAL(12,2) DEFAULT 0.00 AFTER subtotal,
ADD COLUMN payment_method VARCHAR(50) NULL,
ADD COLUMN location VARCHAR(100) NULL,
ADD COLUMN source_file_name VARCHAR(255) NULL,
ADD COLUMN extraction_status VARCHAR(50) DEFAULT 'manual',
ADD COLUMN review_status VARCHAR(50) DEFAULT 'pending',
ADD COLUMN import_batch_id BIGINT UNSIGNED NULL,
ADD COLUMN source_row_number INT NULL;

-- Add constraint separately to avoid syntax issues if table lacks indexes
ALTER TABLE transactions
ADD CONSTRAINT fk_transactions_batch FOREIGN KEY (import_batch_id) REFERENCES import_batches(id) ON DELETE SET NULL;
