-- ===========================================
-- NEARM Social Nitter X Bot - Database Schema
-- ===========================================
-- Run this migration on your Railway PostgreSQL instance

-- Create the tweets_processed table
CREATE TABLE IF NOT EXISTS tweets_processed (
    id TEXT PRIMARY KEY,
    published_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Create index for faster lookups by published date
CREATE INDEX IF NOT EXISTS idx_tweets_processed_published_at 
ON tweets_processed(published_at DESC);

-- Create index for cleanup queries
CREATE INDEX IF NOT EXISTS idx_tweets_processed_created_at 
ON tweets_processed(created_at DESC);

-- Optional: Add a cleanup function to remove old entries (older than 90 days)
-- This helps keep the database small
CREATE OR REPLACE FUNCTION cleanup_old_tweets()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM tweets_processed 
    WHERE created_at < NOW() - INTERVAL '90 days';
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Optional: Add comment for documentation
COMMENT ON TABLE tweets_processed IS 'Stores processed tweet IDs to prevent duplicate posting';
COMMENT ON COLUMN tweets_processed.id IS 'Unique tweet ID extracted from Nitter RSS link';
COMMENT ON COLUMN tweets_processed.published_at IS 'Original publication date from RSS feed';
COMMENT ON COLUMN tweets_processed.created_at IS 'Timestamp when record was inserted';
