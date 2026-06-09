-- Rental underwriting strategy per deal: 'ltr' (long-term) or 'str' (short-term/Airbnb).
ALTER TABLE deals ADD COLUMN IF NOT EXISTS rental_strategy text DEFAULT 'ltr';
