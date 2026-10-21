import os
import base64
from cryptography.hazmat.primitives.asymmetric import rsa, padding
from cryptography.hazmat.primitives import hashes, serialization

KEYS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "storage", "keys"))
PRIVATE_KEY_FILE = os.path.join(KEYS_DIR, "gov_private_key.pem")
PUBLIC_KEY_FILE = os.path.join(KEYS_DIR, "gov_public_key.pem")
ISSUER_KEY_ID = "GOV-NATIONAL-KEY-2026"

def ensure_keys_exist():
    """Generates RSA-2048 keypair if not present."""
    os.makedirs(KEYS_DIR, exist_ok=True)
    if not os.path.exists(PRIVATE_KEY_FILE) or not os.path.exists(PUBLIC_KEY_FILE):
        private_key = rsa.generate_private_key(
            public_exponent=65537,
            key_size=2048
        )
        # Save private key
        pem_private = private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption()
        )
        with open(PRIVATE_KEY_FILE, "wb") as f:
            f.write(pem_private)

        # Save public key
        pem_public = private_key.public_key().public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo
        )
        with open(PUBLIC_KEY_FILE, "wb") as f:
            f.write(pem_public)

def get_public_key_pem() -> str:
    ensure_keys_exist()
    with open(PUBLIC_KEY_FILE, "r") as f:
        return f.read()

def sign_data(data_bytes: bytes) -> str:
    """Signs bytes with government RSA private key and returns base64 signature."""
    ensure_keys_exist()
    with open(PRIVATE_KEY_FILE, "rb") as f:
        private_key = serialization.load_pem_private_key(f.read(), password=None)

    signature = private_key.sign(
        data_bytes,
        padding.PSS(
            mgf=padding.MGF1(hashes.SHA256()),
            salt_length=padding.PSS.MAX_LENGTH
        ),
        hashes.SHA256()
    )
    return base64.b64encode(signature).decode('utf-8')

def verify_signature(data_bytes: bytes, signature_base64: str, public_key_pem: str = None) -> bool:
    """Verifies RSA signature using trusted public key."""
    if not public_key_pem:
        ensure_keys_exist()
        with open(PUBLIC_KEY_FILE, "rb") as f:
            pub_bytes = f.read()
    else:
        pub_bytes = public_key_pem.encode('utf-8')

    try:
        public_key = serialization.load_pem_public_key(pub_bytes)
        signature = base64.b64decode(signature_base64)
        public_key.verify(
            signature,
            data_bytes,
            padding.PSS(
                mgf=padding.MGF1(hashes.SHA256()),
                salt_length=padding.PSS.MAX_LENGTH
            ),
            hashes.SHA256()
        )
        return True
    except Exception as e:
        return False
