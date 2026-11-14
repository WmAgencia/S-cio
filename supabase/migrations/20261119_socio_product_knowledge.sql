-- One Markdown knowledge document per product, regenerated on every change.
-- Deterministic server facts only; never exposed through a public URL.
CREATE TABLE IF NOT EXISTS socio_product_knowledge (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 product_id uuid NOT NULL,
 markdown text NOT NULL CHECK(char_length(markdown)>0),
 refreshed_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,product_id) REFERENCES products(tenant_id,id) ON DELETE CASCADE,
 UNIQUE(tenant_id,product_id)
);
