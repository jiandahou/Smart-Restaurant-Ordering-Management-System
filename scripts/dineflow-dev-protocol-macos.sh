#!/bin/bash

set -euo pipefail

uri="${1:-}"
if [[ "${uri%/}" != "dineflow-dev://stripe-forward" ]]; then
  echo "Unsupported DineFlow development command." >&2
  exit 2
fi

script_dir="$(cd "$(dirname "$0")" && pwd)"
repository_root="${DINEFLOW_REPOSITORY_ROOT:-$(cd "$script_dir/.." && pwd)}"
environment_file="$repository_root/.env"
forward_to="http://localhost:5000/api/payments/stripe/webhook"

if [[ -f "$environment_file" ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" == STRIPE_FORWARD_TO_URL=* ]]; then
      forward_to="${line#STRIPE_FORWARD_TO_URL=}"
      forward_to="${forward_to#\"}"
      forward_to="${forward_to%\"}"
      forward_to="${forward_to#\'}"
      forward_to="${forward_to%\'}"
      break
    fi
  done < "$environment_file"
fi

if [[ "$forward_to" != http://* && "$forward_to" != https://* ]]; then
  echo "STRIPE_FORWARD_TO_URL must be an absolute HTTP or HTTPS URL." >&2
  exit 3
fi

printf -v stripe_command 'stripe listen --forward-to %q' "$forward_to"

terminal_command="$stripe_command"
if [[ ! -f "$HOME/.config/stripe/config.toml" ]]; then
  terminal_command="stripe login && $stripe_command"
fi

/usr/bin/osascript - "$terminal_command" <<'APPLESCRIPT'
on run argv
  tell application "Terminal"
    activate
    do script (item 1 of argv)
  end tell
end run
APPLESCRIPT
