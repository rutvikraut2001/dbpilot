# DBPilot

A modern, open-source database studio for developers. Explore schemas, browse data, and run queries across multiple databases with a beautiful, intuitive interface.

![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)
![License](https://img.shields.io/badge/License-MIT-green)

## Quick Start

### Option 1: Docker (Recommended)

```bash
# Clone and run with Docker
git clone https://github.com/rutvikraut2001/dbpilot.git
cd db-studio
docker compose up -d
```

Open [http://localhost:3030](http://localhost:3030) in your browser.

**With sample databases for testing:**
```bash
docker compose --profile with-db up -d
```

Then connect to:
- PostgreSQL: `postgresql://postgres:postgres@postgres:5432/testdb`
- MongoDB: `mongodb://mongo:mongo@mongodb:27017`

### Option 2: Local Development

```bash
git clone https://github.com/rutvikraut2001/dbpilot.git
cd db-studio
npm install
npm run dev
```

## Features

- **Multi-Database Support** - Connect to PostgreSQL and MongoDB (more coming soon)
- **Schema Visualization** - Interactive ER diagrams powered by React Flow
- **Data Browser** - Browse, search, and paginate through your data
- **Query Editor** - Monaco-powered SQL/NoSQL editor with syntax highlighting
- **Dark/Light Theme** - Beautiful UI that adapts to your preference
- **Read-Only Mode** - Production-safe mode to prevent accidental writes
- **Connection Management** - Save and manage multiple database connections
- **Resizable Sidebar** - Adjust sidebar width to your preference
- **Docker Support** - Easy deployment with Docker and docker-compose

## Screenshots

<details>
<summary>View Screenshots</summary>

### Connection Page
Connect to your databases with a simple, intuitive interface.

### Data Browser
Browse tables and collections with pagination, search, and filtering.

### Schema Viewer
Visualize your database schema with interactive ER diagrams.

### Query Editor
Write and execute queries with syntax highlighting and results view.

</details>

## Tech Stack

- **Framework**: [Next.js 16](https://nextjs.org/) (App Router)
- **Language**: [TypeScript](https://www.typescriptlang.org/)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/)
- **UI Components**: [shadcn/ui](https://ui.shadcn.com/)
- **State Management**: [Zustand](https://zustand-demo.pmnd.rs/)
- **Schema Visualization**: [React Flow](https://reactflow.dev/)
- **Query Editor**: [Monaco Editor](https://microsoft.github.io/monaco-editor/)
- **Database Drivers**: [node-postgres](https://node-postgres.com/), [MongoDB Node Driver](https://www.mongodb.com/docs/drivers/node/current/)

## Getting Started

### Prerequisites

- Node.js 18+
- npm, yarn, or pnpm
- PostgreSQL and/or MongoDB instance to connect to

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/rutvikraut2001/dbpilot.git
   cd dbpilot
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Run the development server**
   ```bash
   npm run dev
   ```

4. **Open your browser**

   Navigate to [http://localhost:3000](http://localhost:3000)

### Production Build

```bash
npm run build
npm start
```


## Usage

### Connecting to a Database

1. Open the application in your browser
2. Select your database type (PostgreSQL or MongoDB)
3. Enter a connection name (for your reference)
4. Enter the connection string:
   - **PostgreSQL**: `postgresql://user:password@host:port/database`
   - **MongoDB**: `mongodb://user:password@host:port/database`
5. Click "Connect"

### Connection String Examples

**PostgreSQL**
```
postgresql://postgres:password@localhost:5432/mydb
postgresql://user:pass@localhost:5432/mydb?schema=public
```

**MongoDB**
```
mongodb://localhost:27017/mydb
mongodb://user:pass@localhost:27017/mydb?authSource=admin
```

### Features Guide

| Feature | Description |
|---------|-------------|
| **Data Tab** | Browse table/collection data with pagination |
| **Query Tab** | Write and execute raw SQL or MongoDB queries |
| **Schema Tab** | Visualize database schema with ER diagrams |
| **Read-Only Toggle** | Enable to prevent write operations |
| **Theme Toggle** | Switch between light, dark, or system theme |

## Updating Your Docker Image

After making changes to your code, here's how to update your Docker Hub image:

**1. Rebuild the image:**
```bash
docker build -t 30rutvik/db-studio:latest .
```

**2. Push to Docker Hub:**
```bash
docker push 30rutvik/db-studio:latest
```

**3. (Optional) Tag with version:**
```bash
docker tag 30rutvik/db-studio:latest 30rutvik/db-studio:v1.1
docker push 30rutvik/db-studio:v1.1
```

**For users pulling your updated image:**
```bash
docker pull 30rutvik/db-studio:latest
docker compose down
docker compose up -d
```

The `:latest` tag will always point to your most recent push. Users need to explicitly pull the new image since Docker caches images locally.

## Roadmap

- [ ] MySQL support
- [ ] SQLite support
- [ ] Oracle Database support
- [ ] DynamoDB support
- [ ] Query history
- [ ] Export data (CSV, JSON)
- [ ] Table structure editing
- [ ] Index management
- [ ] Saved queries
- [ ] SSH tunneling
- [x] Docker image

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [Prisma Studio](https://www.prisma.io/studio) - Inspiration for the project
- [shadcn/ui](https://ui.shadcn.com/) - Beautiful UI components
- [React Flow](https://reactflow.dev/) - Schema visualization
- [Monaco Editor](https://microsoft.github.io/monaco-editor/) - Query editor

---

## Author

**Rutvik** - Creator & Maintainer

- GitHub: [@rutvikraut2001](https://github.com/rutvikraut2001)
- Docker Hub: [30rutvik/db-studio](https://hub.docker.com/r/30rutvik/db-studio)

---

<p align="center">
  Made with ❤️ by <a href="https://github.com/rutvikraut2001">Rutvik</a>
</p>
<p align="center">
  © 2025 DB Studio. MIT License.
</p>
