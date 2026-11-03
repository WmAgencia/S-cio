-- Supabase phase 1 hardening: private media and indexes for tenant-scoped FKs.
CREATE INDEX socio_tenants_owner_idx ON public.socio_tenants(owner_id);
CREATE INDEX socio_approvals_connection_idx ON public.socio_action_approvals(tenant_id,tool_connection_id);
CREATE INDEX socio_approvals_requester_idx ON public.socio_action_approvals(requested_by);
CREATE INDEX socio_approvals_approver_idx ON public.socio_action_approvals(approved_by);
CREATE INDEX socio_jobs_requested_by_idx ON public.socio_analysis_jobs(requested_by);
CREATE INDEX socio_audit_tenant_time_idx ON public.socio_audit_events(tenant_id,created_at DESC);
CREATE INDEX socio_audit_actor_idx ON public.socio_audit_events(actor_id);
CREATE INDEX socio_knowledge_tenant_job_idx ON public.socio_knowledge_versions(tenant_id,job_id);
CREATE INDEX socio_media_tenant_product_idx ON public.socio_product_media(tenant_id,product_id);
CREATE INDEX socio_sources_tenant_channel_idx ON public.socio_training_sources(tenant_id,channel_id);
CREATE INDEX socio_sources_tenant_job_idx ON public.socio_training_sources(tenant_id,job_id);
ALTER TABLE public.socio_agent_profiles ADD CONSTRAINT socio_agent_profile_approved_version_fk
 FOREIGN KEY(tenant_id,approved_knowledge_id)
 REFERENCES public.socio_knowledge_versions(tenant_id,id);
CREATE INDEX socio_agent_approved_version_idx ON public.socio_agent_profiles(tenant_id,approved_knowledge_id);
ALTER TABLE public.socio_product_media ADD CONSTRAINT socio_media_tenant_path_scope
 CHECK(object_path LIKE tenant_id::text || '/%');
-- This bucket is PRIVATE: no public URLs, no anonymous access.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 VALUES('socio-media','socio-media',false,15728640,ARRAY[
 'image/png','image/jpeg','image/webp','video/mp4'])
 ON CONFLICT(id) DO NOTHING;
-- Folder prefix MUST be the authenticated user's authorized tenant UUID.
CREATE POLICY socio_media_select ON storage.objects FOR SELECT TO authenticated USING(
 bucket_id='socio-media' AND EXISTS (
 SELECT 1 FROM public.socio_tenants t WHERE t.id::text=(storage.foldername(name))[1]
 AND (t.owner_id=(select auth.uid()) OR
 t.id IN (SELECT m.tenant_id FROM public.socio_memberships m WHERE m.user_id=(select auth.uid())))
 ));
CREATE POLICY socio_media_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK(
 bucket_id='socio-media' AND EXISTS (
 SELECT 1 FROM public.socio_tenants t WHERE t.id::text=(storage.foldername(name))[1]
 AND t.owner_id=(select auth.uid())
 ));
CREATE POLICY socio_media_update ON storage.objects FOR UPDATE TO authenticated USING(
 bucket_id='socio-media' AND EXISTS (
 SELECT 1 FROM public.socio_tenants t WHERE t.id::text=(storage.foldername(name))[1]
 AND t.owner_id=(select auth.uid())
 )) WITH CHECK(
 bucket_id='socio-media' AND EXISTS (
 SELECT 1 FROM public.socio_tenants t WHERE t.id::text=(storage.foldername(name))[1]
 AND t.owner_id=(select auth.uid())
 ));
CREATE POLICY socio_media_delete ON storage.objects FOR DELETE TO authenticated USING(
 bucket_id='socio-media' AND EXISTS (
 SELECT 1 FROM public.socio_tenants t WHERE t.id::text=(storage.foldername(name))[1]
 AND t.owner_id=(select auth.uid())
 ));
