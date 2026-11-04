-- Private Supabase staging-only indexes for observed FK linter warnings.
-- Empty schema confirmed 2026-11-04; no production database changes.
-- Does not remove unused/duplicate indexes without a separate review.
DO $guard$
BEGIN
 IF (SELECT count(*) FROM socio_app.tenants)>0 THEN
  RAISE EXCEPTION 'Refusing staging index migration after runtime data load';
 END IF;
END $guard$;

CREATE INDEX IF NOT EXISTS socio_p5_audit_actor ON socio_app.audit(actor_id);
CREATE INDEX IF NOT EXISTS socio_p5_ui_assigned ON socio_app.conversation_ui_state(assigned_user_id);
CREATE INDEX IF NOT EXISTS socio_p5_conversations_channel ON socio_app.conversations(channel_id);
CREATE INDEX IF NOT EXISTS socio_p5_outbox_user ON socio_app.message_outbox(user_id);
CREATE INDEX IF NOT EXISTS socio_p5_message_ui_user ON socio_app.message_ui_state(user_id);
CREATE INDEX IF NOT EXISTS socio_p5_messages_conversation ON socio_app.messages(conversation_id);
CREATE INDEX IF NOT EXISTS socio_p5_orders_conversation ON socio_app.sales_orders(tenant_id,conversation_id);
CREATE INDEX IF NOT EXISTS socio_p5_events_order ON socio_app.sales_payment_events(order_id);
CREATE INDEX IF NOT EXISTS socio_p5_quotes_creator ON socio_app.sales_quotes(created_by);
CREATE INDEX IF NOT EXISTS socio_p5_quotes_conversation ON socio_app.sales_quotes(tenant_id,conversation_id);
CREATE INDEX IF NOT EXISTS socio_p5_sessions_tenant ON socio_app.sessions(active_tenant_id);
CREATE INDEX IF NOT EXISTS socio_p5_job_items_import ON socio_app.training_job_items(tenant_id,import_id);
CREATE INDEX IF NOT EXISTS socio_p5_job_items_job ON socio_app.training_job_items(tenant_id,job_id);
CREATE INDEX IF NOT EXISTS socio_p5_versions_job ON socio_app.training_versions(tenant_id,job_id);
CREATE INDEX IF NOT EXISTS socio_p5_snapshot_import ON socio_app.waakg_import_snapshots(tenant_id,import_id);
CREATE INDEX IF NOT EXISTS socio_p5_scan_chats_channel ON socio_app.waakg_scan_chats(tenant_id,channel_id);
CREATE INDEX IF NOT EXISTS socio_p5_scan_chats_scan ON socio_app.waakg_scan_chats(tenant_id,scan_id);
