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
| **PostgreSQL** | ✅ | ✅ SQL | ✅ | Full CRUD, column types, FK relationships |
| **MongoDB** | ✅ | ✅ MQL | ✅ | Document browser, nested field inference |
| **ClickHouse** | ✅ | ✅ SQL | ✅ | Columnar analytics, append-only write model |
| **Redis** | ✅ | ✅ Commands | — | Key browser by pattern, TTL, type badges, flush |

### General Features
- **Multi-DB Switcher** — toggle between saved connections from the header without disconnecting
- **Schema Visualization** — interactive ER diagrams with PK/FK relationships (PostgreSQL, MongoDB, ClickHouse)
- **Query Editor** — Monaco-powered editor with syntax highlighting for SQL, MQL, and Redis commands
- **Redis Cache Browser** — scan keys by pattern, view type-colored badges (string/hash/list/set/zset/stream), TTL countdown, memory usage per key
- **Flush Operations** — Flush DB or Flush All directly from the Redis sidebar/toolbar (with confirmation)
- **Inline Data Editing** — double-click any cell to edit values in-place
- **Read-Only Mode** — server-side enforcement prevents accidental writes to production databases
- **Connection Management** — save, rename, and switch between multiple database connections
- **Resizable Sidebar** — drag to adjust the table/key browser width
- **Dark / Light / System Theme** — adapts to your OS preference
- **Docker Support** — optimised multi-stage image (~90–100 MB)

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

The multi-stage Dockerfile produces a lean Alpine image (~90–100 MB) by:
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
| **Data Tab** | Click a table/key pattern in the sidebar to browse data. Supports pagination, sorting, and inline editing. |
| **Query Tab** | Write and execute SQL (PostgreSQL/ClickHouse), MongoDB queries (JSON), or Redis commands. |
| **Schema Tab** | Available for PostgreSQL, MongoDB, and ClickHouse. Shows interactive ER diagram. |
| **Redis Cache** | Browse keys grouped by pattern (`user:*`), see type, TTL, memory. Flush individual DB or entire Redis instance. |
| **Multi-DB Switcher** | Click the connection badge in the header to switch between saved databases instantly. |
| **Read-Only Toggle** | Enable in the header to block all write operations (enforced server-side). |
| **Theme Toggle** | Sun/moon icon in the header to switch light, dark, or system theme. |

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
- [x] Docker image (~90–100 MB)
- [x] Connection management (save, rename, delete)
- [ ] MySQL / MariaDB support
- [ ] SQLite support
- [ ] Export data to CSV / JSON
- [ ] Saved queries
- [ ] Query history persistence
- [ ] SSH tunnel support
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
  Made with ❤️ by <a href="https://github.com/rutvikraut2001">Rutvik</a>
</p>
<p align="center">
  © 2025 DBPilot. MIT License.
</p>
