# DBPilot

A modern, open-source database studio for developers. Explore schemas, browse data, and run queries across **PostgreSQL, MongoDB, ClickHouse, and Redis** with a beautiful, intuitive interface.

![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)
![License](https://img.shields.io/badge/License-MIT-green)

---

## Quick Start

### Option 1: Docker (Recommended)

```bash
git clone https://github.com/rutvikraut2001/dbpilot.git
cd dbpilot
docker compose up -d
```

Open [http://localhost:3030](http://localhost:3030) in your browser.

**With sample databases for testing:**
```bash
docker compose --profile with-db up -d
```

Then connect using:
| Database | Connection String |
|---|---|
| PostgreSQL | `postgresql://postgres:postgres@postgres:5432/testdb` |
| MongoDB | `mongodb://mongo:mongo@mongodb:27017` |
| ClickHouse | `clickhouse://default:clickhouse@clickhouse:8123/default` |
| Redis | `redis://redis:6379/0` |

### Option 2: Local Development

```bash
git clone https://github.com/rutvikraut2001/dbpilot.git
cd dbpilot
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Features

### Multi-Database Support
| Database | Browse Data | Run Queries | Schema / ER Diagram | Notes |
|---|---|---|---|---|
| **PostgreSQL** | CRUD | SQL | ER Diagram | Full CRUD, column types, FK relationships |
| **MongoDB** | CRUD | MQL | ER Diagram | Document browser, nested field inference |
| **ClickHouse** | Read + Append | SQL | ER Diagram | Columnar analytics, append-only write model |
| **Redis** | Key Browser | Commands | — | Key browser by pattern, TTL, type badges, flush |

### Data Browsing & Editing
- **Multi-Tab Data Viewer** — open multiple tables as tabs, switch between them like browser tabs
- **Smart Cell Display** — JSON expansion, boolean badges, UUID detection with click-to-copy
- **Double-Click Field Edit** — double-click any cell to edit just that field in a focused popup
- **Full Row Edit** — click the pencil icon for a pgAdmin-style dialog with all fields, dynamic sizing based on column count
- **Inline Copy** — hover any cell to copy its value; ID fields (UUIDs, ObjectIds) have persistent copy buttons
- **CSV Export** — export current table data to CSV from the toolbar
- **Column Resizing** — drag column borders to resize

### Connection & Diagnostics
- **Smart Connect** — auto-tries multiple connection strategies (localhost, 127.0.0.1, host.docker.internal, Unix socket)
- **SSH Tunneling** — connect through SSH with password or private key auth
- **Connection Diagnostics** — actionable error messages with suggestions when connections fail
- **Connection Health Monitoring** — background polling with auto-reconnect and status indicator
- **Multi-DB Switcher** — toggle between saved connections from the header without disconnecting
- **Localhost Fallback** — transparent retry with host.docker.internal for Docker environments

### Query & Schema
- **Query Editor** — Monaco-powered editor with syntax highlighting for SQL, MongoDB queries, and Redis commands
- **Schema Visualization** — interactive ER diagrams with PK/FK relationships, auto-layout, and export
- **Redis Cache Browser** — scan keys by pattern, view type badges, TTL countdown, memory usage per key
- **Flush Operations** — Flush DB or Flush All directly from the Redis sidebar/toolbar (with confirmation)

### UI & Experience
- **Aurora/Neon Theme** — modern gradient design with Space Grotesk + JetBrains Mono fonts
- **Dark / Light / System Theme** — adapts to your OS preference, toggle from any page
- **Read-Only Mode** — server-side enforcement prevents accidental writes to production databases
- **Resizable Sidebar** — drag to adjust the table/key browser width
- **Debounced Table Filter** — fast filtering in the sidebar with 200ms debounce
- **Skeleton Loading** — smooth loading states instead of spinners
- **Feedback System** — built-in feedback form accessible from the landing page

---

## Connection Strings

### PostgreSQL
```
postgresql://user:password@host:5432/database
postgresql://postgres:mypass@localhost:5432/mydb
postgresql://user:pass@db.example.com:5432/prod?schema=public
```

### MongoDB
```
mongodb://localhost:27017/mydb
mongodb://user:pass@localhost:27017/mydb?authSource=admin
mongodb+srv://user:pass@cluster.mongodb.net/mydb
```

### ClickHouse
```
clickhouse://default:password@localhost:8123/default
clickhouse://user:pass@clickhouse.example.com:8123/analytics
```

### Redis
```
redis://localhost:6379/0
redis://user:pass@redis.example.com:6379/0
redis://:password@localhost:6379/2
```

---

## Tech Stack

| Category | Technology |
|---|---|
| Framework | [Next.js 16](https://nextjs.org/) (App Router) |
| Language | [TypeScript 5](https://www.typescriptlang.org/) |
| Styling | [Tailwind CSS 4](https://tailwindcss.com/) |
| UI Components | [shadcn/ui](https://ui.shadcn.com/) + [Radix UI](https://radix-ui.com/) |
| State Management | [Zustand](https://zustand-demo.pmnd.rs/) |
| Schema Visualization | [React Flow / XY Flow](https://reactflow.dev/) |
| Query Editor | [Monaco Editor](https://microsoft.github.io/monaco-editor/) |
| Data Table | [TanStack Table v8](https://tanstack.com/table) |
| Fonts | [Space Grotesk](https://fonts.google.com/specimen/Space+Grotesk) + [JetBrains Mono](https://fonts.google.com/specimen/JetBrains+Mono) |
| SSH Tunneling | [ssh2](https://github.com/mscdex/ssh2) |
| PostgreSQL | [node-postgres (pg)](https://node-postgres.com/) |
| MongoDB | [MongoDB Node Driver](https://www.mongodb.com/docs/drivers/node/current/) |
| ClickHouse | [@clickhouse/client](https://github.com/ClickHouse/clickhouse-js) |
| Redis | [ioredis](https://github.com/redis/ioredis) |

---

## Getting Started (Local)

### Prerequisites
- Node.js 20+
- npm
- A running instance of any supported database to connect to

### Installation

```bash
# 1. Clone
git clone https://github.com/rutvikraut2001/dbpilot.git
cd dbpilot

# 2. Install dependencies
npm install

# 3. Start development server
npm run dev
```

Navigate to [http://localhost:3000](http://localhost:3000).

### Production Build
```bash
npm run build
npm start
```

---

## Docker

### Run with Docker Compose
```bash
# Production only
docker compose up -d

# With test databases (PostgreSQL, MongoDB, ClickHouse, Redis)
docker compose --profile with-db up -d
```

### Build the image manually
```bash
docker build -t db-studio .
```

The multi-stage Dockerfile produces a lean Alpine image (~90-100 MB) by:
- Using `output: standalone` to bundle only traced server dependencies
- Excluding build-time artifacts: TypeScript compiler, SWC compiler binaries, sharp/libvips image libraries
- Force-including packages with dynamic exports: `@clickhouse/client`

### Connect to databases on your host machine (Docker Desktop)
Use `host.docker.internal` instead of `localhost`:
```
postgresql://user:pass@host.docker.internal:5432/mydb
mongodb://user:pass@host.docker.internal:27017/mydb
redis://host.docker.internal:6379/0
clickhouse://user:pass@host.docker.internal:8123/default
```

### Updating your Docker Hub image
```bash
# Rebuild and push
docker build -t 30rutvik/db-studio:latest .
docker push 30rutvik/db-studio:latest

# Tag a specific version
docker tag 30rutvik/db-studio:latest 30rutvik/db-studio:v2.0
docker push 30rutvik/db-studio:v2.0

# Pull the updated image
docker pull 30rutvik/db-studio:latest
docker compose down && docker compose up -d
```

---

## Features Guide

| Feature | How to use |
|---|---|
| **Data Tab** | Click a table/key pattern in the sidebar to open it as a tab. Double-click any cell to edit that field. Use the pencil icon for full row editing. |
| **Multi-Tab Browsing** | Each table opens as a closeable tab. Switch between tables without losing context. FK clicks open related tables in new tabs. |
| **Query Tab** | Write and execute SQL (PostgreSQL/ClickHouse), MongoDB queries (JSON), or Redis commands. |
| **Schema Tab** | Available for PostgreSQL, MongoDB, and ClickHouse. Shows interactive ER diagram with export. |
| **Redis Cache** | Browse keys grouped by pattern (`user:*`), see type, TTL, memory. Flush individual DB or entire Redis instance. |
| **Multi-DB Switcher** | Click the connection badge in the header to switch between saved databases instantly. |
| **Read-Only Toggle** | Enable in the header to block all write operations (enforced server-side). |
| **Theme Toggle** | Sun/moon icon in the header to switch light, dark, or system theme. Available on both landing page and studio. |
| **SSH Tunnel** | Expand "Advanced" in the connection form to configure SSH tunneling with password or key auth. |
| **Feedback** | Click "Feedback" in the header to send suggestions or bug reports. |

---

## Roadmap

- [x] PostgreSQL support (full CRUD + schema ER)
- [x] MongoDB support (full CRUD + schema inference)
- [x] ClickHouse support (read + append writes)
- [x] Redis support (cache browser, TTL, Flush DB/All, Redis commands)
- [x] Multi-database switcher (switch connections without disconnecting)
- [x] Monaco query editor
- [x] Interactive ER diagram (React Flow)
- [x] Read-only mode (server-side enforcement)
- [x] Docker image (~90-100 MB)
- [x] Connection management (save, rename, delete)
- [x] SSH tunnel support
- [x] Connection diagnostics with actionable suggestions
- [x] Connection health monitoring with auto-reconnect
- [x] Multi-tab data browsing
- [x] Double-click single-field editing
- [x] Smart cell display (JSON, booleans, UUIDs, copy-on-hover)
- [x] CSV export
- [x] Dark/light/system theme with aurora design
- [ ] MySQL / MariaDB support
- [ ] SQLite support
- [ ] Saved queries
- [ ] Query history persistence
- [ ] Index management UI
- [ ] Table structure editing

---

## Contributing

Contributions are welcome!

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## License

MIT License — see the [LICENSE](LICENSE) file for details.

---

## Acknowledgments

- [Prisma Studio](https://www.prisma.io/studio) — Inspiration for the project
- [shadcn/ui](https://ui.shadcn.com/) — Beautiful UI components
- [React Flow](https://reactflow.dev/) — Schema visualization
- [Monaco Editor](https://microsoft.github.io/monaco-editor/) — Query editor

---

## Author

**Rutvik** — Creator & Maintainer

- GitHub: [@rutvikraut2001](https://github.com/rutvikraut2001)
- Docker Hub: [30rutvik/db-studio](https://hub.docker.com/r/30rutvik/db-studio)

---

<p align="center">
  Made with love by <a href="https://github.com/rutvikraut2001">Rutvik</a>
</p>
<p align="center">
  © 2025 DBPilot. MIT License.
</p>
