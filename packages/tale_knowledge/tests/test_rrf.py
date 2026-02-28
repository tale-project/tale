"""Tests for Reciprocal Rank Fusion merge."""

from tale_knowledge.retrieval.rrf import merge_rrf


class TestMergeRrf:
    def test_single_list(self):
        results = [
            [{"id": 1, "text": "a"}, {"id": 2, "text": "b"}],
        ]
        merged = merge_rrf(results, limit=2)
        assert len(merged) == 2
        assert merged[0]["id"] == 1
        assert merged[1]["id"] == 2

    def test_two_lists_overlap(self):
        list1 = [{"id": 1, "text": "a"}, {"id": 2, "text": "b"}]
        list2 = [{"id": 2, "text": "b"}, {"id": 3, "text": "c"}]
        merged = merge_rrf([list1, list2], limit=3)
        # id=2 appears in both lists, should rank highest
        assert merged[0]["id"] == 2

    def test_limit(self):
        results = [[{"id": i, "text": f"item-{i}"} for i in range(10)]]
        merged = merge_rrf(results, limit=3)
        assert len(merged) == 3

    def test_empty_lists(self):
        merged = merge_rrf([[], []], limit=5)
        assert merged == []

    def test_empty_input(self):
        merged = merge_rrf([], limit=5)
        assert merged == []

    def test_custom_id_key(self):
        results = [[{"doc_id": "a", "text": "hello"}, {"doc_id": "b", "text": "world"}]]
        merged = merge_rrf(results, limit=2, id_key="doc_id")
        assert merged[0]["doc_id"] == "a"

    def test_scores_normalized_to_one(self):
        results = [[{"id": 1, "text": "a"}, {"id": 2, "text": "b"}]]
        merged = merge_rrf(results, limit=2)
        assert merged[0]["rrf_score"] == 1.0
        assert 0 < merged[1]["rrf_score"] < 1.0

    def test_custom_k(self):
        list1 = [{"id": 1}, {"id": 2}]
        list2 = [{"id": 2}, {"id": 1}]
        merged_k10 = merge_rrf([list1, list2], limit=2, k=10)
        merged_k100 = merge_rrf([list1, list2], limit=2, k=100)
        # Both should still have id=1 and id=2 with score 1.0 (tied)
        assert len(merged_k10) == 2
        assert len(merged_k100) == 2
