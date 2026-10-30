#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/root/share-wa}"
BACKUP_DIR="${BACKUP_DIR:-/root/env-backup}"
WEB_DIR="${WEB_DIR:-/var/www/sharewa}"
PM2_APP_NAME="${PM2_APP_NAME:-}"
RUN_DB_PUSH="${RUN_DB_PUSH:-0}"
ENV_FILES=(".env" "artifacts/api-server/.env")

die() {
  echo "ERROR: $*" >&2
  exit 1
}

for command in git pnpm rsync pm2 realpath; do
  command -v "$command" >/dev/null 2>&1 || die "Required command not found: $command"
done

[[ "$EUID" -eq 0 ]] || die "Run this script as root."
[[ -d "$APP_DIR/.git" ]] || die "APP_DIR is not a Git repository: $APP_DIR"
[[ "$RUN_DB_PUSH" == "0" || "$RUN_DB_PUSH" == "1" ]] || die "RUN_DB_PUSH must be 0 or 1."

APP_DIR="$(realpath "$APP_DIR")"
BACKUP_DIR="$(realpath -m "$BACKUP_DIR")"
WEB_DIR="$(realpath -m "$WEB_DIR")"

[[ "$BACKUP_DIR" != "/" && "$BACKUP_DIR" != "$APP_DIR" ]] \
  || die "Unsafe BACKUP_DIR: $BACKUP_DIR"
[[ "$WEB_DIR" != "/" && "$WEB_DIR" != "$APP_DIR" && "$WEB_DIR" != "$BACKUP_DIR" ]] \
  || die "Unsafe WEB_DIR: $WEB_DIR"
case "$WEB_DIR/" in
  "$APP_DIR/"*) die "WEB_DIR must not be inside APP_DIR." ;;
esac
case "$BACKUP_DIR/" in
  "$APP_DIR/"*) die "BACKUP_DIR must not be inside APP_DIR." ;;
esac

cd "$APP_DIR"

echo "==> [1/7] Backup environment files"
mkdir -p "$BACKUP_DIR"
for file in "${ENV_FILES[@]}"; do
  if [[ -f "$APP_DIR/$file" ]]; then
    mkdir -p "$BACKUP_DIR/$(dirname "$file")"
    cp -p -- "$APP_DIR/$file" "$BACKUP_DIR/$file"
  fi
done

echo "==> [2/7] Fetch latest code from origin/main"
git fetch origin
git rev-parse --verify 'origin/main^{commit}' >/dev/null \
  || die "origin/main was not found."
echo "WARNING: git reset --hard will discard tracked local changes."
git reset --hard origin/main

echo "==> [3/7] Restore server environment files"
for file in "${ENV_FILES[@]}"; do
  if [[ -f "$BACKUP_DIR/$file" ]]; then
    mkdir -p "$APP_DIR/$(dirname "$file")"
    cp -p -- "$BACKUP_DIR/$file" "$APP_DIR/$file"
  fi
done

echo "==> [4/7] Install locked dependencies"
pnpm install --frozen-lockfile

if [[ "$RUN_DB_PUSH" == "1" ]]; then
  echo "==> [5/7] Push database schema and verify admin login"
  [[ -f "$APP_DIR/.env" ]] || die "RUN_DB_PUSH=1 requires $APP_DIR/.env."
  pnpm db:push
else
  echo "==> [5/7] Database schema push skipped (set RUN_DB_PUSH=1 to enable)"
fi

echo "==> [6/7] Build application"
pnpm build
[[ -f "$APP_DIR/artifacts/sharewa/dist/index.html" ]] \
  || die "Frontend build did not produce artifacts/sharewa/dist/index.html."

if [[ -z "$PM2_APP_NAME" ]]; then
  mapfile -t matching_pm2_apps < <(
    pm2 jlist | node -e '
      const path = require("node:path");
      const root = path.resolve(process.argv[1]);
      const apps = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
      for (const app of apps) {
        const cwd = app.pm2_env?.pm_cwd;
        if (cwd && (path.resolve(cwd) === root || path.resolve(cwd).startsWith(root + path.sep))) {
          console.log(app.name);
        }
      }
    ' "$APP_DIR"
  )
  if [[ "${#matching_pm2_apps[@]}" -ne 1 ]]; then
    die "Could not identify one PM2 app for $APP_DIR. Set PM2_APP_NAME explicitly (check 'pm2 list')."
  fi
  PM2_APP_NAME="${matching_pm2_apps[0]}"
  echo "Using PM2 app: $PM2_APP_NAME"
elif ! pm2 describe "$PM2_APP_NAME" >/dev/null 2>&1; then
  die "PM2 app '$PM2_APP_NAME' was not found."
fi

echo "==> [7/7] Deploy frontend and restart PM2 app"
mkdir -p "$WEB_DIR"
rsync --archive --delete -- "$APP_DIR/artifacts/sharewa/dist/" "$WEB_DIR/"
chmod -R a+rX -- "$WEB_DIR"
if command -v chcon >/dev/null 2>&1; then
  chcon -R -t httpd_sys_content_t "$WEB_DIR" \
    || echo "WARNING: SELinux context was not changed; check web server access." >&2
fi
pm2 restart "$PM2_APP_NAME" --update-env
pm2 save
pm2 list

echo "==> Deployment complete: $(git rev-parse --short HEAD)"
