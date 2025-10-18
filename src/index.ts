#!/usr/bin/env node
/**
 * MCP server for RT (Request Tracker) REST2 API.
 * Provides read-only access to RT tickets, correspondence, and attachments.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { Command } from "commander";
import {
  configureRT,
  makeRTRequest,
  extractTicketRelationships,
  formatFileSize,
} from "./lib.js";

/**
 * Define MCP tools.
 */
const tools: Tool[] = [
  {
    name: "search_tickets",
    description:
      "Search for tickets using simple search syntax. Returns summary information for matching tickets.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: 'Simple search query text (e.g., "bug in login")',
        },
        limit: {
          type: "number",
          description:
            "Maximum number of results to return (default 20, max 100)",
          default: 20,
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_ticket",
    description:
      "Get complete ticket information by ticket ID, including subject, status, queue, owner, dates, priority, and custom fields.",
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
  {
    name: "get_ticket_correspondence",
    description:
      "Get ticket correspondence (comments and replies with attachments). Retrieves all correspondence entries grouped by transaction, showing inline text messages and file attachment metadata.",
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
  {
    name: "get_attachment",
    description:
      "Download a specific attachment by ID. Returns base64-encoded content with metadata for any file type.",
    inputSchema: {
      type: "object",
      properties: {
        attachment_id: {
          type: "number",
          description: "The RT attachment ID number",
        },
      },
      required: ["attachment_id"],
    },
  },
  {
    name: "get_ticket_hierarchy",
    description:
      "Get ticket hierarchy (parent/child relationships). Builds the complete hierarchy tree if recursive=true, or only immediate relationships if recursive=false.",
    inputSchema: {
      type: "object",
      properties: {
        ticket_id: {
          type: "number",
          description: "The RT ticket ID number",
        },
        recursive: {
          type: "boolean",
          description:
            "Whether to recursively fetch the entire hierarchy tree (default: true)",
          default: true,
        },
      },
      required: ["ticket_id"],
    },
  },
];

/**
 * Tool implementations.
 */
async function searchTickets(query: string, limit: number = 20): Promise<any> {
  try {
    // Validate limit
    if (limit < 1) limit = 1;
    if (limit > 100) limit = 100;

    // URL encode the query
    const encodedQuery = encodeURIComponent(query);

    // Request specific fields for summary information
    const fields = "Subject,Status,Queue,Owner,Created";
    const endpoint = `/tickets?simple=1;query=${encodedQuery};per_page=${limit};fields=${fields}`;
    const data = await makeRTRequest(endpoint);

    if (typeof data !== "object" || data === null) {
      return { error: "Unexpected response format", data };
    }

    const total = data.total || 0;
    const count = data.count || 0;
    const items = data.items || [];

    // Process each ticket to extract summary info
    const tickets = items.map((item: any) => {
      const ticket: any = {
        id: item.id,
        subject: item.Subject,
        status: item.Status,
      };

      // Extract Queue (might be object or string)
      const queue = item.Queue;
      if (typeof queue === "object" && queue !== null) {
        ticket.queue = queue.id || queue.Name;
      } else {
        ticket.queue = queue;
      }

      // Extract Owner (might be object or string)
      const owner = item.Owner;
      if (typeof owner === "object" && owner !== null) {
        ticket.owner = owner.id || owner.Name;
      } else {
        ticket.owner = owner;
      }

      ticket.created = item.Created;

      return ticket;
    });

    return {
      total,
      count,
      limit,
      tickets,
    };
  } catch (error: any) {
    return {
      error: error.message || String(error),
      query,
    };
  }
}

async function getTicket(ticketId: number): Promise<any> {
  try {
    const data = await makeRTRequest(`/ticket/${ticketId}`);

    if (typeof data !== "object" || data === null) {
      return { error: "Unexpected response format", data };
    }

    const ticketInfo = {
      id: data.id,
      type: data.Type,
      subject: data.Subject,
      status: data.Status,
      queue: data.Queue,
      owner: data.Owner,
      creator: data.Creator,
      requestors: data.Requestors || [],
      cc: data.Cc || [],
      admin_cc: data.AdminCc || [],
      created: data.Created,
      started: data.Started,
      resolved: data.Resolved,
      last_updated: data.LastUpdated,
      time_worked: data.TimeWorked,
      time_estimated: data.TimeEstimated,
      time_left: data.TimeLeft,
    };

    return ticketInfo;
  } catch (error: any) {
    return {
      error: error.message || String(error),
      ticket_id: ticketId,
    };
  }
}

async function getTicketCorrespondence(ticketId: number): Promise<any> {
  try {
    // Get list of attachments
    const attachmentsData = await makeRTRequest(
      `/ticket/${ticketId}/attachments`
    );

    if (typeof attachmentsData !== "object" || attachmentsData === null) {
      return {
        error: "Unexpected response format",
        ticket_id: ticketId,
        data: attachmentsData,
      };
    }

    const items = attachmentsData.items || [];
    const totalAttachments = items.length;

    // Fetch all attachments and group by transaction
    const transactionsMap = new Map<
      string,
      { attachments: any[]; creator: string | null; created: string | null }
    >();

    for (const attachmentInfo of items) {
      const attachmentId = attachmentInfo.id;

      // Fetch full attachment data
      const attachmentData = await makeRTRequest(`/attachment/${attachmentId}`);

      // Extract transaction ID
      const transactionIdObj = attachmentData.TransactionId;
      if (!transactionIdObj) continue;

      const transactionId =
        typeof transactionIdObj === "object"
          ? transactionIdObj.id
          : transactionIdObj;
      if (!transactionId) continue;

      const txId = String(transactionId);

      // Initialize transaction entry if needed
      if (!transactionsMap.has(txId)) {
        transactionsMap.set(txId, {
          attachments: [],
          creator: null,
          created: null,
        });
      }

      const transaction = transactionsMap.get(txId)!;

      // Extract creator and created (same for all attachments in transaction)
      if (!transaction.creator) {
        const creatorObj = attachmentData.Creator;
        if (creatorObj) {
          transaction.creator =
            typeof creatorObj === "object" ? creatorObj.id : creatorObj;
        }
        transaction.created = attachmentData.Created;
      }

      // Add attachment to transaction
      transaction.attachments.push(attachmentData);
    }

    // Process each transaction to build correspondence entries
    const correspondence = [];

    for (const [transactionId, transactionData] of transactionsMap.entries()) {
      const entry: any = {
        transaction_id: transactionId,
        creator: transactionData.creator,
        created: transactionData.created,
        message: null,
        attachments: [],
      };

      // Process each attachment in the transaction
      for (const attachmentData of transactionData.attachments) {
        let contentType = attachmentData.ContentType || "";
        const subject = (attachmentData.Subject || "").trim();

        // Skip multipart/mixed containers
        if (contentType === "multipart/mixed") {
          continue;
        }

        // Check if it's a text type
        let isText = contentType.startsWith("text/");
        if (!isText && contentType === "application/octet-stream") {
          // Check for X-RT-Original-Content-Type
          const headersStr = attachmentData.Headers || "";
          for (const line of headersStr.split("\n")) {
            if (line.startsWith("X-RT-Original-Content-Type:")) {
              const originalType = line.split(":", 2)[1].trim();
              if (originalType.startsWith("text/")) {
                isText = true;
                contentType = originalType;
              }
              break;
            }
          }
        }

        // Determine if this is inline text or a file attachment
        const isInlineText = isText && (!subject || subject === "");

        if (isInlineText) {
          // This is user-typed text content
          const encodedContent = attachmentData.Content || "";
          try {
            if (encodedContent) {
              entry.message = Buffer.from(encodedContent, "base64").toString(
                "utf-8"
              );
            } else {
              entry.message = "";
            }
          } catch (decodeError: any) {
            entry.message = `[Error decoding: ${decodeError.message}]`;
          }
        } else {
          // This is a file attachment
          const encodedContent = attachmentData.Content || "";
          const fileSize = encodedContent ? encodedContent.length : 0;

          entry.attachments.push({
            id: attachmentData.id,
            filename: subject || "untitled",
            content_type: contentType,
            size: formatFileSize(fileSize),
          });
        }
      }

      correspondence.push(entry);
    }

    // Sort by created date
    correspondence.sort((a, b) => {
      const dateA = a.created || "";
      const dateB = b.created || "";
      return dateA.localeCompare(dateB);
    });

    return {
      ticket_id: ticketId,
      total_attachments: totalAttachments,
      correspondence_count: correspondence.length,
      correspondence,
    };
  } catch (error: any) {
    return {
      error: error.message || String(error),
      ticket_id: ticketId,
    };
  }
}

async function getAttachment(attachmentId: number): Promise<any> {
  try {
    const attachmentData = await makeRTRequest(`/attachment/${attachmentId}`);

    // Extract metadata
    const contentType = attachmentData.ContentType || "unknown";
    const subject = (attachmentData.Subject || "").trim();
    const encodedContent = attachmentData.Content || "";

    // Calculate size
    const fileSize = encodedContent ? encodedContent.length : 0;
    const sizeStr = formatFileSize(fileSize);

    // Extract creator
    const creatorObj = attachmentData.Creator;
    let creatorId = null;
    if (creatorObj) {
      creatorId = typeof creatorObj === "object" ? creatorObj.id : creatorObj;
    }

    return {
      attachment_id: attachmentId,
      filename: subject || "untitled",
      content_type: contentType,
      size: sizeStr,
      content_base64: encodedContent,
      created: attachmentData.Created,
      creator: creatorId,
    };
  } catch (error: any) {
    return {
      error: error.message || String(error),
      attachment_id: attachmentId,
    };
  }
}

async function getTicketHierarchy(
  ticketId: number,
  recursive: boolean = true
): Promise<any> {
  try {
    // Track visited tickets to avoid cycles
    const visited = new Set<string>();
    const ticketDetails = new Map<string, any>();

    async function fetchTicketWithRelations(
      tid: string
    ): Promise<any | null> {
      if (visited.has(tid)) {
        return null;
      }

      visited.add(tid);

      try {
        const data = await makeRTRequest(`/ticket/${tid}`);

        // Extract basic info
        const owner = data.Owner;
        const ticketInfo: any = {
          id: data.id,
          subject: data.Subject,
          status: data.Status,
          owner:
            typeof owner === "object" && owner !== null ? owner.id : owner,
          created: data.Created,
          time_worked: data.TimeWorked,
        };

        // Extract relationships
        const relationships = extractTicketRelationships(data);
        ticketInfo.parent_ids = relationships.parents;
        ticketInfo.child_ids = relationships.children;

        ticketDetails.set(tid, ticketInfo);
        return ticketInfo;
      } catch (error) {
        return null;
      }
    }

    async function buildHierarchy(tid: string): Promise<any | null> {
      const ticketInfo = await fetchTicketWithRelations(tid);
      if (!ticketInfo) {
        return null;
      }

      const result: any = {
        id: ticketInfo.id,
        subject: ticketInfo.subject,
        status: ticketInfo.status,
        owner: ticketInfo.owner,
        created: ticketInfo.created,
        time_worked: ticketInfo.time_worked,
      };

      if (recursive) {
        // Fetch children recursively
        if (ticketInfo.child_ids && ticketInfo.child_ids.length > 0) {
          result.children = {};
          for (const childId of ticketInfo.child_ids) {
            const childTree = await buildHierarchy(childId);
            if (childTree) {
              result.children[childId] = childTree;
            }
          }
        }

        // Fetch parents recursively
        if (ticketInfo.parent_ids && ticketInfo.parent_ids.length > 0) {
          result.parents = {};
          for (const parentId of ticketInfo.parent_ids) {
            const parentTree = await buildHierarchy(parentId);
            if (parentTree) {
              result.parents[parentId] = parentTree;
            }
          }
        }
      } else {
        // Non-recursive: just include IDs
        if (ticketInfo.child_ids && ticketInfo.child_ids.length > 0) {
          result.child_ids = ticketInfo.child_ids;
        }
        if (ticketInfo.parent_ids && ticketInfo.parent_ids.length > 0) {
          result.parent_ids = ticketInfo.parent_ids;
        }
      }

      return result;
    }

    // Build the hierarchy starting from the requested ticket
    const hierarchy = await buildHierarchy(String(ticketId));

    return {
      ticket_id: ticketId,
      recursive,
      tickets_fetched: visited.size,
      hierarchy,
    };
  } catch (error: any) {
    return {
      error: error.message || String(error),
      ticket_id: ticketId,
    };
  }
}

/**
 * Parse command-line arguments.
 */
function parseArgs(): { url: string; apiToken: string } {
  const program = new Command();

  program
    .name("rt-mcp-server")
    .description(
      "RT REST2 MCP Server - Provides read-only access to RT tickets and attachments"
    )
    .option(
      "--url <url>",
      "RT REST2 API base URL (required)",
      process.env.RT_BASE_URL || ""
    )
    .option(
      "--api-token <token>",
      "RT authentication token",
      process.env.RT_TOKEN || ""
    )
    .parse();

  const opts = program.opts();
  return {
    url: opts.url || process.env.RT_BASE_URL || "",
    apiToken: opts.apiToken || process.env.RT_TOKEN || "",
  };
}

/**
 * Configure global settings.
 */
function configure(opts: { url: string; apiToken: string }) {
  if (!opts.url) {
    console.error(
      "Error: RT server URL is required.\n" +
        "Provide it via --url argument or RT_BASE_URL environment variable.\n" +
        "Example: --url https://rt.example.com/REST/2.0"
    );
    process.exit(1);
  }

  if (!opts.apiToken) {
    console.error(
      "Error: RT authentication token is required.\n" +
        "Provide it via --api-token argument or RT_TOKEN environment variable.\n" +
        "Create a token in RT via Settings > Auth Tokens"
    );
    process.exit(1);
  }

  configureRT(opts.url, opts.apiToken);
}

/**
 * Main function.
 */
async function main() {
  // Parse arguments and configure
  const opts = parseArgs();
  configure(opts);

  // Create MCP server
  const server = new Server(
    {
      name: "RT REST2 MCP Server",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Register tool list handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools,
    };
  });

  // Register tool call handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case "search_tickets": {
          const { query, limit = 20 } = args as {
            query: string;
            limit?: number;
          };
          const result = await searchTickets(query, limit);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        }

        case "get_ticket": {
          const { ticket_id } = args as { ticket_id: number };
          const result = await getTicket(ticket_id);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        }

        case "get_ticket_correspondence": {
          const { ticket_id } = args as { ticket_id: number };
          const result = await getTicketCorrespondence(ticket_id);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        }

        case "get_attachment": {
          const { attachment_id } = args as { attachment_id: number };
          const result = await getAttachment(attachment_id);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        }

        case "get_ticket_hierarchy": {
          const { ticket_id, recursive = true } = args as {
            ticket_id: number;
            recursive?: boolean;
          };
          const result = await getTicketHierarchy(ticket_id, recursive);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                error: error.message || String(error),
                tool: name,
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }
  });

  // Start server with STDIO transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Run main
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
