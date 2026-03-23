-- Greg Tracker - MySQL Schema
-- Purpose: Mobile-first PWA accounting automation (income/expense) with receipt image ingestion + AI extraction review flow.

CREATE DATABASE IF NOT EXISTS greg_tracker
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE greg_tracker;

-- Optional future multi-user support
CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(120) NOT NULL,
  email VARCHAR(190) NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS categories (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(80) NOT NULL UNIQUE,
  type ENUM('income','expense','both') NOT NULL DEFAULT 'both',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS receipts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  original_filename VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  storage_url VARCHAR(500) NOT NULL,
  file_size_bytes BIGINT UNSIGNED NULL,
  uploaded_by BIGINT UNSIGNED NULL,
  uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_receipts_uploaded_by
    FOREIGN KEY (uploaded_by) REFERENCES users(id)
    ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS transactions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  receipt_id BIGINT UNSIGNED NULL,
  user_id BIGINT UNSIGNED NULL,
  vendor VARCHAR(200) NOT NULL,
  transaction_date DATE NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  category_id BIGINT UNSIGNED NULL,
  txn_type ENUM('income','expense') NOT NULL,
  notes VARCHAR(500) NULL,
  extraction_confidence DECIMAL(5,2) NULL,
  review_status ENUM('pending_review','approved','rejected') NOT NULL DEFAULT 'pending_review',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_transactions_receipt
    FOREIGN KEY (receipt_id) REFERENCES receipts(id)
    ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_transactions_user
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_transactions_category
    FOREIGN KEY (category_id) REFERENCES categories(id)
    ON UPDATE CASCADE ON DELETE SET NULL,
  INDEX idx_transactions_date (transaction_date),
  INDEX idx_transactions_type (txn_type),
  INDEX idx_transactions_status (review_status),
  INDEX idx_transactions_category (category_id)
) ENGINE=InnoDB;

-- Stores AI raw output + normalized candidate data before final approval.
CREATE TABLE IF NOT EXISTS extraction_drafts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  receipt_id BIGINT UNSIGNED NOT NULL,
  provider ENUM('openai','gemini') NOT NULL,
  raw_json JSON NULL,
  vendor VARCHAR(200) NULL,
  transaction_date DATE NULL,
  amount DECIMAL(12,2) NULL,
  category_name VARCHAR(80) NULL,
  txn_type ENUM('income','expense') NULL,
  confidence DECIMAL(5,2) NULL,
  review_state ENUM('pending','approved','edited','discarded') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_extraction_drafts_receipt
    FOREIGN KEY (receipt_id) REFERENCES receipts(id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  INDEX idx_drafts_receipt (receipt_id),
  INDEX idx_drafts_review_state (review_state)
) ENGINE=InnoDB;

INSERT INTO categories (name, type) VALUES
  ('Sales', 'income'),
  ('Services', 'income'),
  ('Rent', 'expense'),
  ('Supplies', 'expense'),
  ('Transportation', 'expense'),
  ('Utilities', 'expense')
ON DUPLICATE KEY UPDATE name = VALUES(name);
