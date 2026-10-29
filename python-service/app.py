import os
import json
from flask import Flask, request, jsonify
from hashing import calculate_sha256, calculate_file_sha256
from signatures import sign_data, verify_signature, get_public_key_pem, ISSUER_KEY_ID
from blockchain import Blockchain
from pdf_generator import generate_certificate_pdf

app = Flask(__name__)
blockchain = Blockchain()

STORAGE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "storage", "certificates"))
os.makedirs(STORAGE_DIR, exist_ok=True)

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "service": "python-blockchain-service"})

@app.route("/keys/public", methods=["GET"])
def get_public_key():
    return jsonify({
        "issuer_key_id": ISSUER_KEY_ID,
        "public_key_pem": get_public_key_pem()
    })

@app.route("/issue-certificate", methods=["POST"])
def issue_certificate():
    """
    1. Generates PDF
    2. Hashes PDF bytes (SHA-256)
    3. Signs PDF bytes with Government RSA Private Key
    4. Records hash and metadata on Blockchain
    5. Returns cert_id, hash, signature, and block data
    """
    json_data = request.get_json(silent=True) or {}
    cert_id = request.form.get("certificate_id") or json_data.get("certificate_id")
    cert_type = request.form.get("certificate_type") or json_data.get("certificate_type", "General")
    recipient_name = request.form.get("recipient_name") or json_data.get("recipient_name", "Anonymous Citizen")
    issue_date = request.form.get("issue_date") or json_data.get("issue_date")
    details = json_data.get("details", {})
    if not details and request.form.get("remarks"):
        details = {"remarks": request.form.get("remarks")}

    if not cert_id:
        return jsonify({"error": "certificate_id is required"}), 400

    pdf_filename = f"{cert_id}.pdf"
    pdf_path = os.path.join(STORAGE_DIR, pdf_filename)

    # 1. Obtain PDF bytes: either from uploaded file or generate new
    if 'file' in request.files:
        uploaded = request.files['file']
        uploaded.save(pdf_path)
        with open(pdf_path, "rb") as f:
            pdf_bytes = f.read()
    elif json_data.get("file_path") and os.path.exists(json_data.get("file_path")):
        import shutil
        shutil.copyfile(json_data.get("file_path"), pdf_path)
        with open(pdf_path, "rb") as f:
            pdf_bytes = f.read()
    else:
        generate_certificate_pdf(pdf_path, cert_id, cert_type, recipient_name, issue_date, details)
        with open(pdf_path, "rb") as f:
            pdf_bytes = f.read()

    # Extract citizen identifier (e.g. username, email or ID)
    citizen_identifier = request.form.get("citizen_identifier") or json_data.get("citizen_identifier") or recipient_name.lower().replace(" ", "_")

    # 2. Calculate SHA-256 hash
    cert_hash = calculate_sha256(pdf_bytes)

    # 3. Sign bytes with Government RSA Private Key
    signature_base64 = sign_data(pdf_bytes)

    # 4. Add/Update Document inside Citizen's Block
    cert_record = {
        "certificate_id": cert_id,
        "certificate_type": cert_type,
        "recipient_name": recipient_name,
        "certificate_hash": cert_hash,
        "signature": signature_base64,
        "issue_date": issue_date,
        "issuer_key_id": ISSUER_KEY_ID,
        "status": "ACTIVE"
    }

    block = blockchain.add_or_update_citizen_certificate(
        citizen_identifier=citizen_identifier,
        citizen_name=recipient_name,
        cert_dict=cert_record,
        issuer_key_id=ISSUER_KEY_ID
    )

    return jsonify({
        "success": True,
        "certificate_id": cert_id,
        "certificate_hash": cert_hash,
        "signature": signature_base64,
        "issuer_key_id": ISSUER_KEY_ID,
        "block": block,
        "pdf_path": pdf_path
    })

