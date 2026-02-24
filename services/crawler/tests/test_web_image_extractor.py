"""Tests for web_image_extractor module."""

from unittest.mock import AsyncMock, patch

import httpx
import pytest

from app.services.web_image_extractor import (
    MAX_IMAGES_TO_PROCESS,
    MIN_IMAGE_BYTES,
    _filter_image_candidates,
    extract_and_describe_images,
)


class TestFilterImageCandidates:
    """Tests for _filter_image_candidates()."""

    def test_returns_absolute_urls(self):
        images = [{"src": "/images/photo.jpg", "score": 5.0}]
        result = _filter_image_candidates(images, "https://example.com/page")
        assert result == ["https://example.com/images/photo.jpg"]

    def test_filters_data_uris(self):
        images = [
            {"src": "data:image/png;base64,abc123", "score": 5.0},
            {"src": "https://example.com/real.jpg", "score": 3.0},
        ]
        result = _filter_image_candidates(images, "https://example.com")
        assert len(result) == 1
        assert result[0] == "https://example.com/real.jpg"

    def test_filters_svg_extensions(self):
        images = [{"src": "https://example.com/icon.svg", "score": 5.0}]
        result = _filter_image_candidates(images, "https://example.com")
        assert result == []

    def test_filters_ico_extensions(self):
        images = [{"src": "https://example.com/favicon.ico", "score": 5.0}]
        result = _filter_image_candidates(images, "https://example.com")
        assert result == []

    def test_filters_gif_extensions(self):
        images = [{"src": "https://example.com/anim.gif", "score": 5.0}]
        result = _filter_image_candidates(images, "https://example.com")
        assert result == []

    def test_deduplicates_urls(self):
        images = [
            {"src": "https://example.com/img.jpg", "score": 5.0},
            {"src": "https://example.com/img.jpg", "score": 3.0},
        ]
        result = _filter_image_candidates(images, "https://example.com")
        assert len(result) == 1

    def test_sorts_by_score_descending(self):
        images = [
            {"src": "https://example.com/low.jpg", "score": 1.0},
            {"src": "https://example.com/high.jpg", "score": 10.0},
            {"src": "https://example.com/mid.jpg", "score": 5.0},
        ]
        result = _filter_image_candidates(images, "https://example.com")
        assert result == [
            "https://example.com/high.jpg",
            "https://example.com/mid.jpg",
            "https://example.com/low.jpg",
        ]

    def test_caps_at_max_images(self):
        images = [{"src": f"https://example.com/img{i}.jpg", "score": float(i)} for i in range(20)]
        result = _filter_image_candidates(images, "https://example.com")
        assert len(result) == MAX_IMAGES_TO_PROCESS

    def test_returns_empty_for_empty_input(self):
        result = _filter_image_candidates([], "https://example.com")
        assert result == []

    def test_skips_images_with_no_src(self):
        images = [{"alt": "no src", "score": 5.0}, {"src": "", "score": 3.0}]
        result = _filter_image_candidates(images, "https://example.com")
        assert result == []

    def test_resolves_relative_urls(self):
        images = [{"src": "../images/photo.jpg", "score": 5.0}]
        result = _filter_image_candidates(images, "https://example.com/pages/about")
        assert result == ["https://example.com/images/photo.jpg"]

    def test_keeps_jpg_png_webp(self):
        images = [
            {"src": "https://example.com/a.jpg", "score": 3.0},
            {"src": "https://example.com/b.png", "score": 2.0},
            {"src": "https://example.com/c.webp", "score": 1.0},
        ]
        result = _filter_image_candidates(images, "https://example.com")
        assert len(result) == 3


