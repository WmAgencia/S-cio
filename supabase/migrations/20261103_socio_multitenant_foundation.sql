-- Sócio phase 1: additive, isolated schema for the new Supabase project.
-- Production Railway Postgres is NOT modified or cut over by this migration.
-- JWT authorization uses Supabase auth.uid(); never user_metadata.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE public.socio_tenants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
 slug text NOT NULL UNIQUE CHECK (char_length(slug) BETWEEN 2 AND 100),
 owner_id uuid NOT NULL REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.socio_memberships (
 tenant_id uuid NOT NULL REFERENCES public.socio_tenants(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 role text NOT NULL DEFAULT 'agent' CHECK(role IN ('owner','admin','agent')),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (tenant_id,user_id)
);
CREATE INDEX socio_memberships_user ON public.socio_memberships(user_id,tenant_id);
CREATE TABLE public.socio_channels (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.socio_tenants(id) ON DELETE CASCADE,
 label text NOT NULL CHECK(char_length(label) BETWEEN 1 AND 100),
 phone text NOT NULL CHECK(phone ~ '^\+?[0-9]{10,15}$'),
 provider text NOT NULL CHECK(provider IN ('waakg','meta')),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','connecting','connected','disconnected','error')),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,phone)
);
CREATE INDEX socio_channels_tenant ON public.socio_channels(tenant_id);
-- Credential/session identifiers never live in a public tenant table.
CREATE TABLE public.socio_products (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.socio_tenants(id) ON DELETE CASCADE,
 name text NOT NULL CHECK(char_length(name) BETWEEN 1 AND 160),
 description text NOT NULL DEFAULT '' CHECK(char_length(description)<=3000),
 price_cents bigint NOT NULL CHECK(price_cents>=0 AND price_cents<1000000000),
 currency char(3) NOT NULL DEFAULT 'BRL',
 active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id)
);
CREATE INDEX socio_products_tenant ON public.socio_products(tenant_id,active);
CREATE TABLE public.socio_product_media (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.socio_tenants(id) ON DELETE CASCADE,
 product_id uuid NOT NULL,
 object_path text NOT NULL CHECK(char_length(object_path) BETWEEN 5 AND 500),
 mime_type text NOT NULL CHECK(mime_type IN ('image/jpeg','image/png','image/webp','video/mp4')),
 alt text NOT NULL DEFAULT '' CHECK(char_length(alt)<=200),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (tenant_id,product_id) REFERENCES public.socio_products(tenant_id,id) ON DELETE CASCADE,
 UNIQUE(tenant_id,object_path)
);
CREATE TABLE public.socio_agent_profiles (
 tenant_id uuid PRIMARY KEY REFERENCES public.socio_tenants(id) ON DELETE CASCADE,
 agent_name text NOT NULL DEFAULT 'Sócio' CHECK(char_length(agent_name)<=80),
 tone text NOT NULL DEFAULT 'Profissional e natural' CHECK(char_length(tone)<=400),
 instructions text NOT NULL DEFAULT '' CHECK(char_length(instructions)<=6000),
 auto_reply boolean NOT NULL DEFAULT false,
 approved_knowledge_id uuid,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.socio_conversations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.socio_tenants(id) ON DELETE CASCADE,
 channel_id uuid NOT NULL,
 external_chat_id text NOT NULL CHECK(char_length(external_chat_id) BETWEEN 1 AND 250),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','human','resolved')),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (tenant_id,channel_id) REFERENCES public.socio_channels(tenant_id,id),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,channel_id,external_chat_id)
);
CREATE TABLE public.socio_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.socio_tenants(id) ON DELETE CASCADE,
 conversation_id uuid NOT NULL,
 provider_message_id text,
 direction text NOT NULL CHECK(direction IN ('inbound','outbound','note')),
 body text NOT NULL CHECK(char_length(body)<=12000),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (tenant_id,conversation_id) REFERENCES public.socio_conversations(tenant_id,id) ON DELETE CASCADE,
 UNIQUE(tenant_id,provider_message_id)
);
CREATE INDEX socio_messages_tenant_conv ON public.socio_messages(tenant_id,conversation_id,created_at DESC);
CREATE TABLE public.socio_analysis_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.socio_tenants(id) ON DELETE CASCADE,
 requested_by uuid NOT NULL REFERENCES auth.users(id),
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','scanning','analyzing','paused','failed','completed','cancelled')),
 total_items integer NOT NULL DEFAULT 0 CHECK(total_items>=0),
 processed_items integer NOT NULL DEFAULT 0 CHECK(processed_items>=0 AND processed_items<=total_items),
 report text NOT NULL DEFAULT '',
 error_code text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz,
 UNIQUE(tenant_id,id)
);
CREATE INDEX socio_analysis_jobs_queue ON public.socio_analysis_jobs(status,created_at);
CREATE TABLE public.socio_training_sources (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.socio_tenants(id) ON DELETE CASCADE,
 job_id uuid NOT NULL,
 channel_id uuid,
 source_type text NOT NULL CHECK(source_type IN ('waakg','whatsapp_zip','manual')),
 external_source_hash text NOT NULL CHECK(char_length(external_source_hash) BETWEEN 10 AND 160),
 analyzed_messages integer NOT NULL DEFAULT 0 CHECK(analyzed_messages>=0),
 outcome text NOT NULL DEFAULT 'unknown' CHECK(outcome IN ('unknown','human_verified_sale','no_sale')),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (tenant_id,job_id) REFERENCES public.socio_analysis_jobs(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY (tenant_id,channel_id) REFERENCES public.socio_channels(tenant_id,id),
 UNIQUE(tenant_id,external_source_hash)
);
CREATE TABLE public.socio_knowledge_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.socio_tenants(id) ON DELETE CASCADE,
 job_id uuid NOT NULL,
 version integer NOT NULL CHECK(version>=1),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','archived')),
 knowledge_md text NOT NULL DEFAULT '' CHECK(char_length(knowledge_md)<=120000),
 summary text NOT NULL DEFAULT '' CHECK(char_length(summary)<=6000),
 created_at timestamptz NOT NULL DEFAULT now(),
 approved_at timestamptz,
 FOREIGN KEY (tenant_id,job_id) REFERENCES public.socio_analysis_jobs(tenant_id,id),
 UNIQUE(tenant_id,version),UNIQUE(tenant_id,id)
);
CREATE TABLE public.socio_tool_connections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.socio_tenants(id) ON DELETE CASCADE,
 provider text NOT NULL CHECK(provider IN ('meta_ads','instagram','google_ads','waakg')),
 display_name text NOT NULL CHECK(char_length(display_name) BETWEEN 1 AND 150),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','connected','revoked','error')),
 scopes text[] NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id)
);
-- OAuth tokens and API secrets must be stored in an encrypted server vault,
-- not in the above public table, JWT, client storage, or Markdown.
CREATE TABLE public.socio_action_approvals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.socio_tenants(id) ON DELETE CASCADE,
 tool_connection_id uuid NOT NULL,
 action text NOT NULL CHECK(char_length(action) BETWEEN 3 AND 100),
 budget_cents bigint CHECK(budget_cents>=0),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','awaiting_approval','approved','executing','completed','failed','rejected','expired')),
 requested_by uuid NOT NULL REFERENCES auth.users(id),
 approved_by uuid REFERENCES auth.users(id),
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (tenant_id,tool_connection_id) REFERENCES public.socio_tool_connections(tenant_id,id)
);
CREATE TABLE public.socio_audit_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.socio_tenants(id) ON DELETE CASCADE,
 actor_id uuid REFERENCES auth.users(id),
 action text NOT NULL CHECK(char_length(action) BETWEEN 1 AND 120),
 metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
