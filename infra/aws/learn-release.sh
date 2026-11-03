#!/usr/bin/env bash
set -euo pipefail
service="${1:-}"
image="${2:-}"
case "$service" in
  api) port=4000; probe=/api/v1/health/ready ;;
  worker) port=0; probe= ;;
  compute) port=4500; probe=/health/ready ;;
  web) port=3000; probe=/ ;;
  *) echo 'Unsupported service' >&2; exit 2 ;;
esac
[[ "$image" =~ ^ghcr\.io/[a-z0-9_.-]+/[a-z0-9_./-]+@sha256:[a-f0-9]{64}$ ]] || { echo 'Digest required' >&2; exit 2; }
# Serialize releases on each host. Local secrets never appear in command parameters.
exec 9>"/var/lock/learn-${service}.lock"
flock -n 9 || { echo 'Release already running' >&2; exit 2; }
env_file="/etc/learn/${service}.env"
test -f "$env_file"
[[ "$(stat -c '%a' "$env_file")" == 600 && "$(stat -c '%u' "$env_file")" == 0 ]] || { echo 'Config must be root-owned mode 0600' >&2; exit 2; }
docker pull "$image"
name="learn-${service}"
previous="${name}-previous-$(date +%s)-$$"
had_previous=false
if docker inspect "$name" >/dev/null 2>&1; then
  docker stop --time 90 "$name" >/dev/null
  docker rename "$name" "$previous"
  had_previous=true
fi
rollback() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  if $had_previous; then docker rename "$previous" "$name"; docker start "$name" >/dev/null; fi
}
trap rollback ERR
docker run -d --name "$name" --label learn.service="$service" --label learn.environment=staging \
  --network host --restart unless-stopped --stop-timeout 90 --read-only --tmpfs /tmp:rw,nosuid,size=256m \
  --log-opt max-size=10m --log-opt max-file=3 --env-file "$env_file" "$image" >/dev/null
healthy=false
for attempt in $(seq 1 60); do
  running="$(docker inspect --format '{{.State.Running}}' "$name")"
  if [[ "$running" != true ]]; then break; fi
  if [[ "$port" == 0 ]]; then
    if [[ "$attempt" -ge 10 ]]; then healthy=true; break; fi
  elif curl --silent --fail --max-time 3 "http://127.0.0.1:${port}${probe}" >/dev/null; then
    healthy=true; break
  fi
  sleep 2
done
$healthy || { echo 'Readiness failed; restoring previous process' >&2; false; }
trap - ERR
printf 'Released %s %s; previous container: %s\n' "$service" "$image" "$previous"
