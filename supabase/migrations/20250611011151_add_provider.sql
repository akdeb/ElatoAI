-- Add provider column to personalities table
ALTER TABLE personalities 
ADD COLUMN provider TEXT CHECK (provider IN ('openai', 'gemini', 'grok', 'elevenlabs', 'hume')) DEFAULT 'openai';

-- Update existing records to have a default provider
UPDATE personalities 
SET provider = 'openai' 
WHERE provider IS NULL;

-- Make the column NOT NULL after setting defaults
ALTER TABLE personalities 
ALTER COLUMN provider SET NOT NULL;