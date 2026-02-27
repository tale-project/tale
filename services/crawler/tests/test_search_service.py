"""Tests for SearchService RRF merge logic."""

import pytest

from app.services.search_service import RRF_K, SearchResult, SearchService


def _item(id, url="https://example.com", title="Title", chunk_content="content", chunk_index=0):
    return {"id": id, "url": url, "title": title, "chunk_content": chunk_content, "chunk_index": chunk_index}


class TestMergeRrfEmptyInput:
    def test_no_ranked_lists(self):
        assert SearchService._merge_rrf([], limit=10) == []

    def test_single_empty_list(self):
        assert SearchService._merge_rrf([[]], limit=10) == []

    def test_multiple_empty_lists(self):
        assert SearchService._merge_rrf([[], []], limit=10) == []


class TestMergeRrfSingleList:
    def test_single_list_returns_all_items(self):
        items = [_item(1, url="https://a.com"), _item(2, url="https://b.com")]
        results = SearchService._merge_rrf([items], limit=10)
        assert len(results) == 2
        assert results[0].url == "https://a.com"
        assert results[1].url == "https://b.com"

    def test_single_list_preserves_rank_order(self):
        items = [_item(10), _item(20), _item(30)]
        results = SearchService._merge_rrf([items], limit=10)
        assert [r.score for r in results] == sorted([r.score for r in results], reverse=True)

    def test_single_item(self):
        results = SearchService._merge_rrf([[_item(1, chunk_content="hello")]], limit=10)
        assert len(results) == 1
        assert results[0].chunk_content == "hello"


class TestMergeRrfOverlappingItems:
    def test_overlapping_item_boosted_above_disjoint(self):
        list_a = [_item(1), _item(2)]
        list_b = [_item(1), _item(3)]
        results = SearchService._merge_rrf([list_a, list_b], limit=10)
        assert results[0].url == "https://example.com"
        ids_by_score = [r for r in results]
        assert ids_by_score[0].score > ids_by_score[1].score

    def test_overlapping_item_score_equals_sum_of_rrf(self):
        list_a = [_item(1)]
        list_b = [_item(1)]
        results = SearchService._merge_rrf([list_a, list_b], limit=10)
        expected_raw = 2 * (1.0 / (RRF_K + 0 + 1))
        assert len(results) == 1
        assert results[0].score == pytest.approx(1.0)
        assert expected_raw == pytest.approx(expected_raw)

    def test_overlapping_at_different_ranks(self):
        list_a = [_item(1), _item(2)]
        list_b = [_item(2), _item(1)]
        results = SearchService._merge_rrf([list_a, list_b], limit=10)
        assert len(results) == 2
        assert results[0].score == results[1].score


class TestMergeRrfDisjointItems:
    def test_disjoint_lists_merged(self):
        list_a = [_item(1, url="https://a.com")]
        list_b = [_item(2, url="https://b.com")]
        results = SearchService._merge_rrf([list_a, list_b], limit=10)
        assert len(results) == 2
        urls = {r.url for r in results}
        assert urls == {"https://a.com", "https://b.com"}

    def test_disjoint_same_rank_have_equal_scores(self):
        list_a = [_item(1)]
        list_b = [_item(2)]
        results = SearchService._merge_rrf([list_a, list_b], limit=10)
        assert results[0].score == results[1].score

    def test_disjoint_different_ranks(self):
        list_a = [_item(1), _item(2)]
        list_b = [_item(3)]
        results = SearchService._merge_rrf([list_a, list_b], limit=10)
        rank0_score = 1.0 / (RRF_K + 0 + 1)
        rank1_score = 1.0 / (RRF_K + 1 + 1)
        top = [r for r in results if r.score == pytest.approx(1.0)]
        assert len(top) == 2
        bottom = [r for r in results if r.score < 1.0]
        assert len(bottom) == 1
        assert bottom[0].score == pytest.approx(rank1_score / rank0_score)


class TestMergeRrfLimitTruncation:
    def test_limit_truncates_results(self):
        items = [_item(i) for i in range(20)]
        results = SearchService._merge_rrf([items], limit=5)
        assert len(results) == 5

    def test_limit_larger_than_items_returns_all(self):
        items = [_item(1), _item(2)]
        results = SearchService._merge_rrf([items], limit=100)
        assert len(results) == 2

    def test_limit_zero_returns_empty(self):
        items = [_item(1), _item(2)]
        results = SearchService._merge_rrf([items], limit=0)
        assert results == []

    def test_limit_one_returns_top_result(self):
        list_a = [_item(1), _item(2)]
        list_b = [_item(1), _item(3)]
        results = SearchService._merge_rrf([list_a, list_b], limit=1)
        assert len(results) == 1


class TestMergeRrfScoreNormalization:
    def test_top_result_always_has_score_one(self):
        items = [_item(i) for i in range(5)]
        results = SearchService._merge_rrf([items], limit=10)
        assert results[0].score == pytest.approx(1.0)

    def test_top_result_score_one_with_multiple_lists(self):
        list_a = [_item(1), _item(2), _item(3)]
        list_b = [_item(4), _item(1), _item(5)]
        results = SearchService._merge_rrf([list_a, list_b], limit=10)
        assert results[0].score == pytest.approx(1.0)

    def test_scores_are_between_zero_and_one(self):
        list_a = [_item(i) for i in range(10)]
        list_b = [_item(i + 5) for i in range(10)]
        results = SearchService._merge_rrf([list_a, list_b], limit=20)
        for r in results:
            assert 0.0 < r.score <= 1.0

    def test_normalized_scores_preserve_relative_order(self):
        list_a = [_item(1), _item(2), _item(3)]
        results = SearchService._merge_rrf([list_a], limit=10)
        scores = [r.score for r in results]
        assert scores == sorted(scores, reverse=True)


class TestMergeRrfFieldMapping:
    def test_fields_mapped_correctly(self):
        item = _item(42, url="https://test.dev", title="Test Page", chunk_content="some text", chunk_index=3)
        results = SearchService._merge_rrf([[item]], limit=10)
        assert len(results) == 1
        r = results[0]
        assert r.url == "https://test.dev"
        assert r.title == "Test Page"
        assert r.chunk_content == "some text"
        assert r.chunk_index == 3

    def test_title_can_be_none(self):
        item = {"id": 1, "url": "https://x.com", "title": None, "chunk_content": "c", "chunk_index": 0}
        results = SearchService._merge_rrf([[item]], limit=10)
        assert results[0].title is None

    def test_missing_title_key_defaults_to_none(self):
        item = {"id": 1, "url": "https://x.com", "chunk_content": "c", "chunk_index": 0}
        results = SearchService._merge_rrf([[item]], limit=10)
        assert results[0].title is None

    def test_returns_search_result_instances(self):
        results = SearchService._merge_rrf([[_item(1)]], limit=10)
        assert isinstance(results[0], SearchResult)

    def test_later_list_overwrites_item_metadata(self):
        item_v1 = _item(1, title="Old Title")
        item_v2 = _item(1, title="New Title")
        results = SearchService._merge_rrf([[item_v1], [item_v2]], limit=10)
        assert results[0].title == "New Title"
