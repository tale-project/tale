"""
Pages Router — List indexed pages for a website.
"""

from fastapi import APIRouter, HTTPException, Query
from loguru import logger

from app.models import PageListItem, PageListResponse
from app.services.database import get_pool

router = APIRouter(prefix="/api/v1/pages", tags=["Pages"])


@router.get("/{domain}", response_model=PageListResponse)
async def list_pages(
    domain: str,
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    status: str | None = Query(None, description="Filter by status (discovered, active, deleted, failed)"),
    sort: str = Query("last_crawled_at", description="Sort field (last_crawled_at, discovered_at, word_count)"),
):
    """List all crawled pages for a website with indexing status."""
    try:
        pool = get_pool()

        valid_sorts = {"last_crawled_at", "discovered_at", "word_count"}
        sort_field = sort if sort in valid_sorts else "last_crawled_at"
        order = "DESC"

        async with pool.acquire() as conn:
            # Build query with optional status filter
            conditions = ["wu.domain = $1", "wu.content_hash IS NOT NULL"]
            params: list = [domain]
            param_idx = 2

            if status:
                conditions.append(f"wu.status = ${param_idx}")
                params.append(status)
                param_idx += 1

            where_clause = " AND ".join(conditions)

            # Main query with chunk count via LEFT JOIN
            params.extend([limit, offset])
            rows = await conn.fetch(
                f"""SELECT wu.url, wu.title, wu.word_count, wu.status, wu.content_hash,
                           wu.last_crawled_at, wu.discovered_at,
                           COALESCE(c.chunks_count, 0) AS chunks_count
                    FROM website_urls wu
                    LEFT JOIN (
                        SELECT url, COUNT(*) AS chunks_count
                        FROM chunks
                        GROUP BY url
                    ) c ON c.url = wu.url
                    WHERE {where_clause}
                    ORDER BY wu.{sort_field} {order} NULLS LAST
                    LIMIT ${param_idx} OFFSET ${param_idx + 1}""",
                *params,
            )

            # Total count
            total = await conn.fetchval(
                f"SELECT COUNT(*) FROM website_urls wu WHERE {where_clause}",
                *params[: param_idx - 1],
            )

        pages = [
            PageListItem(
                url=r["url"],
                title=r["title"],
                word_count=r["word_count"] or 0,
                status=r["status"],
                content_hash=r["content_hash"],
                last_crawled_at=r["last_crawled_at"].isoformat() if r["last_crawled_at"] else None,
                discovered_at=r["discovered_at"].isoformat() if r["discovered_at"] else None,
                chunks_count=r["chunks_count"],
                indexed=r["chunks_count"] > 0,
            )
            for r in rows
        ]

        return PageListResponse(
            domain=domain,
            pages=pages,
            total=total,
            offset=offset,
            has_more=offset + limit < total,
        )
    except HTTPException:
        raise
    except Exception:
        logger.exception(f"Error listing pages for {domain}")
        raise HTTPException(status_code=500, detail="Failed to list pages") from None
