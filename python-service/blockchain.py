import sqlite3
import json
import os
from datetime import datetime, timezone
from hashing import calculate_sha256

DB_FILE = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "storage", "data", "blockchain.db"))

class Blockchain:
    def __init__(self, db_path=DB_FILE):
        self.db_path = db_path
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
        self._init_db()

    def _get_connection(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self):
        with self._get_connection() as conn:
            cursor = conn.cursor()
            # Each block belongs to one citizen (or Genesis) and stores all documents in certificates_data JSON
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS blocks (
                    block_number INTEGER PRIMARY KEY,
                    citizen_identifier TEXT UNIQUE NOT NULL,
                    citizen_name TEXT NOT NULL,
                    certificates_data TEXT NOT NULL,
                    merkle_root_hash TEXT NOT NULL,
                    issuer_key_id TEXT NOT NULL,
                    timestamp TEXT NOT NULL,
                    previous_hash TEXT NOT NULL,
                    block_hash TEXT NOT NULL
                )
            """)
            conn.commit()

        # Check if genesis block exists
        if self.get_chain_length() == 0:
            self.create_genesis_block()

    def compute_block_hash(self, block_number: int, citizen_identifier: str, merkle_root_hash: str, issuer_key_id: str, timestamp: str, previous_hash: str) -> str:
        """Deterministic block hash calculation incorporating citizen identity and document root hash."""
        block_string = f"{block_number}:{citizen_identifier}:{merkle_root_hash}:{issuer_key_id}:{timestamp}:{previous_hash}"
        return calculate_sha256(block_string.encode('utf-8'))

    def compute_documents_hash(self, certs_list: list) -> str:
        """Calculates a deterministic cryptographic digest across all certificates in citizen's block."""
        if not certs_list:
            return "0" * 64
        # Sort documents by certificate_id for determinism
        sorted_certs = sorted(certs_list, key=lambda x: x.get("certificate_id", ""))
        combined_string = "|".join([f"{c.get('certificate_id')}:{c.get('certificate_hash')}" for c in sorted_certs])
        return calculate_sha256(combined_string.encode('utf-8'))

    def create_genesis_block(self):
        timestamp = "2026-01-01T00:00:00Z"
        citizen_id = "SYSTEM-GENESIS"
        citizen_name = "National Genesis Authority"
        certs_data = json.dumps([])
        merkle_root = "0" * 64
        issuer_key_id = "SYSTEM-GENESIS-KEY"
        previous_hash = "0" * 64
        block_hash = self.compute_block_hash(0, citizen_id, merkle_root, issuer_key_id, timestamp, previous_hash)

        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO blocks (block_number, citizen_identifier, citizen_name, certificates_data, merkle_root_hash, issuer_key_id, timestamp, previous_hash, block_hash)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (0, citizen_id, citizen_name, certs_data, merkle_root, issuer_key_id, timestamp, previous_hash, block_hash))
            conn.commit()

    def get_last_block(self):
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM blocks ORDER BY block_number DESC LIMIT 1")
            row = cursor.fetchone()
            if row:
                d = dict(row)
                d["certificates_list"] = json.loads(d["certificates_data"])
                return d
            return None

    def get_chain_length(self):
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) FROM blocks")
            return cursor.fetchone()[0]

    def get_block_by_citizen(self, citizen_identifier: str):
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM blocks WHERE citizen_identifier = ?", (citizen_identifier,))
            row = cursor.fetchone()
            if row:
                d = dict(row)
                d["certificates_list"] = json.loads(d["certificates_data"])
                return d
            return None

    def add_or_update_citizen_certificate(self, citizen_identifier: str, citizen_name: str, cert_dict: dict, issuer_key_id: str) -> dict:
        """
        One block per citizen:
        - If citizen does not have a block yet: mints a brand-new block linked to previous_hash.
        - If citizen already has a block: appends the new certificate into their existing block and recomputes the block hash.
        """
        timestamp = datetime.now(timezone.utc).isoformat()
        existing_block = self.get_block_by_citizen(citizen_identifier)

        if existing_block:
            # Update existing citizen block with new document
            certs = existing_block["certificates_list"]
            # Avoid duplicate certificate_id
            certs = [c for c in certs if c.get("certificate_id") != cert_dict.get("certificate_id")]
            certs.append(cert_dict)
            certs_json = json.dumps(certs)
            merkle_root = self.compute_documents_hash(certs)

            block_hash = self.compute_block_hash(
                existing_block["block_number"],
                citizen_identifier,
                merkle_root,
                issuer_key_id,
                timestamp,
                existing_block["previous_hash"]
            )

            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    UPDATE blocks
                    SET certificates_data = ?, merkle_root_hash = ?, timestamp = ?, block_hash = ?
                    WHERE citizen_identifier = ?
                """, (certs_json, merkle_root, timestamp, block_hash, citizen_identifier))
                conn.commit()

            self._cascade_rehash(existing_block["block_number"] + 1)

            return {
                "block_number": existing_block["block_number"],
                "citizen_identifier": citizen_identifier,
                "citizen_name": citizen_name,
                "certificates_count": len(certs),
                "merkle_root_hash": merkle_root,
                "issuer_key_id": issuer_key_id,
                "timestamp": timestamp,
                "previous_hash": existing_block["previous_hash"],
                "block_hash": block_hash,
                "updated": True
            }
        else:
            # Mint new block for this citizen
            last_block = self.get_last_block()
            next_block_number = (last_block["block_number"] + 1) if last_block else 0
            previous_hash = last_block["block_hash"] if last_block else "0" * 64

            certs = [cert_dict]
            certs_json = json.dumps(certs)
            merkle_root = self.compute_documents_hash(certs)

            block_hash = self.compute_block_hash(
                next_block_number,
                citizen_identifier,
                merkle_root,
                issuer_key_id,
                timestamp,
                previous_hash
            )

            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    INSERT INTO blocks (block_number, citizen_identifier, citizen_name, certificates_data, merkle_root_hash, issuer_key_id, timestamp, previous_hash, block_hash)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (next_block_number, citizen_identifier, citizen_name, certs_json, merkle_root, issuer_key_id, timestamp, previous_hash, block_hash))
                conn.commit()

            return {
                "block_number": next_block_number,
                "citizen_identifier": citizen_identifier,
                "citizen_name": citizen_name,
                "certificates_count": len(certs),
                "merkle_root_hash": merkle_root,
                "issuer_key_id": issuer_key_id,
                "timestamp": timestamp,
                "previous_hash": previous_hash,
                "block_hash": block_hash,
                "updated": False
            }

    def _cascade_rehash(self, from_block_number: int):
        """Ensures subsequent blocks update previous_hash and block_hash if an earlier block was updated."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM blocks WHERE block_number >= ? ORDER BY block_number ASC", (from_block_number,))
            rows = cursor.fetchall()
            for r in rows:
                b_num = r["block_number"]
                if b_num == 0:
                    continue
                cursor.execute("SELECT block_hash FROM blocks WHERE block_number = ?", (b_num - 1,))
                prev_row = cursor.fetchone()
                if not prev_row:
                    continue
                prev_hash = prev_row[0]
                new_hash = self.compute_block_hash(
                    b_num,
                    r["citizen_identifier"],
                    r["merkle_root_hash"],
                    r["issuer_key_id"],
                    r["timestamp"],
                    prev_hash
                )
                cursor.execute("UPDATE blocks SET previous_hash = ?, block_hash = ? WHERE block_number = ?", (prev_hash, new_hash, b_num))
            conn.commit()

    def revoke_citizen_certificate(self, citizen_identifier: str, certificate_id: str, reason: str, issuer_key_id: str) -> dict:
        """
        Officially revokes an identity card anchored in a citizen's block.
        Updates card status to REVOKED, re-computes document root and cascades block hash.
        """
        timestamp = datetime.now(timezone.utc).isoformat()
        existing_block = self.get_block_by_citizen(citizen_identifier) if citizen_identifier else None
        if not existing_block:
            for b in self.get_all_blocks():
                for c in b["certificates_list"]:
                    if c.get("certificate_id") == certificate_id:
                        existing_block = b
                        citizen_identifier = b["citizen_identifier"]
                        break
                if existing_block:
                    break

        if not existing_block:
            return {"error": "Citizen block containing this certificate was not found"}

        certs = existing_block["certificates_list"]
        found = False
        for c in certs:
            if c.get("certificate_id") == certificate_id:
                c["status"] = "REVOKED"
                c["revocation_reason"] = reason
                c["revocation_date"] = timestamp
                found = True
                break

        if not found:
            return {"error": f"Certificate {certificate_id} not found in citizen block"}

        certs_json = json.dumps(certs)
        merkle_root = self.compute_documents_hash(certs)

        block_hash = self.compute_block_hash(
            existing_block["block_number"],
            citizen_identifier,
            merkle_root,
            issuer_key_id,
            timestamp,
            existing_block["previous_hash"]
        )

        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                UPDATE blocks
                SET certificates_data = ?, merkle_root_hash = ?, timestamp = ?, block_hash = ?
                WHERE citizen_identifier = ?
            """, (certs_json, merkle_root, timestamp, block_hash, citizen_identifier))
            conn.commit()

        self._cascade_rehash(existing_block["block_number"] + 1)

        return {
            "success": True,
            "block_number": existing_block["block_number"],
            "citizen_identifier": citizen_identifier,
            "certificate_id": certificate_id,
            "status": "REVOKED",
            "revocation_reason": reason,
            "revocation_date": timestamp,
            "merkle_root_hash": merkle_root,
            "block_hash": block_hash
        }

    def get_block_by_certificate_id(self, certificate_id: str):
        """Searches across all citizen blocks for a certificate ID."""
        blocks = self.get_all_blocks()
        for b in blocks:
            for c in b["certificates_list"]:
                if c.get("certificate_id") == certificate_id:
                    res = dict(b)
                    res["matching_certificate"] = c
                    return res
        return None

    def get_block_by_hash(self, cert_hash: str):
        """Searches across all citizen blocks for a certificate SHA-256 hash."""
        clean_hash = cert_hash.strip().lower()
        blocks = self.get_all_blocks()
        for b in blocks:
            for c in b["certificates_list"]:
                if c.get("certificate_hash", "").strip().lower() == clean_hash:
                    res = dict(b)
                    res["matching_certificate"] = c
                    return res
        return None

    def get_all_blocks(self):
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM blocks ORDER BY block_number ASC")
            blocks = []
            for row in cursor.fetchall():
                d = dict(row)
                d["certificates_list"] = json.loads(d["certificates_data"])
                blocks.append(d)
            return blocks

    def validate_chain(self) -> dict:
        """Validates hash integrity across all citizen blocks in the chain."""
        blocks = self.get_all_blocks()
        if not blocks:
            return {"is_valid": False, "error": "Chain is empty"}

        for i in range(len(blocks)):
            current = blocks[i]

            # Recompute document root hash
            calc_merkle = self.compute_documents_hash(current["certificates_list"])
            if current["merkle_root_hash"] != calc_merkle:
                return {
                    "is_valid": False,
                    "error": f"Block #{current['block_number']} ({current['citizen_name']}) documents integrity compromised!"
                }

            # Recompute block hash
            expected_hash = self.compute_block_hash(
                current["block_number"],
                current["citizen_identifier"],
                current["merkle_root_hash"],
                current["issuer_key_id"],
                current["timestamp"],
                current["previous_hash"]
            )
            if current["block_hash"] != expected_hash:
                return {
                    "is_valid": False,
                    "error": f"Block #{current['block_number']} block hash mismatch!"
                }

            # Check previous hash link
            if i > 0:
                previous = blocks[i - 1]
                if current["previous_hash"] != previous["block_hash"]:
                    return {
                        "is_valid": False,
                        "error": f"Block #{current['block_number']} previous_hash link broken! Points to {current['previous_hash']}, expected {previous['block_hash']}"
                    }

        return {"is_valid": True, "total_blocks": len(blocks), "message": "Citizen Blockchain Ledger verified successfully"}
