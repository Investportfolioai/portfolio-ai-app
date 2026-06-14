ALTER TABLE sandbox_modules ADD COLUMN IF NOT EXISTS model_route text DEFAULT 'claude-sonnet-4-6';
ALTER TABLE sandboxes ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
