#!/usr/bin/env python3
"""
FastMCP server for RT (Request Tracker) REST2 API.
Provides read-only access to RT tickets and text attachments.
"""

import os
import sys
import argparse
import base64
from typing import Optional, Dict, Any

import httpx
from fastmcp import FastMCP, Context

# Global configuration (will be set from command-line args or environment)
RT_BASE_URL: str = ""
RT_TOKEN: str = ""

# Initialize FastMCP server
mcp = FastMCP(
    name="RT REST2 MCP Server",
    instructions="Provides read-only access to RT (Request Tracker) tickets, correspondence, and hierarchy via REST2 API"
)


async def make_rt_request(
    endpoint: str,
    ctx: Optional[Context] = None
) -> Dict[str, Any]:
    """
    Make an authenticated request to the RT REST2 API.

    Args:
        endpoint: API endpoint path (e.g., "/ticket/123")
        ctx: Optional context for logging

    Returns:
        JSON response as dictionary

    Raises:
        httpx.HTTPStatusError: If the request fails
    """
    url = f"{RT_BASE_URL.rstrip('/')}{endpoint}"
    headers = {
        "Authorization": f"token {RT_TOKEN}",
        "Accept": "application/json"
    }

    if ctx:
        await ctx.info(f"Making request to: {endpoint}")

    async with httpx.AsyncClient() as client:
        response = await client.get(url, headers=headers, timeout=30.0)
        response.raise_for_status()
        return response.json()


def extract_ticket_relationships(ticket_data: Dict[str, Any]) -> Dict[str, list]:
    """
    Extract parent/child relationships from ticket _hyperlinks.

    Args:
        ticket_data: Raw ticket data from RT API

    Returns:
        Dictionary with 'parents' and 'children' lists containing ticket IDs
    """
    relationships = {"parents": [], "children": []}

    hyperlinks = ticket_data.get("_hyperlinks", [])
    for link in hyperlinks:
        ref = link.get("ref")
        ticket_id = link.get("id")

        if ref == "parent" and ticket_id:
            relationships["parents"].append(str(ticket_id))
        elif ref == "child" and ticket_id:
            relationships["children"].append(str(ticket_id))

    return relationships


@mcp.tool
async def get_ticket(ticket_id: int, ctx: Context) -> dict:
    """
    Get complete ticket information by ticket ID.

    This tool fetches all available information about a specific RT ticket,
    including subject, status, queue, owner, dates, priority, and custom fields.

    Args:
        ticket_id: The RT ticket ID number
        ctx: Execution context

    Returns:
        Dictionary containing complete ticket information

    Example:
        get_ticket(ticket_id=12345)
    """
    try:
        await ctx.info(f"Fetching ticket {ticket_id}")

        # Fetch ticket data
        data = await make_rt_request(f"/ticket/{ticket_id}", ctx)

        # Extract ticket information
        if isinstance(data, dict):
            ticket_info = {
                "id": data.get("id"),
                "type": data.get("Type"),
                "subject": data.get("Subject"),
                "status": data.get("Status"),
                "queue": data.get("Queue"),
                "owner": data.get("Owner"),
                "creator": data.get("Creator"),
                "requestors": data.get("Requestors", []),
                "cc": data.get("Cc", []),
                "admin_cc": data.get("AdminCc", []),
                "created": data.get("Created"),
                "started": data.get("Started"),
                "resolved": data.get("Resolved"),
                "last_updated": data.get("LastUpdated"),
                "time_worked": data.get("TimeWorked"),
                "time_estimated": data.get("TimeEstimated"),
                "time_left": data.get("TimeLeft")
            }

            await ctx.info(f"Successfully fetched ticket {ticket_id}")
            return ticket_info
        else:
            return {"error": "Unexpected response format", "data": data}

    except httpx.HTTPStatusError as e:
        error_msg = f"HTTP error {e.response.status_code}: {e.response.text}"
        await ctx.error(error_msg)
        return {"error": error_msg, "ticket_id": ticket_id}
    except Exception as e:
        error_msg = f"Failed to fetch ticket: {str(e)}"
        await ctx.error(error_msg)
        return {"error": error_msg, "ticket_id": ticket_id}


