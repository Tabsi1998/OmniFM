"""scripts/local_check.py: --changed and the npm ci skip (#553).

Here because the backend group of the local check and the CI run this folder;
local_check.py needs nothing but the standard library.
"""

import hashlib
import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
_spec = importlib.util.spec_from_file_location("local_check", ROOT / "scripts" / "local_check.py")
local_check = importlib.util.module_from_spec(_spec)
# dataclasses look the module up by name while it loads.
sys.modules.setdefault("local_check", local_check)
_spec.loader.exec_module(local_check)

EVERYTHING = set(local_check.GROUPS)
FINGERPRINT = {"packages": "abc", "node": "v22.23.5", "npm": "10.9.8", "platform": "Windows-AMD64"}


def test_documentation_alone_runs_the_repository_group():
    groups, reason = local_check.changed_groups(
        ["README.md", "docs/discord-design.md", ".claude/skills/x/SKILL.md", "LICENSE", "backend/README.md"])
    assert groups == {"repository"}
    assert reason == "documentation only"


def test_no_changes_run_the_repository_group():
    assert local_check.changed_groups([])[0] == {"repository"}


def test_frontend_alone_leaves_out_only_backend():
    groups, _ = local_check.changed_groups(["frontend/src/App.jsx", "frontend/package.json", "docs/a.md"])
    # node stays: ESLint lints frontend/src and the unit suite reads the frontend.
    assert groups == {"repository", "node", "frontend", "extra"}


def test_code_outside_frontend_runs_everything():
    assert local_check.changed_groups(["frontend/src/App.jsx", "src/index.js"])[0] == EVERYTHING
    assert local_check.changed_groups(["package-lock.json"])[0] == EVERYTHING
    assert local_check.changed_groups(["scripts/local_check.py", "README.md"])[0] == EVERYTHING


def test_the_changelog_counts_as_code():
    # test/release.test.js reads CHANGELOG.md in the unit suite.
    assert local_check.changed_groups(["CHANGELOG.md"])[0] == EVERYTHING


def make_install(tmp_path, packages=("a", "@scope/b")):
    modules = tmp_path / "node_modules"
    entries = {"": {"name": "app"}}
    for name in packages:
        (modules / name).mkdir(parents=True)
        (modules / name / "package.json").write_text("{}", encoding="utf-8")
        entries[f"node_modules/{name}"] = {"version": "1.0.0"}
    hidden = modules / ".package-lock.json"
    hidden.write_text(json.dumps({"packages": entries}), encoding="utf-8")
    marker = {"fingerprint": FINGERPRINT, "installed": {"hidden-lockfile": hashlib.sha256(hidden.read_bytes()).hexdigest()}}
    (modules / local_check.INSTALL_MARKER).write_text(json.dumps(marker), encoding="utf-8")
    return modules


def test_an_unchanged_install_is_current(tmp_path):
    make_install(tmp_path)
    assert local_check.install_is_current(tmp_path, FINGERPRINT) == (True, "unchanged")


def test_without_a_marker_npm_ci_runs(tmp_path):
    modules = make_install(tmp_path)
    (modules / local_check.INSTALL_MARKER).unlink()
    assert local_check.install_is_current(tmp_path, FINGERPRINT) == (False, "no install marker")


def test_new_package_files_node_or_npm_install_again(tmp_path):
    make_install(tmp_path)
    for key in FINGERPRINT:
        changed = dict(FINGERPRINT, **{key: "other"})
        assert local_check.install_is_current(tmp_path, changed)[0] is False, key


def test_a_tree_changed_through_npm_installs_again(tmp_path):
    modules = make_install(tmp_path)
    hidden = modules / ".package-lock.json"
    data = json.loads(hidden.read_text(encoding="utf-8"))
    data["packages"]["node_modules/a"]["version"] = "2.0.0"
    hidden.write_text(json.dumps(data), encoding="utf-8")
    assert local_check.install_is_current(tmp_path, FINGERPRINT) == (False, "node_modules/.package-lock.json changed")


def test_a_partly_deleted_tree_installs_again(tmp_path):
    modules = make_install(tmp_path)
    (modules / "@scope" / "b" / "package.json").unlink()
    assert local_check.install_is_current(tmp_path, FINGERPRINT) == (False, "node_modules/@scope/b is missing")
