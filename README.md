# RT MCP Server

A TypeScript MCP server that provides read-only access to RT (Request Tracker) via the REST2 API. This Model Context Protocol (MCP) server allows Large Language Models to search for tickets, query ticket information, retrieve correspondence, download attachments, and explore ticket hierarchies.

## Features

- **Read-only access** to RT tickets, correspondence, and attachments
- **Token-based authentication** via RT REST2 API
- **Command-line & environment variable configuration**
- **Five main tools**:
  - `search_tickets` - Search for tickets using simple query syntax
  - `get_ticket` - Retrieve complete ticket information
  - `get_ticket_correspondence` - Get ticket correspondence grouped by transaction with inline text and file metadata
  - `get_attachment` - Download any attachment by ID with base64-encoded content
  - `get_ticket_hierarchy` - Build ticket parent/child relationship trees
- **STDIO transport** for seamless integration with MCP clients
- **TypeScript** for type safety and better developer experience
- **Easy deployment** with npm/npx

## Installation

### Requirements

- Node.js ≥ v18.0.0
- RT authentication token (create via Settings > Auth Tokens in RT web interface)

### MCP Clients

<details>
<summary><b>Claude Code</b></summary>

#### Using Command Line (Recommended)

**macOS/Linux:**
```bash
claude mcp add rt -- npx -y rt-mcp-server --api-token YOUR_RT_TOKEN --url https://rt.example.com/REST/2.0
```

**Windows:**
```bash
claude mcp add rt -- cmd /c npx -y rt-mcp-server --api-token YOUR_RT_TOKEN --url https://rt.example.com/REST/2.0
```

#### Manual Configuration

Edit your Claude Code MCP configuration file and add:

```json
{
  "mcpServers": {
    "rt": {
      "command": "npx",
      "args": [
        "-y",
        "rt-mcp-server",
        "--api-token",
        "YOUR_RT_TOKEN",
        "--url",
        "https://rt.example.com/REST/2.0"
      ]
    }
  }
}
```

</details>

<details>
<summary><b>Claude Desktop</b></summary>

#### Option 1: UI Method

1. Open Claude Desktop
2. Navigate to **Settings** → **Developer** → **Edit Config**
3. Add the RT MCP server configuration

#### Option 2: Configuration File

Edit `claude_desktop_config.json` (location varies by OS):
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

**macOS/Linux configuration:**

```json
{
  "mcpServers": {
    "rt": {
      "command": "npx",
      "args": [
        "-y",
        "rt-mcp-server",
        "--api-token",
        "YOUR_RT_TOKEN",
        "--url",
        "https://rt.example.com/REST/2.0"
      ]
    }
  }
}
```

**Windows configuration:**

```json
{
  "mcpServers": {
    "rt": {
      "command": "cmd",
      "args": [
        "/c",
        "npx",
        "-y",
        "rt-mcp-server",
        "--api-token",
        "YOUR_RT_TOKEN",
        "--url",
        "https://rt.example.com/REST/2.0"
      ]
    }
  }
}
```

Restart Claude Desktop after saving.

</details>

<details>
<summary><b>Gemini CLI</b></summary>

#### Using Command Line (Recommended)

```bash
gemini mcp add rt npx -y rt-mcp-server --api-token YOUR_RT_TOKEN --url https://rt.example.com/REST/2.0
```

#### Manual Configuration

Edit the Gemini settings file at `~/.gemini/settings.json` and add the RT MCP server to the `mcpServers` object:

```json
{
  "mcpServers": {
    "rt": {
      "command": "npx",
      "args": [
        "-y",
        "rt-mcp-server",
        "--api-token",
        "YOUR_RT_TOKEN",
        "--url",
        "https://rt.example.com/REST/2.0"
      ]
    }
  }
}
```

</details>

<details>
<summary><b>OpenAI Codex</b></summary>

#### Using Command Line (Recommended)

```bash
codex mcp add rt npx -y rt-mcp-server --api-token YOUR_RT_TOKEN --url https://rt.example.com/REST/2.0
```

#### Manual Configuration

Add the RT MCP server to your OpenAI Codex configuration using TOML format:

```toml
[mcp_servers.rt]
command = "npx"
args = [
  "-y",
  "rt-mcp-server",
  "--api-token",
  "YOUR_RT_TOKEN",
  "--url",
  "https://rt.example.com/REST/2.0"
]
```

</details>

<details>
<summary><b>LangChain / LangGraph</b></summary>

Use the MCP toolkit to integrate RT:

```python
from langchain_mcp import MCPToolkit

rt_toolkit = MCPToolkit(
    server_params={
        "command": "npx",
        "args": [
            "-y",
            "rt-mcp-server",
            "--api-token",
            "YOUR_RT_TOKEN",
            "--url",
            "https://rt.example.com/REST/2.0"
        ]
    }
)

tools = rt_toolkit.get_tools()
```

</details>

### Local Development Installation

If you want to develop or modify the server:

