-- Remoção do comércio/orçamentos do Sócio. O catálogo de produtos é mantido:
-- a IA continua usando produtos, preços e fotos no atendimento.
-- Backup verificado antes da remoção: socio-commerce-backup-20261112.json.
-- Idempotente: pode rodar mais de uma vez.

DROP TABLE IF EXISTS sales_payment_events CASCADE;
DROP TABLE IF EXISTS sales_orders CASCADE;
DROP TABLE IF EXISTS sales_quotes CASCADE;
DROP TABLE IF EXISTS sale_intents CASCADE;
DROP TABLE IF EXISTS quote_requests CASCADE;