@mcp.tool
async def get_ticket_correspondence(
    ticket_id: int,
    ctx: Context
) -> dict:
    """
    Get ticket correspondence (comments and replies with attachments).

    This tool retrieves all correspondence entries from an RT ticket, grouped by
    transaction. Each entry contains the user's typed message (if present) and any
    file attachments. In RT, a single correspondence can have both text content and
    attached files.

    Args:
        ticket_id: The RT ticket ID number
        ctx: Execution context

    Returns:
        Dictionary containing list of correspondence entries, each with:
        - transaction_id: RT transaction ID
        - creator: Username who created this entry
        - created: Timestamp
        - message: User's typed text content (if present)
        - attachments: List of file attachments (if present)

    Example:
        get_ticket_correspondence(ticket_id=256826)
    """
    try:
        await ctx.info(f"Fetching correspondence for ticket {ticket_id}")

        # Get list of attachments
        attachments_data = await make_rt_request(
            f"/ticket/{ticket_id}/attachments",
            ctx
        )

        if not isinstance(attachments_data, dict):
            return {
                "error": "Unexpected response format",
                "ticket_id": ticket_id,
                "data": attachments_data
            }

        items = attachments_data.get("items", [])
        total_attachments = len(items)

        await ctx.info(f"Found {total_attachments} total attachments")

        # Fetch all attachments and group by transaction
        transactions_map = {}  # transaction_id -> list of attachments

        for idx, attachment_info in enumerate(items, 1):
            attachment_id = attachment_info.get("id")
            await ctx.report_progress(idx, total_attachments)

            # Fetch full attachment data
            attachment_data = await make_rt_request(
                f"/attachment/{attachment_id}",
                ctx
            )

            # Extract transaction ID
            transaction_id_obj = attachment_data.get("TransactionId")
            if not transaction_id_obj:
                continue

            transaction_id = transaction_id_obj.get("id") if isinstance(transaction_id_obj, dict) else transaction_id_obj
            if not transaction_id:
                continue

            # Initialize transaction entry if needed
            if transaction_id not in transactions_map:
                transactions_map[transaction_id] = {
                    "attachments": [],
                    "creator": None,
                    "created": None
                }

            # Extract creator and created (same for all attachments in transaction)
            if not transactions_map[transaction_id]["creator"]:
                creator_obj = attachment_data.get("Creator")
                if creator_obj:
                    transactions_map[transaction_id]["creator"] = creator_obj.get("id") if isinstance(creator_obj, dict) else creator_obj
                transactions_map[transaction_id]["created"] = attachment_data.get("Created")

            # Add attachment to transaction
            transactions_map[transaction_id]["attachments"].append(attachment_data)

        # Process each transaction to build correspondence entries
        correspondence = []

        for transaction_id, transaction_data in transactions_map.items():
            entry = {
                "transaction_id": transaction_id,
                "creator": transaction_data["creator"],
                "created": transaction_data["created"],
                "message": None,
                "attachments": []
            }

            # Process each attachment in the transaction
            for attachment_data in transaction_data["attachments"]:
                content_type = attachment_data.get("ContentType", "")
                subject = attachment_data.get("Subject", "").strip()

                # Skip multipart/mixed containers
                if content_type == "multipart/mixed":
                    continue

                # Check if it's a text type
                is_text = content_type.startswith("text/")
                if not is_text and content_type == "application/octet-stream":
                    # Check for X-RT-Original-Content-Type
                    headers_str = attachment_data.get("Headers", "")
                    for line in headers_str.split('\n'):
                        if line.startswith("X-RT-Original-Content-Type:"):
                            original_type = line.split(":", 1)[1].strip()
                            if original_type.startswith("text/"):
                                is_text = True
                                content_type = original_type
                            break

                # Determine if this is inline text or a file attachment
                is_inline_text = is_text and (not subject or subject == "")

                if is_inline_text:
                    # This is user-typed text content
                    encoded_content = attachment_data.get("Content", "")
                    try:
                        if encoded_content:
                            entry["message"] = base64.b64decode(encoded_content).decode("utf-8")
                        else:
                            entry["message"] = ""
                    except Exception as decode_error:
                        entry["message"] = f"[Error decoding: {str(decode_error)}]"

                else:
                    # This is a file attachment
                    encoded_content = attachment_data.get("Content", "")
                    file_size = len(encoded_content) if encoded_content else 0

                    # Convert size to human-readable format
                    if file_size < 1024:
                        size_str = f"{file_size} bytes"
                    elif file_size < 1024 * 1024:
                        size_str = f"{file_size / 1024:.1f} KB"
                    else:
                        size_str = f"{file_size / (1024 * 1024):.1f} MB"

                    entry["attachments"].append({
                        "id": attachment_data.get("id"),
                        "filename": subject or "untitled",
                        "content_type": content_type,
                        "size": size_str
                    })

            correspondence.append(entry)

        # Sort by created date
        correspondence.sort(key=lambda x: x["created"] or "")

        await ctx.info(f"Successfully retrieved {len(correspondence)} correspondence entries")

        return {
            "ticket_id": ticket_id,
            "total_attachments": total_attachments,
            "correspondence_count": len(correspondence),
            "correspondence": correspondence
        }

    except httpx.HTTPStatusError as e:
        error_msg = f"HTTP error {e.response.status_code}: {e.response.text}"
        await ctx.error(error_msg)
        return {"error": error_msg, "ticket_id": ticket_id}
    except Exception as e:
        error_msg = f"Failed to fetch correspondence: {str(e)}"
        await ctx.error(error_msg)
        return {"error": error_msg, "ticket_id": ticket_id}


