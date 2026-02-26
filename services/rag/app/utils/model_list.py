"""Utilities for parsing comma-separated model lists from environment variables."""


def parse_model_list(value: str | None) -> list[str]:
    """Parse a comma-separated model list into a list of trimmed, non-empty strings."""
    if not value:
        return []
    return [m.strip() for m in value.split(",") if m.strip()]


def get_first_model(value: str | None) -> str | None:
    """Get the first model from a comma-separated model list."""
    models = parse_model_list(value)
    return models[0] if models else None


def get_first_model_or_raise(value: str | None, var_name: str) -> str:
    """Get the first model from a comma-separated model list, or raise if none available."""
    model = get_first_model(value)
    if not model:
        raise ValueError(f"{var_name} is not set or contains no valid models.")
    return model
