# Install Instructions ⚙️

This folder contains quick install guidance for running the Web Portal in Docker (including a Docker Compose file and an Unraid template).

## Summary
- Base image: `node:lts-alpine`
- Application path inside container: `/app` (the repository must be mounted there)
- Container port: **3000** (maps to host 3000)
- Entrypoint / command (post-create):

  sh -c "apk add --no-cache curl jq && cd /app && npm install && npm start"

## Docker run (example)
You must mount the repo as `/app` inside the container. Example `docker run` (multi-line form for readability):

```bash
docker run \
  -d \
  --name='neighborhood-web-portal' \
  --net='proxy-in' \
  --pids-limit 2048 \
  -e TZ="America/New_York" \
  -e HOST_OS="Unraid" \
  -e HOST_HOSTNAME="R730" \
  -e HOST_CONTAINERNAME="neighborhood-web-portal" \
  -l net.unraid.docker.managed=dockerman \
  -l net.unraid.docker.webui='http://[IP]:[PORT:3000]' \
  -p '3000:3000/tcp' \
  -v '/path/to/your/repo':'/app':'rw' \
  'node:lts-alpine' sh -c "apk add --no-cache curl jq && cd /app && npm install && npm start"
```

Notes:
- Replace `/path/to/your/repo` with the path to your checked-out repository or your data directory (the repository must be mounted at `/app` inside the container).
- Set the `TZ` and host env vars as appropriate for the host.

## Docker Compose (recommended)
A `docker-compose.yml` is provided in this folder — it mirrors the docker run above and pulls three images:
- `node:lts-alpine` (web portal)
- `mongo:latest` (database)
- `python:3.11-slim` (LPR capture)

Quick usage:

```bash
# Run in the folder with docker-compose.yml
docker compose up -d
# View logs
docker compose logs -f
```

Tip: the Compose service is configured to use the external network `proxy-in`. Ensure that network exists on your host or adjust the `networks` setting.

## Unraid Template
A basic Unraid template (`template.xml`) is included for import into Community Applications. The template pre-populates the common environment variables, ports, and bind-mount for `/app`.

## LPR Capture (optional)
This repository includes LPR capture support in `LPR_Notifications/` and a small capture service that runs independently of the main web portal. If you want to enable LPR capture, follow these notes and examples.

### Quick Docker run (example)
```bash
docker run \
  -d \
  --name='neighborhood-lrp-capture' \
  --net='bridge' \
  --pids-limit 2048 \
  -e TZ="America/New_York" \
  -e HOST_OS="Unraid" \
  -e HOST_HOSTNAME="R730" \
  -e HOST_CONTAINERNAME="neighborhood-lrp-capture" \
  -e 'UNIFI_PROTECT_USERNAME'='your_protect_username' \
  -e 'UNIFI_PROTECT_PASSWORD'='your_protect_password' \
  -e 'UNIFI_PROTECT_API_KEY'='your_protect_api_key' \
  -e 'CONTAINER_CMD'='/bin/sh -c "/app/docker/unraid_entrypoint.sh ${CONTAINER_CMD:---catchup}"' \
  -l net.unraid.docker.managed=dockerman \
  -v '/path/to/your/repo':'/app':'ro' \
  -v '/path/to/your/lpr_data':'/var/lib/lpr':'rw' \
  python:3.11-slim /app/docker/unraid_entrypoint.sh

> Note: The LPR capture container runs a Python image (`python:3.11-slim`). Credentials are intentionally left as placeholders — do not commit real secrets to the repo.

**Image / Repository callout:** Docker image used by the LPR capture service: `python:3.11-slim`. In the Unraid template the `<Repository>` field is set to `python 3.11-slim` (space-separated).
```

### Docker Compose (recommended)
A `lpr-capture-compose.yml` example is included in this folder. It mounts your repo read-only at `/app` and the LPR storage at `/var/lib/lpr` and runs `/app/docker/unraid_entrypoint.sh`.

### Unraid template
A dedicated template `web-portal-lpr.xml` is included for import into Community Applications (see folder). It pre-populates common envs and mounts.

### Notes & troubleshooting
- Environment variables important for LPR capture include `UNIFI_PROTECT_USERNAME`, `UNIFI_PROTECT_PASSWORD`, and `UNIFI_PROTECT_API_KEY` (API key is preferred when available).
- The capture service relies on the local LPR storage mount (`/var/lib/lpr`) and the repo's `docker/unraid_entrypoint.sh` entrypoint.
- I had this working previously where new events were being fed to an in-container listener; that ingestion has since broken — you'll need to diagnose the capture service or the Protect connection.
- There is a backfill script (`backfill_protect_hours.py` / `backfill_protect_hours`) that can be run manually or scheduled to backfill missed events. In my environment the furthest I could pull was **7 days**.

## MongoDB (required)
This application requires a MongoDB instance. For simplicity and compatibility with the scripts and defaults in this repo, create a MongoDB container using the official `mongo` image with the standard port mapping and a persistent volume for `/data/db`.

Example Docker run (quick):

```bash
docker run -d --name web-portal-mongo -p 27017:27017 -v /path/to/mongo/data:/data/db mongo:latest
```

Example Docker Compose service to add to your stack:

```yaml
services:
  mongo:
    image: mongo:latest
    container_name: web-portal-mongo
    restart: unless-stopped
    ports:
      - "27017:27017"
    volumes:
      - /path/to/your/mongo/data:/data/db
```

After creating the DB, set `MONGO_URL` in your `.env` to point to the DB (example: `MONGO_URL=mongodb://web-portal-mongo:27017/web-portal` or a host+port if you mapped to the host).

Example `.env` snippet:

```dotenv
# MongoDB connection (point to your mongo container or host)
# Examples:
# - Container name: mongodb://web-portal-mongo:27017/web-portal
# - With credentials: mongodb://user:password@mongo-host:27017/web-portal
MONGO_URL=mongodb://web-portal-mongo:27017/web-portal
```

### Optional: Enable MongoDB authentication 🔐
Authentication is not required for local development or testing, but it is **recommended for production**.

Quick ways to enable auth and create a root user:

- Start MongoDB and set root credentials at container creation (recommended):

```bash
docker run -d --name web-portal-mongo \
  -p 27017:27017 \
  -v /path/to/mongo/data:/data/db \
  -e MONGO_INITDB_ROOT_USERNAME=wp_admin \
  -e MONGO_INITDB_ROOT_PASSWORD=S3cret \
  mongo:latest
```

- Or create a user against an existing container (run once):

```bash
docker run --rm --network container:web-portal-mongo \
  mongo:latest mongo admin --eval "db.createUser({user: 'wp_admin', pwd: 'S3cret', roles:[{role:'root',db:'admin'}]})"
```

After enabling auth, update your `.env` to include credentials in the connection string, for example:

```dotenv
MONGO_URL=mongodb://wp_admin:S3cret@web-portal-mongo:27017/web-portal
```

> Note: Enabling authentication is optional for development; if you enable it, ensure you secure credentials and do not commit them to the repository.


## Troubleshooting & Notes
- The container uses `node:lts-alpine`. The start command runs `npm install` at container start to pick up changes from the mounted repo; for production, consider pre-building a production image.
- If you prefer a different node image or build flow, update the `image:` or replace the `command` in `docker-compose.yml` or the template.

---

If you'd like, I can:
- Add a pre-built Dockerfile and a small multi-stage build so you don't need to run `npm install` at container start.
- Create a small healthcheck and restart policy improvements in the Compose file.