@mcp.tool
async def get_attachment(
    attachment_id: int,
    ctx: Context
) -> dict:
    """
    Download a specific attachment by ID.

    This tool fetches a single attachment from RT and returns its content
    in base64-encoded format along with metadata. Use this to download
    files that were listed in get_ticket_correspondence results.

    Args:
        attachment_id: The RT attachment ID number
        ctx: Execution context

    Returns:
        Dictionary containing:
        - attachment_id: The attachment ID
        - filename: Attachment filename
        - content_type: MIME type
        - size: Human-readable file size
        - content_base64: Base64-encoded file content
        - created: Creation timestamp
        - creator: Username who created this attachment

    Example:
        get_attachment(attachment_id=2586343)
    """
    try:
        await ctx.info(f"Fetching attachment {attachment_id}")

        # Fetch attachment data
        attachment_data = await make_rt_request(
            f"/attachment/{attachment_id}",
            ctx
        )

        # Extract metadata
        content_type = attachment_data.get("ContentType", "unknown")
        subject = attachment_data.get("Subject", "").strip()
        encoded_content = attachment_data.get("Content", "")

        # Calculate size
        file_size = len(encoded_content) if encoded_content else 0
        if file_size < 1024:
            size_str = f"{file_size} bytes"
        elif file_size < 1024 * 1024:
            size_str = f"{file_size / 1024:.1f} KB"
        else:
            size_str = f"{file_size / (1024 * 1024):.1f} MB"

        # Extract creator
        creator_obj = attachment_data.get("Creator")
        creator_id = None
        if creator_obj:
            creator_id = creator_obj.get("id") if isinstance(creator_obj, dict) else creator_obj

        await ctx.info(f"Successfully fetched attachment {attachment_id} ({size_str})")

        return {
            "attachment_id": attachment_id,
            "filename": subject or "untitled",
            "content_type": content_type,
            "size": size_str,
            "content_base64": encoded_content,
            "created": attachment_data.get("Created"),
            "creator": creator_id
        }

    except httpx.HTTPStatusError as e:
        error_msg = f"HTTP error {e.response.status_code}: {e.response.text}"
        await ctx.error(error_msg)
        return {"error": error_msg, "attachment_id": attachment_id}
    except Exception as e:
        error_msg = f"Failed to fetch attachment: {str(e)}"
        await ctx.error(error_msg)
        return {"error": error_msg, "attachment_id": attachment_id}


