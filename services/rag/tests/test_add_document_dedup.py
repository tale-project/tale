"""Tests for add_document dedup and error handling logic.

Verifies the result-processing logic after asyncio.gather in add_document:
- Content hash is only saved when ALL datasets succeed
- Any dataset failure (partial or total) raises RuntimeError
- The job is marked as failed so the caller can retry

These tests replicate the exact logic from CogneeService.add_document()
(service.py lines ~781-830) without importing heavy dependencies (cognee,
sqlalchemy, etc.) that are only available in the Docker container.
"""

import pytest


def _process_dataset_results(
    dataset_results: list,
    document_id: str | None,
    new_content_hash: str | None,
) -> tuple[dict, bool]:
    """Replicate the post-gather logic from CogneeService.add_document().

    This mirrors the exact code path at service.py lines ~781-830.

    Returns:
        (result_dict, should_save_hash) or raises RuntimeError on any failure.
    """
    total_chunks_created = 0
    result = None
    added_datasets: list[str] = []
    dataset_errors: list[BaseException] = []

    for ds_result_or_err in dataset_results:
        if isinstance(ds_result_or_err, BaseException):
            dataset_errors.append(ds_result_or_err)
            continue
        ds_name, ds_result, ds_chunks = ds_result_or_err
        added_datasets.append(ds_name)
        total_chunks_created += ds_chunks
        if result is None:
            result = ds_result

    # Any dataset failure = job failure.
    # Don't save content hash so re-upload can retry all datasets.
    if dataset_errors:
        error_summary = "; ".join(str(e) for e in dataset_errors[:3])
        raise RuntimeError(
            f"{len(dataset_errors)}/{len(dataset_results)} dataset(s) failed for document "
            f"'{document_id or 'unknown'}': {error_summary}"
        )

    # All datasets succeeded — save content hash for deduplication
    should_save_hash = bool(document_id and new_content_hash)

    return {
        "success": True,
        "document_id": document_id or "unknown",
        "chunks_created": total_chunks_created,
        "cleaned_datasets": [],
    }, should_save_hash


class TestHashSaving:
    """Content hash should only be saved when every dataset succeeds."""

    def test_hash_saved_when_all_datasets_succeed(self):
        results = [
            ("tale_team_a", {"id": "doc1", "chunks": 3}, 3),
        ]
        response, should_save = _process_dataset_results(results, "doc1", "abc123hash")
        assert response["success"] is True
        assert response["chunks_created"] == 3
        assert should_save is True

    def test_hash_saved_when_multiple_datasets_all_succeed(self):
        results = [
            ("tale_team_a", {"id": "doc1", "chunks": 3}, 3),
            ("tale_team_b", {"id": "doc1", "chunks": 5}, 5),
        ]
        response, should_save = _process_dataset_results(results, "doc1", "abc123hash")
        assert response["success"] is True
        assert response["chunks_created"] == 8
        assert should_save is True

    def test_hash_not_saved_when_no_document_id(self):
        results = [
            ("tale_team_a", {"id": "doc1", "chunks": 3}, 3),
        ]
        response, should_save = _process_dataset_results(results, None, "abc123hash")
        assert should_save is False

    def test_hash_not_saved_when_no_content_hash(self):
        results = [
            ("tale_team_a", {"id": "doc1", "chunks": 3}, 3),
        ]
        response, should_save = _process_dataset_results(results, "doc1", None)
        assert should_save is False

    def test_empty_results_no_errors_saves_hash(self):
        """Edge case: empty results with no errors should not raise.

        In practice this can't happen (target_datasets is always non-empty),
        but the code path should not crash.
        """
        response, should_save = _process_dataset_results([], "doc1", "abc123hash")
        assert response["success"] is True
        assert response["chunks_created"] == 0
        assert should_save is True


class TestDatasetFailure:
    """Any dataset failure must raise RuntimeError."""

    def test_single_dataset_fails(self):
        results = [
            RuntimeError("cognify boom"),
        ]
        with pytest.raises(RuntimeError, match=r"1/1 dataset.*failed"):
            _process_dataset_results(results, "doc1", "abc123hash")

    def test_all_datasets_fail(self):
        results = [
            RuntimeError("cognify failed for team_a"),
            TimeoutError("cognify timed out for team_b"),
        ]
        with pytest.raises(RuntimeError, match=r"2/2 dataset.*failed"):
            _process_dataset_results(results, "doc1", "abc123hash")

    def test_partial_failure_also_raises(self):
        """Even if some datasets succeed, any failure means the job fails."""
        results = [
            ("tale_team_a", {"id": "doc1", "chunks": 3}, 3),
            RuntimeError("cognify failed for team_b"),
        ]
        with pytest.raises(RuntimeError, match=r"1/2 dataset.*failed"):
            _process_dataset_results(results, "doc1", "abc123hash")

    def test_error_message_includes_document_id(self):
        results = [
            RuntimeError("some error"),
        ]
        with pytest.raises(RuntimeError, match="doc-xyz"):
            _process_dataset_results(results, "doc-xyz", "abc123hash")

    def test_error_message_truncates_at_3_errors(self):
        results = [
            RuntimeError("err1"),
            RuntimeError("err2"),
            RuntimeError("err3"),
            RuntimeError("err4"),
        ]
        with pytest.raises(RuntimeError, match=r"4/4 dataset.*failed") as exc_info:
            _process_dataset_results(results, "doc1", "abc123hash")
        assert "err4" not in str(exc_info.value)
