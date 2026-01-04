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

### Compose examples
Below are a few compose snippets showing common patterns.

1) Basic (loads `.env` and runs web portal + mongo):

```yaml
version: '3.8'
services:
  webportal:
    image: node:lts-alpine
    env_file: ./.env
    ports:
      - '3000:3000'
    volumes:
      - './:/app:rw'
    networks:
      - proxy-in
  mongo:
    image: mongo:latest
    volumes:
      - ./mongo-data:/data/db
networks:
  proxy-in:
    external: true
```

2) Explicit env override (turn LPR off at container level):

```yaml
version: '3.8'
services:
  webportal:
    image: node:lts-alpine
    env_file: ./.env
    environment:
      - SHOW_LPR_DATA=NO # overrides .env value for this service
    ports:
      - '3000:3000'
    volumes:
      - './:/app:rw'
    networks:
      - proxy-in
  # Note: LPR capture service not included here (no LPR capture container started)
networks:
  proxy-in:
    external: true
```

3) Compose with LPR capture service enabled (optional):

```yaml
version: '3.8'
services:
  webportal:
    image: node:lts-alpine
    env_file: ./.env
    ports:
      - '3000:3000'
    volumes:
      - './:/app:rw'
    networks:
      - proxy-in
  mongo:
    image: mongo:latest
    volumes:
      - ./mongo-data:/data/db
  lpr-capture:
    image: python:3.11-slim
    env_file: ./.env
    command: '/app/docker/unraid_entrypoint.sh'
    volumes:
      - './:/app:ro'
      - './lpr-data:/var/lib/lpr:rw'
    networks:
      - proxy-in
networks:
  proxy-in:
    external: true
```

Notes:
- Use the second example if you want to intentionally hide LPR-related UI (set `SHOW_LPR_DATA=NO`) — this removes LPR tiles and the `/lpr-dashboard.html` route from the public site.
- When using `.env` together with `environment:` or passing `-e` in `docker run`, the explicitly set values override `.env` for that run.


## Environment configuration (env vars)
You can provide configuration via environment variables either by setting them directly (shell / docker run) or by using a `.env` file. A sample `.env.example` exists in the repository root — copy it to `.env` and edit values as needed.

- Option A — Use a `.env` file (recommended for local dev):
  - Create a `.env` at the repository root and add `KEY=value` lines (e.g., `MONGO_URL`, `UNIFA_API_URL`, `UNIFA_BEARER_TOKEN`, `SHOW_LPR_DATA`, `SITE_NAME`).
  - Docker Compose will automatically load `.env` when run in the same folder. Alternatively explicitly load an env file: `docker compose --env-file ./path/to/.env up -d`.

- Option B — Set variables inline / in your shell:
  - Example `docker run` with envs: `docker run -e MONGO_URL='mongodb://...' -e UNIFA_API_URL='https://...' ...`
  - Or export in your shell session: `export MONGO_URL='mongodb://...' && docker compose up -d` (exported shell vars are available to compose).

- Option C — Use `env_file` or `environment` in `docker-compose.yml`:
  - Example snippet:

```yaml
services:
  webportal:
    env_file:
      - ./.env
    environment:
      - SHOW_LPR_DATA=${SHOW_LPR_DATA}
```

Notes:
- Do not commit real secrets. Keep `.env` in `.gitignore` and store credentials securely (Docker secrets, Vault, cloud secrets manager).
- Values set via `docker run -e` or the `environment:` block in Compose will override values from `.env`/`env_file` for that container instance.
- For LPR capture, ensure `UNIFI_PROTECT_USERNAME`, `UNIFI_PROTECT_PASSWORD`, or `UNIFI_PROTECT_API_KEY` (preferred) are set for the capture container.

### Filling out `.env.example`
- Start by copying the template: `cp .env.example .env`
- Required minimal fields to get the app running locally:
  - `MONGO_URL` (e.g., `mongodb://localhost:27017/web-portal`)
  - `UNIFA_API_URL` and `UNIFA_BEARER_TOKEN` (if using upstream Protect/API features)
  - `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USER`, and `EMAIL_PASS` (for invites/emails)
- Gmail / Google Workspace note:
  - If you use Gmail for SMTP, **do NOT** use your normal Gmail password. Create an App Password (Account > Security > App Passwords) and set `EMAIL_PASS` to that app password. This is required when 2FA is enabled and is more secure than using your account password.
- Recommended for production:
  - Use a secrets manager or Docker secrets for `EMAIL_PASS`, `UNIFA_BEARER_TOKEN`, `UNIFI_PROTECT_API_KEY` instead of plaintext in `.env`.
  - Set `SHOW_LPR_DATA=NO` if you do not want LPR-related UI exposed publicly.
  - Set `ADMIN_EMAILS` to a comma-separated list of admin addresses.
- Quick example (do not use real secrets):

```env
MONGO_URL=mongodb://wp_admin:S3cret@mongo-host:27017/web-portal
UNIFA_API_URL=https://api.example.com
UNIFA_BEARER_TOKEN=eyJhbGciOi...
EMAIL_HOST=smtp.mail.example.com
EMAIL_PORT=587
EMAIL_USER=notify@example.com
# Using Gmail example: set EMAIL_PASS to an App Password (not your normal password)
EMAIL_PASS=abcd-efgh-ijkl-mnop
SHOW_LPR_DATA=YES
```

If you want, I can add a small `ENVIRONMENT.md` with copyable examples for local, Docker Compose, and production (secrets manager) usage.

## Unraid Template
A basic Unraid template (`template.xml`) is included for import into Community Applications. The template pre-populates the common environment variables, ports, and bind-mount for `/app`.

**Unraid templates (where to put them):**
If you want the templates to be available across your Unraid installs (Community Applications custom templates), place them in the local templates folder on the Unraid host:

```
/boot/config/plugins/dockerMan/templates-user/
```

After copying the file(s) there, open Community Applications -> Template Manager and your custom templates will show up for import/edit.



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


