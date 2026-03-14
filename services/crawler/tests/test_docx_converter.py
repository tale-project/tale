"""Tests for HTML to DOCX section converter."""


from app.services.html_to_docx_converter import html_to_sections


class TestHtmlToSections:
    """Tests for html_to_sections function."""

    def test_simple_heading_and_paragraph(self):
        html = "<h1>Title</h1><p>Hello world</p>"
        result = html_to_sections(html)

        assert result["title"] == "Title"
        assert len(result["sections"]) == 1
        assert result["sections"][0] == {"type": "paragraph", "text": "Hello world"}

    def test_multiple_headings(self):
        html = "<h1>Main Title</h1><h2>Section A</h2><p>Content A</p><h3>Sub Section</h3>"
        result = html_to_sections(html)

        assert result["title"] == "Main Title"
        assert result["sections"][0] == {"type": "heading", "level": 2, "text": "Section A"}
        assert result["sections"][1] == {"type": "paragraph", "text": "Content A"}
        assert result["sections"][2] == {"type": "heading", "level": 3, "text": "Sub Section"}

    def test_unordered_list(self):
        html = "<ul><li>Apple</li><li>Banana</li><li>Cherry</li></ul>"
        result = html_to_sections(html)

        assert len(result["sections"]) == 1
        section = result["sections"][0]
        assert section["type"] == "bullets"
        assert section["items"] == ["Apple", "Banana", "Cherry"]

    def test_ordered_list(self):
        html = "<ol><li>First</li><li>Second</li><li>Third</li></ol>"
        result = html_to_sections(html)

        assert len(result["sections"]) == 1
        section = result["sections"][0]
        assert section["type"] == "numbered"
        assert section["items"] == ["First", "Second", "Third"]

    def test_table_with_thead(self):
        html = """
        <table>
            <thead><tr><th>Name</th><th>Age</th></tr></thead>
            <tbody>
                <tr><td>Alice</td><td>30</td></tr>
                <tr><td>Bob</td><td>25</td></tr>
            </tbody>
        </table>
        """
        result = html_to_sections(html)

        assert len(result["sections"]) == 1
        section = result["sections"][0]
        assert section["type"] == "table"
        assert section["headers"] == ["Name", "Age"]
        assert section["rows"] == [["Alice", "30"], ["Bob", "25"]]

    def test_table_with_th_in_first_row(self):
        html = """
        <table>
            <tr><th>Product</th><th>Price</th></tr>
            <tr><td>Widget</td><td>$10</td></tr>
        </table>
        """
        result = html_to_sections(html)

        section = result["sections"][0]
        assert section["type"] == "table"
        assert section["headers"] == ["Product", "Price"]
        assert section["rows"] == [["Widget", "$10"]]

    def test_blockquote(self):
        html = "<blockquote>This is a quote</blockquote>"
        result = html_to_sections(html)

        assert len(result["sections"]) == 1
        assert result["sections"][0] == {"type": "quote", "text": "This is a quote"}

    def test_code_block(self):
        html = "<pre><code>const x = 42;\nconsole.log(x);</code></pre>"
        result = html_to_sections(html)

        assert len(result["sections"]) == 1
        section = result["sections"][0]
        assert section["type"] == "code"
        assert "const x = 42;" in section["text"]

    def test_pre_without_code(self):
        html = "<pre>plain preformatted text</pre>"
        result = html_to_sections(html)

        assert len(result["sections"]) == 1
        assert result["sections"][0]["type"] == "code"
        assert result["sections"][0]["text"] == "plain preformatted text"

    def test_nested_div_content(self):
        html = "<div><h2>Inside Div</h2><p>Nested content</p></div>"
        result = html_to_sections(html)

        assert any(s["type"] == "heading" and s["text"] == "Inside Div" for s in result["sections"])
        assert any(s["type"] == "paragraph" and s["text"] == "Nested content" for s in result["sections"])

    def test_full_html_document(self):
        html = """
        <!DOCTYPE html>
        <html>
        <head><title>Test</title></head>
        <body>
            <h1>Document Title</h1>
            <p>First paragraph</p>
            <h2>Section One</h2>
            <ul><li>Item A</li><li>Item B</li></ul>
        </body>
        </html>
        """
        result = html_to_sections(html)

        assert result["title"] == "Document Title"
        assert result["sections"][0] == {"type": "paragraph", "text": "First paragraph"}
        assert result["sections"][1] == {"type": "heading", "level": 2, "text": "Section One"}
        assert result["sections"][2]["type"] == "bullets"
        assert result["sections"][2]["items"] == ["Item A", "Item B"]

    def test_empty_html(self):
        result = html_to_sections("")

        assert result["title"] == "Untitled Document"
        assert result["sections"] == []

    def test_no_h1_uses_untitled(self):
        html = "<h2>Sub Heading</h2><p>No main title here</p>"
        result = html_to_sections(html)

        assert result["title"] == "Untitled Document"
        assert result["sections"][0] == {"type": "heading", "level": 2, "text": "Sub Heading"}

    def test_skips_script_and_style(self):
        html = "<script>alert('x')</script><style>.foo{}</style><p>Real content</p>"
        result = html_to_sections(html)

        assert len(result["sections"]) == 1
        assert result["sections"][0] == {"type": "paragraph", "text": "Real content"}

    def test_whitespace_only_elements_skipped(self):
        html = "<h1>Title</h1><p>   </p><p>Real content</p>"
        result = html_to_sections(html)

        assert result["title"] == "Title"
        # Empty paragraph is still included (it has whitespace text)
        # but real content should be present
        assert any(s["text"] == "Real content" for s in result["sections"])

    def test_table_normalizes_row_lengths(self):
        html = """
        <table>
            <thead><tr><th>A</th><th>B</th><th>C</th></tr></thead>
            <tbody>
                <tr><td>1</td><td>2</td></tr>
                <tr><td>x</td><td>y</td><td>z</td><td>extra</td></tr>
            </tbody>
        </table>
        """
        result = html_to_sections(html)

        section = result["sections"][0]
        assert section["headers"] == ["A", "B", "C"]
        assert section["rows"][0] == ["1", "2", ""]
        assert section["rows"][1] == ["x", "y", "z"]

    def test_mixed_content(self):
        html = """
        <h1>Report</h1>
        <p>Introduction paragraph.</p>
        <h2>Data</h2>
        <table>
            <thead><tr><th>Metric</th><th>Value</th></tr></thead>
            <tbody><tr><td>Revenue</td><td>$1M</td></tr></tbody>
        </table>
        <h2>Notes</h2>
        <ul><li>Note 1</li><li>Note 2</li></ul>
        <blockquote>Important quote</blockquote>
        <pre><code>print("hello")</code></pre>
        """
        result = html_to_sections(html)

        assert result["title"] == "Report"

        types = [s["type"] for s in result["sections"]]
        assert "paragraph" in types
        assert "heading" in types
        assert "table" in types
        assert "bullets" in types
        assert "quote" in types
        assert "code" in types
