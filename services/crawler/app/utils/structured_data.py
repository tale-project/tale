"""Format structured data (JSON-LD, OpenGraph) as readable text for content extraction."""

import json
import logging

logger = logging.getLogger(__name__)

MAX_OUTPUT_CHARS = 8000
MAX_VARIANTS = 50

_VALUABLE_JSONLD_TYPES = frozenset(
    {
        "Product",
        "ProductGroup",
        "FAQPage",
        "Recipe",
        "Event",
        "Article",
        "NewsArticle",
        "BlogPosting",
        "Review",
        "AggregateRating",
        "Course",
        "SoftwareApplication",
        "Book",
        "Movie",
        "LocalBusiness",
        "Restaurant",
        "JobPosting",
    }
)

_SKIPPED_OG_KEYS = frozenset(
    {
        "title",
        "description",
        "url",
        "type",
        "site_name",
        "image",
        "image:width",
        "image:height",
        "image:type",
    }
)


def format_structured_data(structured_data: dict | None) -> str:
    """Format structured data as readable markdown text.

    Returns empty string if no meaningful content is found or on any error.
    Output is capped at MAX_OUTPUT_CHARS to prevent dominating chunks.
    """
    if not structured_data:
        return ""

    try:
        sections: list[str] = []

        for item in structured_data.get("json_ld", []):
            if isinstance(item, list):
                for sub in item:
                    if isinstance(sub, dict):
                        formatted = _format_json_ld_item(sub)
                        if formatted:
                            sections.append(formatted)
            elif isinstance(item, dict):
                formatted = _format_json_ld_item(item)
                if formatted:
                    sections.append(formatted)

        og_text = _format_opengraph(structured_data.get("opengraph", {}))
        if og_text:
            sections.append(og_text)

        if not sections:
            return ""

        result = "---\n\n" + "\n\n".join(sections)
        if len(result) > MAX_OUTPUT_CHARS:
            result = result[:MAX_OUTPUT_CHARS].rsplit("\n", 1)[0] + "\n\n*(truncated)*"

        return result

    except Exception:
        logger.warning("Failed to format structured data", exc_info=True)
        return ""


def _format_json_ld_item(item: dict) -> str:
    """Format a single JSON-LD object into readable text."""
    item_type = item.get("@type", "")

    if isinstance(item_type, list):
        item_type = item_type[0] if item_type else ""

    if item_type not in _VALUABLE_JSONLD_TYPES:
        return ""

    if item_type in ("Product", "ProductGroup"):
        return _format_product(item)
    if item_type == "FAQPage":
        return _format_faq(item)
    if item_type in ("Recipe",):
        return _format_recipe(item)

    return _format_generic_jsonld(item, item_type)


