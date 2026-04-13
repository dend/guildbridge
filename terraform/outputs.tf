# ---------------------------------------------------------------------------
# Paste these into wrangler.jsonc
# ---------------------------------------------------------------------------

output "kv_namespace_id" {
  description = "-> wrangler.jsonc: kv_namespaces[0].id"
  value       = cloudflare_workers_kv_namespace.oauth.id
}

output "d1_database_id" {
  description = "-> wrangler.jsonc: d1_databases[0].database_id"
  value       = cloudflare_d1_database.audit.id
}

output "d1_database_name" {
  description = "-> wrangler.jsonc: d1_databases[0].database_name (and the arg to `wrangler d1 migrations apply`)"
  value       = cloudflare_d1_database.audit.name
}

# ---------------------------------------------------------------------------
# Set this as a Worker secret
# ---------------------------------------------------------------------------

output "cf_access_aud" {
  description = "-> `wrangler secret put CF_ACCESS_AUD`. The Worker validates incoming JWTs against this audience tag."
  value       = cloudflare_zero_trust_access_application.admin.aud
}

# ---------------------------------------------------------------------------
# Convenience: ready-to-paste wrangler.jsonc fragment
# ---------------------------------------------------------------------------

output "wrangler_bindings" {
  description = "Drop-in replacement for the kv_namespaces + d1_databases blocks in wrangler.jsonc."
  value = {
    kv_namespaces = [{
      binding = "OAUTH_KV"
      id      = cloudflare_workers_kv_namespace.oauth.id
    }]
    d1_databases = [{
      binding       = "AUDIT_DB"
      database_name = cloudflare_d1_database.audit.name
      database_id   = cloudflare_d1_database.audit.id
    }]
  }
}
