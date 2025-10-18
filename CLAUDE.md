# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a TypeScript MCP server that provides read-only access to the RT (Request Tracker) REST2 API. It exposes RT tickets, correspondence, and attachments through the Model Context Protocol (MCP), allowing LLMs to search for tickets, query ticket information, retrieve correspondence with inline text, and download attachments.

**Key Technologies:**
- TypeScript (Node.js ≥18.0.0) - Primary language
- `@modelcontextprotocol/sdk` - Official MCP SDK for TypeScript
- Native `fetch` API - HTTP client for RT REST2 API calls
- `commander` - CLI argument parsing
- STDIO transport for MCP communication

## Architecture

The codebase consists of a single MCP server (`src/index.ts`) that:

1. **Authenticates via token**: Uses `RT_TOKEN` environment variable or CLI argument with RT's token-based auth
2. **Provides five main tools**:
   - `search_tickets()` - Searches for tickets using simple query syntax, returns summary information for matching tickets
   - `get_ticket()` - Fetches complete ticket metadata (subject, status, queue, owner, dates, priority, custom fields, etc.)
   - `get_ticket_correspondence()` - Retrieves ticket correspondence grouped by transaction, showing inline text messages and file attachment metadata
   - `get_attachment()` - Downloads individual attachments by ID, returning base64-encoded content with metadata for any file type
   - `get_ticket_hierarchy()` - Builds ticket hierarchy tree showing parent/child relationships, with optional recursive fetching
3. **Makes authenticated HTTP requests**: The `makeRTRequest()` helper handles all API communication with proper headers and error handling

**Authentication Flow:**
- Token is read from `RT_TOKEN` environment variable or `--api-token` CLI argument at startup
- Server fails fast with clear error if token is missing
- Token is sent in `Authorization: token <TOKEN>` header for all requests

**Correspondence Processing:**
- Groups attachments by transaction ID to show related messages and files together
- Distinguishes inline text messages (no filename) from file attachments (has filename)
- Displays full content for inline text messages after base64 decoding
- Shows metadata only for file attachments (ID, filename, content type, size)
- Checks `X-RT-Original-Content-Type` header for text types converted to `application/octet-stream`
- Extracts creator ID and timestamp from attachment data

**Attachment Download:**
- Downloads individual attachments by ID via `/attachment/{id}` endpoint
- Returns base64-encoded content for any file type (PDFs, images, spreadsheets, etc.)
- Provides complete metadata: filename, content type, size, creator, timestamp
- Human-readable file size formatting (bytes, KB, MB)
- Handles all MIME types, not just text files

**Hierarchy Processing:**
- Extracts parent/child relationships from `_hyperlinks` field in ticket responses
- Supports recursive fetching to build complete ancestor/descendant tree
- Includes cycle detection to avoid infinite loops
- Returns nested object structure with ticket details at each level

## Configuration

The server supports two configuration methods with priority: command-line arguments > environment variables > defaults.

### Command-Line Arguments (Recommended)
- `--api-token` - RT authentication token (create via Settings > Auth Tokens in RT web interface)
- `--url` - RT server base URL (default: `https://rt.example.com/REST/2.0`)

### Environment Variables (Fallback)
- `RT_TOKEN` - RT authentication token
- `RT_BASE_URL` - RT server base URL

## Running the Server

```bash
# Install dependencies
npm install

# Build the TypeScript code
npm run build

# Run with command-line arguments (recommended)
node dist/index.js --api-token "your-token-here" --url "https://rt.example.com/REST/2.0"

# Or with environment variables
export RT_TOKEN="your-token-here"
export RT_BASE_URL="https://rt.example.com/REST/2.0"  # optional
node dist/index.js
```

**MCP Client Configuration (using npx - recommended):**
```json
{
  "mcpServers": {
    "rt": {
      "command": "npx",
      "args": [
        "-y",
        "rt-mcp-server",
        "--api-token", "your-token-here",
        "--url", "https://rt.example.com/REST/2.0"
      ]
    }
  }
}
```