def _format_product(item: dict) -> str:
    """Format Product/ProductGroup JSON-LD with variants and pricing."""
    lines: list[str] = []

    name = item.get("name", "")
    if name:
        lines.append(f"## Product: {name}")

    brand = item.get("brand", {})
    brand_name = brand.get("name", "") if isinstance(brand, dict) else str(brand)
    if brand_name:
        lines.append(f"- Brand: {brand_name}")

    if category := item.get("category"):
        lines.append(f"- Category: {category}")

    if description := item.get("description"):
        desc = str(description)[:500]
        lines.append(f"- Description: {desc}")

    variants = item.get("hasVariant", [])
    if variants:
        lines.append("")
        lines.append("### Variants & Pricing")
        lines.append("")
        lines.append("| Variant | Price | Availability | SKU |")
        lines.append("|---------|-------|--------------|-----|")

        for v in variants[:MAX_VARIANTS]:
            v_name = v.get("name", v.get("public_title", ""))
            offers = v.get("offers", {})
            if isinstance(offers, list):
                offers = offers[0] if offers else {}
            price = offers.get("price", "")
            currency = offers.get("priceCurrency", "")
            avail = offers.get("availability", "").replace("http://schema.org/", "").replace("https://schema.org/", "")
            sku = v.get("sku", "")
            price_str = f"{currency} {price}".strip() if price else ""
            lines.append(f"| {v_name} | {price_str} | {avail} | {sku} |")

        if len(variants) > MAX_VARIANTS:
            lines.append(f"\n*...and {len(variants) - MAX_VARIANTS} more variants*")

    elif offers := item.get("offers"):
        if isinstance(offers, dict):
            price = offers.get("price", "")
            currency = offers.get("priceCurrency", "")
            avail = offers.get("availability", "").replace("http://schema.org/", "").replace("https://schema.org/", "")
            if price:
                lines.append(f"- Price: {currency} {price}".strip())
            if avail:
                lines.append(f"- Availability: {avail}")
        elif isinstance(offers, list):
            lines.append("")
            lines.append("### Pricing")
            lines.append("")
            lines.append("| Price | Availability |")
            lines.append("|-------|--------------|")
            for o in offers[:MAX_VARIANTS]:
                price = o.get("price", "")
                currency = o.get("priceCurrency", "")
                avail = o.get("availability", "").replace("http://schema.org/", "").replace("https://schema.org/", "")
                price_str = f"{currency} {price}".strip() if price else ""
                lines.append(f"| {price_str} | {avail} |")

    if (rating := item.get("aggregateRating")) and isinstance(rating, dict):
        value = rating.get("ratingValue", "")
        count = rating.get("reviewCount", rating.get("ratingCount", ""))
        if value:
            lines.append(f"- Rating: {value}/5 ({count} reviews)" if count else f"- Rating: {value}/5")

    return "\n".join(lines)


def _format_faq(item: dict) -> str:
    """Format FAQPage JSON-LD."""
    lines = ["## FAQ"]
    for entity in item.get("mainEntity", [])[:20]:
        question = entity.get("name", "")
        answer = entity.get("acceptedAnswer", {})
        answer_text = answer.get("text", "") if isinstance(answer, dict) else str(answer)
        if question:
            lines.append(f"\n**Q: {question}**")
            if answer_text:
                lines.append(answer_text[:500])
    return "\n".join(lines) if len(lines) > 1 else ""


def _format_recipe(item: dict) -> str:
    """Format Recipe JSON-LD."""
    lines: list[str] = []
    if name := item.get("name"):
        lines.append(f"## Recipe: {name}")
    if prep := item.get("prepTime"):
        lines.append(f"- Prep time: {prep}")
    if cook := item.get("cookTime"):
        lines.append(f"- Cook time: {cook}")
    if servings := item.get("recipeYield"):
        lines.append(f"- Servings: {servings}")
    if ingredients := item.get("recipeIngredient"):
        lines.append("\n### Ingredients")
        for ing in ingredients[:50]:
            lines.append(f"- {ing}")
    if instructions := item.get("recipeInstructions"):
        lines.append("\n### Instructions")
        for i, step in enumerate(instructions[:30], 1):
            text = step.get("text", "") if isinstance(step, dict) else str(step)
            if text:
                lines.append(f"{i}. {text[:300]}")
    return "\n".join(lines) if len(lines) > 1 else ""


def _format_generic_jsonld(item: dict, item_type: str) -> str:
    """Format other valuable JSON-LD types as compact key-value pairs."""
    lines = [f"## {item_type}"]
    skip_keys = {"@context", "@type", "@id", "@graph", "image", "logo", "url", "mainEntityOfPage"}

    for key, value in sorted(item.items()):
        if key in skip_keys:
            continue
        if isinstance(value, (dict, list)):
            serialized = json.dumps(value, ensure_ascii=False, sort_keys=True)
            if len(serialized) > 500:
                continue
            lines.append(f"- {key}: {serialized}")
        else:
            lines.append(f"- {key}: {value}")

    return "\n".join(lines) if len(lines) > 1 else ""


def _format_opengraph(og_data: dict) -> str:
    """Format OpenGraph data, excluding fields that duplicate visible page content."""
    if not og_data:
        return ""

    lines: list[str] = []
    for key, value in sorted(og_data.items()):
        if key in _SKIPPED_OG_KEYS:
            continue
        if value:
            lines.append(f"- {key}: {value}")

    if not lines:
        return ""

    return "## Page Metadata (OpenGraph)\n" + "\n".join(lines)