@mcp.tool
async def search_tickets(
    query: str,
    limit: int = 20,
    ctx: Context = None
) -> dict:
    """
    Search for tickets using simple search syntax.

    This tool searches RT tickets using a simple query that matches across
    ticket subject, content, and other fields. It returns summary information
    for matching tickets.

    Args:
        query: Simple search query text (e.g., "bug in login")
        limit: Maximum number of results to return (default 20, max 100)
        ctx: Execution context

    Returns:
        Dictionary containing:
        - total: Total number of matching tickets in RT
        - count: Number of tickets returned in this response
        - limit: Limit that was applied
        - tickets: List of ticket summaries with ID, Subject, Status, Queue, Owner, Created

    Example:
        search_tickets(query="database error", limit=10)
    """
    try:
        # Validate limit
        if limit < 1:
            limit = 1
        elif limit > 100:
            limit = 100

        await ctx.info(f"Searching tickets with query: '{query}' (limit={limit})")

        # URL encode the query
        from urllib.parse import quote
        encoded_query = quote(query)

        # Make request to simple search endpoint with fields parameter to get ticket details
        # Request specific fields to get summary information
        fields = "Subject,Status,Queue,Owner,Created"
        endpoint = f"/tickets?simple=1;query={encoded_query};per_page={limit};fields={fields}"
        data = await make_rt_request(endpoint, ctx)

        if not isinstance(data, dict):
            return {
                "error": "Unexpected response format",
                "data": data
            }

        # Extract metadata
        total = data.get("total", 0)
        count = data.get("count", 0)
        items = data.get("items", [])

        await ctx.info(f"Found {total} total matches, returning {count} tickets")

        # Process each ticket to extract summary info
        tickets = []
        for item in items:
            ticket_summary = {
                "id": item.get("id"),
                "subject": item.get("Subject"),
                "status": item.get("Status"),
            }

            # Extract Queue (might be object or string)
            queue = item.get("Queue")
            if isinstance(queue, dict):
                ticket_summary["queue"] = queue.get("id") or queue.get("Name")
            else:
                ticket_summary["queue"] = queue

            # Extract Owner (might be object or string)
            owner = item.get("Owner")
            if isinstance(owner, dict):
                ticket_summary["owner"] = owner.get("id") or owner.get("Name")
            else:
                ticket_summary["owner"] = owner

            # Extract Created timestamp
            ticket_summary["created"] = item.get("Created")

            tickets.append(ticket_summary)

        await ctx.info(f"Successfully processed {len(tickets)} ticket summaries")

        return {
            "total": total,
            "count": count,
            "limit": limit,
            "tickets": tickets
        }

    except httpx.HTTPStatusError as e:
        error_msg = f"HTTP error {e.response.status_code}: {e.response.text}"
        await ctx.error(error_msg)
        return {"error": error_msg, "query": query}
    except Exception as e:
        error_msg = f"Failed to search tickets: {str(e)}"
        await ctx.error(error_msg)
        return {"error": error_msg, "query": query}


