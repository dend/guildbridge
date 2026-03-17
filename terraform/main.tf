# GuildBridge — Cloudflare infrastructure
#
# Provisions the stateful Cloudflare resources the Worker binds to:
#   - KV namespace (OAUTH_KV)
#   - D1 database (AUDIT_DB)
#   - Zero Trust Access application + policy for /admin
#
# NOT managed here (use wrangler):
#   - Worker script & Durable Object   -> `npm run deploy`
#   - D1 schema                        -> `wrangler d1 migrations apply guildbridge-audit --remote`
#   - Secrets                          -> `wrangler secret put <NAME>`
#   - Analytics Engine dataset         -> created implicitly on first write, no provisioning needed
#
# Usage:
#   cp terraform.tfvars.example terraform.tfvars   # fill in values
#   terraform init
#   terraform apply
#   # copy outputs into wrangler.jsonc and run `wrangler secret put CF_ACCESS_AUD`

terraform {
  required_version = ">= 1.5"
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
  }
}

provider "cloudflare" {
  # Auth via CLOUDFLARE_API_TOKEN env var.
  # Token needs: Account.Workers KV Storage:Edit, Account.D1:Edit, Account.Access: Apps and Policies:Edit
}

# ---------------------------------------------------------------------------
# KV — OAuth state, CSRF tokens, admin allowlist
# ---------------------------------------------------------------------------
resource "cloudflare_workers_kv_namespace" "oauth" {
  account_id = var.cloudflare_account_id
  title      = "${var.name_prefix}-oauth"
}

# ---------------------------------------------------------------------------
# D1 — tool-call audit log
# Schema is applied separately via `wrangler d1 migrations apply`.
# ---------------------------------------------------------------------------
resource "cloudflare_d1_database" "audit" {
  account_id = var.cloudflare_account_id
  name       = "${var.name_prefix}-audit"
}

# ---------------------------------------------------------------------------
# Zero Trust Access — gates the /admin panel
# The Worker validates the CF-Access-Jwt-Assertion header server-side
# (src/cf-access.ts) using the AUD tag exported below.
# ---------------------------------------------------------------------------
resource "cloudflare_zero_trust_access_application" "admin" {
  account_id                = var.cloudflare_account_id
  name                      = "${var.name_prefix} Admin"
  domain                    = "${var.worker_hostname}/admin"
  type                      = "self_hosted"
  session_duration          = var.admin_session_duration
  auto_redirect_to_identity = true
}

resource "cloudflare_zero_trust_access_policy" "admin_allow" {
  account_id     = var.cloudflare_account_id
  application_id = cloudflare_zero_trust_access_application.admin.id
  name           = "Allow listed admins"
  precedence     = 1
  decision       = "allow"

  include {
    email = var.admin_emails
  }
}
