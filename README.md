# DBPilot

A modern, open-source database studio for developers. Explore schemas, browse data, and run queries across multiple databases with a beautiful, intuitive interface.

![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)
![License](https://img.shields.io/badge/License-MIT-green)

## Features

- **Multi-Database Support** - Connect to PostgreSQL and MongoDB (more coming soon)
- **Schema Visualization** - Interactive ER diagrams powered by React Flow
- **Data Browser** - Browse, search, and paginate through your data
- **Query Editor** - Monaco-powered SQL/NoSQL editor with syntax highlighting
- **Dark/Light Theme** - Beautiful UI that adapts to your preference
- **Read-Only Mode** - Production-safe mode to prevent accidental writes
- **Connection Management** - Save and manage multiple database connections

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
   git clone https://github.com/yourusername/dbpilot.git
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

## Project Structure

```
src/
├── app/
│   ├── api/           # API routes for database operations
│   │   ├── connect/   # Connection management
│   │   ├── data/      # CRUD operations
│   │   ├── query/     # Query execution
│   │   ├── schema/    # Schema & relationships
│   │   └── tables/    # Table listing
│   ├── studio/        # Main studio page
│   └── page.tsx       # Landing/connection page
├── components/
│   ├── connection/    # Connection form
│   ├── data-table/    # Data viewer component
│   ├── query-editor/  # Monaco editor wrapper
│   ├── schema-viewer/ # React Flow ER diagram
│   ├── sidebar/       # Table browser
│   └── ui/            # shadcn/ui components
└── lib/
    ├── adapters/      # Database adapters
    │   ├── types.ts   # Unified interfaces
    │   ├── postgres.ts
    │   ├── mongodb.ts
    │   └── factory.ts
    └── stores/        # Zustand stores
```

## Database Adapter Architecture

DBPilot uses a unified adapter pattern to support multiple databases:

```typescript
interface DatabaseAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getTables(): Promise<TableInfo[]>;
  getTableSchema(table: string): Promise<ColumnInfo[]>;
  getTableData(table: string, options?: QueryOptions): Promise<PaginatedResult>;
  executeQuery(query: string): Promise<QueryResult>;
  getRelationships(): Promise<Relationship[]>;
  // ... more methods
}
```

Adding a new database is as simple as implementing this interface.

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
- [ ] Docker image

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

<p align="center">
  Made with ❤️ by developers, for developers
</p>
