variable "cloudflare_account_id" {
  type        = string
  description = "Cloudflare account ID (32-char hex, found in the dashboard sidebar)."
}

variable "name_prefix" {
  type        = string
  description = "Prefix for created resource names. Lets you run multiple deployments (staging/prod) in one account."
  default     = "guildbridge"
}

variable "worker_hostname" {
  type        = string
  description = "Hostname the Worker is served on, without scheme or trailing slash. Example: guildbridge.your-subdomain.workers.dev or mcp.example.com. Access will gate <this>/admin."
}

variable "admin_emails" {
  type        = list(string)
  description = "Email addresses allowed through the /admin Access policy. Must match an identity provider configured in your Zero Trust account."

  validation {
    condition     = length(var.admin_emails) > 0
    error_message = "At least one admin email is required — an Access app with no allow policy denies everyone."
  }
}

variable "admin_session_duration" {
  type        = string
  description = "How long an Access session lasts before re-auth. Go-style duration string."
  default     = "24h"
}
