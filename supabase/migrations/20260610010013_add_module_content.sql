-- Add content jsonb column to sandbox_modules for AI-generated structured output.
alter table public.sandbox_modules
  add column if not exists content jsonb;
