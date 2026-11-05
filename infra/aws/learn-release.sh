#!/usr/bin/env bash
# Runs on the EC2 host through SSM: pulls one digest-pinned ECR image and restarts one service.
#   learn-release <api|worker|web|migrate> <account>.dkr.ecr.<region>.amazonaws.com/<repo>@sha256:<digest>
# A failed health check restores the previous digest. Database changes are not rolled back, so
# migrations must stay compatible with the previous image.
set -euo pipefail

service="${1:-}"
image="${2:-}"
home="${LEARN_HOME:-/opt/learn}"
attempts="${LEARN_HEALTH_ATTEMPTS:-60}"
delay="${LEARN_HEALTH_DELAY:-2}"

case "$service" in
  api) var=API_IMAGE; probe='http://127.0.0.1:4000/api/v1/health/ready' ;;
  web) var=WEB_IMAGE; probe='http://127.0.0.1:3000/' ;;
  worker) var=WORKER_IMAGE; probe= ;;
  migrate) var=MIGRATE_IMAGE; probe= ;;
  *) echo 'Unsupported service' >&2; exit 2 ;;
esac

digest_ref='^[0-9]{12}\.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com/[a-z0-9_./-]+@sha256:[a-f0-9]{64}$'
[[ "$image" =~ $digest_ref ]] || { echo 'ECR image with sha256 digest required' >&2; exit 2; }

cd "$home"
test -f .env || { echo 'Missing .env' >&2; exit 2; }
[[ "$(stat -c '%a' .env)" == 600 && "$(stat -c '%u' .env)" == "$(id -u)" ]] ||
  { echo 'Config must be owner-only mode 0600' >&2; exit 2; }

# The web and backend pipelines share this host, so releases take turns.
exec 9>"${LEARN_LOCK:-/var/lock/learn-release.lock}"
flock -w 300 9 || { echo 'Another release is still running' >&2; exit 2; }

compose() { docker compose --env-file .env -f compose.yml "$@"; }

set_image() {
  if grep -q "^${var}=" .env; then
    sed -i "s|^${var}=.*|${var}=$1|" .env
  else
    printf '%s=%s\n' "$var" "$1" >> .env
  fi
}

registry="${image%%/*}"
region="$(cut -d. -f4 <<< "$registry")"
aws ecr get-login-password --region "$region" | docker login --username AWS --password-stdin "$registry"
docker pull "$image"

previous="$(grep "^${var}=" .env | cut -d= -f2- || true)"
set_image "$image"

rollback() {
  trap - ERR
  echo "Release failed; restoring ${service}" >&2
  set_image "$previous"
  if [[ "$service" != migrate && "$previous" =~ $digest_ref ]]; then
    compose up -d --no-deps "$service" || true
  fi
  exit 1
}
trap rollback ERR

if [[ "$service" == migrate ]]; then
  compose --profile ops run --rm migrate
  trap - ERR
  echo "Migrations applied with ${image}"
  exit 0
fi

# Idempotent: covers the first release, when the shared services do not exist yet.
if [[ "$service" == api ]]; then
  compose up -d --no-deps postgres redis minio
  compose run --rm storage-init
fi

compose up -d --no-deps "$service"

container="$(compose ps -q "$service")"
healthy=false
for attempt in $(seq 1 "$attempts"); do
  [[ "$(docker inspect --format '{{.State.Running}}' "$container")" == true ]] || break
  [[ "$(docker inspect --format '{{.RestartCount}}' "$container")" == 0 ]] || break
  if [[ -z "$probe" ]]; then
    # The worker has no port, so staying up for a while is its health signal.
    if [[ "$attempt" -ge 10 ]]; then healthy=true; break; fi
  elif compose exec -T "$service" node -e \
    "fetch('${probe}').then((r)=>process.exit(r.ok?0:1),()=>process.exit(1))"; then
    healthy=true
    break
  fi
  sleep "$delay"
done
"$healthy" || { echo 'Health check failed' >&2; false; }
trap - ERR

# Caddy depends on web and api, so start it once either is healthy.
compose up -d --no-deps caddy
docker image prune -f --filter 'until=168h' >/dev/null
echo "Released ${service} ${image}"
