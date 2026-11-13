"""Turn Upwork job-alert emails into Job Radar listings.

Human-in-the-loop design: nothing here talks to Upwork. The user forwards (or
Outlook-syncs) the alert emails Upwork sends them; this module only reads the
text of those emails. No Upwork API, no login, no scraping, no automation.

IMPORTANT — verified vs assumed
  * The parser is written against the *shape* of Upwork alert emails as
    commonly seen (a job title that links to an upwork.com job URL containing
    a `~<hex id>` ciphertext, followed by budget / skills / description lines).
    It has been tested on synthetic fixtures in tests/test_upwork_alerts.py,
    NOT on real Upwork emails. Upwork can change the template at any time, so
    it is deliberately tolerant: anything it cannot find is left empty rather
    than guessed, and a job with no recognisable link is never created.
  * Validate it with 3-5 real alert emails before relying on it (see
    docs/upwork-assistant.md).
"""
import hashlib
import html as html_lib
import re
from dataclasses import dataclass, field
from urllib.parse import urlparse

SOURCE = "Upwork (email alert)"
ID_PREFIX = "upwork-email:"
CANONICAL_URL = "https://www.upwork.com/jobs/~{id}"

_JOB_ID = re.compile(r"~([0-9a-f]{16,40})", re.I)
_ANCHOR = re.compile(r"<a\b[^>]*?\bhref\s*=\s*(?:\"([^\"]*)\"|'([^']*)')[^>]*>(.*?)</a\s*>", re.I | re.S)
_BARE_URL = re.compile(r"https?://[^\s<>\"'\]\)]+", re.I)
_MARK = "⟦"  # ⟦ — never appears in real mail
_MARK_END = "⟧"
_MARKER = re.compile(_MARK + r"([^" + _MARK_END + r"]*)" + _MARK_END)
_GENERIC_ANCHOR = re.compile(
    r"^(view|see|open|apply|submit|read|click|more|details|job|proposal|here|now|\W|\d)+$", re.I)
_SUBJECT_PREFIX = re.compile(
    r"^\s*(?:re:|fwd?:)?\s*(?:new\s+)?(?:job|jobs|invitation|alert|match(?:es)?|recommended)[^:–—-]{0,30}[:–—-]\s*",
    re.I)
_FOOTER = re.compile(
    r"unsubscribe|manage (?:your )?(?:email|notification|alert)|upwork,? inc|©|all rights reserved|"
    r"you(?:'|’)re receiving this", re.I)

_MONEY = r"\$\s?([\d]{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)\s*(k)?"
_HOURLY = re.compile(
    r"(?:hourly[^$\n]{0,20})?" + _MONEY + r"(?:\s*(?:-|–|—|to)\s*\$?\s?" + _MONEY[2:] + r")?\s*(?:/\s*hr|/\s*hour|per hour|an hour)",
    re.I)
_HOURLY_LABEL = re.compile(
    r"hourly[^$\n]{0,20}" + _MONEY + r"(?:\s*(?:-|–|—|to)\s*\$?\s?" + _MONEY[2:] + r")?", re.I)
_FIXED = re.compile(r"(?:fixed[- ]?price|budget|est\.? budget|fixed)[^$\n]{0,25}" + _MONEY, re.I)
_ANY_MONEY = re.compile(_MONEY)
_SKILLS_LINE = re.compile(r"^(?:required\s+)?skills?\s*(?:&\s*expertise)?\s*[:\-]\s*(.+)$", re.I)
_LABEL_LINE = re.compile(
    r"^(?:hourly|fixed[- ]?price|budget|est\.? budget|posted|proposals?|skills?|required skills?|location|"
    r"client|country|experience level|duration|hours?(?:/week)?|payment|category|connects?|apply|view)\b\s*[:\-]", re.I)


