#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

step() {
  printf '\n== %s ==\n' "$1"
}

fail() {
  printf '\nERROR: %s\n' "$1" >&2
  exit 1
}

ask() {
  local prompt="$1"
  local default="${2-}"
  local value
  if [[ -n "$default" ]]; then
    read -r -p "$prompt [$default]: " value
    printf '%s' "${value:-$default}"
  else
    read -r -p "$prompt: " value
    printf '%s' "$value"
  fi
}

confirm() {
  local prompt="$1"
  local default="${2-y}"
  local suffix="[Y/n]"
  [[ "$default" == "n" ]] && suffix="[y/N]"
  local reply
  read -r -p "$prompt $suffix " reply
  reply="${reply:-$default}"
  [[ "$reply" =~ ^[Yy]$ ]]
}

upsert_env() {
  local key="$1"
  local value="$2"
  local env_file="$ROOT_DIR/.env"
  touch "$env_file"
  if grep -q "^${key}=" "$env_file"; then
    sed -i "s|^${key}=.*$|${key}=\"${value}\"|" "$env_file"
  else
    printf '%s="%s"\n' "$key" "$value" >> "$env_file"
  fi
}

suggest_web_ui_port() {
  local port
  while true; do
    port="$(( 20000 + RANDOM % 20000 ))"
    if ! command -v ss >/dev/null 2>&1; then
      printf '%s' "$port"
      return
    fi
    if ! ss -ltn "( sport = :${port} )" 2>/dev/null | tail -n +2 | grep -q .; then
      printf '%s' "$port"
      return
    fi
  done
}

choose_runtime() {
  if command -v docker >/dev/null 2>&1; then
    if docker info >/dev/null 2>&1; then
      printf 'docker'
      return
    fi
  fi
  if command -v container >/dev/null 2>&1; then
    printf 'apple-container'
    return
  fi
  fail "No supported container runtime detected. Install Docker or Apple Container first."
}

normalize_folder() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//; s/-+/-/g'
}

strip_channel_prefix() {
  local channel="$1"
  local value="$2"
  printf '%s' "$value" | sed -E "s/^${channel}[-_]+//"
}

ensure_deps() {
  if [[ ! -d node_modules ]]; then
    step "Installing dependencies"
    npm install
  fi
}

run_step() {
  npx tsx setup/index.ts --step "$@"
}

start_configured_service() {
  if command -v systemctl >/dev/null 2>&1 && systemctl --user daemon-reload >/dev/null 2>&1; then
    systemctl --user start nanoclaw
    systemctl --user is-active --quiet nanoclaw || fail "NanoClaw service failed to start under systemd --user."
    return
  fi

  if command -v launchctl >/dev/null 2>&1; then
    launchctl kickstart -k "gui/$(id -u)/com.nanoclaw" >/dev/null 2>&1 || true
    return
  fi

  if [[ -x "$ROOT_DIR/start-nanoclaw.sh" ]]; then
    "$ROOT_DIR/start-nanoclaw.sh"
    return
  fi

  fail "Could not determine how to start the NanoClaw service."
}

ensure_deps

mkdir -p logs

step "Detecting environment"
run_step timezone || true
run_step environment

runtime="$(choose_runtime)"
printf 'Using container runtime: %s\n' "$runtime"

step "Choosing channel"
printf 'Supported channels in this branch:\n'
printf '1. Telegram\n'
printf '2. WhatsApp\n'
channel_choice="$(ask "Select a channel" "1")"
case "$channel_choice" in
  1|telegram|Telegram)
    channel="telegram"
    ;;
  2|whatsapp|WhatsApp)
    channel="whatsapp"
    ;;
  *)
    fail "Unsupported channel selection: $channel_choice"
    ;;
esac

assistant_name="$(ask "Assistant name" "Andy")"
trigger="$(ask "Trigger word" "@${assistant_name}")"
upsert_env "ASSISTANT_NAME" "$assistant_name"

step "Configuring channel"
if [[ "$channel" == "telegram" ]]; then
  telegram_token="$(ask "Telegram bot token")"
  [[ -n "$telegram_token" ]] || fail "Telegram bot token is required."
  upsert_env "TELEGRAM_BOT_TOKEN" "$telegram_token"
  printf '\nAdd the bot to the target chat, then send /chatid there to get the JID.\n'
  jid="$(ask "Telegram chat JID (example: tg:-1001234567890)")"
  [[ "$jid" == tg:* ]] || fail "Telegram JID must start with tg:"
else
  printf '\nWhatsApp authentication will open a QR or pairing flow.\n'
  npm run auth
  run_step groups
  printf '\nIf you need a group JID, run:\n'
  printf '  npx tsx setup/index.ts --step groups --list\n\n'
  jid="$(ask "WhatsApp chat JID (example: 120363...@g.us or 1555...@s.whatsapp.net)")"
  [[ "$jid" == *@g.us || "$jid" == *@s.whatsapp.net ]] || fail "Invalid WhatsApp JID format."
fi

if confirm "Enable the local Web UI too?" "n"; then
  suggested_web_ui_port="$(suggest_web_ui_port)"
  printf '\nPick a non-standard local Web UI port. Avoid the obvious default ports.\n'
  web_ui_port="$(ask "Web UI port" "$suggested_web_ui_port")"
  web_ui_host="$(ask "Web UI host" "0.0.0.0")"
  web_ui_auth_token="$(ask "Web UI auth token (leave blank for none)" "")"
  web_ui_group_jid="$(ask "Web UI stable group JID" "web:web_ui")"
  web_ui_group_name="$(ask "Web UI group name" "Web UI")"

  upsert_env "WEB_UI_PORT" "$web_ui_port"
  upsert_env "WEB_UI_HOST" "$web_ui_host"
  upsert_env "WEB_UI_AUTH_TOKEN" "$web_ui_auth_token"
  upsert_env "WEB_UI_GROUP_JID" "$web_ui_group_jid"
  upsert_env "WEB_UI_GROUP_NAME" "$web_ui_group_name"
fi

group_name="$(ask "Display name for this chat/group")"
default_folder="${channel}_$(normalize_folder "$group_name")"
folder="$(ask "Folder name" "$default_folder")"
folder="$(normalize_folder "$folder")"
folder="${channel}_$(strip_channel_prefix "$channel" "$folder")"

if confirm "Make this the main group?" "y"; then
  main_flag="--is-main"
  trigger_flag=""
else
  main_flag=""
  if confirm "Require trigger word in this group?" "y"; then
    trigger_flag=""
  else
    trigger_flag="--no-trigger-required"
  fi
fi

step "Building container"
run_step container --runtime "$runtime"

step "Registering group"
register_args=(
  register
  --jid "$jid"
  --name "$group_name"
  --trigger "$trigger"
  --folder "$folder"
  --channel "$channel"
  --assistant-name "$assistant_name"
)

if [[ -n "$main_flag" ]]; then
  register_args+=("$main_flag")
fi
if [[ -n "$trigger_flag" ]]; then
  register_args+=("$trigger_flag")
fi

run_step "${register_args[@]}"

if confirm "Install NanoClaw as a background service now?" "n"; then
  step "Setting up service"
  run_step service
  step "Starting service"
  start_configured_service
fi

step "Verifying installation"
run_step verify

printf '\nSetup complete.\n'
printf 'Channel: %s\n' "$channel"
printf 'Group JID: %s\n' "$jid"
printf 'Folder: %s\n' "$folder"