```bash
# Clone the repository
git clone <repository-url>
cd rt-mcp

# Install dependencies
npm install

# Build the project
npm run build

# Test it
node dist/index.js --api-token "YOUR_RT_TOKEN" --url "https://rt.example.com/REST/2.0"
```

## Configuration

The server supports configuration via command-line arguments or environment variables.

### Command-Line Arguments (Recommended)
- `--api-token` - Your RT authentication token
- `--url` - RT server base URL (required)

### Environment Variables (Alternative)
- `RT_TOKEN` - Your RT authentication token
- `RT_BASE_URL` - RT server base URL

**Priority:** Command-line arguments override environment variables.

## Usage with MCP Clients

After installing the RT MCP server in your preferred MCP client (see Installation section above), you can interact with RT tickets using natural language.

## Usage Examples

### Example 1: Searching for Tickets

Ask your MCP-enabled LLM:
> "Find all tickets about database errors"

The LLM will use `search_tickets(query="database errors")` to find matching tickets and display a summary of results.

### Example 2: Checking Ticket Status

Ask your MCP-enabled LLM:
> "What is the status of RT ticket 12345?"

The LLM will use `get_ticket(12345)` to fetch the ticket details and report the status, owner, priority, and other relevant information.

### Example 3: Reading Ticket Correspondence

Ask your MCP-enabled LLM:
> "Show me all the comments and correspondence from RT ticket 67890"

The LLM will use `get_ticket_correspondence(67890)` to retrieve all correspondence grouped by transaction, including inline text messages and file attachment metadata.

### Example 4: Downloading Attachments

Ask your MCP-enabled LLM:
> "Download the PDF receipt from RT ticket 67890"

The LLM will use `get_ticket_correspondence(67890)` to find attachment IDs, then `get_attachment(attachment_id)` to download the specific file with base64-encoded content.

### Example 5: Exploring Ticket Hierarchies

Ask your MCP-enabled LLM:
> "Show me the parent and child tickets for RT ticket 54321"

The LLM will use `get_ticket_hierarchy(54321, recursive=True)` to build the complete relationship tree showing all related tickets.

## Available Tools

### `search_tickets(query: string, limit?: number)`

Searches for tickets using simple query syntax that matches across ticket subject, content, and other fields.

**Parameters:**
- `query` - Simple search query text (e.g., "bug in login", "database error")
- `limit` - Maximum number of results to return (default 20, max 100)

**Example:**
```json
{
  "query": "database error",
  "limit": 10
}
```

**Returns:**
```json
{
  "total": 45,
  "count": 10,
  "limit": 10,
  "tickets": [
    {
      "id": 12345,
      "subject": "Database connection error on production",
      "status": "open",
      "queue": "Engineering",
      "owner": "john.doe",
      "created": "2024-01-15T10:30:00Z"
    }
  ]
}
```

### `get_ticket(ticket_id: number)`

Retrieves complete ticket information including:
- Basic info: ID, type, subject, status, queue
- People: owner, creator, requestors, CC, AdminCC
- Dates: created, started, resolved, last updated
- Time tracking: worked, estimated, left

**Example:**
```json
{
  "ticket_id": 12345
}
```

**Returns:**
```json
{
  "id": 12345,
  "subject": "Example ticket",
  "status": "open",
  "queue": "General",
  "owner": "username",
  "creator": "requester@example.com",
  "created": "2024-01-15T10:30:00Z"
}
```

### `get_ticket_correspondence(ticket_id: number)`