**MCP Client Configuration (local development):**
```json
{
  "mcpServers": {
    "rt": {
      "command": "node",
      "args": [
        "/path/to/rt-mcp/dist/index.js",
        "--api-token", "your-token-here",
        "--url", "https://rt.example.com/REST/2.0"
      ]
    }
  }
}
```

**MCP Client Configuration (environment variables):**
```json
{
  "mcpServers": {
    "rt": {
      "command": "npx",
      "args": ["-y", "rt-mcp-server"],
      "env": {
        "RT_TOKEN": "your-token-here",
        "RT_BASE_URL": "https://rt.example.com/REST/2.0"
      }
    }
  }
}
```

## API Endpoints Used

The server uses these RT REST2 API endpoints:
- `GET /tickets?simple=1;query={query};per_page={limit}` - Search tickets using simple query syntax
- `GET /ticket/{id}` - Retrieve ticket information (includes `_hyperlinks` with parent/child relationships)
- `GET /ticket/{id}/attachments` - List ticket attachments
- `GET /attachment/{id}` - Retrieve individual attachment (with base64-encoded content)

## Documentation

- RT REST2 API: https://docs.bestpractical.com/rt/5.0.7/RT/REST2.html
- Model Context Protocol: https://modelcontextprotocol.io
- MCP TypeScript SDK: https://github.com/modelcontextprotocol/typescript-sdk

## Important Implementation Details

**Configuration Parsing:**
- `parseArgs()` uses `commander` to parse `--url` and `--api-token` arguments
- `configure()` sets global `RT_BASE_URL` and `RT_TOKEN` with priority: CLI args > env vars > defaults
- Server fails fast with clear error message if token is not provided via any method

**MCP Server Setup:**
- Server is created with `@modelcontextprotocol/sdk/server`
- Tool list handler registered with `ListToolsRequestSchema`
- Tool call handler registered with `CallToolRequestSchema`
- STDIO transport used for communication with MCP clients

**Error Handling:**
- HTTP errors are caught and returned as `{"error": "...", ...}` objects
- Network/decode errors are caught and returned in error objects
- All tools return objects (never throw exceptions to client)
- Tool call handler wraps errors in `{ isError: true }` response

**Read-Only Design:**
This server only implements GET operations - no ticket creation, updates, or deletions.

**TypeScript Features:**
- Full type safety with TypeScript compiler
- Async/await pattern throughout
- Native fetch API (Node.js ≥18 required)
- ESM modules (type: "module" in package.json)

## Project Structure

```
rt-mcp/
├── src/
│   └── index.ts        # Main MCP server (single file implementation)
├── dist/               # Compiled JavaScript (generated by tsc)
├── package.json        # npm dependencies and scripts
├── tsconfig.json       # TypeScript compiler configuration
├── .gitignore          # Excludes node_modules, dist, etc.
├── README.md           # User-facing documentation
└── CLAUDE.md           # This file
```

## Development Workflow

### Building the Project

```bash
# Install dependencies
npm install

# Build TypeScript to JavaScript
npm run build

# Watch mode (auto-rebuild on changes)
npm run dev

# Clean build artifacts
npm run clean
```

### Adding New Tools

When adding a new tool to the MCP server:

1. **Define the tool schema** in the `tools` array
2. **Implement the tool function** with async/await pattern
3. **Return objects**, never throw exceptions to client
4. **Add case to tool call handler** in `CallToolRequestSchema` handler
5. **Update documentation** with clear descriptions and examples
6. **Use `makeRTRequest()`** helper for RT API calls

Example:
```typescript
// 1. Add to tools array
const tools: Tool[] = [
  // ... existing tools
  {
    name: "get_ticket_history",
    description: "Get transaction history for a ticket.",
    inputSchema: {
      type: "object",
      properties: {
        ticket_id: {
          type: "number",
          description: "The RT ticket ID number",
        },
      },
      required: ["ticket_id"],
    },
  },
];

// 2. Implement the tool function
async function getTicketHistory(ticketId: number): Promise<any> {
  try {
    const data = await makeRTRequest(`/ticket/${ticketId}/history`);
    return { ticket_id: ticketId, history: data };
  } catch (error: any) {
    return {
      error: error.message || String(error),
      ticket_id: ticketId,
    };
  }
}

// 3. Add to tool call handler
case "get_ticket_history": {
  const { ticket_id } = args as { ticket_id: number };
  const result = await getTicketHistory(ticket_id);
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(result, null, 2),
      },
    ],
  };
}
```

