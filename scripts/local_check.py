#!/usr/bin/env python3
"""Run every check the CI runs, on this computer.

The CI is the second, independent confirmation. This is the first: the checks
of .github/workflows/ci.yml and nightly.yml, run with the developer's own tools
and processor, plus the gates GitHub never runs.

Groups:
    repository  hygiene and search console readiness, every shell script, no
                CRLF stored, Gitleaks over the history and over uncommitted
                and new files
    node        Node 22 as package.json pins it, a locked install, the syntax
                gates, the ESLint ratchet, the native Opus codec, the Mongo
                connection smoke and the unit suite against a MongoDB of its own
    backend     the CI's Python 3.12 in an environment of its own, every module
                compiles, the FastAPI unit tests, and the owner contract driven
                end to end through a live server
    frontend    a locked install and the production build, checked for content
    extra       what GitHub does not run: npm audit, the settings contract,
                dependency licences, OSV over the lockfiles and ShellCheck

Usage:
    python scripts/local_check.py                  everything but extra
    python scripts/local_check.py --all            everything
    python scripts/local_check.py --only node      some groups
    python scripts/local_check.py --list           the steps, without running
    python scripts/local_check.py --record         refresh the ratchet baseline

Results go to .local-testing/, which Git ignores.
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import re
import shutil
import socket
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / ".local-testing"
LOGS = STATE / "logs"
BASELINE = ROOT / "scripts" / "ci-baseline.json"
WINDOWS = platform.system() == "Windows"

GROUPS = ("repository", "node", "backend", "frontend", "extra")
DEFAULT_GROUPS = ("repository", "node", "backend", "frontend")

FRONTEND = ROOT / "frontend"
BACKEND = ROOT / "backend"
# Virtual environments live outside the repository. A repository script that
# walks the whole tree - a documentation link check, for one - would otherwise
# read thousands of third-party files as if they were the project's own.
CACHE = Path.home() / ".local-ci" / ROOT.name
VENV = CACHE / "venv"

# The versions the CI uses. package.json pins Node ">=22 <23"; the FastAPI job
# sets up Python 3.12.
NODE_MAJOR = 22
BACKEND_PYTHON = "3.12"

# Ports of their own: a developer's own MongoDB on 27017, or another
# repository's stack on 8001, must neither be used nor disturbed.
MONGO_PORT = 27019
MONGO_CONTAINER = "omnifm-local-check-mongo"
API_PORT = 18001
NODE_API_PORT = 18002
PROXY_API_PORT = 18003
NODE_CONTRACT_PORT = 18004
API_TOKEN = "ci-owner-token"
MASK = "•" * 8

ENV_USE = re.compile(r"process\.env\.([A-Z][A-Z0-9_]*)|process\.env\[['\"]([A-Z][A-Z0-9_]*)['\"]\]")

# Set by the runtime or the platform, never by an operator, so .env.example
# should not promise them.
ENV_PROVIDED = {
    "NODE_ENV", "CI", "PATH", "HOME", "PWD", "TZ", "PORT", "HOSTNAME", "LANG",
    # Set by OmniFM itself or its test harness, never by an operator:
    # the split supervisor (process index and role), start.sh (DRY_RUN
    # preflight), node --test, and the backend contract test runner.
    "BOT_PROCESS_INDEX", "BOT_PROCESS_ROLE", "DRY_RUN", "NODE_TEST_CONTEXT",
    "OMNIFM_RUN_BACKEND_CONTRACT_TESTS", "OMNIFM_TEST_BASE_URL", "REACT_APP_BACKEND_URL",
    "OMNIFM_TEST_ADMIN_TOKEN",
}

ALLOWED_LICENCES = {
    "MIT", "ISC", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "0BSD", "Unlicense",
    "CC0-1.0", "BlueOak-1.0.0", "Python-2.0", "MIT-0",
}


# =============================================================================
# Shared core
#
# Every repository's local_check.py carries the same copy of this part. The
# header above it names the paths and the groups, the steps below it say what
# is checked, and nothing in here knows which repository it is in. Each copy
# stands on its own, so a repository can be checked right after a fresh clone.
# =============================================================================

PASS, FAIL, SKIP = "passed", "failed", "skipped"

# The MongoDB the CI workflows run as a service.
MONGO_IMAGE = "mongo:7.0.39-jammy"
# OSV-Scanner 2.6.0 and ShellCheck 0.11.0, pinned by digest: a scanner that
# updates itself between two runs would change the findings on its own.
OSV_IMAGE = "ghcr.io/google/osv-scanner@sha256:afd838850ac1a0fcc15ff4a041dc9ba11123c3f0d2666217a5f0fcf9222b55fa"
SHELLCHECK_IMAGE = "koalaman/shellcheck@sha256:bb596a0d169b85ddd81d8b6d3a2ff6d5baf5fca10b97f575ebc647c3dff62b3d"
# Semgrep 1.177.0 (the open-source engine), pinned by digest like the others.
SEMGREP_IMAGE = "semgrep/semgrep@sha256:acaac22ffc7b7cc5926de0751b223bce0b2491c33d18422fa72f632c78d81198"

# Git's well-known id of the empty tree. A diff against it covers every line.
EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"

TOOLCHAIN = Path.home() / ".local-toolchain"
PROGRESS = "local-check.progress.json"
REPORT = "local-check.json"

# Paths that belong to the local checks, never to the product. A snapshot of
# the repository leaves them out, so they cannot end up in a build or a scan.
LOCAL_TOOLING = (".ci-panel/", ".local-testing/")

# Variables whose names look like credentials. No check needs a real one, and a
# shell that happens to carry a live token or database password must not hand
# it to code under test. Only their names are printed.
SECRET_NAME = re.compile(
    r"TOKEN|SECRET|PASSW|CREDENTIAL|PRIVATE|API_?KEY|ENCRYPTION|_KEY$"
    r"|^(MONGO|SMTP|STRIPE|RESEND|JWT|DISCORD|ADMIN|DOLIBARR)_",
    re.IGNORECASE,
)


class StepFailed(Exception):
    """A step found a problem. The message says what, and how to fix it."""


class StepSkipped(Exception):
    """A step cannot run here. The message says why."""


@dataclass
class Step:
    group: str
    name: str
    describe: str
    action: Callable[["Context"], "str | None"]
    # Names of steps that must pass first. A bare name means the same group;
    # "group/name" reaches into another one.
    needs: tuple = ()

    @property
    def key(self) -> str:
        return f"{self.group}/{self.name}"

    def requirements(self) -> list[str]:
        return [need if "/" in need else f"{self.group}/{need}" for need in self.needs]


@dataclass
class Result:
    group: str
    name: str
    describe: str
    status: str
    detail: str = ""
    seconds: float = 0.0


@dataclass
class Context:
    env: dict
    dropped: list
    log_dir: Path
    record: bool = False
    containers: list = field(default_factory=list)
    processes: list = field(default_factory=list)
    cache: dict = field(default_factory=dict)

    def log(self, name: str, text: str) -> Path:
        self.log_dir.mkdir(parents=True, exist_ok=True)
        path = self.log_dir / f"{name}.log"
        path.write_text(text, encoding="utf-8", errors="replace")
        return path

    def run(self, *arguments, cwd: Path | None = None, env: dict | None = None,
            check: bool = True, timeout: int = 1800,
            stdin: str | None = None) -> subprocess.CompletedProcess:
        """Run one command in the cleaned environment and capture its output."""
        merged = dict(self.env)
        if env:
            merged.update(env)
        command = [str(part) for part in arguments]
        try:
            completed = subprocess.run(
                command, cwd=str(cwd or ROOT), env=merged, input=stdin,
                capture_output=True, text=True, encoding="utf-8", errors="replace",
                timeout=timeout)
        except FileNotFoundError as error:
            raise StepSkipped(f"{command[0]} is not installed: {error}") from error
        except subprocess.TimeoutExpired as error:
            raise StepFailed(f"{Path(command[0]).name} did not finish within {timeout} s") from error
        if check and completed.returncode != 0:
            raise StepFailed(tail(completed))
        return completed


def clean_environment(source: dict) -> tuple[dict, list]:
    """Split an environment into what the steps get and the names withheld."""
    kept, withheld = {}, []
    for name, value in source.items():
        if SECRET_NAME.search(name):
            withheld.append(name)
        else:
            kept[name] = value
    return kept, sorted(withheld)


def base_context(record: bool = False) -> Context:
    env, withheld = clean_environment(dict(os.environ))
    # GitHub sets CI. Some tools behave differently with it - Create React App
    # turns lint warnings into errors - so the local run sets it too.
    env["CI"] = "true"
    env.setdefault("PYTHONUTF8", "1")
    env["npm_config_fund"] = "false"
    env["npm_config_update_notifier"] = "false"
    env["COREPACK_ENABLE_DOWNLOAD_PROMPT"] = "0"
    env["DOTNET_CLI_TELEMETRY_OPTOUT"] = "1"
    STATE.mkdir(parents=True, exist_ok=True)
    return Context(env=env, dropped=withheld, log_dir=LOGS, record=record)


def tail(completed: subprocess.CompletedProcess, lines: int = 25) -> str:
    """The end of a failing command's output, which is where the reason is."""
    text = (completed.stdout or "") + (completed.stderr or "")
    kept = [line for line in text.splitlines() if line.strip()][-lines:]
    return "\n".join(kept) or f"exit code {completed.returncode}"


def tool(context: Context, name: str) -> str | None:
    return shutil.which(name, path=context.env.get("PATH"))


