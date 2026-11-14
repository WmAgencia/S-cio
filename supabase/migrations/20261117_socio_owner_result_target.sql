-- Owner-declared cost per result. The traffic manager stops comparing ads only
-- with each other and starts judging them against the price the owner accepts
-- to pay for a conversation, lead or sale.
-- Idempotent: pode rodar mais de uma vez.

ALTER TABLE socio_owner_groups
 ADD COLUMN IF NOT EXISTS target_result_cents integer
  CHECK (target_result_cents IS NULL OR target_result_cents BETWEEN 100 AND 10000000);
