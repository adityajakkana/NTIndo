import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import sql from "mssql";
import "dotenv/config";

// Database configuration
const sqlConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: 'localhost',
  database: 'AdventureWorks2022',
  options: { encrypt: false, trustServerCertificate: true }
};

const server = new McpServer({
  name: "adventureworks-mcp",
  version: "1.0.0",
});

// Define the tool for the AI to call
server.tool(
  "query_database",
  "Execute a SQL SELECT query against the AdventureWorks database",
  { query: z.string().describe("The SQL SELECT statement to execute") },
  async ({ query }) => {
    // Safety check: only allow SELECT
    if (!query.trim().toUpperCase().startsWith("SELECT")) {
      return { content: [{ type: "text", text: "Error: Only SELECT queries are allowed." }] };
    }

    try {
      const pool = await sql.connect(sqlConfig);
      const result = await pool.query(query);
      return { content: [{ type: "text", text: JSON.stringify(result.recordset) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `SQL Error: ${err.message}` }] };
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);