@dataclass
class ParsedJob:
    job_id: str | None
    title: str
    url: str
    description: str = ""
    skills: list[str] = field(default_factory=list)
    rate_type: str | None = None          # "hourly" | "fixed"
    budget: float | None = None           # ceiling (hourly max, or fixed amount)
    budget_min: float | None = None
    currency: str = "USD"
    posted_text: str = ""
    proposals_text: str = ""
    location: str = ""

    @property
    def dedupe_key(self) -> str:
        if self.job_id:
            return f"upwork:{self.job_id.lower()}"
        basis = f"{self.title.lower()}|{self.budget}|{self.description[:120].lower()}"
        return "upwork-h:" + hashlib.sha256(basis.encode()).hexdigest()[:32]

    def listing_fields(self, received_at: str = "") -> dict:
        """The fields stored for the user, shaped like a Job Radar listing."""
        return {
            "title": self.title[:300],
            "company": "Upwork client",
            "source": SOURCE,
            "url": self.url,
            "tags": self.skills[:12],
            "budget": self.budget,
            "budgetMin": self.budget_min,
            "currency": self.currency,
            "rateType": self.rate_type,
            "description": self.description[:4000],
            "postedAt": received_at,
            "postedText": self.posted_text[:100],
            "proposalsText": self.proposals_text[:100],
            "location": self.location[:100],
            "upworkJobId": self.job_id,
            "kind": "gig",
        }


# --------------------------------------------------------------------------- #
# Text preparation
# --------------------------------------------------------------------------- #
def _is_upwork(url: str) -> bool:
    try:
        host = (urlparse(url).hostname or "").lower()
    except ValueError:
        return False
    return host == "upwork.com" or host.endswith(".upwork.com")


def _annotated(text_body: str, html_body: str) -> str:
    """Plain text where every link is written `anchor text ⟦url⟧` so the title,
    its link and the lines that follow stay together."""
    if html_body.strip():
        src = re.sub(r"<(script|style|head)\b[^>]*>.*?</\1\s*>", " ", html_body, flags=re.I | re.S)
        src = _ANCHOR.sub(lambda m: f" {_strip_tags(m.group(3))} {_MARK}{html_lib.unescape(m.group(1) or m.group(2) or '')}{_MARK_END} ", src)
        src = re.sub(r"<\s*br\s*/?>|</\s*(?:p|div|tr|li|h[1-6]|table|td|th)\s*>", "\n", src, flags=re.I)
        body = html_lib.unescape(re.sub(r"<[^>]*>", " ", src))
    else:
        body = text_body
        # Bare URLs in a plain-text mail: keep the line the URL is on as the "anchor".
        body = _BARE_URL.sub(lambda m: f" {_MARK}{m.group(0).rstrip('.,;')}{_MARK_END} ", body)
    lines = [re.sub(r"[ \t ]+", " ", ln).strip() for ln in body.replace("\r", "").split("\n")]
    return "\n".join(ln for ln in lines if ln)


def _strip_tags(value: str) -> str:
    return re.sub(r"\s+", " ", html_lib.unescape(re.sub(r"<[^>]*>", " ", value or ""))).strip()


# --------------------------------------------------------------------------- #
# Field extraction
# --------------------------------------------------------------------------- #
def _num(value: str, k: str | None) -> float:
    n = float(value.replace(",", ""))
    return n * 1000 if k and k.lower() == "k" else n


def _money_fields(block: str) -> tuple[str | None, float | None, float | None]:
    m = _HOURLY_LABEL.search(block) or _HOURLY.search(block)
    if m:
        # groups: lo, k1, hi, k2
        lo = _num(m.group(1), m.group(2))
        hi = _num(m.group(3), m.group(4)) if m.group(3) else None
        return "hourly", (hi if hi is not None else lo), (lo if hi is not None else None)
    m = _FIXED.search(block)
    if m:
        return "fixed", _num(m.group(1), m.group(2)), None
    return None, None, None


def _skills(block: str) -> list[str]:
    for line in block.split("\n"):
        m = _SKILLS_LINE.match(line.strip())
        if m:
            parts = re.split(r"\s*[,•·|;]\s*", m.group(1))
            return list(dict.fromkeys(p.strip(" .") for p in parts if 0 < len(p.strip()) <= 40))[:15]
    return []


