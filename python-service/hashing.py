import hashlib

def calculate_sha256(data_bytes: bytes) -> str:
    """Calculates SHA-256 hash of given byte sequence."""
    hasher = hashlib.sha256()
    hasher.update(data_bytes)
    return hasher.hexdigest()

def calculate_file_sha256(file_path: str) -> str:
    """Calculates SHA-256 hash of a file by reading chunks."""
    hasher = hashlib.sha256()
    with open(file_path, "rb") as f:
        while chunk := f.read(65536):
            hasher.update(chunk)
    return hasher.hexdigest()
