"""Where the weekly scores document is kept.

One setting picks the location on both sides: the job's --output (or the
WILDFIRE_MODEL_URI environment variable) and the API's WILDFIRE_MODEL_URI.

    data/wildfire_model.json             A local file (relative to backend/)
    s3://my-bucket/wildfire/latest.json  An S3 object (needs boto3 and AWS credentials)

To keep it somewhere else (for example a Supabase table), add a class with the
same three methods and a branch in open_store. Nothing else changes.
"""

import os
from pathlib import Path
from typing import Protocol


class ScoresStore(Protocol):
    """A single stored document that can be versioned, read and replaced."""

    def version(self) -> str | None:
        """Return a token that changes whenever the document changes, or None if it doesn't exist."""
        ...

    def read(self) -> bytes:
        """Return the document's bytes. Raises FileNotFoundError if it doesn't exist."""
        ...

    def write(self, data: bytes) -> None:
        """Replace the document atomically, so a reader never sees half of it."""
        ...

    def describe(self) -> str:
        """Return the location, for logs and /api/health."""
        ...


class LocalFileStore:
    def __init__(self, path: Path) -> None:
        """Keep the document in a local file.

        Args:
            path: The file. Its folder is created on first write.
        Called by: open_store.
        """
        self.path = path

    def version(self) -> str | None:
        """Return the file's modification time and size, or None if it's missing.

        Called by: app/services/wildfire_model.WildfireModelSource.current.
        """
        try:
            stat = self.path.stat()
        except FileNotFoundError:
            return None
        return f"{stat.st_mtime_ns}:{stat.st_size}"

    def read(self) -> bytes:
        """Read the file.

        Raises:
            FileNotFoundError: If it doesn't exist.
        Called by: app/services/wildfire_model.WildfireModelSource.current.
        """
        return self.path.read_bytes()

    def write(self, data: bytes) -> None:
        """Write to a temporary file, then rename it over the old one.

        Called by: ml/wildfire/predict_week.publish.
        """
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(self.path.suffix + ".tmp")
        tmp.write_bytes(data)
        tmp.replace(self.path)

    def describe(self) -> str:
        """Return the file path. Called by: logs and status."""
        return str(self.path)


class S3Store:
    def __init__(self, bucket: str, key: str) -> None:
        """Keep the document in one S3 object. boto3 is imported on first use.

        Credentials come from boto3's usual chain: the Lambda or task role on AWS,
        or AWS_PROFILE / environment variables locally. The writer needs
        s3:PutObject on the key, and the API needs s3:GetObject (HEAD uses it too).

        Args:
            bucket: Bucket name.
            key: Object key, e.g. "wildfire/latest.json".
        Called by: open_store.
        """
        self.bucket = bucket
        self.key = key
        self._client = None

    def _s3(self):
        """Create the boto3 client once.

        Returns:
            A boto3 S3 client.
        Raises:
            ImportError: If boto3 isn't installed (pip install boto3).
        Called by: version, read, write.
        """
        if self._client is None:
            import boto3  # Only needed once the scores live on S3

            self._client = boto3.client("s3")
        return self._client

    def version(self) -> str | None:
        """Return the object's ETag, or None if it doesn't exist.

        Called by: app/services/wildfire_model.WildfireModelSource.current.
        """
        from botocore.exceptions import ClientError

        try:
            head = self._s3().head_object(Bucket=self.bucket, Key=self.key)
        except ClientError as error:
            if error.response.get("Error", {}).get("Code") in ("404", "NoSuchKey", "NotFound"):
                return None
            raise
        return head["ETag"]

    def read(self) -> bytes:
        """Download the object.

        Raises:
            FileNotFoundError: If it doesn't exist.
        Called by: app/services/wildfire_model.WildfireModelSource.current.
        """
        from botocore.exceptions import ClientError

        try:
            return self._s3().get_object(Bucket=self.bucket, Key=self.key)["Body"].read()
        except ClientError as error:
            if error.response.get("Error", {}).get("Code") in ("404", "NoSuchKey", "NotFound"):
                raise FileNotFoundError(self.describe()) from error
            raise

    def write(self, data: bytes) -> None:
        """Upload the object. S3 replaces objects atomically.

        Called by: ml/wildfire/predict_week.publish.
        """
        self._s3().put_object(
            Bucket=self.bucket, Key=self.key, Body=data, ContentType="application/json"
        )

    def describe(self) -> str:
        """Return the s3:// URI. Called by: logs and status."""
        return f"s3://{self.bucket}/{self.key}"


def open_store(location: str | os.PathLike, base_dir: Path | None = None) -> ScoresStore:
    """Return the store for a location string.

    Args:
        location: "s3://bucket/key", or a file path.
        base_dir: Folder that relative file paths are resolved against. Defaults
            to the current directory.
    Returns:
        An S3Store or a LocalFileStore.
    Raises:
        ValueError: For an s3:// URI without a bucket or key.
    Called by: app/main.lifespan, ml/wildfire/predict_week.main and handler.lambda_handler.
    """
    text = os.fspath(location)
    if text.startswith("s3://"):
        bucket, _, key = text[len("s3://") :].partition("/")
        if not bucket or not key:
            raise ValueError(f"Expected s3://bucket/key, got {text!r}")
        return S3Store(bucket, key)
    path = Path(text)
    if not path.is_absolute() and base_dir is not None:
        path = base_dir / path
    return LocalFileStore(path)
