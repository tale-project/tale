"""Tests for structured data formatting utility."""

from app.utils.structured_data import (
    MAX_OUTPUT_CHARS,
    MAX_VARIANTS,
    format_structured_data,
)


class TestFormatStructuredData:
    def test_none_input(self):
        assert format_structured_data(None) == ""

    def test_empty_dict(self):
        assert format_structured_data({}) == ""

    def test_empty_json_ld_and_og(self):
        assert format_structured_data({"json_ld": [], "opengraph": {}}) == ""

    def test_skipped_jsonld_types(self):
        result = format_structured_data(
            {
                "json_ld": [
                    {"@type": "WebSite", "name": "Example"},
                    {"@type": "Organization", "name": "Org"},
                    {"@type": "BreadcrumbList", "itemListElement": []},
                ]
            }
        )
        assert result == ""

    def test_product_basic(self):
        result = format_structured_data(
            {
                "json_ld": [
                    {
                        "@type": "Product",
                        "name": "Widget",
                        "brand": {"name": "Acme"},
                        "category": "Gadgets",
                        "offers": {
                            "price": "29.99",
                            "priceCurrency": "USD",
                            "availability": "http://schema.org/InStock",
                        },
                    }
                ]
            }
        )
        assert "## Product: Widget" in result
        assert "Brand: Acme" in result
        assert "Category: Gadgets" in result
        assert "USD 29.99" in result
        assert "InStock" in result

    def test_product_group_with_variants(self):
        variants = [
            {
                "name": f"Variant {i}",
                "offers": {
                    "price": f"{10 + i}.00",
                    "priceCurrency": "CHF",
                    "availability": "http://schema.org/InStock",
                },
                "sku": f"SKU-{i}",
            }
            for i in range(5)
        ]
        result = format_structured_data(
            {
                "json_ld": [
                    {
                        "@type": "ProductGroup",
                        "name": "Test Product",
                        "hasVariant": variants,
                    }
                ]
            }
        )
        assert "### Variants & Pricing" in result
        assert "| Variant | Price | Availability | SKU |" in result
        assert "Variant 0" in result
        assert "CHF 10.00" in result
        assert "SKU-0" in result
        assert "Variant 4" in result

    def test_product_variants_capped(self):
        variants = [
            {
                "name": f"V{i}",
                "offers": {"price": "10.00", "priceCurrency": "USD"},
                "sku": f"S{i}",
            }
            for i in range(80)
        ]
        result = format_structured_data({"json_ld": [{"@type": "Product", "name": "Big", "hasVariant": variants}]})
        assert f"V{MAX_VARIANTS - 1}" in result
        assert f"V{MAX_VARIANTS}" not in result
        assert f"and {80 - MAX_VARIANTS} more variants" in result

    def test_product_offers_list(self):
        result = format_structured_data(
            {
                "json_ld": [
                    {
                        "@type": "Product",
                        "name": "Multi",
                        "offers": [
                            {"price": "10.00", "priceCurrency": "EUR", "availability": "https://schema.org/InStock"},
                            {"price": "15.00", "priceCurrency": "EUR", "availability": "https://schema.org/OutOfStock"},
                        ],
                    }
                ]
            }
        )
        assert "### Pricing" in result
        assert "EUR 10.00" in result
        assert "EUR 15.00" in result
        assert "OutOfStock" in result

    def test_product_aggregate_rating(self):
        result = format_structured_data(
            {
                "json_ld": [
                    {
                        "@type": "Product",
                        "name": "Rated",
                        "aggregateRating": {"ratingValue": "4.5", "reviewCount": "120"},
                    }
                ]
            }
        )
        assert "4.5/5" in result
        assert "120 reviews" in result

    def test_faq_page(self):
        result = format_structured_data(
            {
                "json_ld": [
                    {
                        "@type": "FAQPage",
                        "mainEntity": [
                            {
                                "name": "What is this?",
                                "acceptedAnswer": {"text": "It is a thing."},
                            },
                            {
                                "name": "How much?",
                                "acceptedAnswer": {"text": "Free."},
                            },
                        ],
                    }
                ]
            }
        )
        assert "## FAQ" in result
        assert "What is this?" in result
        assert "It is a thing." in result
        assert "How much?" in result

    def test_recipe(self):
        result = format_structured_data(
            {
                "json_ld": [
                    {
                        "@type": "Recipe",
                        "name": "Pancakes",
                        "prepTime": "PT10M",
                        "cookTime": "PT15M",
                        "recipeYield": "4 servings",
                        "recipeIngredient": ["2 cups flour", "1 cup milk"],
                        "recipeInstructions": [
                            {"text": "Mix ingredients."},
                            {"text": "Cook on griddle."},
                        ],
                    }
                ]
            }
        )
        assert "## Recipe: Pancakes" in result
        assert "Prep time: PT10M" in result
        assert "2 cups flour" in result
        assert "Mix ingredients." in result

    def test_opengraph_selective(self):
        result = format_structured_data(
            {
                "opengraph": {
                    "title": "Should be skipped",
                    "description": "Should be skipped",
                    "url": "https://example.com",
                    "price:amount": "29.99",
                    "price:currency": "USD",
                    "locale": "en_US",
                }
            }
        )
        assert "title" not in result.split("OpenGraph")[1] if "OpenGraph" in result else True
        assert "price:amount: 29.99" in result
        assert "price:currency: USD" in result
        assert "locale: en_US" in result

    def test_opengraph_all_skipped(self):
        result = format_structured_data(
            {
                "opengraph": {
                    "title": "Title",
                    "description": "Desc",
                    "url": "https://x.com",
                    "type": "website",
                }
            }
        )
        assert result == ""

    def test_output_capped(self):
        many_faqs = [
            {"name": f"Question {i} " + "x" * 200, "acceptedAnswer": {"text": f"Answer {i} " + "y" * 300}}
            for i in range(50)
        ]
        result = format_structured_data({"json_ld": [{"@type": "FAQPage", "mainEntity": many_faqs}]})
        assert len(result) <= MAX_OUTPUT_CHARS + 50
        assert "*(truncated)*" in result

    def test_nested_graph_list(self):
        result = format_structured_data(
            {
                "json_ld": [
                    [
                        {"@type": "Recipe", "name": "Pancakes", "prepTime": "PT10M"},
                        {"@type": "WebSite", "name": "Example"},
                    ]
                ]
            }
        )
        assert "## Recipe: Pancakes" in result
        assert "WebSite" not in result

    def test_malformed_data_graceful(self):
        assert format_structured_data({"json_ld": "not a list"}) == ""
        assert format_structured_data({"json_ld": [None]}) == ""
        assert format_structured_data({"json_ld": [{"@type": "Product", "offers": "bad"}]}) == ""

    def test_idempotency(self):
        data = {
            "json_ld": [
                {
                    "@type": "Product",
                    "name": "Test",
                    "brand": {"name": "Brand"},
                    "hasVariant": [
                        {
                            "name": "V1",
                            "offers": {"price": "10", "priceCurrency": "USD"},
                            "sku": "S1",
                        }
                    ],
                }
            ],
            "opengraph": {"price:amount": "10", "locale": "en"},
        }
        result1 = format_structured_data(data)
        result2 = format_structured_data(data)
        assert result1 == result2

    def test_starts_with_separator(self):
        result = format_structured_data({"json_ld": [{"@type": "Product", "name": "X", "offers": {"price": "1"}}]})
        assert result.startswith("---\n\n")

    def test_generic_jsonld_type(self):
        result = format_structured_data(
            {
                "json_ld": [
                    {
                        "@type": "JobPosting",
                        "title": "Engineer",
                        "hiringOrganization": "Acme",
                        "datePosted": "2026-01-01",
                    }
                ]
            }
        )
        assert "## JobPosting" in result
        assert "title: Engineer" in result

    def test_list_type_field(self):
        result = format_structured_data({"json_ld": [{"@type": ["Product", "Thing"], "name": "Multi-type"}]})
        assert "## Product: Multi-type" in result

    def test_brand_as_string(self):
        result = format_structured_data({"json_ld": [{"@type": "Product", "name": "P", "brand": "SimpleBrand"}]})
        assert "Brand: SimpleBrand" in result

    def test_mixed_json_ld_and_og(self):
        result = format_structured_data(
            {
                "json_ld": [{"@type": "Product", "name": "Item", "offers": {"price": "5"}}],
                "opengraph": {"price:amount": "5.00"},
            }
        )
        assert "## Product: Item" in result
        assert "price:amount: 5.00" in result