@app.route("/verify-certificate", methods=["POST"])
def verify_certificate():
    """
    Independent Verification Workflow:
    Accepts raw PDF bytes (or file upload) + optional signature.
    Performs:
    1. Reads submitted certificate bytes
    2. Calculates SHA-256 hash
    3. Obtains Government Public Key & verifies RSA signature
    4. Retrieves matching block from blockchain
    5. Compares submitted hash vs blockchain hash
    6. Returns granular diagnostic report
    """
    json_data = request.get_json(silent=True) or {}
    signature = request.form.get("signature") or json_data.get("signature")
    cert_id = request.form.get("certificate_id") or json_data.get("certificate_id")
    cert_bytes = None

    if 'file' in request.files:
        uploaded_file = request.files['file']
        cert_bytes = uploaded_file.read()
    elif not json_data and request.data:
        cert_bytes = request.data
    elif json_data and "file_path" in json_data:
        with open(json_data["file_path"], "rb") as f:
            cert_bytes = f.read()

    # Support Hash-Only Verification (Employer entering public hash or cert ID)
    input_hash = request.form.get("certificate_hash") or json_data.get("certificate_hash")

    if not cert_bytes and not input_hash and not cert_id:
        return jsonify({"error": "Certificate file content or public hash is required for verification"}), 400

    # If verifying by file
    if cert_bytes:
        submitted_hash = calculate_sha256(cert_bytes)
        block = None
        if cert_id:
            block = blockchain.get_block_by_certificate_id(cert_id)
        if not block:
            block = blockchain.get_block_by_hash(submitted_hash)

        blockchain_record_found = block is not None
        matching_cert = block.get("matching_certificate") if block else None
        recorded_hash = matching_cert["certificate_hash"] if matching_cert else None
        hash_match = (blockchain_record_found and recorded_hash is not None and submitted_hash.lower() == recorded_hash.lower())

        signature_valid = False
        sig_checked = False
        if signature:
            sig_checked = True
            signature_valid = verify_signature(cert_bytes, signature)

        if not blockchain_record_found:
            status = "NOT_FOUND"
            verdict = "DOCUMENT UNVERIFIED (No Citizen Blockchain Record Found)"
        elif matching_cert and matching_cert.get("status") == "REVOKED":
            status = "REVOKED"
            verdict = f"DOCUMENT REVOKED (This document was officially REVOKED by Government Authority on {matching_cert.get('revocation_date', 'N/A')[:10]}. Reason: {matching_cert.get('revocation_reason', 'Not specified')})"
        elif not hash_match:
            status = "TAMPERED"
            verdict = "DOCUMENT REJECTED (Hash Mismatch - Document Content Modified)"
        elif sig_checked and not signature_valid:
            status = "INVALID_SIGNATURE"
            verdict = "DOCUMENT REJECTED (Government RSA Signature Invalid)"
        else:
            status = "VERIFIED"
            verdict = "DOCUMENT VERIFIED (Anchored on Citizen Blockchain)"

        return jsonify({
            "status": status,
            "final_result": verdict,
            "verification_mode": "FILE_AUDIT",
            "checks": {
                "blockchain_record_found": blockchain_record_found,
                "certificate_hash": submitted_hash,
                "blockchain_hash": recorded_hash,
                "hash_match": hash_match,
                "signature_provided": sig_checked,
                "signature_valid": signature_valid if sig_checked else None
            },
            "block": block,
            "certificate": matching_cert
        })

    # If verifying by Public Hash directly
    lookup_hash = (input_hash or "").strip()
    block = None
    if lookup_hash:
        block = blockchain.get_block_by_hash(lookup_hash)
    if not block and cert_id:
        block = blockchain.get_block_by_certificate_id(cert_id)

    if block:
        matching_cert = block.get("matching_certificate") or {}
        rec_hash = matching_cert.get("certificate_hash") or lookup_hash
        hash_match = True if not lookup_hash or rec_hash.lower() == lookup_hash.lower() else False
        is_revoked = matching_cert.get("status") == "REVOKED"

        if is_revoked:
            status = "REVOKED"
            verdict = f"DOCUMENT REVOKED (This document was officially REVOKED by Government Authority on {matching_cert.get('revocation_date', 'N/A')[:10]}. Reason: {matching_cert.get('revocation_reason', 'Not specified')})"
        elif hash_match:
            status = "VERIFIED"
            verdict = "DOCUMENT VERIFIED (Anchored on Citizen Blockchain)"
        else:
            status = "TAMPERED"
            verdict = "DOCUMENT REJECTED (Hash Mismatch)"

        return jsonify({
            "status": status,
            "final_result": verdict,
            "verification_mode": "HASH_LOOKUP",
            "checks": {
                "blockchain_record_found": True,
                "certificate_hash": lookup_hash or rec_hash,
                "blockchain_hash": rec_hash,
                "hash_match": hash_match,
                "signature_provided": False,
                "signature_valid": None
            },
            "block": block,
            "certificate": matching_cert
        })
    else:
        return jsonify({
            "status": "NOT_FOUND",
            "final_result": "DOCUMENT UNVERIFIED (Hash Not Found on Blockchain)",
            "verification_mode": "HASH_LOOKUP",
            "checks": {
                "blockchain_record_found": False,
                "certificate_hash": lookup_hash,
                "blockchain_hash": None,
                "hash_match": False,
                "signature_provided": False,
                "signature_valid": None
            },
            "block": None,
            "certificate": None
        })

    return jsonify({
        "status": status,
        "final_result": verdict,
        "checks": {
            "blockchain_record_found": blockchain_record_found,
            "certificate_hash": submitted_hash,
            "blockchain_hash": recorded_hash,
            "hash_match": hash_match,
            "signature_provided": sig_checked,
            "signature_valid": signature_valid if sig_checked else None
        },
        "block": block
    })

