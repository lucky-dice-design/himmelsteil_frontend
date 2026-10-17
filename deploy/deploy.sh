#!/usr/bin/env bash
# Installed root-owned on the VPS; never execute a script from the upload as root.
set -Eeuo pipefail
umask 077
[[ $EUID == 0 ]] || { echo 'Run using the installed sudo entrypoint.' >&2; exit 1; }
revision=${1:-}
[[ $revision =~ ^[0-9a-f]{40}$ ]] || { echo 'Expected a full Git commit SHA.' >&2; exit 1; }
# This root-owned file contains only DEPLOY_HOME=/home/<deployment-user>.
source /etc/lucky-deploy.conf
: "${DEPLOY_HOME:?Missing DEPLOY_HOME}"
archive="$DEPLOY_HOME/deploy-incoming/himmelsteil_frontend/$revision/release.tar.gz"
test -f "$archive"
exec 9>/run/lock/lucky-vps-deploy.lock
flock -w 900 9
work=$(mktemp -d /var/tmp/himmelsteil_frontend.XXXXXXXX)
trap 'rm -rf -- "$work"' EXIT
# Copy first: subsequent extraction is from a root-owned, stable archive.
cp "$archive" "$work/release.tar.gz"
mkdir "$work/source"
# git archive produces regular files; reject links and traversal before extraction.
python3 - "$work/release.tar.gz" "$work/source" <<'PYTHON'
import sys, tarfile
from pathlib import PurePosixPath
with tarfile.open(sys.argv[1]) as archive:
    for member in archive.getmembers():
        path = PurePosixPath(member.name)
        if path.is_absolute() or '..' in path.parts or not (member.isfile() or member.isdir()):
            raise SystemExit('Release contains an unsafe archive member')
    archive.extractall(sys.argv[2], filter='data')
PYTHON
src="$work/source"
# Abort before any update if the competing host service has been re-enabled.
if systemctl is-active --quiet caddy.service || systemctl is-enabled --quiet caddy.service; then
  echo 'Host caddy.service must be disabled and stopped; Docker Caddy owns ports 80/443.' >&2
  exit 1
fi
snapshot=/var/backups/lucky-deploy/himmelsteil_frontend/$(date -u +%Y%m%dT%H%M%S)-$revision
install -d -m 0700 "$snapshot"
echo "Backup directory: $snapshot"
trap 'status=$?; echo "Deployment failed (exit $status); backup directory: $snapshot" >&2; exit "$status"' ERR
source_dir=/opt/himmelsteil-preview-src
test -f /etc/himmelsteil-preview.env
test -x /usr/local/sbin/himmelsteil-preview-build
test -d "$source_dir/dist"
# Serialize source replacement with the existing five-minute preview build.
exec 8>/run/lock/himmelsteil-preview-build.lock
flock -w 300 8
tar -czf "$snapshot/source.tar.gz" -C "$source_dir" .
for item in dist content scripts package.json; do
  test -e "$src/$item"
done
for item in dist content scripts; do
  rsync -a --delete --chown=root:root "$src/$item/" "$source_dir/$item/"
done
install -m 0644 "$src/package.json" "$source_dir/package.json"
flock -u 8
/usr/local/sbin/himmelsteil-preview-build --dry-run
/usr/local/sbin/himmelsteil-preview-build
# Live publication is enabled only after the initial verified Live build.
if [[ -f /var/lib/himmelsteil-publication/live-singletons.json ]]; then
  /usr/local/sbin/himmelsteil-preview-build --live --dry-run
  /usr/local/sbin/himmelsteil-preview-build --live
fi
# Test the shared proxy and both CMS backends, including TLS and host routing.
for domain in admin.himmelsteil.de admin.luckydicedesign.de; do
  result=$(curl --silent --show-error --fail --retry 8 --retry-connrefused --retry-delay 2 --max-time 10 \
    --resolve "$domain:443:127.0.0.1" "https://$domain/server/ping")
  [[ $result == pong ]] || { echo "CMS probe failed: $domain" >&2; exit 1; }
done
printf '%s\n' "$revision" > "$source_dir/.deployed-revision"
echo "Himmelsteil preview deployed: $revision; backup: $snapshot"
