"""Private supporting documents for credit applications."""
import base64

import pytest

from conftest import bearer, signup
from test_credit import APP, freelancer, pool

PDF = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
JPG = b"\xff\xd8\xff\xe0" + b"\x00" * 32


def b64(data):
    return base64.b64encode(data).decode()


@pytest.fixture
def owner(client):
    return bearer(signup(client, email="owner@example.com")["token"])


@pytest.fixture
def setup(client, owner):
    pool(client, owner)
    fl = freelancer(client, owner)
    app_id = client.post("/api/credit/applications", headers=fl, json=APP).json()["id"]
    return fl, app_id


def upload(client, fl, app_id, data, label="Brief"):
    return client.post(f"/api/credit/applications/{app_id}/documents", headers=fl, json={"label": label, "contentBase64": b64(data)})


def test_pdf_png_and_jpeg_are_accepted_and_listed(client, setup):
    fl, app_id = setup
    for data in (PDF, PNG, JPG):
        assert upload(client, fl, app_id, data).status_code == 200
    docs = client.get("/api/credit/applications", headers=fl).json()[0]["documents"]
    assert [d["mime"] for d in docs] == ["application/pdf", "image/png", "image/jpeg"] and all("data" not in d and "sha256" not in d for d in docs)


@pytest.mark.parametrize("data", [b"<html><script>alert(1)</script></html>", b"MZ\x90\x00 an executable", b"GIF89a....", b"PK\x03\x04 zip", b"%pdf-lowercase"])
def test_files_are_judged_by_their_content_not_their_name(client, setup, data):
    fl, app_id = setup
    res = upload(client, fl, app_id, data, label="invoice.pdf")
    assert res.status_code == 422 and "PDF, PNG or JPEG" in res.json()["detail"]


def test_size_count_label_and_encoding_limits(client, setup):
    fl, app_id = setup
    assert upload(client, fl, app_id, PDF + b"0" * (2 * 1024 * 1024)).status_code == 422
    assert upload(client, fl, app_id, b"").status_code == 422
    assert client.post(f"/api/credit/applications/{app_id}/documents", headers=fl, json={"label": "x", "contentBase64": "not base64!!"}).status_code == 422
    assert client.post(f"/api/credit/applications/{app_id}/documents", headers=fl, json={"label": "", "contentBase64": b64(PDF)}).status_code == 422
    for _ in range(3):
        assert upload(client, fl, app_id, PDF).status_code == 200
    assert upload(client, fl, app_id, PDF).status_code == 409                         # a fourth


def test_download_is_private_forced_to_download_and_never_rendered(client, owner, setup):
    fl, app_id = setup
    doc = upload(client, fl, app_id, PDF, label='x"; filename="evil.html').json()
    res = client.get(f"/api/credit/documents/{doc['id']}", headers=fl)
    assert res.status_code == 200 and res.content == PDF
    assert res.headers["content-disposition"] == 'attachment; filename="document-1.pdf"'      # generated, never the typed label
    assert res.headers["content-type"] == "application/pdf" and res.headers["x-content-type-options"] == "nosniff"
    assert "no-store" in res.headers["cache-control"] and "sandbox" in res.headers["content-security-policy"]
    assert res.headers["cross-origin-resource-policy"] == "same-origin"
    assert res.headers["x-robots-tag"] == "noindex, noarchive"
    assert client.get(f"/api/credit/documents/{doc['id']}").status_code == 401                # anonymous
    other = freelancer(client, owner, "other@example.com")
    assert client.get(f"/api/credit/documents/{doc['id']}", headers=other).status_code == 404
    assert client.get(f"/api/credit/documents/{doc['id']}", headers=owner).status_code == 200


def test_documents_can_be_added_or_removed_only_before_review(client, owner, setup):
    fl, app_id = setup
    doc = upload(client, fl, app_id, PDF).json()
    assert client.delete(f"/api/credit/applications/{app_id}/documents/{doc['id']}", headers=fl).status_code == 200
    assert client.get(f"/api/credit/documents/{doc['id']}", headers=fl).status_code == 404
    keep = upload(client, fl, app_id, PNG).json()
    from test_credit import offer
    assert offer(client, owner, app_id).status_code == 200
    assert upload(client, fl, app_id, PDF).status_code == 404                                # frozen once offered
    assert client.delete(f"/api/credit/applications/{app_id}/documents/{keep['id']}", headers=fl).status_code == 404
    assert client.get(f"/api/credit/documents/{keep['id']}", headers=fl).status_code == 200  # still readable by its owner


def test_the_document_bytes_never_appear_in_listings_exports_or_audit(client, owner, setup):
    fl, app_id = setup
    upload(client, fl, app_id, PDF)
    assert b64(PDF) not in client.get("/api/credit/applications", headers=fl).text
    assert b64(PDF) not in client.get("/api/credit/admin/applications", headers=owner).text
    assert b64(PDF) not in client.get("/api/credit/admin/audit", headers=owner).text


def test_documents_are_deleted_with_the_account_data_map_and_never_exported_as_bytes():
    from app import datarights
    coll = datarights.DATA_MAP["credit_documents"]
    assert coll.action == "delete" and "data" in coll.exclude


def test_upload_rejects_oversized_chunked_body(setup, client, monkeypatch):
    from app.credit import service

    fl, app_id = setup
    monkeypatch.setattr(service, "MAX_DOC_BYTES", 1024)
    chunks = (b" " * 512 for _ in range(5))
    result = client.post(f"/api/credit/applications/{app_id}/documents",
                         headers={**fl, "Content-Type": "application/json"}, content=chunks)
    assert result.status_code == 413
    assert client.get("/api/credit/applications", headers=fl).json()[0]["documents"] == []