-- RLS on every user-facing table; backend automation uses server-only credential.
DO $$
DECLARE tbl text;
BEGIN
 FOREACH tbl IN ARRAY ARRAY[
 'socio_tenants','socio_memberships','socio_channels','socio_products',
 'socio_product_media','socio_agent_profiles','socio_conversations',
 'socio_messages','socio_analysis_jobs','socio_training_sources',
 'socio_knowledge_versions','socio_tool_connections',
 'socio_action_approvals','socio_audit_events'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',tbl);
  EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated',tbl);
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated',tbl);
 END LOOP;
END $$;
-- No public data exposure and no tenant-owner escalation using editable metadata.
CREATE POLICY socio_tenants_select ON public.socio_tenants FOR SELECT TO authenticated
 USING (owner_id=(select auth.uid()) OR id IN
 (SELECT tenant_id FROM public.socio_memberships WHERE user_id=(select auth.uid())));
CREATE POLICY socio_tenants_insert ON public.socio_tenants FOR INSERT TO authenticated
 WITH CHECK(owner_id=(select auth.uid()));
GRANT INSERT ON public.socio_tenants TO authenticated;
CREATE POLICY socio_memberships_select ON public.socio_memberships FOR SELECT TO authenticated
 USING(user_id=(select auth.uid()));
CREATE POLICY socio_memberships_invite ON public.socio_memberships FOR INSERT TO authenticated
 WITH CHECK(tenant_id IN
 (SELECT id FROM public.socio_tenants WHERE owner_id=(select auth.uid())));
GRANT INSERT ON public.socio_memberships TO authenticated;
-- Owners and tenant members read their own records only; no direct writes to
-- messages, knowledge, external actions, audit events or OAuth connections.
DO $$
DECLARE tbl text;
BEGIN
 FOREACH tbl IN ARRAY ARRAY[
 'socio_channels','socio_products','socio_product_media','socio_agent_profiles',
 'socio_conversations','socio_messages','socio_analysis_jobs',
 'socio_training_sources','socio_knowledge_versions','socio_tool_connections',
 'socio_action_approvals','socio_audit_events'] LOOP
  EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (tenant_id IN (SELECT id FROM public.socio_tenants WHERE owner_id=(select auth.uid())) OR tenant_id IN (SELECT tenant_id FROM public.socio_memberships WHERE user_id=(select auth.uid())))',tbl||'_tenant_read',tbl);
 END LOOP;
END $$;
CREATE POLICY socio_products_insert_owner ON public.socio_products FOR INSERT TO authenticated
 WITH CHECK(tenant_id IN (SELECT id FROM public.socio_tenants WHERE owner_id=(select auth.uid())));
CREATE POLICY socio_products_update_owner ON public.socio_products FOR UPDATE TO authenticated
 USING(tenant_id IN (SELECT id FROM public.socio_tenants WHERE owner_id=(select auth.uid())))
 WITH CHECK(tenant_id IN (SELECT id FROM public.socio_tenants WHERE owner_id=(select auth.uid())));
GRANT INSERT,UPDATE ON public.socio_products TO authenticated;
CREATE POLICY socio_product_media_insert_owner ON public.socio_product_media FOR INSERT TO authenticated
 WITH CHECK(tenant_id IN (SELECT id FROM public.socio_tenants WHERE owner_id=(select auth.uid())));
GRANT INSERT ON public.socio_product_media TO authenticated;
CREATE POLICY socio_channels_pending_owner ON public.socio_channels FOR INSERT TO authenticated
 WITH CHECK(status='pending' AND tenant_id IN (SELECT id FROM public.socio_tenants WHERE owner_id=(select auth.uid())));
GRANT INSERT ON public.socio_channels TO authenticated;
CREATE POLICY socio_agent_profiles_insert_owner ON public.socio_agent_profiles FOR INSERT TO authenticated
 WITH CHECK(auto_reply=false AND tenant_id IN (SELECT id FROM public.socio_tenants WHERE owner_id=(select auth.uid())));
CREATE POLICY socio_agent_profiles_update_owner ON public.socio_agent_profiles FOR UPDATE TO authenticated
 USING(tenant_id IN (SELECT id FROM public.socio_tenants WHERE owner_id=(select auth.uid())))
 WITH CHECK(auto_reply=false AND tenant_id IN (SELECT id FROM public.socio_tenants WHERE owner_id=(select auth.uid())));
GRANT INSERT,UPDATE ON public.socio_agent_profiles TO authenticated;
CREATE POLICY socio_analysis_jobs_queue_owner ON public.socio_analysis_jobs FOR INSERT TO authenticated
 WITH CHECK(status='queued' AND total_items=0 AND processed_items=0
 AND requested_by=(select auth.uid()) AND tenant_id IN
 (SELECT id FROM public.socio_tenants WHERE owner_id=(select auth.uid())));
GRANT INSERT ON public.socio_analysis_jobs TO authenticated;
