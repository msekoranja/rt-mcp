#!/usr/bin/env node
/**
 * RT Ticket Export to Markdown
 * Exports RT tickets to markdown files with directory structure.
 */

import { Command } from "commander";
import * as fs from "fs";
import * as path from "path";
import {
  configureRT,
  makeRTRequest,
  extractTicketRelationships,
  formatFileSize,
} from "./lib.js";

/**
 * Ticket data interface
 */
interface TicketData {
  id: number;
  subject: string;
  status: string;
  queue: any;
  owner: any;
  creator: any;
  requestors: string[];
  created: string;
  resolved?: string;
}

/**
 * Correspondence entry interface
 */
interface CorrespondenceEntry {
  transaction_id: string;
  creator: string | null;
  created: string | null;
  message: string | null;
  attachments: Array<{
    id: number;
    filename: string;
    content_type: string;
    size: string;
  }>;
}

/**
 * Parse command-line arguments.
 */
function parseArgs(): {
  ticketId: number;
  recursive: boolean;
  url: string;
  apiToken: string;
  output: string;
} {
  const program = new Command();

  program
    .name("rt-export-md")
    .description("Export RT tickets to markdown format with directory structure")
    .argument("<ticket-id>", "RT ticket ID to export")
    .option(
      "--recursive",
      "Include child tickets recursively",
      false
    )
    .option(
      "--url <url>",
      "RT REST2 API base URL",
      process.env.RT_BASE_URL || ""
    )
    .option(
      "--api-token <token>",
      "RT authentication token",
      process.env.RT_TOKEN || ""
    )
    .option(
      "-o, --output <dir>",
      "Output directory (default: current directory)",
      "."
    )
    .parse();

  const opts = program.opts();
  const args = program.args;

  const ticketId = parseInt(args[0], 10);
  if (isNaN(ticketId)) {
    console.error("Error: Invalid ticket ID. Must be a number.");
    process.exit(1);
  }

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

  return {
    ticketId,
    recursive: opts.recursive,
    url: opts.url,
    apiToken: opts.apiToken,
    output: opts.output,
  };
}

/**
 * Fetch ticket data.
 */
async function fetchTicket(ticketId: number): Promise<TicketData | null> {
  try {
    const data = await makeRTRequest(`/ticket/${ticketId}`);
    return {
      id: data.id,
      subject: data.Subject || "",
      status: data.Status || "",
      queue: data.Queue,
      owner: data.Owner,
      creator: data.Creator,
      requestors: data.Requestors || [],
      created: data.Created || "",
      resolved: data.Resolved,
    };
  } catch (error: any) {
    console.error(`Error fetching ticket ${ticketId}: ${error.message}`);
    return null;
  }
}

/**
 * Fetch ticket correspondence.
 */