@app.route("/blockchain/blocks", methods=["GET"])
def get_blocks():
    return jsonify({
        "total": blockchain.get_chain_length(),
        "blocks": blockchain.get_all_blocks()
    })

@app.route("/blockchain/validate", methods=["GET"])
def validate_chain():
    result = blockchain.validate_chain()
    return jsonify(result)

@app.route("/blockchain/tamper-test", methods=["POST"])
def tamper_test():
    """Security demonstration endpoint that intentionally tampers with a block to demonstrate detection."""
    data = request.json or {}
    block_num = data.get("block_number", 1)
    new_fake_hash = "f" * 64

    import sqlite3
    conn = sqlite3.connect(blockchain.db_path)
    cursor = conn.cursor()
    cursor.execute("UPDATE blocks SET merkle_root_hash = ? WHERE block_number = ?", (new_fake_hash, block_num))
    conn.commit()
    conn.close()

    val_res = blockchain.validate_chain()
    return jsonify({
        "tampered_block": block_num,
        "validation_after_tamper": val_res
    })

@app.route("/revoke-certificate", methods=["POST"])
def revoke_certificate():
    """
    Officially revokes an identity card anchored on the citizen's blockchain block.
    """
    json_data = request.get_json(silent=True) or {}
    cert_id = request.form.get("certificate_id") or json_data.get("certificate_id")
    citizen_identifier = request.form.get("citizen_identifier") or json_data.get("citizen_identifier")
    reason = request.form.get("reason") or json_data.get("reason", "Revoked by Government Authority")

    if not cert_id:
        return jsonify({"error": "certificate_id is required"}), 400

    result = blockchain.revoke_citizen_certificate(
        citizen_identifier=citizen_identifier,
        certificate_id=cert_id,
        reason=reason,
        issuer_key_id=ISSUER_KEY_ID
    )

    if "error" in result:
        return jsonify(result), 404

    return jsonify(result)

if __name__ == "__main__":
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", 5001))
    print(f"Starting Python Blockchain Service on {host}:{port}...")
    app.run(host=host, port=port, debug=False)