@mcp.tool
async def get_ticket_hierarchy(
    ticket_id: int,
    recursive: bool = True,
    ctx: Context = None
) -> dict:
    """
    Get ticket hierarchy (parent/child relationships).

    This tool retrieves the parent and child relationships for a ticket.
    If recursive=True, it builds the complete hierarchy tree including all
    ancestors and descendants. If recursive=False, it only returns immediate
    parent and children (one level).

    Args:
        ticket_id: The RT ticket ID number
        recursive: Whether to recursively fetch the entire hierarchy tree (default: True)
        ctx: Execution context

    Returns:
        Dictionary containing the hierarchy tree structure with ticket details

    Example:
        get_ticket_hierarchy(ticket_id=251218, recursive=True)
    """
    try:
        await ctx.info(f"Fetching hierarchy for ticket {ticket_id} (recursive={recursive})")

        # Track visited tickets to avoid cycles
        visited = set()
        ticket_details = {}

        async def fetch_ticket_with_relations(tid: str) -> Optional[Dict[str, Any]]:
            """Fetch a ticket and extract its relationships."""
            if tid in visited:
                return None

            visited.add(tid)

            try:
                data = await make_rt_request(f"/ticket/{tid}", ctx)

                # Extract basic info
                ticket_info = {
                    "id": data.get("id"),
                    "subject": data.get("Subject"),
                    "status": data.get("Status"),
                    "owner": data.get("Owner", {}).get("id") if isinstance(data.get("Owner"), dict) else data.get("Owner"),
                    "created": data.get("Created"),
                    "time_worked": data.get("TimeWorked")
                }

                # Extract relationships
                relationships = extract_ticket_relationships(data)
                ticket_info["parent_ids"] = relationships["parents"]
                ticket_info["child_ids"] = relationships["children"]

                ticket_details[tid] = ticket_info
                return ticket_info

            except Exception as e:
                await ctx.error(f"Failed to fetch ticket {tid}: {str(e)}")
                return None

        async def build_hierarchy(tid: str, depth: int = 0) -> Optional[Dict[str, Any]]:
            """Recursively build the hierarchy tree."""
            ticket_info = await fetch_ticket_with_relations(tid)
            if not ticket_info:
                return None

            result = {
                "id": ticket_info["id"],
                "subject": ticket_info["subject"],
                "status": ticket_info["status"],
                "owner": ticket_info["owner"],
                "created": ticket_info["created"],
                "time_worked": ticket_info["time_worked"]
            }

            if recursive:
                # Fetch children recursively
                if ticket_info["child_ids"]:
                    result["children"] = {}
                    for child_id in ticket_info["child_ids"]:
                        child_tree = await build_hierarchy(child_id, depth + 1)
                        if child_tree:
                            result["children"][child_id] = child_tree

                # Fetch parents recursively
                if ticket_info["parent_ids"]:
                    result["parents"] = {}
                    for parent_id in ticket_info["parent_ids"]:
                        parent_tree = await build_hierarchy(parent_id, depth + 1)
                        if parent_tree:
                            result["parents"][parent_id] = parent_tree
            else:
                # Non-recursive: just include IDs
                if ticket_info["child_ids"]:
                    result["child_ids"] = ticket_info["child_ids"]
                if ticket_info["parent_ids"]:
                    result["parent_ids"] = ticket_info["parent_ids"]

            return result

        # Build the hierarchy starting from the requested ticket
        hierarchy = await build_hierarchy(str(ticket_id))

        await ctx.info(f"Successfully built hierarchy for ticket {ticket_id} ({len(visited)} tickets fetched)")

        return {
            "ticket_id": ticket_id,
            "recursive": recursive,
            "tickets_fetched": len(visited),
            "hierarchy": hierarchy
        }

    except httpx.HTTPStatusError as e:
        error_msg = f"HTTP error {e.response.status_code}: {e.response.text}"
        await ctx.error(error_msg)
        return {"error": error_msg, "ticket_id": ticket_id}
    except Exception as e:
        error_msg = f"Failed to fetch hierarchy: {str(e)}"
        await ctx.error(error_msg)
        return {"error": error_msg, "ticket_id": ticket_id}


def parse_args():
    """Parse command-line arguments."""
    parser = argparse.ArgumentParser(
        description="RT REST2 MCP Server - Provides read-only access to RT tickets and attachments"
    )
    parser.add_argument(
        "--url",
        type=str,
        default=None,
        help="RT REST2 API base URL (required)"
    )
    parser.add_argument(
        "--api-token",
        type=str,
        default=None,
        help="RT authentication token (default: env RT_TOKEN)"
    )
    return parser.parse_args()


def configure(args):
    """Configure global settings from command-line args and environment variables."""
    global RT_BASE_URL, RT_TOKEN

    # Priority: command-line args > environment variables
    RT_BASE_URL = args.url or os.environ.get("RT_BASE_URL") or ""
    RT_TOKEN = args.api_token or os.environ.get("RT_TOKEN") or ""

    if not RT_BASE_URL:
        print(
            "Error: RT server URL is required.\n"
            "Provide it via --url argument or RT_BASE_URL environment variable.\n"
            "Example: --url https://rt.example.com/REST/2.0",
            file=sys.stderr
        )
        sys.exit(1)

    if not RT_TOKEN:
        print(
            "Error: RT authentication token is required.\n"
            "Provide it via --api-token argument or RT_TOKEN environment variable.\n"
            "Create a token in RT via Settings > Auth Tokens",
            file=sys.stderr
        )
        sys.exit(1)


if __name__ == "__main__":
    # Parse command-line arguments and configure
    args = parse_args()
    configure(args)

    # Run the MCP server with STDIO transport
    mcp.run(transport="stdio")