def _label(block: str, pattern: str) -> str:
    m = re.search(r"^\s*" + pattern + r"\s*[:\-]\s*(.+)$", block, re.I | re.M)
    return m.group(1).strip() if m else ""


def _description(block: str, title: str) -> str:
    keep = []
    for line in block.split("\n"):
        line = line.strip()
        if not line or _MARKER.fullmatch(line) or line.lower() == title.lower():
            continue
        if _LABEL_LINE.match(line) or _GENERIC_ANCHOR.match(_MARKER.sub("", line).strip() or "x"):
            continue
        keep.append(_MARKER.sub("", line).strip())
    text = " ".join(keep)
    text = re.sub(r"\s+", " ", text).strip()
    # An email "…" teaser ends with "…" or "More"; drop the dangling UI words.
    return re.sub(r"\s*(?:\.\.\.|…)?\s*(?:more|read more|view job)\s*$", "…", text, flags=re.I)[:4000]


def _title_from_subject(subject: str) -> str:
    cleaned = _SUBJECT_PREFIX.sub("", subject or "").strip()
    return cleaned[:300]


# --------------------------------------------------------------------------- #
# Public API
# --------------------------------------------------------------------------- #
def parse_alert(subject: str, text_body: str = "", html_body: str = "") -> list[ParsedJob]:
    """Every distinct Upwork job found in one alert email (digest or single)."""
    annotated = _annotated(text_body or "", html_body or "")
    markers = [(m.start(), m.end(), m.group(1)) for m in _MARKER.finditer(annotated)]

    # job id -> list of (marker_start, marker_end, url, anchor_text, anchor_start)
    found: dict[str, list[tuple[int, int, str, str, int]]] = {}
    order: list[str] = []
    for start, end, url in markers:
        if not _is_upwork(url):
            continue
        m = _JOB_ID.search(url)
        if not m:
            continue
        job_id = m.group(1).lower()
        line_start = annotated.rfind("\n", 0, start) + 1
        anchor = _MARKER.sub("", annotated[line_start:start]).strip()
        # the anchor text is whatever precedes the marker on its line
        if job_id not in found:
            found[job_id] = []
            order.append(job_id)
        found[job_id].append((start, end, url, anchor, line_start))

    jobs: list[ParsedJob] = []
    single = len(order) == 1
    for index, job_id in enumerate(order):
        links = found[job_id]
        first = links[0]
        title = ""
        for _, _, _, anchor, _ in links:
            if anchor and len(anchor) >= 4 and not _GENERIC_ANCHOR.match(anchor):
                title = anchor
                break
        if not title and single:
            title = _title_from_subject(subject)
        title = title or "Upwork job"
        block_start = first[4]
        next_starts = [found[o][0][4] for o in order[index + 1:]]
        block_end = min(next_starts) if next_starts else len(annotated)
        block = annotated[block_start:block_end]
        foot = _FOOTER.search(block)
        if foot:
            block = block[:foot.start()]
        rate_type, budget, budget_min = _money_fields(block)
        jobs.append(ParsedJob(
            job_id=job_id, title=title, url=CANONICAL_URL.format(id=job_id),
            description=_description(block, title), skills=_skills(block),
            rate_type=rate_type, budget=budget, budget_min=budget_min,
            posted_text=_label(block, r"posted"), proposals_text=_label(block, r"proposals?"),
            location=_label(block, r"(?:client\s+)?(?:location|country)"),
        ))
    return jobs


def manual_job(title: str, url: str = "", description: str = "", skills: list[str] | None = None,
               budget: float | None = None, rate_type: str | None = None) -> ParsedJob:
    """A job the user typed or pasted in themselves (no email involved)."""
    job_id = None
    if url:
        m = _JOB_ID.search(url)
        if m and _is_upwork(url):
            job_id = m.group(1).lower()
    canonical = CANONICAL_URL.format(id=job_id) if job_id else url
    return ParsedJob(job_id=job_id, title=title.strip(), url=canonical, description=description.strip(),
                     skills=[s.strip() for s in (skills or []) if s.strip()][:15], budget=budget,
                     rate_type=rate_type if rate_type in ("hourly", "fixed") else None)
