/**
 * Shared library functions for RT REST2 API access.
 * Used by both the MCP server and export script.
 */

// Global configuration
let RT_BASE_URL = "";
let RT_TOKEN = "";

/**
 * Configure global RT settings.
 */
export function configureRT(baseUrl: string, token: string) {
  RT_BASE_URL = baseUrl;
  RT_TOKEN = token;
}

/**
 * Get current RT configuration.
 */
export function getRTConfig(): { baseUrl: string; token: string } {
  return {
    baseUrl: RT_BASE_URL,
    token: RT_TOKEN,
  };
}

/**
 * Make an authenticated request to the RT REST2 API.
 */
export async function makeRTRequest(endpoint: string): Promise<any> {
  const url = `${RT_BASE_URL.replace(/\/$/, "")}${endpoint}`;
  const headers = {
    Authorization: `token ${RT_TOKEN}`,
    Accept: "application/json",
  };

  const response = await fetch(url, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `HTTP error ${response.status}: ${text || response.statusText}`
    );
  }

  return response.json();
}

/**
 * Extract parent/child relationships from ticket _hyperlinks.
 */
export function extractTicketRelationships(ticketData: any): {
  parents: string[];
  children: string[];
} {
  const relationships = { parents: [] as string[], children: [] as string[] };

  const hyperlinks = ticketData._hyperlinks || [];
  for (const link of hyperlinks) {
    const ref = link.ref;
    const ticketId = link.id;

    if (ref === "parent" && ticketId) {
      relationships.parents.push(String(ticketId));
    } else if (ref === "child" && ticketId) {
      relationships.children.push(String(ticketId));
    }
  }

  return relationships;
}

/**
 * Format file size to human-readable string.
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} bytes`;
  } else if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  } else {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}