### Modifying Configuration

The configuration is parsed in the `main()` function:
1. `parseArgs()` - defines and parses CLI arguments using `commander`
2. `configure()` - sets global `RT_BASE_URL` and `RT_TOKEN`
3. Server creation and tool registration
4. `server.connect(transport)` - starts the server with STDIO transport

To add new config options:
- Add option in `parseArgs()` with `.option()`
- Process in `configure()`
- Use in tool functions

### Testing Changes

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Run the server with test credentials
node dist/index.js --api-token "test-token" --url "https://rt.example.com/REST/2.0"

# Test with MCP client (e.g., Claude Code)
# Add to MCP client config and interact via Claude Code
```

## Common Tasks

### Updating Dependencies

```bash
# Add new dependency
npm install package-name

# Add dev dependency
npm install --save-dev package-name

# Update all dependencies
npm update

# Check for outdated packages
npm outdated
```

### Debugging

**Enable MCP protocol logging:**
- MCP SDK logs to stderr by default
- Check MCP client's debug output for protocol messages

**Check HTTP requests:**
- Add `console.error()` calls in `makeRTRequest()` (output goes to stderr)
- Inspect the full response structure

**Test individual functions:**
```typescript
// Add to bottom of src/index.ts for testing
async function test() {
  const result = await getTicket(12345);
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv.includes("--test")) {
  test().then(() => process.exit(0)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
```

Then run: `node dist/index.js --test`

## Extending the Server

### Adding Search Capability

The server already includes `search_tickets()` tool with simple search support.

To enhance search:
1. Add TicketSQL query support (more powerful than simple search)
2. Handle pagination with `page` and `per_page` parameters
3. Add sorting options
4. Filter by custom fields

### Adding Write Operations

**Important:** If adding write operations (POST/PUT/DELETE):
- Update server name/description to remove "read-only"
- Add appropriate safety checks and confirmations
- Consider authentication/authorization requirements
- Test thoroughly with non-production RT instance first
- Update all documentation
- Add confirmation prompts for destructive operations

### Supporting Binary Attachments

Binary attachments are already supported via the `get_attachment()` tool:
- Downloads any file type (PDFs, images, spreadsheets, etc.)
- Returns base64-encoded content that can be decoded and saved
- Includes complete metadata (filename, MIME type, size, creator, timestamp)
- No file size limitations beyond RT server constraints

## TypeScript Best Practices

1. **Use explicit types**: Avoid `any` where possible
2. **Async/await**: Use consistently for all async operations
3. **Error handling**: Always catch and return error objects
4. **Null checks**: Check for null/undefined before accessing properties
5. **Immutability**: Prefer const over let, avoid mutating function parameters
6. **ESM imports**: Use `import` instead of `require`
7. **Type guards**: Use type guards for runtime type checking

## Debugging Tips

1. **"Module not found" errors**: Run `npm install` to install dependencies
2. **Build errors**: Run `npm run clean && npm run build` to clean rebuild
3. **Authentication failures**: Check token validity and RT user permissions
4. **Empty responses**: Verify RT endpoint URLs match API version
5. **Base64 decode errors**: Some attachments may not be UTF-8 text
6. **MCP client not seeing tools**: Check STDIO transport is working, verify JSON output
7. **TypeScript errors**: Check `tsconfig.json` settings and Node.js version (≥18)

## Related Documentation

- MCP TypeScript SDK: https://github.com/modelcontextprotocol/typescript-sdk
- RT REST2 API reference: https://docs.bestpractical.com/rt/5.0.7/RT/REST2.html
- MCP specification: https://modelcontextprotocol.io
- TypeScript documentation: https://www.typescriptlang.org/docs/
- Node.js fetch API: https://nodejs.org/api/globals.html#fetch