Retrieves all correspondence from a ticket, grouped by transaction. Each transaction may contain:
- Inline text messages (user's typed message)
- File attachments (with metadata only)

**Example:**
```json
{
  "ticket_id": 12345
}
```

**Returns:**
```json
{
  "ticket_id": 12345,
  "total_attachments": 5,
  "correspondence": [
    {
      "transaction_id": "100",
      "creator": "user@example.com",
      "created": "2024-01-15T10:35:00Z",
      "message": "This is the user's typed message...",
      "attachments": [
        {
          "id": 67890,
          "filename": "document.pdf",
          "content_type": "application/pdf",
          "size": "42.0 KB"
        }
      ]
    }
  ]
}
```

### `get_attachment(attachment_id: number)`

Downloads a specific attachment by ID, returning base64-encoded content for any file type.

**Example:**
```json
{
  "attachment_id": 67890
}
```

**Returns:**
```json
{
  "attachment_id": 67890,
  "filename": "document.pdf",
  "content_type": "application/pdf",
  "size": "42.0 KB",
  "content_base64": "JVBERi0xLjQK...",
  "created": "2024-01-15T10:35:00Z",
  "creator": "user@example.com"
}
```

### `get_ticket_hierarchy(ticket_id: number, recursive?: boolean)`

Retrieves the parent/child relationship tree for a ticket.

**Parameters:**
- `ticket_id` - The RT ticket ID
- `recursive` - If true, fetches complete tree; if false, only immediate relationships (default: true)

**Example:**
```json
{
  "ticket_id": 12345,
  "recursive": true
}
```

**Returns:**
```json
{
  "ticket_id": 12345,
  "recursive": true,
  "tickets_fetched": 10,
  "hierarchy": {
    "id": 12345,
    "subject": "Main ticket",
    "status": "open",
    "parents": {
      "12340": {
        "id": 12340,
        "subject": "Parent ticket"
      }
    },
    "children": {
      "12350": {
        "id": 12350,
        "subject": "Child ticket"
      }
    }
  }
}
```

## How It Works

1. **Configuration**: Parses command-line arguments (or reads environment variables) for RT URL and authentication token
2. **Authentication**: Uses token-based auth with RT REST2 API for all requests
3. **HTTP Client**: Uses native `fetch` API for async HTTP requests to RT REST2 API
4. **Error Handling**: Returns error information as objects rather than throwing exceptions
5. **MCP Protocol**: Implements MCP server using `@modelcontextprotocol/sdk` with STDIO transport
6. **Type Safety**: Full TypeScript type checking for reliability

## API Endpoints Used

The server interacts with these RT REST2 endpoints:
- `GET /tickets?simple=1;query={query};per_page={limit}` - Search tickets using simple query syntax
- `GET /ticket/{id}` - Retrieve ticket information
- `GET /ticket/{id}/attachments` - List all attachments for a ticket
- `GET /attachment/{id}` - Retrieve individual attachment content (base64-encoded)

## Documentation

- [RT REST2 API Documentation](https://docs.bestpractical.com/rt/5.0.7/RT/REST2.html) - Official RT REST2 API reference
- [Model Context Protocol](https://modelcontextprotocol.io) - MCP specification

## Development

### Building

```bash
# Install dependencies
npm install

# Build TypeScript to JavaScript
npm run build

# Watch mode (auto-rebuild on changes)
npm run dev
```

### Project Structure

```
rt-mcp/
├── src/
│   └── index.ts          # Main MCP server implementation
├── dist/                 # Compiled JavaScript (generated)
├── package.json          # Node.js dependencies and scripts
├── tsconfig.json         # TypeScript configuration
├── .gitignore            # Git ignore rules
├── README.md             # This file
└── CLAUDE.md             # Guide for Claude Code
```

### Running Tests

```bash
# Run the built server with test credentials
node dist/index.js --api-token "test-token" --url "https://rt.example.com/REST/2.0"
```

## Common Workflows

### Reading Ticket Information

Simply ask Claude in natural language:
- "What's the status of RT ticket 12345?"
- "Who is assigned to ticket 67890?"
- "When was ticket 11111 created and last updated?"
- "Show me the custom fields for ticket 22222"

### Analyzing Ticket Discussions

Ask Claude to summarize or analyze:
- "Read all comments from RT ticket 33333 and summarize the issue"
- "What are the main discussion points in ticket 44444?"
- "Extract action items from the conversation in ticket 55555"
- "Translate the technical discussion in ticket 66666 to non-technical language"

### Batch Operations

Ask Claude to process multiple tickets:
- "Compare the status of tickets 100, 101, and 102"
- "Show me a table of ticket 200, 201, 202 with status, owner, and priority"
- "Check if any of tickets 300-305 mention the word 'urgent' in their attachments"

## Limitations

- **Read-only**: No ticket creation, updates, or deletion capabilities
- **Simple search only**: Uses RT's simple search syntax (not full TicketSQL query language)
- **No transaction history**: Does not expose complete ticket history/transactions (only correspondence)
- **Single ticket at a time**: Each tool call fetches one ticket (LLM can call multiple times for batch operations)
- **File size**: Large attachments may take time to download depending on RT server performance
- **Search result limit**: Maximum 100 tickets per search query (RT API limitation)

## Troubleshooting

### Module Not Found Error

If you see module errors during build:
```bash
# Make sure dependencies are installed
npm install
# Rebuild the project
npm run build
```

### Authentication Errors

If you see HTTP 401 or 403 errors:
- Verify your RT token is correct
- Check the token hasn't expired
- Ensure your RT user has permissions to access tickets
- Verify the RT server URL is correct

### Connection Errors

If you see connection timeout or refused errors:
- Check the RT server URL (should include `/REST/2.0`)
- Verify the server is accessible from your network
- Ensure HTTPS is being used

### TypeScript Build Errors

If you encounter TypeScript compilation errors:
- Check that you're using Node.js ≥18.0.0
- Ensure all dependencies are installed: `npm install`
- Try cleaning and rebuilding: `npm run clean && npm run build`

## Security Notes

- Store `RT_TOKEN` securely (environment variables, secrets manager, etc.)
- Never commit tokens to version control (`.gitignore` excludes `token.txt` and `.env` files)
- The server will fail fast if `RT_TOKEN` is not provided
- All communication with RT should use HTTPS
- Command-line tokens may be visible in process lists - prefer environment variables in production

## Contributing

When extending this server:
- Follow TypeScript best practices
- Use async/await pattern consistently
- Return error objects instead of throwing exceptions
- Update tool schemas for new functionality
- Test with actual RT instance before committing
- Run `npm run build` after making changes
