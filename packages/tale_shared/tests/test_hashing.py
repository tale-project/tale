"""Tests for SHA-256 hashing utilities."""

import hashlib
import tempfile
from pathlib import Path

import pytest

from tale_shared.utils.hashing import compute_content_hash, compute_file_hash


class TestComputeContentHash:
    def test_empty_bytes(self):
        expected = hashlib.sha256(b"").hexdigest()
        assert compute_content_hash(b"") == expected

    def test_known_content(self):
        content = b"hello world"
        expected = hashlib.sha256(content).hexdigest()
        assert compute_content_hash(content) == expected

    def test_deterministic(self):
        content = b"test data for dedup"
        assert compute_content_hash(content) == compute_content_hash(content)

    def test_different_content_different_hash(self):
        assert compute_content_hash(b"a") != compute_content_hash(b"b")


class TestComputeFileHash:
    def test_file_hash_matches_content_hash(self, tmp_path: Path):
        content = b"file content for hashing test"
        file_path = tmp_path / "test.txt"
        file_path.write_bytes(content)

        file_hash = compute_file_hash(file_path)
        content_hash = compute_content_hash(content)
        assert file_hash == content_hash

    def test_empty_file(self, tmp_path: Path):
        file_path = tmp_path / "empty.txt"
        file_path.write_bytes(b"")

        expected = hashlib.sha256(b"").hexdigest()
        assert compute_file_hash(file_path) == expected

    def test_large_file(self, tmp_path: Path):
        content = b"x" * 100_000
        file_path = tmp_path / "large.bin"
        file_path.write_bytes(content)

        expected = hashlib.sha256(content).hexdigest()
        assert compute_file_hash(file_path) == expected
