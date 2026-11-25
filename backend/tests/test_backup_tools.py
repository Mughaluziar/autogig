"""Exercise the Database Tools wrapper without connecting to any service."""
import os
import stat
import subprocess
import sys
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[2] / "scripts" / "backup"


def test_backup_uses_private_config_and_retains_newest_archive(tmp_path):
    archive_dir = tmp_path / "private backups"
    tool = tmp_path / "dump.py"
    tool.write_text("""
import json
import os
import stat
import sys
from pathlib import Path

config = Path(next(arg.split("=", 1)[1] for arg in sys.argv if arg.startswith("--config=")))
assert stat.S_IMODE(config.stat().st_mode) == 0o600
assert json.loads(config.read_text())["uri"] == os.environ["MONGODB_URI"]
assert not any(os.environ["MONGODB_URI"] in arg for arg in sys.argv)
sys.stdout.buffer.write(b"synthetic archive")
""")
    env = {
        **os.environ, "MONGODB_URI": "mongodb://unused.example.invalid",
        "MONGODB_DB": "backup_fixture", "BACKUP_DIR": str(archive_dir), "KEEP": "1",
        "PYTHON": sys.executable, "TMPDIR": str(tmp_path), "MONGODUMP": f"{sys.executable} {tool}",
    }
    command = ["bash", str(TOOLS / "mongo-backup.sh")]
    first = Path(subprocess.run(command, env=env, check=True, capture_output=True, text=True).stdout.strip())
    second = Path(subprocess.run(command, env=env, check=True, capture_output=True, text=True).stdout.strip())
    assert not first.exists()
    assert second.read_bytes() == b"synthetic archive"
    assert stat.S_IMODE(second.stat().st_mode) == 0o600
    assert not list(tmp_path.glob("autogig-mongo.*"))


def test_restore_refuses_source_database_before_connecting(tmp_path):
    result = subprocess.run(
        ["bash", str(TOOLS / "mongo-restore.sh"), str(tmp_path / "archive.gz"), "source"],
        env={**os.environ, "MONGODB_URI": "mongodb://unused.example.invalid",
             "MONGODB_DB": "source", "CONFIRM_OVERWRITE": "no"},
        capture_output=True, text=True,
    )
    assert result.returncode == 2
    assert "Refusing to restore over the source database." in result.stderr
