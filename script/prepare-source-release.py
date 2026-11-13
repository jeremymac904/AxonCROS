#!/usr/bin/env python3
"""Prepare an inspectable OSS source candidate, never publish or alter the checkout.

Standard library only. Inputs are Git-indexed source and explicitly allowed new
source files. Uncleared artwork/history/configuration are excluded, not copied and
then deleted. A dirty worktree requires an explicit flag and is marked as such.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import tarfile

ROOT_FILES = {"README.md", "LICENSE", "ASSET_POLICY.md", "SECURITY.md", "ARTWORK_LICENSE.md", ".gitignore"}
DOCS = {"docs/local-oss-release.md", "docs/axon-cros-native-bridge.md",
        "docs/axon-cros-r3-backend.md", "docs/axon-cros-r3-news-sources.md", "docs/research-provenance.md",
        "docs/connector-setup.md", "docs/google-agent-actions.md"}
RESEARCH_FILES = {"mortgage-bot-team/" + name for name in (
    "00-START-HERE.md", "01-team-operating-model.md", "02-loan-workflow.md",
    "03-controls-and-sources.md", "04-bot-profiles.md", "05-acceptance-tests.md",
    "06-deployment-plan.md", "07-platform-training/00-START-HERE.md",
    "07-platform-training/01-loan-factory-arive.md", "07-platform-training/02-lendingpad-encompass.md",
    "07-platform-training/03-sonar-uwm-rocket.md", "07-platform-training/04-platform-skill.md")}
EXTENSIONS = {".ts", ".tsx", ".js", ".mjs", ".py", ".swift", ".m", ".h",
              ".sh", ".json", ".html", ".css", ".md", ".toml", ".yml", ".yaml"}
EXCLUDE_PREFIXES = (".git/", ".codex/", ".local-install/", "release/", "verification/",
                    "bot-hq/assets/", "bot-hq/web/artwork/", "bot-hq/web/public/",
                    "mac-wrapper/Resources/", "bot-hq/gateway/")
EXCLUDE_FILES = {"bot-hq/web/src/avatar/shapes.gen.ts", "bot-hq/web/scripts/gen-shapes.mjs",
                 "bot-hq/server/scripts/axon-ui-acceptance.mjs"}
SECRET_PATTERN = re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|"
                            rb"(?<![\w-])(?:sk-(?:proj-)?[A-Za-z0-9_-]{30,}|"
                            rb"gh[pousr]_[A-Za-z0-9]{30,}|AIza[A-Za-z0-9_-]{30,})")
CHARACTERS = {"Captain": (31, 53, 79), "Pixel": (27, 117, 130),
              "Bolt": (180, 90, 34), "Nova": (117, 73, 151), "Scout": (78, 111, 41)}
OWNED_ART = {
    "mac-wrapper/Resources/AxonCROS_Symbol.png",
    "bot-hq/web/public/assets/axoncros/AxonCROS_Symbol.png",
    "bot-hq/web/public/assets/axoncros/AxonCROS_Primary_Logo.png",
} | {f"bot-hq/web/public/assets/bot-team/{character}/{character}_{state}.{extension}"
     for character in CHARACTERS for state, extension in
     [("profile", "png"), ("thinking", "webp"), ("thinking", "gif"),
      ("working", "webp"), ("working", "gif"), ("celebrating", "webp"), ("celebrating", "gif")]}


def allowed(name: str) -> bool:
    p = PurePosixPath(name)
    if p.is_absolute() or ".." in p.parts or "\\" in name or any(ord(c) < 32 or ord(c) == 127 for c in name):
        return False
    if name in OWNED_ART or name == "LICENSES/CC-BY-4.0.txt":
        return True
    if name.startswith(EXCLUDE_PREFIXES) or name in EXCLUDE_FILES:
        return False
    if any(x in {"node_modules", "dist", ".build", ".swiftpm", "data", "backups", "__pycache__"} for x in p.parts):
        return False
    if p.name in {"auth.json", "credentials.json", "cookies.json", "session.json"}:
        return False
    if p.name.startswith(".env"):
        return name == "bot-hq/.env.example"
    if name in ROOT_FILES or name in DOCS or name == ".github/workflows/local-ci.yml":
        return True
    if name.startswith("mortgage-bot-team/"):
        return name in RESEARCH_FILES
    if name.startswith(("bot-hq/", "mac-wrapper/", "script/")):
        return p.suffix in EXTENSIONS or p.name in {"LICENSE", ".gitignore"}
    return False


def replacements() -> dict[str, bytes]:
    result = {"bot-hq/web/public/favicon.svg": b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#1f354f"/><path d="M8 24 16 7 24 24M11 18h10" fill="none" stroke="white" stroke-width="3"/></svg>\n'}
    result["bot-hq/web/src/avatar/shapes.gen.ts"] = b'''// Original geometric placeholder for the sanitized source edition. MIT.
export interface ShapeDef { viewBox: string; d: string; outline: string }
const circle = 'M16 3a13 13 0 1 0 0 26a13 13 0 1 0 0-26';
export const SHAPES: Record<string, ShapeDef> = { blob: {viewBox: '0 0 32 32', d: circle, outline: circle} };
'''
    # Legacy full-mode icons use a neutral own glyph; local-mode icons use Lucide.
    icon_svg = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M5 5h14v14H5zM9 9v6h6V9z" fill-rule="evenodd"/></svg>\n'
    for name in ("apps arrow_down arrow_down_scroll arrow_down_scroll-white chat_filled chat_filled-white check chev_down chev_right clock close composer_plus copy copy-white edit file mic paperclip plus record save search share sidebar slack star verified voice_a voice_b").split():
        result[f"bot-hq/web/public/assets/icons/{name}.svg"] = icon_svg
    return result


def git(root: Path, *args: str) -> str:
    return subprocess.check_output(["git", "-C", str(root), *args], text=True).strip()


def collect(root: Path, allow_dirty: bool) -> tuple[dict[str, bytes], dict]:
    root = root.resolve()
    dirty = bool(git(root, "status", "--porcelain"))
    if dirty and not allow_dirty:
        raise ValueError("Worktree has changes; commit/review them, or explicitly use --allow-dirty for a candidate marked dirty.")
    names = subprocess.check_output(["git", "-C", str(root), "ls-files", "-z", "--cached", "--others", "--exclude-standard"]).decode().split("\0")
    files, excluded = {}, []
    for name in sorted(set(filter(None, names))):
        if not allowed(name):
            excluded.append(name)
            continue
        file = root / name
        if file.is_symlink() or any(parent.is_symlink() for parent in file.parents if parent != root.parent):
            raise ValueError(f"Refusing symlink input: {name}")
        if not file.is_file():
            raise ValueError(f"Missing indexed input: {name}")
        content = file.read_bytes()
        if len(content) > (25_000_000 if name in OWNED_ART else 4_000_000) or (b"\0" in content and name not in OWNED_ART):
            raise ValueError(f"Unexpected oversized/binary source: {name}")
        if name not in OWNED_ART and SECRET_PATTERN.search(content):
            raise ValueError(f"Credential-shaped material needs review; contents withheld: {name}")
        if name == "bot-hq/.env.example":
            placeholders = {"", "change-me-to-a-long-random-string", "replace-with-random-value"}
            for line in content.decode("utf8").splitlines():
                assignment = re.match(r"^\s*([A-Z][A-Z0-9_]*)\s*=\s*([^#]*)", line)
                if assignment and re.search(r"SECRET|TOKEN|PASSWORD|_KEY$", assignment[1]):
                    if assignment[2].strip().strip("\"'") not in placeholders:
                        raise ValueError("Non-placeholder credential in bot-hq/.env.example; contents withheld.")
        files[name] = content
    for required in ("LICENSE", "ASSET_POLICY.md", "SECURITY.md", "bot-hq/LICENSE", "bot-hq/THIRD_PARTY_NOTICES.md", "script/build_and_run.sh"):
        if required not in files:
            raise ValueError(f"Required release input absent: {required}")
    for name in OWNED_ART | {"ARTWORK_LICENSE.md", "LICENSES/CC-BY-4.0.txt"}:
        if name not in files:
            raise ValueError(f"Required licensed artwork/notice absent: {name}")
    generated = replacements()
    files.update(generated)
    files["bot-hq/README.md"] = b'''# AxonCROS local source edition

Start with the root README and docs/local-oss-release.md. The supported install
is the local Mac workspace, not the historical Orgo/cloud full-mode installer.
This source edition retains the owner-licensed AxonCROS/Bot Team artwork.
Uncleared legacy artwork is excluded or replaced with neutral geometry.
Upstream code attribution is retained in LICENSE and THIRD_PARTY_NOTICES.md.
No external connector/account is configured by unpacking or building this source.
'''
    files["SOURCE_EDITION.md"] = b'''# Sanitized source candidate

This archive intentionally contains no Git history, private installation config,
databases, node_modules or screenshots. Original AxonCROS/Bot Team artwork is
included under CC BY4.0 with Jeremy McDonald attribution (ARTWORK_LICENSE.md).
Other legacy artwork without recorded redistribution rights is excluded or
replaced with original neutral geometry. Working originals remain unchanged.
See RELEASE_MANIFEST.json for exact packaged SHA-256 values and exclusions.
No archive generation step publishes, installs, grants access or calls a model.
'''
    manifest = {"schema": 1, "edition": "sanitized-local-source-candidate", "baseCommit": git(root,"rev-parse","HEAD"),
                "dirtyWorktree": dirty, "published": False, "excludedPaths": excluded,
                "transformedPaths": ["bot-hq/README.md"], "generatedPaths": sorted(generated), "artworkLicense": {"spdx": "CC-BY-4.0", "attribution": "Jeremy McDonald", "permissionRecorded": "2026-11-13", "paths": sorted(OWNED_ART)},
                "research": {"paths": sorted(RESEARCH_FILES), "notice": "Project-authored dated summaries, profiles and synthetic scenarios; not a redistribution license for linked third-party sources. See docs/research-provenance.md."},
                "files": {name: {"sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)} for name,data in sorted(files.items())}}
    files["RELEASE_MANIFEST.json"] = (json.dumps(manifest,indent=2,sort_keys=True)+"\n").encode()
    return files, manifest


def write_archive(root: Path, output_dir: Path, allow_dirty: bool = False) -> tuple[Path, dict]:
    root = root.resolve()
    output_dir = output_dir.resolve()
    if output_dir == root or root in output_dir.parents:
        raise ValueError("Output must be outside the source checkout.")
    files, manifest = collect(root, allow_dirty)
    output_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    name = "AxonCROS-source-"+manifest["baseCommit"][:12]+("-worktree" if manifest["dirtyWorktree"] else "")+".tar.gz"
    target = output_dir / name
    # Exclusive creation prevents accidental replacement of a reviewed candidate.
    with target.open("xb") as output:
        os.chmod(target, 0o600)
        with gzip.GzipFile(filename="",mode="wb",fileobj=output,mtime=0) as gz:
            with tarfile.open(fileobj=gz,mode="w",format=tarfile.PAX_FORMAT) as archive:
                for name, data in sorted(files.items()):
                    info=tarfile.TarInfo("AxonCROS-source/"+name)
                    info.size=len(data); info.uid=info.gid=0; info.uname=info.gname=""; info.mtime=0
                    info.mode=0o755 if name.endswith((".sh",".py")) else 0o644
                    archive.addfile(info,io.BytesIO(data))
    digest=hashlib.sha256(target.read_bytes()).hexdigest()
    target.with_suffix(target.suffix+".sha256").write_text(digest+"  "+target.name+"\n")
    return target, manifest


def main() -> None:
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir",type=Path,required=True)
    parser.add_argument("--allow-dirty",action="store_true")
    args=parser.parse_args()
    root=Path(__file__).resolve().parents[1]
    try:
        archive,manifest=write_archive(root,args.output_dir,args.allow_dirty)
    except (ValueError,FileExistsError) as error:
        parser.error(str(error))
    print(json.dumps({"archive":str(archive),"packagedFiles":len(manifest["files"]),"excludedFiles":len(manifest["excludedPaths"]),"dirtyWorktree":manifest["dirtyWorktree"],"published":False},indent=2))


if __name__ == "__main__":
    main()