def require(context: Context, name: str, hint: str) -> str:
    found = tool(context, name)
    if not found:
        raise StepSkipped(f"{name} is not installed. {hint}")
    return found


def git(context: Context) -> str:
    return require(context, "git", "Install Git for Windows.")


def tracked(context: Context, *pathspecs: str, new: bool = False) -> list[str]:
    """Files Git knows, optionally with the new ones it would pick up."""
    arguments = ["ls-files", "-z", "--cached"]
    if new:
        arguments += ["--others", "--exclude-standard"]
    listed = context.run(git(context), *arguments, "--", *pathspecs).stdout.split("\0")
    return sorted({name for name in listed if name and (ROOT / name).is_file()})


def posix_bash(context: Context) -> str:
    """A real POSIX bash, never the WSL stub.

    System32\\bash.exe is the WSL launcher. It comes first on PATH in a plain
    PowerShell, it cannot read a Windows path, and it fails every script handed
    to it. A check that calls every deployment script broken teaches the
    developer to ignore it, so the stub is refused by name.
    """
    for folder in (r"C:\Program Files\Git\bin", r"C:\Program Files\Git\usr\bin"):
        candidate = Path(folder) / "bash.exe"
        if candidate.is_file():
            return str(candidate)
    found = tool(context, "bash")
    if found and "system32" not in found.lower():
        return found
    raise StepSkipped("no POSIX bash was found. Git for Windows ships one.")


def port_open(port: int) -> bool:
    with socket.socket() as probe:
        probe.settimeout(0.4)
        return probe.connect_ex(("127.0.0.1", port)) == 0


def docker(context: Context) -> str:
    if "docker" in context.cache:
        return context.cache["docker"]
    binary = require(context, "docker", "Install Docker Desktop.")
    probe = context.run(binary, "info", "--format", "{{.ServerVersion}}", check=False, timeout=90)
    if probe.returncode != 0:
        raise StepSkipped("the Docker engine is not running. Start Docker Desktop.")
    context.cache["docker"] = binary
    return binary


# ------------------------------------------------------------------ runtimes

def python_for(context: Context, version: str) -> str:
    """The interpreter of one Python version, found through the py launcher."""
    key = f"python-{version}"
    if key in context.cache:
        return context.cache[key]
    found = None
    launcher = tool(context, "py")
    if launcher:
        probe = context.run(launcher, f"-{version}", "-c", "import sys; print(sys.executable)",
                            check=False, timeout=120)
        if probe.returncode == 0 and probe.stdout.strip():
            found = probe.stdout.strip().splitlines()[-1]
    found = found or tool(context, f"python{version}")
    if not found:
        raise StepSkipped(f"Python {version} is not installed. winget install Python.Python.{version}")
    context.cache[key] = found
    return found


def venv_executable(folder: Path) -> Path:
    return folder / ("Scripts/python.exe" if WINDOWS else "bin/python")


def make_venv(context: Context, folder: Path, interpreter: str, *pip_arguments) -> str:
    """An environment of its own, so a result cannot depend on what else is installed."""
    exe = venv_executable(folder)
    if not exe.is_file():
        context.run(interpreter, "-m", "venv", folder, timeout=900)
    completed = context.run(exe, "-m", "pip", "install", "--quiet", "--disable-pip-version-check",
                            "--upgrade", "pip", *pip_arguments, timeout=3600)
    context.log(f"pip-{folder.name}", completed.stdout + completed.stderr)
    return str(exe)


def node_of(context: Context, major: int) -> str:
    """A Node of one major version: the pinned one, or the one on PATH if it matches.

    A newer Node must not quietly stand in for the one the CI uses. The runtime
    differences that break a deployment are the ones a version jump hides.
    """
    key = f"node-{major}"
    if key in context.cache:
        return context.cache[key]
    found = None
    executable = "node.exe" if WINDOWS else "node"
    if TOOLCHAIN.is_dir():
        for child in sorted(TOOLCHAIN.iterdir(), reverse=True):
            if child.is_dir() and child.name.startswith(f"node-v{major}."):
                for candidate in (child / executable, child / "bin" / executable):
                    if candidate.is_file():
                        found = str(candidate)
                        break
            if found:
                break
    if not found:
        system = tool(context, "node")
        if system:
            version = context.run(system, "--version", check=False, timeout=60).stdout.strip()
            if version.lstrip("v").split(".")[0] == str(major):
                found = system
    if not found:
        raise StepSkipped(f"Node {major} is not installed. Unpack node-v{major}.x into {TOOLCHAIN}")
    context.cache[key] = found
    return found


def npm_of(node: str) -> str:
    candidate = Path(node).with_name("npm.cmd" if WINDOWS else "npm")
    return str(candidate) if candidate.is_file() else "npm"


def node_path_env(context: Context, node: str) -> dict:
    """An environment in which that node, its npm and its corepack come first."""
    return {"PATH": os.pathsep.join([str(Path(node).parent), context.env.get("PATH", "")])}


def run_yarn(context: Context, cwd: Path, *arguments, node: str, check: bool = True,
             timeout: int = 3600) -> subprocess.CompletedProcess:
    """Yarn 1.22 through Corepack, with the chosen Node first on PATH.

    The lockfile is yarn.lock, so npm must never stand in: it would resolve a
    different tree than the one the deployment installs.
    """
    env = node_path_env(context, node)
    direct = shutil.which("yarn", path=env["PATH"])
    if direct:
        command = [direct]
    else:
        corepack = shutil.which("corepack", path=env["PATH"])
        if not corepack:
            raise StepSkipped("neither yarn nor corepack was found; Node ships corepack")
        command = [corepack, "yarn"]
    return context.run(*command, *arguments, cwd=cwd, env=env, check=check, timeout=timeout)


# ------------------------------------------------------------------ services

def start_mongo(context: Context, name: str, port: int, image: str = MONGO_IMAGE) -> str:
    """A MongoDB of the CI's image, in a container of its own on a port of its own.

    A fresh container per run means no test ever sees the previous run's data,
    and a port per repository means two repositories can be checked at once.
    """
    key = f"mongo:{name}"
    if key in context.cache:
        return context.cache[key]
    binary = docker(context)
    context.run(binary, "rm", "--force", name, check=False, timeout=120)
    if port_open(port):
        raise StepSkipped(f"port {port} is taken by something else; stop it and run again")
    context.run(binary, "run", "--detach", "--name", name, "--publish",
                f"127.0.0.1:{port}:27017", image, timeout=1800)
    context.containers.append(name)
    deadline = time.time() + 120
    while time.time() < deadline:
        ping = context.run(binary, "exec", name, "mongosh", "--quiet", "--eval",
                           "db.adminCommand({ping: 1}).ok", check=False, timeout=60)
        if ping.returncode == 0 and ping.stdout.strip().endswith("1"):
            url = f"mongodb://127.0.0.1:{port}"
            context.cache[key] = url
            return url
        time.sleep(2)
    raise StepFailed(f"{image} did not answer a ping within 120 s")


def start_process(context: Context, name: str, arguments: list, *, cwd: Path, env: dict,
                  url: str, seconds: int = 120, tls=None) -> None:
    """Start a server in the background and wait until it answers HTTP at all.

    Any HTTP answer counts, a 404 included: the question here is whether the
    process serves, and the checks that follow judge what it serves. For a
    server with a certificate of its own, tls is the ssl context that trusts it.
    """
    context.log_dir.mkdir(parents=True, exist_ok=True)
    path = context.log_dir / f"{name}.log"
    sink = path.open("w", encoding="utf-8", errors="replace")
    merged = dict(context.env)
    merged.update(env)
    process = subprocess.Popen([str(part) for part in arguments], cwd=str(cwd), env=merged,
                               stdout=sink, stderr=subprocess.STDOUT)
    context.processes.append((process, sink))
    deadline = time.time() + seconds
    while time.time() < deadline:
        if process.poll() is not None:
            sink.flush()
            output = path.read_text(encoding="utf-8", errors="replace")
            raise StepFailed(f"{name} exited with code {process.returncode} before it answered. "
                             f"Log: {path}\n{output[-2000:]}")
        try:
            with urllib.request.urlopen(url, timeout=5, context=tls):
                return
        except urllib.error.HTTPError:
            return
        except OSError:
            time.sleep(1)
    raise StepFailed(f"{name} did not answer {url} within {seconds} s. Log: {path}")


def stop_everything(context: Context) -> None:
    for process, sink in reversed(context.processes):
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=20)
            except subprocess.TimeoutExpired:
                process.kill()
        sink.close()
    context.processes.clear()
    binary = shutil.which("docker", path=context.env.get("PATH"))
    for name in reversed(context.containers):
        if binary:
            subprocess.run([binary, "rm", "--force", name], capture_output=True, text=True,
                           timeout=180)
    context.containers.clear()


def snapshot(context: Context, target: Path, *pathspecs: str, linux: bool = False) -> int:
    """Copy what Git would commit into target: tracked files as they are now, and new ones.

    Ignored files stay behind - a local .env with real credentials, a virtual
    environment, build output - and so do the local check's own files. With
    linux=True, text files get the LF endings a checkout on the Linux runner
    has, because bash in a container stops at the first CR.
    """
    if target.exists():
        shutil.rmtree(target)
    count = 0
    for name in tracked(context, *pathspecs, new=True):
        if name.startswith(LOCAL_TOOLING):
            continue
        data = (ROOT / name).read_bytes()
        if linux and b"\r\n" in data and b"\0" not in data[:8000]:
            data = data.replace(b"\r\n", b"\n")
        destination = target / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(data)
        count += 1
    return count