class TestExtractAndDescribeImages:
    """Tests for extract_and_describe_images()."""

    async def test_returns_empty_for_no_images(self):
        descriptions, vision_used = await extract_and_describe_images([], "https://example.com")
        assert descriptions == []
        assert vision_used is False

    async def test_returns_empty_when_all_filtered(self):
        images = [{"src": "data:image/png;base64,tiny", "score": 5.0}]
        descriptions, vision_used = await extract_and_describe_images(images, "https://example.com")
        assert descriptions == []
        assert vision_used is False

    @patch("app.services.web_image_extractor.vision_client")
    @patch("app.services.web_image_extractor.httpx.AsyncClient")
    async def test_happy_path_describes_images(self, mock_client_cls, mock_vision):
        image_bytes = b"\x89PNG" + b"\x00" * MIN_IMAGE_BYTES

        mock_response = AsyncMock()
        mock_response.content = image_bytes
        mock_response.raise_for_status = lambda: None

        mock_client = AsyncMock()
        mock_client.get = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        mock_client_cls.return_value = mock_client

        mock_vision.describe_image = AsyncMock(return_value="A photo of a sunset")

        images = [{"src": "https://example.com/sunset.jpg", "score": 5.0}]
        descriptions, vision_used = await extract_and_describe_images(images, "https://example.com")

        assert len(descriptions) == 1
        assert descriptions[0] == "[Image: A photo of a sunset]"
        assert vision_used is True

    @patch("app.services.web_image_extractor.vision_client")
    @patch("app.services.web_image_extractor.httpx.AsyncClient")
    async def test_skips_small_images(self, mock_client_cls, mock_vision):
        tiny_bytes = b"\x89PNG" + b"\x00" * 100  # Way below MIN_IMAGE_BYTES

        mock_response = AsyncMock()
        mock_response.content = tiny_bytes
        mock_response.raise_for_status = lambda: None

        mock_client = AsyncMock()
        mock_client.get = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        mock_client_cls.return_value = mock_client

        images = [{"src": "https://example.com/tiny.jpg", "score": 5.0}]
        descriptions, vision_used = await extract_and_describe_images(images, "https://example.com")

        assert descriptions == []
        assert vision_used is False
        mock_vision.describe_image.assert_not_called()

    @patch("app.services.web_image_extractor.vision_client")
    @patch("app.services.web_image_extractor.httpx.AsyncClient")
    async def test_handles_download_failure(self, mock_client_cls, mock_vision):
        mock_client = AsyncMock()
        mock_client.get = AsyncMock(side_effect=httpx.HTTPError("Connection failed"))
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        mock_client_cls.return_value = mock_client

        images = [{"src": "https://example.com/broken.jpg", "score": 5.0}]
        descriptions, vision_used = await extract_and_describe_images(images, "https://example.com")

        assert descriptions == []
        assert vision_used is False

    @patch("app.services.web_image_extractor.vision_client")
    @patch("app.services.web_image_extractor.httpx.AsyncClient")
    async def test_handles_vision_api_failure(self, mock_client_cls, mock_vision):
        image_bytes = b"\x89PNG" + b"\x00" * MIN_IMAGE_BYTES

        mock_response = AsyncMock()
        mock_response.content = image_bytes
        mock_response.raise_for_status = lambda: None

        mock_client = AsyncMock()
        mock_client.get = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        mock_client_cls.return_value = mock_client

        mock_vision.describe_image = AsyncMock(side_effect=Exception("API error"))

        images = [{"src": "https://example.com/photo.jpg", "score": 5.0}]
        descriptions, vision_used = await extract_and_describe_images(images, "https://example.com")

        assert descriptions == []
        assert vision_used is False

    @patch("app.services.web_image_extractor.vision_client")
    @patch("app.services.web_image_extractor.httpx.AsyncClient")
    async def test_skips_empty_descriptions(self, mock_client_cls, mock_vision):
        image_bytes = b"\x89PNG" + b"\x00" * MIN_IMAGE_BYTES

        mock_response = AsyncMock()
        mock_response.content = image_bytes
        mock_response.raise_for_status = lambda: None

        mock_client = AsyncMock()
        mock_client.get = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        mock_client_cls.return_value = mock_client

        mock_vision.describe_image = AsyncMock(return_value="")

        images = [{"src": "https://example.com/blank.jpg", "score": 5.0}]
        descriptions, vision_used = await extract_and_describe_images(images, "https://example.com")

        assert descriptions == []
        assert vision_used is False