async function fetchCorrespondence(
  ticketId: number
): Promise<CorrespondenceEntry[]> {
  try {
    // Get list of attachments
    const attachmentsData = await makeRTRequest(
      `/ticket/${ticketId}/attachments`
    );
    const items = attachmentsData.items || [];

    // Fetch all attachments and group by transaction
    const transactionsMap = new Map<
      string,
      { attachments: any[]; creator: string | null; created: string | null }
    >();

    for (const attachmentInfo of items) {
      const attachmentId = attachmentInfo.id;
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

      if (!transactionsMap.has(txId)) {
        transactionsMap.set(txId, {
          attachments: [],
          creator: null,
          created: null,
        });
      }

      const transaction = transactionsMap.get(txId)!;

      if (!transaction.creator) {
        const creatorObj = attachmentData.Creator;
        if (creatorObj) {
          transaction.creator =
            typeof creatorObj === "object" ? creatorObj.id : creatorObj;
        }
        transaction.created = attachmentData.Created;
      }

      transaction.attachments.push(attachmentData);
    }

    // Process each transaction
    const correspondence: CorrespondenceEntry[] = [];

    for (const [transactionId, transactionData] of transactionsMap.entries()) {
      const entry: CorrespondenceEntry = {
        transaction_id: transactionId,
        creator: transactionData.creator,
        created: transactionData.created,
        message: null,
        attachments: [],
      };

      for (const attachmentData of transactionData.attachments) {
        let contentType = attachmentData.ContentType || "";
        const subject = (attachmentData.Subject || "").trim();
        const headersStr = attachmentData.Headers || "";
        const encodedContent = attachmentData.Content || "";

        // Skip multipart/mixed containers
        if (contentType === "multipart/mixed") {
          continue;
        }

        // Check if it's a text type
        let isText = contentType.startsWith("text/");
        if (!isText && contentType === "application/octet-stream") {
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

        // Use Content-Disposition header (MIME standard) to determine inline vs attachment
        const hasInlineDisposition = isInlineDisposition(headersStr);
        const isInlineText = hasInlineDisposition && isText;

        if (isInlineText) {
          // This is inline comment text - embed in markdown
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
        } else if (encodedContent && encodedContent.length > 0) {
          // This is a file attachment - save separately
          const fileSize = encodedContent.length;

          entry.attachments.push({
            id: attachmentData.id,
            filename: subject || "untitled",
            content_type: contentType,
            size: formatFileSize(fileSize),
          });
        }
        // Skip empty content (no inline text, no file content)
      }

      correspondence.push(entry);
    }

    // Sort by created date
    correspondence.sort((a, b) => {
      const dateA = a.created || "";
      const dateB = b.created || "";
      return dateA.localeCompare(dateB);
    });

    return correspondence;
  } catch (error: any) {
    console.error(
      `Error fetching correspondence for ticket ${ticketId}: ${error.message}`
    );
    return [];
  }
}

/**
 * Check if attachment has inline content disposition (MIME standard).
 * Returns true if Content-Disposition header is "inline", false otherwise.
 */
function isInlineDisposition(headers: string): boolean {
  const lines = headers.split("\n");
  for (const line of lines) {
    if (line.startsWith("Content-Disposition:")) {
      const value = line.split(":", 2)[1]?.trim().toLowerCase();
      return value?.startsWith("inline") || false;
    }
  }
  return false; // Default to false if not found
}

/**
 * Download binary attachment to file.
 */
async function downloadAttachment(
  attachmentId: number,
  outputPath: string
): Promise<void> {
  try {
    const attachmentData = await makeRTRequest(`/attachment/${attachmentId}`);
    const encodedContent = attachmentData.Content || "";

    if (encodedContent) {
      const buffer = Buffer.from(encodedContent, "base64");
      fs.writeFileSync(outputPath, buffer);
    }
  } catch (error: any) {
    console.error(
      `Error downloading attachment ${attachmentId}: ${error.message}`
    );
  }
}

/**
 * Format ticket data as markdown (compact format).
 */
function formatTicketMarkdown(
  ticket: TicketData,
  correspondence: CorrespondenceEntry[]
): string {
  const lines: string[] = [];

  // Helper function to format date as YYYY-MM-DD
  const formatDate = (isoDate: string): string => {
    return isoDate.substring(0, 10);
  };

  // Extract names from objects or use as-is
  const ownerName =
    typeof ticket.owner === "object" && ticket.owner !== null
      ? ticket.owner.id || ticket.owner.Name
      : ticket.owner;
  const creatorName =
    typeof ticket.creator === "object" && ticket.creator !== null
      ? ticket.creator.id || ticket.creator.Name
      : ticket.creator;

  // Compact header with inline metadata
  lines.push(`# #${ticket.id}: ${ticket.subject}`);

  // Build metadata line
  let metadata = `Status: ${ticket.status} | Owner: ${ownerName} | Creator: ${creatorName} | Created: ${formatDate(ticket.created)}`;

  // Add resolved date only if status is resolved
  if (ticket.status.toLowerCase() === "resolved" && ticket.resolved) {
    metadata += ` | Resolved: ${formatDate(ticket.resolved)}`;
  }

  lines.push(metadata);

  // Correspondence (if any)
  if (correspondence.length > 0) {
    const hasNonEmptyCorrespondence = correspondence.some(
      (entry) => (entry.message && entry.message.trim()) || entry.attachments.length > 0
    );

    if (hasNonEmptyCorrespondence) {
      lines.push(""); // Single blank line before first correspondence

      for (const entry of correspondence) {
        // Skip completely empty transactions
        const hasMessage = entry.message && entry.message.trim();
        const hasAttachments = entry.attachments.length > 0;

        if (!hasMessage && !hasAttachments) {
          continue;
        }

        // Compact correspondence header: **YYYY-MM-DD creator**: content
        const date = entry.created ? formatDate(entry.created) : "Unknown";
        const creator = entry.creator || "Unknown";

        if (hasMessage) {
          // Output header with message content
          lines.push(`**${date} ${creator}**: ${entry.message!.trim()}`);
        } else {
          // No message, only attachments
          lines.push(`**${date} ${creator}**:`);
        }

        // Attachments (if any)
        if (hasAttachments) {
          lines.push("");
          lines.push("**Attachments**:");
          for (const attachment of entry.attachments) {
            lines.push(
              `- [${attachment.filename}](${attachment.filename}) (${attachment.content_type}, ${attachment.size})`
            );
          }
        }

        lines.push(""); // Blank line after each correspondence entry
      }
    }
  }

  return lines.join("\n");
}

/**
 * Export a single ticket to markdown.
 */
async function exportTicket(
  ticketId: number,
  outputDir: string,
  recursive: boolean,
  depth: number = 0
): Promise<void> {
  const indent = "  ".repeat(depth);
  console.log(`${indent}Exporting ticket ${ticketId}...`);

  // Create ticket directory
  const ticketDir = path.join(outputDir, `ticket-${ticketId}`);
  if (!fs.existsSync(ticketDir)) {
    fs.mkdirSync(ticketDir, { recursive: true });
  }

  // Fetch ticket data
  const ticket = await fetchTicket(ticketId);
  if (!ticket) {
    console.error(`${indent}Failed to fetch ticket ${ticketId}`);
    return;
  }

  // Fetch correspondence
  const correspondence = await fetchCorrespondence(ticketId);

  // Download binary attachments directly to ticket directory
  for (const entry of correspondence) {
    for (const attachment of entry.attachments) {
      const attachmentPath = path.join(ticketDir, attachment.filename);
      console.log(
        `${indent}  Downloading attachment: ${attachment.filename}...`
      );
      await downloadAttachment(attachment.id, attachmentPath);
    }
  }

  // Write markdown file
  const markdownContent = formatTicketMarkdown(ticket, correspondence);
  const markdownPath = path.join(ticketDir, `ticket-${ticketId}.md`);
  fs.writeFileSync(markdownPath, markdownContent, "utf-8");
  console.log(`${indent}Wrote ${markdownPath}`);

  // Recursively export child tickets to same output directory
  if (recursive) {
    const ticketData = await makeRTRequest(`/ticket/${ticketId}`);
    const relationships = extractTicketRelationships(ticketData);

    if (relationships.children.length > 0) {
      console.log(
        `${indent}Found ${relationships.children.length} child ticket(s)`
      );
      for (const childId of relationships.children) {
        await exportTicket(
          parseInt(childId, 10),
          outputDir,
          recursive,
          depth + 1
        );
      }
    }
  }
}

/**
 * Main function.
 */
async function main() {
  const opts = parseArgs();

  // Configure RT connection
  configureRT(opts.url, opts.apiToken);

  console.log(`RT Ticket Export to Markdown`);
  console.log(`================================`);
  console.log(`Ticket ID: ${opts.ticketId}`);
  console.log(`Recursive: ${opts.recursive}`);
  console.log(`Output directory: ${path.resolve(opts.output)}`);
  console.log(`RT URL: ${opts.url}`);
  console.log("");

  // Ensure output directory exists
  if (!fs.existsSync(opts.output)) {
    fs.mkdirSync(opts.output, { recursive: true });
  }

  // Export the ticket
  await exportTicket(opts.ticketId, opts.output, opts.recursive);

  console.log("");
  console.log("Export completed successfully!");
}

// Run main
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
