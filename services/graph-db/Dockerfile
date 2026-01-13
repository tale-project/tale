# Version argument - injected by CI from git tag, defaults to 'dev' for local builds
ARG VERSION=dev

FROM python:3.11-slim

# Re-declare VERSION arg (ARGs don't persist after FROM)
ARG VERSION=dev

WORKDIR /app

# Install uv for faster package management
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Copy pyproject.toml and install dependencies
COPY pyproject.toml .
RUN uv pip install --system .

# Copy application code
COPY app/ ./app/

# Create data directory
RUN mkdir -p /data

# Set version environment variable
ENV TALE_VERSION=${VERSION}

# Expose port
EXPOSE 8000

# Run the application
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

