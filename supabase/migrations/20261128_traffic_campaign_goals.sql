CREATE TABLE IF NOT EXISTS traffic_campaign_goals (
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 account_id text NOT NULL,
 campaign_id text NOT NULL,
 objective text NOT NULL,
 daily_budget numeric(12,2) NOT NULL CHECK(daily_budget>0),
 target_cost numeric(12,2) NOT NULL CHECK(target_cost>0),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,account_id,campaign_id)
);
ALTER TABLE traffic_campaign_goals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON traffic_campaign_goals FROM PUBLIC;
DO $ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
  EXECUTE 'REVOKE ALL ON traffic_campaign_goals FROM anon';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
  EXECUTE 'REVOKE ALL ON traffic_campaign_goals FROM authenticated';
 END IF;
END $;
