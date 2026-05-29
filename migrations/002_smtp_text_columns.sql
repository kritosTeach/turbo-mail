-- Migration: widen smtp_servers columns from VARCHAR(255)/VARCHAR(100) to TEXT
-- Fixes bulk import failures caused by long email addresses and hostnames

ALTER TABLE smtp_servers ALTER COLUMN username TYPE TEXT;
ALTER TABLE smtp_servers ALTER COLUMN host     TYPE TEXT;
ALTER TABLE smtp_servers ALTER COLUMN name     TYPE TEXT;