# ------------------------------------------------------------------- ratchet

def load_baseline() -> dict:
    try:
        return json.loads(BASELINE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def save_baseline(data: dict) -> None:
    BASELINE.parent.mkdir(parents=True, exist_ok=True)
    BASELINE.write_text(json.dumps(data, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
                        encoding="utf-8", newline="\n")


def ratchet(context: Context, key: str, found: set, what: str) -> str:
    """Known findings are debt; new ones fail.

    A gate is green on the day it is switched on and honest from then on. Run
    with --record once debt has been paid down, so the baseline shrinks with it.
    """
    baseline = load_baseline()
    known = set(baseline.get(key, []))
    if context.record:
        baseline[key] = sorted(found)
        save_baseline(baseline)
        return f"baseline recorded: {len(found)} {what}"
    new = sorted(found - known)
    if new:
        shown = "\n  ".join(new[:20]) + ("\n  ..." if len(new) > 20 else "")
        raise StepFailed(f"{len(new)} new {what}:\n  {shown}\n"
                         f"Fix them, or run with --record to accept them into {BASELINE.name}.")
    note = f"{len(found)} known {what}" if found else f"no {what}"
    resolved = known - found
    if resolved:
        note += f"; {len(resolved)} resolved since the baseline, run --record to lock that in"
    return note


# ------------------------------------------------------ steps every repo shares

def shell_scripts(context: Context) -> str:
    """Every shell script parses, with the line endings Git stores.

    The CI checks the scripts it names. This checks every .sh in the repository:
    a restore or deploy script that only breaks during an incident is the worst
    place to find a typo.
    """
    bash = posix_bash(context)
    listed = tracked(context, "*.sh", new=True)
    if not listed:
        raise StepSkipped("no shell scripts in this repository")
    broken = []
    for name in listed:
        text = (ROOT / name).read_bytes().replace(b"\r\n", b"\n").decode("utf-8", "replace")
        completed = context.run(bash, "-n", check=False, timeout=120, stdin=text)
        if completed.returncode != 0:
            broken.append(f"{name}: {tail(completed, 2)}")
    if broken:
        raise StepFailed("these do not parse:\n  " + "\n  ".join(broken))
    return f"{len(listed)} scripts parse"


def line_endings(context: Context) -> str:
    """No CRLF in what Git stores for text files.

    Git for Windows converts line endings on the way out, so a file can look
    right here and still be stored with CRLF - and a shell script stored that
    way fails on a Linux server with 'bad interpreter'. This reads the index,
    which is what every other machine checks out.
    """
    found = set()
    for entry in context.run(git(context), "ls-files", "--eol", "-z").stdout.split("\0"):
        info, _, path = entry.partition("\t")
        fields = info.split()
        if not path or not fields:
            continue
        attributes = info.partition("attr/")[2].strip()
        if fields[0] in ("i/crlf", "i/mixed") and "-text" not in attributes:
            found.add(f"{path} ({fields[0][2:]})")
    return ratchet(context, "line-endings", found, "text files stored with CRLF")


def whitespace(context: Context) -> str:
    """git diff --check over everything, not over nothing.

    On a fresh checkout there is no diff, so a CI that runs git diff --check can
    never fail. Measured against the empty tree it covers every committed line:
    what is there today is recorded, and whitespace errors in uncommitted
    changes fail outright.
    """
    binary = git(context)
    committed = context.run(binary, "diff", "--check", EMPTY_TREE, "HEAD", check=False, timeout=900)
    found = set()
    for line in committed.stdout.splitlines():
        match = re.match(r"^(.+?):\d+: (.+?)\.?$", line)
        if match:
            found.add(f"{match.group(1)}: {match.group(2)}")
    pending = context.run(binary, "diff", "--check", "HEAD", check=False, timeout=900)
    fresh = [line for line in pending.stdout.splitlines() if re.match(r"^.+?:\d+: ", line)]
    if fresh:
        raise StepFailed("whitespace errors in uncommitted changes:\n  " + "\n  ".join(fresh[:20]))
    return ratchet(context, "whitespace", found, "committed whitespace errors")


def gitleaks_binary(context: Context) -> str:
    return require(context, "gitleaks", "winget install Gitleaks.Gitleaks")


def gitleaks_config() -> list[str]:
    config = ROOT / ".gitleaks.toml"
    return ["--config", str(config)] if config.is_file() else []


def gitleaks_history(context: Context) -> str:
    completed = context.run(gitleaks_binary(context), "git", ".", "--redact", "--no-banner",
                            *gitleaks_config(), "--log-opts=HEAD", check=False, timeout=1800)
    output = completed.stdout + completed.stderr
    context.log("gitleaks-history", output)
    if completed.returncode != 0:
        raise StepFailed("Gitleaks found secrets in the reachable history:\n" + tail(completed))
    commits = re.search(r"(\d+) commits scanned", output)
    return f"{commits.group(1) if commits else 'every'} commits are clean"


def gitleaks_worktree(context: Context) -> str:
    """The files Git does not have yet: changed ones and new ones.

    The history scan cannot see them, and neither can GitHub. Only what Git
    would pick up is scanned - ignored logs and build output are left out - so
    a finding here is always something that could be committed next.
    """
    binary = git(context)
    changed = set(context.run(binary, "diff", "--name-only", "-z", "HEAD").stdout.split("\0"))
    changed |= set(context.run(binary, "ls-files", "-z", "--others", "--exclude-standard").stdout.split("\0"))
    pending = sorted(name for name in changed
                     if name and not name.startswith(LOCAL_TOOLING) and (ROOT / name).is_file())
    if not pending:
        return "nothing uncommitted to scan"
    with tempfile.TemporaryDirectory(prefix="local-check-leaks-") as folder:
        for name in pending:
            destination = Path(folder) / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / name, destination)
        completed = context.run(gitleaks_binary(context), "dir", ".", "--redact", "--no-banner",
                                *gitleaks_config(), cwd=Path(folder), check=False, timeout=1800)
    context.log("gitleaks-worktree", completed.stdout + completed.stderr)
    if completed.returncode != 0:
        raise StepFailed("Gitleaks found secrets in uncommitted or new files:\n" + tail(completed))
    return f"{len(pending)} uncommitted or new files are clean"


def osv_scan(context: Context) -> str:
    """Known vulnerabilities in every lockfile, from the OSV database.

    One scanner reads package-lock.json, yarn.lock, requirements files, go.sum
    and NuGet locks alike, so every ecosystem in the repository is judged by
    the same source of advisories. Transitive resolution stays off: for a
    requirements file without a lock it picks the oldest allowed versions -
    h11 0.9.0 where 0.16.0 is installed - and reports advisories that do not
    apply.
    """
    binary = docker(context)
    completed = context.run(binary, "run", "--rm", "--mount",
                            f"type=bind,source={ROOT},target=/src,readonly", OSV_IMAGE,
                            "scan", "source", "--recursive", "--no-resolve", "--allow-no-lockfiles",
                            "--format", "json", "/src",
                            check=False, timeout=2400)
    output = completed.stdout + completed.stderr
    context.log("osv-scanner", output)
    if "No package sources found" in output:
        return "no lockfiles in this repository, nothing to scan"
    if completed.returncode not in (0, 1):
        raise StepFailed("OSV-Scanner could not scan the repository:\n" + tail(completed))
    try:
        report = json.loads(completed.stdout or "{}")
    except ValueError as error:
        raise StepFailed("OSV-Scanner produced no JSON report:\n" + tail(completed)) from error
    found = set()
    for result in report.get("results") or []:
        source = str((result.get("source") or {}).get("path", "")).replace("/src/", "", 1)
        for package in result.get("packages") or []:
            info = package.get("package") or {}
            for vulnerability in package.get("vulnerabilities") or []:
                found.add(f"{source}: {info.get('name')} {info.get('version')} {vulnerability.get('id')}")
    return ratchet(context, "osv", found, "known vulnerabilities in the lockfiles")


def shellcheck(context: Context) -> str:
    """ShellCheck over every tracked script: quoting, globbing and exit-code traps."""
    listed = tracked(context, "*.sh")
    if not listed:
        raise StepSkipped("no shell scripts in this repository")
    binary = docker(context)
    completed = context.run(binary, "run", "--rm", "--mount",
                            f"type=bind,source={ROOT},target=/mnt,readonly", SHELLCHECK_IMAGE,
                            "--format=json1", *[f"/mnt/{name}" for name in listed],
                            check=False, timeout=900)
    try:
        report = json.loads(completed.stdout or '{"comments": []}')
    except ValueError as error:
        raise StepFailed("ShellCheck produced no report:\n" + tail(completed)) from error
    found = {f"{comment['file'][5:]}: SC{comment['code']} ({comment['level']})"
             for comment in report.get("comments", [])}
    return ratchet(context, "shellcheck", found, "ShellCheck findings")


def pytest_counts(text: str) -> dict:
    """The counts from pytest's last summary line."""
    lines = [line for line in text.splitlines()
             if re.search(r"\d+ (passed|failed|skipped|errors?|deselected)", line)]
    counts: dict = {}
    if lines:
        for number, kind in re.findall(r"(\d+) (passed|failed|skipped|errors?|deselected)", lines[-1]):
            counts["errors" if kind.startswith("error") else kind] = int(number)
    return counts


def describe_counts(counts: dict) -> str:
    order = ("passed", "failed", "errors", "skipped", "deselected")
    return ", ".join(f"{counts[kind]} {kind}" for kind in order if counts.get(kind)) or "no tests reported"


# -------------------------------------------------------------------- runner

def head_info() -> dict:
    binary = shutil.which("git")
    if not binary:
        return {}

    def ask(*arguments: str) -> str:
        completed = subprocess.run([binary, *arguments], cwd=str(ROOT), capture_output=True,
                                   text=True, encoding="utf-8", errors="replace")
        return completed.stdout.strip()

    return {"branch": ask("branch", "--show-current"), "head": ask("rev-parse", "--short", "HEAD"),
            "subject": ask("log", "-1", "--format=%s"), "dirty": bool(ask("status", "--porcelain"))}


def write_progress(planned: list, results: list, current, started: str, finished: bool,
                   info: dict) -> None:
    """What has run so far, for the dashboard. Best effort: a locked file is skipped."""
    done = {(item.group, item.name): item for item in results}
    steps = []
    for step in planned:
        item = done.get((step.group, step.name))
        if item:
            steps.append({"group": item.group, "name": item.name, "describe": item.describe,
                          "status": item.status, "detail": item.detail, "seconds": item.seconds})
        else:
            steps.append({"group": step.group, "name": step.name, "describe": step.describe,
                          "status": "running" if step is current else "pending",
                          "detail": "", "seconds": 0})
    payload = {"repo": ROOT.name, "path": str(ROOT), "started": started,
               "finished": datetime.now(timezone.utc).isoformat(timespec="seconds") if finished else None,
               "git": info, "steps": steps}
    try:
        STATE.mkdir(parents=True, exist_ok=True)
        temporary = STATE / (PROGRESS + ".tmp")
        temporary.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
        os.replace(temporary, STATE / PROGRESS)
    except OSError:
        pass


def execute(steps: list, context: Context) -> list:
    results: list = []
    passed: set = set()
    started = datetime.now(timezone.utc).isoformat(timespec="seconds")
    info = head_info()
    context.cache["git-info"] = info
    for step in steps:
        missing = [need for need in step.requirements() if need not in passed]
        if missing:
            detail = f"needs {', '.join(missing)} to pass first"
            results.append(Result(step.group, step.name, step.describe, SKIP, detail))
            print(f"SKIPPED         {step.key}: {detail}", flush=True)
            continue
        print(f"\n== {step.group}: {step.describe}", flush=True)
        write_progress(steps, results, step, started, False, info)
        clock = time.monotonic()
        try:
            detail = step.action(context) or ""
            status = PASS
            passed.add(step.key)
        except StepSkipped as reason:
            detail, status = str(reason), SKIP
        except StepFailed as reason:
            detail, status = str(reason), FAIL
        except Exception as reason:  # a bug in a check must not read as a clean run
            detail, status = f"the check itself failed: {reason!r}", FAIL
        seconds = round(time.monotonic() - clock, 1)
        results.append(Result(step.group, step.name, step.describe, status, detail, seconds))
        head = detail.splitlines()[0] if detail else ""
        print(f"{status.upper():<8} {seconds:6.1f} s  {head}", flush=True)
    write_progress(steps, results, None, started, True, info)
    return results


def summary(results: list, seconds: float) -> str:
    counts = {status: sum(1 for item in results if item.status == status) for status in (PASS, FAIL, SKIP)}
    lines = [f"\n{ROOT.name}: {counts[PASS]} passed, {counts[SKIP]} skipped, "
             f"{counts[FAIL]} failed in {seconds:.0f} s"]
    for item in results:
        head = item.detail.splitlines()[0] if item.detail else ""
        lines.append(f"  {item.status.upper():<8}{item.group:<12}{item.describe:<58}"
                     f"{item.seconds:7.1f} s  {head[:110]}")
    failed = [item for item in results if item.status == FAIL]
    if failed:
        lines.append("\nWhat failed, in full:")
        for item in failed:
            lines.append(f"\n  {item.group}/{item.name} - {item.describe}")
            lines.extend(f"    {line}" for line in item.detail.splitlines())
    return "\n".join(lines)


def main(argv: list | None = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    parser = argparse.ArgumentParser(description=f"Run every check for {ROOT.name} on this computer.")
    parser.add_argument("--only", help="comma-separated groups: " + ", ".join(GROUPS))
    parser.add_argument("--all", action="store_true", help="include the extra group, which GitHub does not run")
    parser.add_argument("--list", action="store_true", help="show the steps without running them")
    parser.add_argument("--record", action="store_true", help="accept today's findings into the ratchet baseline")
    parser.add_argument("--keep-services", action="store_true", help="leave containers and servers running")
    arguments = parser.parse_args(argv)

    if arguments.only:
        groups = {name.strip() for name in arguments.only.split(",") if name.strip()}
        unknown = groups - set(GROUPS)
        if unknown:
            parser.error("unknown groups: " + ", ".join(sorted(unknown)))
    elif arguments.all or arguments.record:
        groups = set(GROUPS)
    else:
        groups = set(DEFAULT_GROUPS)

    steps = plan(groups)
    if arguments.list:
        for step in steps:
            print(f"{step.group:<12} {step.describe}")
        return 0

    context = build_context(record=arguments.record)
    print(f"{ROOT.name}: {', '.join(group for group in GROUPS if group in groups)}", flush=True)
    if context.dropped:
        print("Withheld from every step (names only): " + ", ".join(context.dropped), flush=True)

    clock = time.monotonic()
    try:
        results = execute(steps, context)
    finally:
        if arguments.keep_services:
            print("Containers and servers are left running (--keep-services).")
        else:
            tear_down(context)
    seconds = time.monotonic() - clock

    report = {"repo": ROOT.name, "groups": [group for group in GROUPS if group in groups],
              "seconds": round(seconds, 1), "git": context.cache.get("git-info", {}),
              "results": [vars(item) for item in results]}
    (STATE / REPORT).write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(summary(results, seconds))
    print(f"Report: {STATE / REPORT}")
    return 1 if any(item.status == FAIL for item in results) else 0


# ==================================================================== OmniFM

def npm(context: Context, *arguments: str, cwd: Path | None = None, env: dict | None = None,
        check: bool = True, timeout: int = 1800) -> subprocess.CompletedProcess:
    """npm of the pinned Node 22, with that Node first on PATH."""
    node = node_of(context, NODE_MAJOR)
    merged = node_path_env(context, node)
    if env:
        merged.update(env)
    return context.run(npm_of(node), *arguments, cwd=cwd, env=merged, check=check, timeout=timeout)


def npm_step_result(context: Context, name: str, completed: subprocess.CompletedProcess, failure: str) -> None:
    path = context.log(name, completed.stdout + completed.stderr)
    if completed.returncode != 0:
        raise StepFailed(f"{failure}. Full output: {path}\n" + tail(completed, 30))


# ---------------------------------------------------------------- repository

def repo_hygiene(context: Context) -> str:
    completed = npm(context, "run", "--silent", "test:repo-hygiene", check=False, timeout=600)
    npm_step_result(context, "repo-hygiene", completed, "the repository hygiene check failed")
    return "hygiene and search console readiness"


def repository_steps() -> list:
    return [
        Step("repository", "hygiene", "Repository hygiene and search console", repo_hygiene),
        Step("repository", "shell", "Every shell script parses", shell_scripts),
        Step("repository", "line-endings", "No CRLF stored for text files", line_endings),
        Step("repository", "gitleaks-history", "Gitleaks over the history", gitleaks_history),
        Step("repository", "gitleaks-worktree", "Gitleaks over uncommitted and new files",
             gitleaks_worktree),
    ]


# ---------------------------------------------------------------------- node

def mongo_env(context: Context) -> dict:
    url = start_mongo(context, MONGO_CONTAINER, MONGO_PORT)
    return {"CI": "true", "MONGO_URL": f"{url}/omnifm_local", "DB_NAME": "omnifm_local"}


def node_version(context: Context) -> str:
    node = node_of(context, NODE_MAJOR)
    return f"Node {context.run(node, '--version', timeout=60).stdout.strip()} from {Path(node).parent}"


def node_install(context: Context) -> str:
    completed = npm(context, "ci", "--no-audit", "--no-fund", check=False, timeout=2400)
    npm_step_result(context, "npm-ci", completed, "npm ci failed")
    return "npm ci"


def syntax_checks(context: Context) -> str:
    for script in ("test:split-syntax", "test:syntax"):
        completed = npm(context, "run", "--silent", script, check=False, timeout=1200)
        npm_step_result(context, script.replace(":", "-"), completed, f"npm run {script} failed")
    return "the split entrypoints and every module under src/ and scripts/ parse"


def typecheck(context: Context) -> str:
    """tsc --noEmit over src/lib and src/core with their JSDoc types (#211).

    Green from the start, so a hard gate: every new type error fails.
    """
    completed = npm(context, "run", "--silent", "typecheck", check=False, timeout=900)
    npm_step_result(context, "typecheck", completed, "TypeScript found type errors")
    return "no type errors in src/lib and src/core"


def eslint_ratchet(context: Context) -> str:
    """ESLint over the bot, the scripts, the tests and the frontend (#209).

    scripts/check-lint.mjs keeps its findings in the "eslint" list of the same
    baseline file, so ci.yml runs the identical ratchet with `npm run lint`.
    """
    arguments = ["run", "--silent", "lint"] + (["--", "--record"] if context.record else [])
    completed = npm(context, *arguments, check=False, timeout=1200)
    text = (completed.stdout + completed.stderr).strip()
    path = context.log("eslint", text)
    if completed.returncode != 0:
        raise StepFailed(f"ESLint found new problems. Full output: {path}\n" + tail(completed, 30))
    return text.splitlines()[-1] if text else "ESLint ran"


def voice_codec(context: Context) -> str:
    completed = npm(context, "run", "--silent", "test:voice-codec", check=False, timeout=900)
    npm_step_result(context, "voice-codec", completed, "the native Opus codec does not work")
    return "native Opus encode and decode"


def mongo_smoke(context: Context) -> str:
    script = ("const db = await import('./src/lib/db.js'); await db.connect();"
              " if (!db.getDb()) throw new Error('Mongo connection failed'); await db.close();")
    node = node_of(context, NODE_MAJOR)
    env = dict(node_path_env(context, node), **mongo_env(context))
    completed = context.run(node, "--input-type=module", "-e", script, env=env, check=False, timeout=300)
    context.log("mongo-smoke", completed.stdout + completed.stderr)
    if completed.returncode != 0:
        raise StepFailed("the app does not connect to MongoDB:\n" + tail(completed))
    return f"the app connects to {MONGO_IMAGE}"


def unit_tests(context: Context) -> str:
    completed = npm(context, "run", "--silent", "test:unit", env=mongo_env(context), check=False, timeout=5400)
    text = completed.stdout + completed.stderr
    path = context.log("unit", text)
    if completed.returncode != 0:
        raise StepFailed(f"the unit suite failed. Full output: {path}\n" + tail(completed, 30))
    passed = re.search(r"^# pass (\d+)", text, re.MULTILINE)
    failed = re.search(r"^# fail (\d+)", text, re.MULTILINE)
    if failed and int(failed.group(1)):
        raise StepFailed(f"{failed.group(1)} tests failed. Full output: {path}")
    if not passed or not int(passed.group(1)):
        raise StepFailed(f"the unit suite reported no passing test. Full output: {path}")
    return f"{passed.group(1)} tests passed"


def node_steps() -> list:
    return [
        Step("node", "node-version", f"Node {NODE_MAJOR}, the version package.json pins", node_version),
        Step("node", "npm-ci", "Locked install from package-lock.json", node_install, ("node-version",)),
        Step("node", "syntax", "The syntax gates of the CI", syntax_checks, ("npm-ci",)),
        Step("node", "eslint", "ESLint, new findings fail", eslint_ratchet, ("npm-ci",)),
        Step("node", "typecheck", "TypeScript checks src/lib and src/core", typecheck, ("npm-ci",)),
        Step("node", "voice-codec", "Native Opus encode and decode", voice_codec, ("npm-ci",)),
        Step("node", "mongo-smoke", "The app connects to MongoDB", mongo_smoke, ("npm-ci",)),
        Step("node", "unit", "The unit suite against a real MongoDB", unit_tests, ("npm-ci",)),
    ]


# ------------------------------------------------------------------- backend

def venv_python() -> str:
    exe = venv_executable(VENV)
    if not exe.is_file():
        raise StepSkipped("the backend environment is not built yet")
    return str(exe)


def backend_environment(context: Context) -> str:
    # tzdata: Windows has no zoneinfo database, so a test that builds
    # Europe/Vienna fails here and passes on the Linux runner. It is a data
    # package for the local run and changes nothing in production.
    extra = ["tzdata"] if WINDOWS else []
    exe = make_venv(context, VENV, python_for(context, BACKEND_PYTHON),
                    "--requirement", BACKEND / "requirements.txt", *extra)
    return context.run(exe, "--version", timeout=60).stdout.strip() + " with backend/requirements.txt"


def backend_compile(context: Context) -> str:
    """Every backend module compiles, not only server.py, which is all the CI compiles."""
    completed = context.run(venv_python(), "-m", "compileall", "-q", "-x", r"[\\/](\.?venv|node_modules)[\\/]",
                            BACKEND, check=False, timeout=600)
    if completed.returncode != 0:
        raise StepFailed(tail(completed))
    return "every backend module compiles"


def backend_unit(context: Context) -> str:
    completed = context.run(venv_python(), "-m", "pytest", BACKEND / "unit_tests", "-q", "-p", "no:cacheprovider",
                            check=False, timeout=2400)
    text = completed.stdout + completed.stderr
    path = context.log("backend-unit", text)
    if completed.returncode != 0:
        raise StepFailed(f"the FastAPI unit tests failed. Full output: {path}\n" + tail(completed))
    return describe_counts(pytest_counts(text))


class NoRedirect(urllib.request.HTTPRedirectHandler):
    """Keeps a 302 a 302, so its Location header can be asserted."""

    def redirect_request(self, *args, **kwargs):
        return None


def parse_json(raw: str) -> dict:
    try:
        loaded = json.loads(raw)
    except ValueError:
        return {}
    return loaded if isinstance(loaded, dict) else {"_": loaded}


def request(method: str, path: str, *, token: str = "", body: dict | None = None,
            follow: bool = True) -> tuple:
    """One call against the local server: status, headers and JSON."""
    data = json.dumps(body).encode() if body is not None else None
    call = urllib.request.Request(f"http://127.0.0.1:{API_PORT}{path}", data=data, method=method)
    if token:
        call.add_header("X-Admin-Token", token)
    if data is not None:
        call.add_header("Content-Type", "application/json")
    opener = urllib.request.build_opener() if follow else urllib.request.build_opener(NoRedirect)
    try:
        with opener.open(call, timeout=30) as answer:
            return answer.status, dict(answer.headers), parse_json(answer.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as error:
        return error.code, dict(error.headers), parse_json(error.read().decode("utf-8", "replace"))


def expect(condition: object, message: str) -> None:
    if not condition:
        raise StepFailed(message)


def fastapi_contract(context: Context) -> str:
    """Drive a live FastAPI through the owner contract the dashboard relies on.

    The CI's longest gate, and the one that catches the breakages that matter:
    a masked secret that overwrites the real one, a licence that leaves an
    entitlement behind when it is deleted, an archive that cannot be restored,
    a monitoring answer with per-process figures for a shared process. Every
    step asserts both the answer and what reached the database.
    """
    exe = venv_python()
    url = start_mongo(context, MONGO_CONTAINER, MONGO_PORT)
    database = "omnifm_local_contract"
    env = {"MONGO_URL": url, "DB_NAME": database, "API_ADMIN_TOKEN": API_TOKEN, "SEED_DEMO_DATA": "0"}
    prelude = f"import json;from pymongo import MongoClient;d=MongoClient({url!r})[{database!r}];"

    def in_mongo(expression: str) -> object:
        completed = context.run(exe, "-c", prelude + f"print(json.dumps({expression}, default=str))",
                                env=env, timeout=120)
        return json.loads(completed.stdout.strip() or "null")

    def run_mongo(statement: str) -> None:
        context.run(exe, "-c", prelude + statement, env=env, timeout=120)

    run_mongo("d.client.drop_database(d.name)")
    if port_open(API_PORT):
        raise StepSkipped(f"port {API_PORT} is taken; stop what uses it and run again")
    start_process(context, "fastapi", [exe, "-m", "uvicorn", "backend.server:app", "--host", "127.0.0.1",
                                       "--port", str(API_PORT)],
                  cwd=ROOT, env=env, url=f"http://127.0.0.1:{API_PORT}/api/health", seconds=90)
    context.cache["fastapi:env"] = env
    check_owner_contract(in_mongo, run_mongo)
    return "the owner contract holds end to end"


def fastapi_contract_suite(context: Context) -> str:
    """backend/tests: the Owner Console contract tests, against the live server.

    They need a running FastAPI, and the contract step above already has one.
    Their fixtures (backend/tests/conftest.py) write the data each test needs
    into the same database, so the suite does not depend on demo seeds or on
    what the owner contract left behind (#229). The baseline is empty: any
    failing test fails the step.
    """
    env = context.cache.get("fastapi:env")
    if not env or not port_open(API_PORT):
        raise StepSkipped("the live FastAPI of backend/contract is not running")
    base = f"http://127.0.0.1:{API_PORT}"
    completed = context.run(
        venv_python(), "-m", "pytest", BACKEND / "tests", "-q", "-p", "no:cacheprovider", "-rfE",
        env={**env, "OMNIFM_RUN_BACKEND_CONTRACT_TESTS": "1", "OMNIFM_TEST_BASE_URL": base,
             "REACT_APP_BACKEND_URL": base, "OMNIFM_TEST_ADMIN_TOKEN": API_TOKEN},
        check=False, timeout=1800)
    text = completed.stdout + completed.stderr
    path = context.log("backend-contract-suite", text)
    counts = pytest_counts(text)
    if completed.returncode not in (0, 1) or not counts.get("passed"):
        raise StepFailed(f"pytest did not run the contract suite. Full output: {path}\n" + tail(completed))
    failing = set(re.findall(r"^(?:FAILED|ERROR) (\S+)", text, re.M))
    verdict = ratchet(context, "backend-contract-suite", failing, "failing backend contract tests")
    return f"{describe_counts(counts)}; {verdict}"


def node_contract_suite(context: Context) -> str:
    """#287: the same contract suite against the Node API, which will be the only server.

    Starts the Node API alone on the contract database and runs backend/tests
    against it. What fails is the gap list of M10: a route Node does not have
    yet, another status, other fields. A ratchet keeps it honest: the number
    may only go down, each PR of M10 records the smaller baseline.
    """
    env = context.cache.get("fastapi:env")
    if not env:
        raise StepSkipped("the FastAPI environment of backend/contract is missing")
    if port_open(NODE_CONTRACT_PORT):
        raise StepSkipped(f"port {NODE_CONTRACT_PORT} is taken; stop what uses it and run again")
    node = node_of(context, NODE_MAJOR)
    scratch = Path(tempfile.mkdtemp(prefix="omnifm-node-contract-"))
    base = f"http://127.0.0.1:{NODE_CONTRACT_PORT}"
    node_env = dict(node_path_env(context, node), **{
        "MONGO_URL": env["MONGO_URL"], "DB_NAME": env["DB_NAME"], "API_ADMIN_TOKEN": env["API_ADMIN_TOKEN"],
        "WEB_SERVER_ENABLED": "1", "WEB_BIND": "127.0.0.1", "WEB_INTERNAL_PORT": str(NODE_CONTRACT_PORT),
        "PUBLIC_WEB_URL": base, "OMNIFM_RUNTIME_DATA_DIR": str(scratch), "LOGS_DIR": str(scratch / "logs"),
        # The suite fires hundreds of requests from one address; the limiter
        # would turn real gaps into 429 noise.
        "API_RATE_LIMIT_MAX": "10000", "API_RATE_LIMIT_PREMIUM_MAX": "1000",
    })
    start_process(context, "node-contract-api", [node, "scripts/serve-node-api.mjs"], cwd=ROOT, env=node_env,
                  url=f"{base}/api/auth/session", seconds=90)
    completed = context.run(
        venv_python(), "-m", "pytest", BACKEND / "tests", "-q", "-p", "no:cacheprovider", "-rfE",
        env={**env, "OMNIFM_RUN_BACKEND_CONTRACT_TESTS": "1", "OMNIFM_TEST_BASE_URL": base,
             "REACT_APP_BACKEND_URL": base, "OMNIFM_TEST_ADMIN_TOKEN": API_TOKEN},
        check=False, timeout=1800)
    text = completed.stdout + completed.stderr
    gaps = context.run(node, "scripts/check-api-routes.mjs", "--node-gaps", env=node_path_env(context, node),
                       check=False, timeout=120)
    path = context.log("node-contract-suite", text + "\n\n" + gaps.stdout)
    shutil.rmtree(scratch, ignore_errors=True)
    counts = pytest_counts(text)
    if completed.returncode not in (0, 1) or not (counts.get("passed") or counts.get("failed")):
        raise StepFailed(f"pytest did not run the contract suite against Node. Full output: {path}\n" + tail(completed))
    failing = set(re.findall(r"^(?:FAILED|ERROR) (\S+)", text, re.M))
    verdict = ratchet(context, "node-contract-suite", failing, "contract tests the Node API still fails")
    return f"{describe_counts(counts)} against Node; {verdict}. Gap list: {path}"


def check_owner_contract(in_mongo, run_mongo) -> None:
    _, _, health = request("GET", "/api/health")
    expect(health.get("ok") is True, f"/api/health is not ok: {health}")
    expect(health.get("contractVersion") == "owner-live-v5",
           f"the owner contract moved to {health.get('contractVersion')!r}; the dashboard expects 'owner-live-v5'")
    expect(request("GET", "/api/stats")[0] == 200, "/api/stats does not answer")
    expect(request("GET", "/api/admin/config", token=API_TOKEN)[0] == 200,
           "/api/admin/config does not answer for the owner token")
    # The CI never asks this: an admin route that answers without the token is
    # the failure that matters most, and it would pass every other gate.
    expect(request("GET", "/api/admin/config")[0] in (401, 403), "/api/admin/config answers without the owner token")

    secret = {"clientId": "123456789012345678", "clientSecret": "local-secret",
              "redirectUri": "https://example.test/api/auth/discord/callback", "scopes": "identify guilds"}
    _, _, saved = request("PUT", "/api/admin/config", token=API_TOKEN, body={
        "section": "system",
        "data": {"discordOAuth": secret, "smtp": {"enabled": False}, "audioRecognition": {"enabled": False},
                 "songHistory": {"enabled": True, "maxPerGuild": 100}}})
    oauth = saved.get("data", {}).get("discordOAuth", {})
    expect(saved.get("ok") and oauth.get("clientSecretSet") is True and oauth.get("clientSecret") == MASK,
           f"the saved OAuth secret is not masked in the answer: {oauth}")

    # Saving the form again sends the mask back. It must not become the secret.
    request("PUT", "/api/admin/config", token=API_TOKEN, body={
        "section": "system", "data": {"discordOAuth": dict(secret, clientSecret=MASK, clientSecretSet=True)}})
    stored = in_mongo("d.owner_config.find_one({'_id':'global'})['system']['discordOAuth']")
    expect(stored.get("clientSecret") == "local-secret", "writing the masked value back replaced the real client secret")
    expect("clientSecretSet" not in stored, "clientSecretSet leaked into the stored document")

    _, _, integration = request("POST", "/api/admin/integrations/test", token=API_TOKEN,
                                body={"integration": "songhistory"})
    expect(integration.get("ok") and integration["results"]["songHistory"]["ok"],
           f"the song history self-test failed: {integration}")

    _, _, licence = request("POST", "/api/admin/licenses", token=API_TOKEN, body={
        "email": "owner-contract@example.test", "tier": "pro", "months": 1, "seats": 1,
        "guildId": "123456789012345678"})
    expect(licence.get("ok") and str(licence.get("licenseKey", "")).startswith("OMNI-"),
           f"no licence key was issued: {licence}")
    entitlement = in_mongo("d.server_entitlements.find_one({'_serverId':'123456789012345678'})")
    expect(entitlement and str(entitlement.get("licenseId", "")).startswith("OMNI-"),
           "the licence did not create a server entitlement")

    _, _, full = request("GET", "/api/admin/licenses?full=1", token=API_TOKEN)
    linked = full["licenses"][0]["linkedServers"][0]
    expect(linked["licenseResolved"] and linked["effectivePlan"] == "pro",
           f"the linked server does not resolve to the pro plan: {linked}")

    key = full["licenses"][0]["licenseKey"]
    _, _, removed = request("DELETE", f"/api/admin/licenses/{key}", token=API_TOKEN)
    expect(removed.get("ok") and str(removed.get("archiveId", "")).startswith("arc_"),
           f"deleting the licence produced no archive: {removed}")
    archive_id = removed["archiveId"]
    expect(in_mongo("d.licenses.count_documents({})") == 0, "the licence survived its deletion")
    expect(in_mongo(f"d.data_archive.count_documents({{'operationId':{archive_id!r}}})") == 2,
           "the deletion did not archive both records")

    _, _, listing = request("GET", "/api/admin/archive", token=API_TOKEN)
    expect(listing["count"] == 1 and listing["archive"][0]["recordCount"] == 2,
           f"the archive listing is wrong: {listing}")

    _, _, restored = request("POST", f"/api/admin/archive/{archive_id}/restore", token=API_TOKEN, body={})
    expect(restored.get("ok") and restored.get("restored") == 2,
           f"the restore did not bring both records back: {restored}")
    expect(in_mongo(f"d.licenses.find_one({{'_licenseId':{key!r}}})") is not None, "the restored licence is missing")
    expect(in_mongo("d.server_entitlements.find_one({'_serverId':'123456789012345678'})") is not None,
           "the restored entitlement is missing")

    run_mongo(
        "from datetime import datetime,timezone;"
        "d.runtime_health.replace_one({'_id':'latest'},{'_id':'latest',"
        "'at':datetime.now(timezone.utc).isoformat(),"
        "'process':{'cpuPct':7,'ramMb':128,'uptimeSec':60,'resourceModel':'shared-process'},"
        "'nodes':[{'botId':'1476192449721274472','index':1,'name':'OmniFM DJ',"
        "'role':'commander','status':'online','pingMs':23,'guilds':1,"
        "'voiceConnections':1,'listeners':4,'guildDetails':[]}]},upsert=True)")

    _, _, workers = request("GET", "/api/admin/workers", token=API_TOKEN)
    worker = workers["workers"][0]
    expect(workers["live"] and worker["ready"] and worker["servers"] == 1 and worker["listeners"] == 4
           and worker["connections"] == 1, f"the worker view does not reflect runtime health: {worker}")

    _, _, monitoring = request("GET", "/api/admin/monitoring", token=API_TOKEN)
    node = monitoring["nodes"][0]
    expect(monitoring["live"] and node["resourceScope"] == "shared-process" and node["cpuPct"] is None
           and node["ramMb"] is None and node["listeners"] == 4,
           f"monitoring reports per-process figures for a shared process: {node}")

    status, _, _ = request("POST", "/api/admin/licenses", token=API_TOKEN, body={
        "email": "invalid-guild@example.test", "tier": "pro", "months": 1, "seats": 1, "guildId": "1"})
    expect(status == 400, f"an invalid guild id was accepted with status {status}")

    _, headers, _ = request("GET", "/api/auth/discord/login?redirect=1&nextPage=dashboard", follow=False)
    location = headers.get("Location", headers.get("location", ""))
    expect(location.lower().startswith("https://discord.com/"),
           f"the OAuth login does not redirect to Discord: {location!r}")


def node_dashboard_proxy(context: Context) -> str:
    """#195: FastAPI forwards /api/auth and /api/dashboard to the Node API.

    Production runs it that way (OMNIFM_DASHBOARD_BACKEND=node). This starts the
    Node API alone (scripts/serve-node-api.mjs) and a second FastAPI in that
    mode, then checks what the dashboard relies on: routes FastAPI never had
    answer, the Node API's CSRF guard and origin check still hold, the owner
    console stays in FastAPI, and a stopped Node API gives a clear 503.
    """
    env = context.cache.get("fastapi:env")
    if not env:
        raise StepSkipped("the FastAPI environment of backend/contract is missing")
    for port in (NODE_API_PORT, PROXY_API_PORT):
        if port_open(port):
            raise StepSkipped(f"port {port} is taken; stop what uses it and run again")
    node = node_of(context, NODE_MAJOR)
    scratch = Path(tempfile.mkdtemp(prefix="omnifm-node-api-"))
    proxy_base = f"http://127.0.0.1:{PROXY_API_PORT}"
    node_env = dict(node_path_env(context, node), **{
        "MONGO_URL": env["MONGO_URL"], "DB_NAME": env["DB_NAME"],
        "WEB_SERVER_ENABLED": "1", "WEB_BIND": "127.0.0.1", "WEB_INTERNAL_PORT": str(NODE_API_PORT),
        "TRUST_PROXY_HEADERS": "1", "TRUSTED_PROXY_IPS": "127.0.0.1,::1", "PUBLIC_WEB_URL": proxy_base,
        "OMNIFM_RUNTIME_DATA_DIR": str(scratch), "LOGS_DIR": str(scratch / "logs"),
    })
    start_process(context, "node-api", [node, "scripts/serve-node-api.mjs"], cwd=ROOT, env=node_env,
                  url=f"http://127.0.0.1:{NODE_API_PORT}/api/auth/session", seconds=90)
    node_process = context.processes[-1][0]
    proxy_env = dict(env, OMNIFM_DASHBOARD_BACKEND="node", OMNIFM_NODE_API_URL=f"http://127.0.0.1:{NODE_API_PORT}")
    start_process(context, "fastapi-node-proxy", [venv_python(), "-m", "uvicorn", "backend.server:app", "--host",
                                                  "127.0.0.1", "--port", str(PROXY_API_PORT)],
                  cwd=ROOT, env=proxy_env, url=f"{proxy_base}/api/health", seconds=90)

    def call(method: str, path: str, headers: dict | None = None, body: dict | None = None) -> tuple:
        data = json.dumps(body).encode() if body is not None else None
        prepared = urllib.request.Request(f"{proxy_base}{path}", data=data, method=method)
        for key, value in (headers or {}).items():
            prepared.add_header(key, value)
        if data is not None:
            prepared.add_header("Content-Type", "application/json")
        try:
            with urllib.request.build_opener(NoRedirect).open(prepared, timeout=30) as answer:
                return answer.status, dict(answer.headers), parse_json(answer.read().decode("utf-8", "replace"))
        except urllib.error.HTTPError as error:
            return error.code, dict(error.headers), parse_json(error.read().decode("utf-8", "replace"))

    server = "123456789012345678"
    _, _, health = call("GET", "/api/health")
    services = health.get("services", {})
    expect(services.get("dashboardBackend") == "node" and services.get("dashboardApi") is True,
           f"the proxy FastAPI does not report the Node API: {services}")
    status, _, session = call("GET", "/api/auth/session")
    expect(status == 200 and session.get("authenticated") is False,
           f"/api/auth/session did not come from the Node API: {status} {session}")
    status, _, answer = call("GET", f"/api/dashboard/capabilities?serverId={server}")
    expect(status == 401, f"/api/dashboard/capabilities, which FastAPI never had, answered {status} {answer}")
    status, _, answer = call("PUT", f"/api/dashboard/settings?serverId={server}",
                             headers={"Origin": proxy_base}, body={"failoverChain": ["alpha"]})
    expect(status == 403 and "CSRF" in str(answer.get("error", "")),
           f"a dashboard change without the CSRF header was not refused by the Node API: {status} {answer}")
    status, _, answer = call("GET", f"/api/dashboard/stats?serverId={server}", headers={"Origin": "https://evil.example"})
    expect(status == 403, f"a foreign origin reached the dashboard: {status} {answer}")
    status, _, _ = call("GET", "/api/admin/config", headers={"X-Admin-Token": API_TOKEN})
    expect(status == 200, f"the owner console no longer answers from FastAPI: {status}")

    node_process.terminate()
    node_process.wait(timeout=20)
    status, headers, answer = call("GET", "/api/auth/session")
    retry_after = {key.lower(): value for key, value in headers.items()}.get("retry-after")
    expect(status == 503 and answer.get("retryable") is True and retry_after == "5",
           f"a stopped Node API did not give a clear 503: {status} {answer}")
    shutil.rmtree(scratch, ignore_errors=True)
    return "FastAPI forwards the dashboard to the Node API end to end"


def backend_steps() -> list:
    return [
        Step("backend", "venv", f"Python {BACKEND_PYTHON} with backend/requirements.txt", backend_environment),
        Step("backend", "compile", "Every backend module compiles", backend_compile, ("venv",)),
        Step("backend", "unit", "The FastAPI unit tests", backend_unit, ("venv",)),
        Step("backend", "contract", "The owner contract against a live server", fastapi_contract, ("venv",)),
        Step("backend", "contract-suite", "The backend/tests contract suite against the same server",
             fastapi_contract_suite, ("contract",)),
        Step("backend", "node-dashboard", "FastAPI forwards the dashboard to the Node API",
             node_dashboard_proxy, ("contract", "node/npm-ci")),
        Step("backend", "node-contract", "The contract suite against the Node API (M10 gap list)",
             node_contract_suite, ("contract", "node/npm-ci")),
    ]


# ------------------------------------------------------------------ frontend

def build_output() -> Path:
    """Where the Vite build writes: read from vite.config.js, not assumed.

    This project writes to build/, not Vite's default dist/. A check that looks
    in the wrong place calls a healthy build broken, which is worse than none.
    """
    config = FRONTEND / "vite.config.js"
    if config.is_file():
        found = re.search(r"outDir\s*:\s*['\"]([^'\"]+)['\"]", config.read_text(encoding="utf-8", errors="replace"))
        if found:
            return FRONTEND / found.group(1)
    for name in ("build", "dist"):
        if (FRONTEND / name / "index.html").is_file():
            return FRONTEND / name
    return FRONTEND / "dist"


def frontend_install(context: Context) -> str:
    if not (FRONTEND / "package-lock.json").is_file():
        raise StepSkipped("frontend/package-lock.json is missing")
    completed = npm(context, "ci", "--no-audit", "--no-fund", cwd=FRONTEND, check=False, timeout=2400)
    npm_step_result(context, "frontend-npm-ci", completed, "npm ci in frontend/ failed")
    return "npm ci"


def frontend_build(context: Context) -> str:
    """The production build, and proof that it produced something.

    A build that writes an empty output still exits zero. The CI accepts that;
    a deployment of it serves a blank page.
    """
    completed = npm(context, "run", "--silent", "build", cwd=FRONTEND, check=False, timeout=2400)
    npm_step_result(context, "frontend-build", completed, "the production build failed")
    out = build_output()
    if not (out / "index.html").is_file():
        raise StepFailed(f"the build produced no {out / 'index.html'}")
    bundles = [item for item in out.rglob("*.js") if item.is_file()]
    if not bundles:
        raise StepFailed(f"the build produced no JavaScript bundle under {out}")
    size = sum(item.stat().st_size for item in out.rglob("*") if item.is_file())
    return f"{out.name}/: {len(bundles)} bundles, {size // 1024} KiB"


IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg", ".ico"}
IMAGE_LIMIT_KIB = 300


def frontend_images(context: Context) -> str:
    """No image the website ships is larger than 300 KB (#258).

    The build once carried 13 MB of pictures, four of them 2.4 MB each for a
    56-pixel avatar. Originals for download or the Discord portal belong in
    docs/brand-assets, not in frontend/public.
    """
    out = build_output()
    images = [item for item in out.rglob("*") if item.is_file() and item.suffix.lower() in IMAGE_SUFFIXES]
    found = {item.relative_to(out).as_posix() for item in images
             if item.stat().st_size > IMAGE_LIMIT_KIB * 1024}
    note = ratchet(context, "large-images", found, f"images over {IMAGE_LIMIT_KIB} KB in the build")
    total = sum(item.stat().st_size for item in images)
    return f"{note}; {len(images)} images, {total // 1024} KiB together"


def frontend_steps() -> list:
    return [
        Step("frontend", "npm-ci", "Locked install from frontend/package-lock.json", frontend_install),
        Step("frontend", "build", "The production build, and it is not empty", frontend_build, ("npm-ci",)),
        Step("frontend", "images", f"No image in the build over {IMAGE_LIMIT_KIB} KB", frontend_images, ("build",)),
    ]


# --------------------------------------------------------------------- extra

def audit_tree(context: Context, where: Path, label: str) -> set:
    completed = npm(context, "audit", "--json", "--audit-level=low", cwd=where, check=False, timeout=1200)
    context.log(f"npm-audit-{label}", completed.stdout + completed.stderr)
    try:
        report = json.loads(completed.stdout or "{}")
    except ValueError as error:
        raise StepFailed(f"npm audit produced no JSON for {label}:\n" + tail(completed)) from error
    return {f"{label}: {name} ({entry.get('severity')})"
            for name, entry in (report.get("vulnerabilities") or {}).items()
            if entry.get("severity") in ("high", "critical")}


def npm_audit(context: Context) -> str:
    """High and critical advisories in both trees.

    OmniFM's dependency-review workflow is a notice that does nothing, so GitHub
    never fails a pull request over a vulnerable package. This does.
    """
    found = audit_tree(context, ROOT, "root")
    if (FRONTEND / "package-lock.json").is_file():
        found |= audit_tree(context, FRONTEND, "frontend")
    return ratchet(context, "npm-audit", found, "high or critical advisories")


def env_contract(context: Context) -> str:
    """Every setting the code reads is documented in .env.example.

    A variable that only exists in someone's shell is how a deployment breaks on
    a machine that is not the developer's. No CI job checks this.
    """
    example = ROOT / ".env.example"
    if not example.is_file():
        raise StepSkipped(".env.example is missing")
    documented = set()
    for line in example.read_text(encoding="utf-8", errors="replace").splitlines():
        stripped = line.strip()
        if stripped and not stripped.startswith("#") and "=" in stripped:
            documented.add(stripped.split("=", 1)[0].strip())
            continue
        # "# NAME=value" documents an optional override: setting it changes the
        # automatic behaviour, so .env.example must not set it by default.
        commented = re.match(r"#\s*([A-Z][A-Z0-9_]*)=", stripped)
        if commented:
            documented.add(commented.group(1))
    used: set = set()
    for name in tracked(context, "src/*.js", "src/*.mjs", "scripts/*.mjs", "backend/*.py"):
        text = (ROOT / name).read_text(encoding="utf-8", errors="replace")
        for match in ENV_USE.finditer(text):
            used.add(match.group(1) or match.group(2))
        if name.endswith(".py"):
            used.update(re.findall(r"os\.environ(?:\.get)?[\(\[]\s*['\"]([A-Z][A-Z0-9_]*)['\"]", text))
            used.update(re.findall(r"os\.getenv\(\s*['\"]([A-Z][A-Z0-9_]*)['\"]", text))
    return ratchet(context, "env-contract", used - documented - ENV_PROVIDED,
                   "settings read by the code but absent from .env.example")


def licence_inventory(context: Context) -> str:
    """What the shipped dependencies are licensed under.

    A copyleft package that reaches production is a legal problem no test finds.
    A licence nobody has looked at before fails until it is accepted.
    """
    found = set()
    for where, label in ((ROOT, "root"), (FRONTEND, "frontend")):
        for manifest in (where / "node_modules").glob("*/package.json"):
            try:
                data = json.loads(manifest.read_text(encoding="utf-8", errors="replace"))
            except (OSError, ValueError):
                continue
            licence = data.get("license") or data.get("licenses") or "UNKNOWN"
            if isinstance(licence, list):
                licence = " OR ".join(str(item.get("type", item)) if isinstance(item, dict) else str(item)
                                      for item in licence)
            licence = licence if isinstance(licence, str) else str(licence)
            if licence not in ALLOWED_LICENCES:
                found.add(f"{label}: {data.get('name', manifest.parent.name)} ({licence})")
    return ratchet(context, "licences", found, "dependencies outside the allowed licences")


# The rule sets of the Semgrep registry that fit OmniFM's code, and the folders
# they read. The registry needs no account; its rules can gain new checks over
# time, which then show up as new findings like any other.
SEMGREP_RULESETS = ("p/javascript", "p/nodejs", "p/python", "p/react", "p/secrets")
SEMGREP_TARGETS = ("src", "backend", "scripts", "frontend/src")
LIVE_URL = "https://omnifm.xyz"


def semgrep_scan(context: Context) -> str:
    """Static security analysis of the code, in place of CodeQL (#257).

    CodeQL never ran for this private repository: code scanning is not
    available, so the workflow skips itself, and the CodeQL licence does not
    cover private code on a local machine. Semgrep's open-source engine does.
    The files go into the container as one archive; reading them through a
    Windows bind mount takes minutes, the archive seconds.
    """
    binary = docker(context)
    files = tracked(context, *SEMGREP_TARGETS, new=True)
    STATE.mkdir(parents=True, exist_ok=True)
    archive = STATE / "semgrep-source.tar"
    with tarfile.open(archive, "w") as bundle:
        for name in files:
            bundle.add(ROOT / name, arcname=name)
    rules = " ".join(f"--config {ruleset}" for ruleset in SEMGREP_RULESETS)
    script = ("mkdir -p /tmp/source && tar -xf /in/source.tar -C /tmp/source && cd /tmp/source && "
              f"semgrep scan --metrics=off {rules} --json --quiet {' '.join(SEMGREP_TARGETS)}")
    completed = context.run(binary, "run", "--rm", "--mount",
                            f"type=bind,source={archive},target=/in/source.tar,readonly",
                            SEMGREP_IMAGE, "sh", "-c", script, check=False, timeout=1800)
    archive.unlink(missing_ok=True)
    context.log("semgrep", completed.stdout + completed.stderr)
    try:
        report = json.loads(completed.stdout or "{}")
    except ValueError as error:
        raise StepFailed("Semgrep produced no JSON report:\n" + tail(completed)) from error
    if completed.returncode not in (0, 1) or "results" not in report:
        raise StepFailed("Semgrep could not scan the code:\n" + tail(completed))
    found = set()
    for result in report["results"]:
        path = result["path"]
        try:
            lines = (ROOT / path).read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError:
            lines = []
        # The code of the finding, not its line number, identifies it: moving
        # code around does not turn a known finding into a new one.
        snippet = " ".join(" ".join(lines[result["start"]["line"] - 1:result["end"]["line"]]).split())
        found.add(f"{path}: {result['check_id'].rsplit('.', 1)[-1]}: {snippet[:140]}")
    return ratchet(context, "semgrep", found, "Semgrep findings")


def live_smoke(context: Context) -> str:
    """The live smoke check of omnifm.xyz, which GitHub was meant to run (#257).

    It only sends GET requests. With OMNIFM_LIVE_ADMIN_TOKEN in the environment
    it checks the owner API too; the token is passed on explicitly because the
    checks otherwise never see secrets.
    """
    node = node_of(context, NODE_MAJOR)
    arguments = [node, ROOT / "scripts" / "phase6-live-check.mjs", "--base-url", LIVE_URL, "--skip-logs"]
    token = (os.environ.get("OMNIFM_LIVE_ADMIN_TOKEN") or "").strip()
    if not token:
        arguments.append("--skip-api")
    completed = context.run(*arguments, env={"OMNIFM_LIVE_ADMIN_TOKEN": token} if token else None,
                            check=False, timeout=600)
    text = completed.stdout + completed.stderr
    context.log("live-smoke", text)
    failed = set()
    for line in text.splitlines():
        if line.startswith("[FAIL] ") and "live acceptance failed" not in line:
            failed.add(line[len("[FAIL] "):].split(":", 1)[0].strip())
    if completed.returncode != 0 and not failed:
        raise StepFailed("the live smoke check did not run:\n" + tail(completed))
    note = ratchet(context, "live-smoke", failed, f"failing live checks on {LIVE_URL}")
    return note if token else note + " (public checks only; set OMNIFM_LIVE_ADMIN_TOKEN for the owner API)"


LINUX_NODE_IMAGE = "node:22-bookworm"


def voice_codec_linux(context: Context) -> str:
    """The native Opus codec on Linux, where the server runs (#263).

    GitHub ran the codec check on Ubuntu and Windows; the Windows run is the
    node/voice-codec step. This one installs the lockfile in a Linux container
    from a copy of package.json and package-lock.json, so the Windows
    node_modules stay untouched. npm's cache lives in a named volume.
    """
    binary = docker(context)
    script = ("set -e; mkdir -p /app/scripts; cp /src/package.json /src/package-lock.json /app/;"
              " cp /src/scripts/check-voice-codec.mjs /app/scripts/; cd /app;"
              " npm ci --no-audit --no-fund --loglevel=error; node scripts/check-voice-codec.mjs")
    completed = context.run(binary, "run", "--rm", "-v", f"{ROOT}:/src:ro", "-v", "omnifm-local-check-npm:/root/.npm",
                            LINUX_NODE_IMAGE, "bash", "-c", script, check=False, timeout=1800)
    path = context.log("voice-codec-linux", completed.stdout + completed.stderr)
    if completed.returncode != 0:
        raise StepFailed(f"the native Opus codec does not work on Linux. Full output: {path}\n" + tail(completed))
    return f"native Opus encode and decode on Linux ({LINUX_NODE_IMAGE})"


def extra_steps() -> list:
    return [
        Step("extra", "npm-audit", "High and critical advisories in both trees", npm_audit),
        Step("extra", "env-contract", "Every setting the code reads is documented", env_contract),
        Step("extra", "licences", "Dependency licences are known and allowed", licence_inventory,
             ("node/npm-ci", "frontend/npm-ci")),
        Step("extra", "osv", "Known vulnerabilities in the lockfiles", osv_scan),
        Step("extra", "shellcheck", "ShellCheck over the deployment scripts", shellcheck),
        Step("extra", "voice-codec-linux", "The native Opus codec on Linux, like the server", voice_codec_linux),
        Step("extra", "semgrep", "Semgrep security analysis, in place of CodeQL", semgrep_scan),
        Step("extra", "live-smoke", "The live smoke check of omnifm.xyz", live_smoke),
    ]


# -------------------------------------------------------------------- wiring

def plan(groups: set) -> list:
    builders = {"repository": repository_steps, "node": node_steps, "backend": backend_steps,
                "frontend": frontend_steps, "extra": extra_steps}
    steps: list = []
    for group in GROUPS:
        if group in groups:
            steps += builders[group]()
    if "extra" in groups:
        # The licence inventory reads node_modules, which the installs provide.
        present = {step.key for step in steps}
        needed = [step for step in node_steps() + frontend_steps()
                  if step.key in ("node/node-version", "node/npm-ci", "frontend/npm-ci") and step.key not in present]
        steps = needed + steps
    return steps


def build_context(record: bool = False) -> Context:
    return base_context(record)


def tear_down(context: Context) -> None:
    stop_everything(context)


if __name__ == "__main__":
    sys.exit(main())
