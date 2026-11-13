"""Upwork alert-email parser. FIXTURES ARE SYNTHETIC: written to match the shape of
alert emails, not copied from real Upwork mail (see app/upwork_alerts.py)."""
from app import upwork_alerts as ua

DIGEST_HTML = """
<html><head><style>.x{color:red}</style></head><body>
<p>Jobs that match your saved search</p>
<table>
 <tr><td><a href="https://www.upwork.com/jobs/React-dashboard-developer_~01a1b2c3d4e5f6a7b8?source=alert&amp;ref=1">React dashboard developer</a></td></tr>
 <tr><td>Hourly: $40.00 - $70.00</td></tr>
 <tr><td>Posted: 12 minutes ago</td></tr>
 <tr><td>We need an experienced React engineer to build an analytics dashboard with charts and auth. More</td></tr>
 <tr><td>Skills: React, TypeScript, Chart.js</td></tr>
 <tr><td>Proposals: Less than 5</td></tr>
 <tr><td><a href="https://www.upwork.com/jobs/~01a1b2c3d4e5f6a7b8">View job</a></td></tr>
 <tr><td><a href="https://www.upwork.com/nx/find-work/best-matches/details/~02ffeeddccbbaa9988">Python data pipeline &amp; API</a></td></tr>
 <tr><td>Fixed-price: $1,500</td></tr>
 <tr><td>Build a small ETL pipeline and a FastAPI service.</td></tr>
 <tr><td>Skills: Python, FastAPI, PostgreSQL</td></tr>
 <tr><td><a href="https://www.upwork.com/jobs/~02ffeeddccbbaa9988">View job</a></td></tr>
</table>
<p><a href="https://www.upwork.com/ab/notification-settings/">Manage email notifications</a></p>
<p>Upwork, Inc. unsubscribe</p>
<a href="https://evil.example.com/jobs/~01deadbeefdeadbeef99">Fake job on another domain</a>
</body></html>
"""


def test_digest_yields_each_job_once_with_fields():
    jobs = ua.parse_alert("Jobs matching: react", html_body=DIGEST_HTML)
    assert [j.job_id for j in jobs] == ["01a1b2c3d4e5f6a7b8", "02ffeeddccbbaa9988"]
    first, second = jobs
    assert first.title == "React dashboard developer"
    assert first.url == "https://www.upwork.com/jobs/~01a1b2c3d4e5f6a7b8"      # tracking params dropped
    assert (first.rate_type, first.budget_min, first.budget) == ("hourly", 40.0, 70.0)
    assert first.skills == ["React", "TypeScript", "Chart.js"]
    assert "analytics dashboard" in first.description and "Skills:" not in first.description
    assert first.posted_text == "12 minutes ago" and first.proposals_text == "Less than 5"
    assert second.title == "Python data pipeline & API"
    assert (second.rate_type, second.budget, second.budget_min) == ("fixed", 1500.0, None)
    assert second.skills == ["Python", "FastAPI", "PostgreSQL"]
    assert "unsubscribe" not in second.description.lower() and "Manage email" not in second.description


def test_links_on_other_domains_and_non_job_links_are_ignored():
    jobs = ua.parse_alert("x", html_body=DIGEST_HTML)
    assert all("evil.example.com" not in j.url for j in jobs)
    assert ua.parse_alert("x", html_body='<a href="https://www.upwork.com/ab/messages/">Inbox</a>') == []


def test_single_job_plain_text_alert_uses_subject_for_title():
    text = ("Hi,\nA new job matches your profile.\n"
            "https://www.upwork.com/jobs/~0123456789abcdef01\n"
            "Hourly: $25 - $45/hr\nSkills: WordPress, PHP\n"
            "Fix a broken checkout on a WooCommerce store.\n"
            "Unsubscribe: https://www.upwork.com/unsub\n")
    jobs = ua.parse_alert("New job: WooCommerce checkout fix", text_body=text)
    assert len(jobs) == 1
    j = jobs[0]
    assert j.title == "WooCommerce checkout fix"
    assert (j.rate_type, j.budget_min, j.budget) == ("hourly", 25.0, 45.0)
    assert j.skills == ["WordPress", "PHP"]
    assert "WooCommerce store" in j.description


def test_email_without_job_links_creates_nothing():
    assert ua.parse_alert("Your payment", text_body="Your invoice is ready. $500 was paid.") == []
    assert ua.parse_alert("", "", "") == []


def test_unparseable_fields_are_left_empty_not_invented():
    jobs = ua.parse_alert("New job: Mystery", text_body="https://www.upwork.com/jobs/~0123456789abcdef02\n")
    j = jobs[0]
    assert j.budget is None and j.rate_type is None and j.skills == [] and j.description == ""


def test_same_job_repeated_in_one_email_is_one_job():
    html = ('<a href="https://www.upwork.com/jobs/~0a0a0a0a0a0a0a0a0a">Build an iOS app</a> $2,000 budget'
            '<a href="https://www.upwork.com/jobs/~0a0a0a0a0a0a0a0a0a?x=1">Apply now</a>')
    assert len(ua.parse_alert("s", html_body=html)) == 1


def test_dedupe_key_is_stable_across_url_variants_and_emails():
    a = ua.parse_alert("s", html_body='<a href="https://www.upwork.com/jobs/Title_~0123456789abcdef03?a=1">T</a>')[0]
    b = ua.parse_alert("s2", html_body='<a href="https://www.upwork.com/nx/x/~0123456789ABCDEF03">T2</a>')[0]
    assert a.dedupe_key == b.dedupe_key == "upwork:0123456789abcdef03"


def test_manual_job_takes_id_only_from_a_real_upwork_url():
    assert ua.manual_job("t", "https://www.upwork.com/jobs/~0123456789abcdef04").job_id == "0123456789abcdef04"
    spoof = ua.manual_job("t", "https://evil.example.com/jobs/~0123456789abcdef04")
    assert spoof.job_id is None
    assert spoof.dedupe_key.startswith("upwork-h:")


def test_listing_fields_have_radar_shape_and_cap_sizes():
    j = ua.ParsedJob(job_id="01", title="T" * 500, url="u", description="d" * 9000, skills=["s"] * 40)
    f = j.listing_fields("2026-01-01T00:00:00Z")
    assert len(f["title"]) == 300 and len(f["description"]) == 4000 and len(f["tags"]) == 12
    assert f["source"] == ua.SOURCE and f["kind"] == "gig"
