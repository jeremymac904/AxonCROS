#!/usr/bin/env python3
"""Isolated packaging security/integrity tests; no user files, providers or install."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("release", Path(__file__).with_name("prepare-source-release.py"))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class SourceReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="axoncros-release-test-")
        self.root = Path(self.temp.name) / "source"
        self.root.mkdir()
        for name in ("LICENSE", "ASSET_POLICY.md", "SECURITY.md", "ARTWORK_LICENSE.md", "LICENSES/CC-BY-4.0.txt", "README.md", "bot-hq/LICENSE", "bot-hq/THIRD_PARTY_NOTICES.md", "script/build_and_run.sh"):
            self.put(name, "Synthetic test source only.\n")
        self.put("bot-hq/web/src/components/BotTeamAvatar.tsx", "const imageState = reduced ? 'idle' : state;\n")
        self.put("bot-hq/server/src/index.ts", "export {};\n")
        self.put("docs/connector-setup.md", "Synthetic setup guide.\n")
        self.put("bot-hq/.env.example", "SESSION_SECRET=replace-with-random-value\n")
        for name in release.OWNED_ART:
            self.put(name,b"synthetic-owned-art")
        self.put("bot-hq/web/public/assets/apps/unlicensed.png",b"uncleared-original-art")
        self.put("MACBOOK_HANDOFF.md", "Private historical handoff\n")
        subprocess.run(["git","init","-q",str(self.root)],check=True)
        subprocess.run(["git","-C",str(self.root),"add","."],check=True)
        subprocess.run(["git","-C",str(self.root),"-c","user.name=Synthetic Test","-c","user.email=test@example.invalid","commit","-qm","Synthetic fixture"],check=True)

    def tearDown(self):
        self.temp.cleanup()

    def put(self, name, content):
        path=self.root/name; path.parent.mkdir(parents=True,exist_ok=True)
        path.write_bytes(content if isinstance(content,bytes) else content.encode())

    def test_exclusions_replacements_manifest_and_deterministic_archive(self):
        for name in (".env","bot-hq/.env","bot-hq/data/private.db","bot-hq/server/src/auth.json",".local-install/staging/config.json","bot-hq/node_modules/pkg/index.js","verification/user-export.json"):
            self.put(name,"DO-NOT-RELEASE-SYNTHETIC-PRIVATE-MARKER")
        first,manifest=release.write_archive(self.root,Path(self.temp.name)/"out1",True)
        second,_=release.write_archive(self.root,Path(self.temp.name)/"out2",True)
        self.assertEqual(first.read_bytes(),second.read_bytes())
        with tarfile.open(first) as tar:
            names=tar.getnames()
            self.assertTrue(all(n.startswith("AxonCROS-source/") and "/../" not in n for n in names))
            self.assertTrue(all(t.isfile() and not t.issym() and t.uid==0 for t in tar.getmembers()))
            payload={n.removeprefix("AxonCROS-source/"):tar.extractfile(n).read() for n in names}
        self.assertFalse(any(b"DO-NOT-RELEASE" in data or b"uncleared-" in data for data in payload.values()))
        self.assertNotIn("MACBOOK_HANDOFF.md",payload)
        self.assertNotIn(".git/config",payload)
        self.assertIn("bot-hq/.env.example",payload)
        self.assertEqual(payload["docs/connector-setup.md"],b"Synthetic setup guide.\n")
        self.assertEqual(payload["mac-wrapper/Resources/AxonCROS_Symbol.png"],b"synthetic-owned-art")
        self.assertEqual(payload["bot-hq/web/src/components/BotTeamAvatar.tsx"],(self.root/"bot-hq/web/src/components/BotTeamAvatar.tsx").read_bytes())
        self.assertEqual(len(manifest["artworkLicense"]["paths"]),38)
        self.assertEqual((self.root/"mac-wrapper/Resources/AxonCROS_Symbol.png").read_bytes(),b"synthetic-owned-art")
        stored=json.loads(payload["RELEASE_MANIFEST.json"])
        for name,meta in stored["files"].items():
            self.assertEqual(hashlib.sha256(payload[name]).hexdigest(),meta["sha256"])
            self.assertEqual(len(payload[name]),meta["bytes"])
        self.assertTrue(manifest["dirtyWorktree"])
        self.assertFalse(manifest["published"])
        with self.assertRaises(FileExistsError):
            release.write_archive(self.root,Path(self.temp.name)/"out1",True)

    def test_dirty_guard_symlink_guard_and_no_checkout_output(self):
        self.put("bot-hq/server/src/new.ts","export {};\n")
        with self.assertRaisesRegex(ValueError,"Worktree has changes"):
            release.collect(self.root,False)
        with self.assertRaisesRegex(ValueError,"outside"):
            release.write_archive(self.root,self.root/"release",True)
        (self.root/"bot-hq/server/src/new.ts").unlink()
        (self.root/"bot-hq/server/src/new.ts").symlink_to(self.root/"README.md")
        with self.assertRaisesRegex(ValueError,"symlink"):
            release.collect(self.root,True)

    def test_credentials_rejected_without_echoing_material(self):
        secret="sk-"+"Z"*40
        self.put("bot-hq/server/src/accidental.ts",f"const token='{secret}';")
        with self.assertRaises(ValueError) as error:
            release.collect(self.root,True)
        self.assertIn("accidental.ts",str(error.exception))
        self.assertNotIn(secret,str(error.exception))

    def test_env_example_only_allows_empty_or_explicit_placeholder_secrets(self):
        secret="synthetic-short-value-must-not-ship"
        self.put("bot-hq/.env.example",f"HERMES_KEY={secret}\n")
        with self.assertRaises(ValueError) as error:
            release.collect(self.root,True)
        self.assertIn("Non-placeholder",str(error.exception))
        self.assertNotIn(secret,str(error.exception))

    def test_allowlist_and_artwork_attribution_fail_closed(self):
        for name in ("../escape.ts","/absolute.ts","bot-hq/server/dist/index.js","bot-hq/server/src/session.json","bot-hq/web/public/unknown.svg",".github/workflows/unreviewed.yml","mortgage-bot-team/unreviewed-customer.md","script/control\nname.py"):
            self.assertFalse(release.allowed(name),name)
        (self.root/"ARTWORK_LICENSE.md").unlink()
        with self.assertRaisesRegex(ValueError,"Missing indexed input|Required licensed artwork/notice absent"):
            release.collect(self.root,True)

    def test_legacy_runtime_pack_retains_code_art_and_upstream_notices(self):
        script=Path(__file__).resolve().parents[1]/"bot-hq/scripts/pack.sh"
        self.put("bot-hq/scripts/pack.sh",script.read_bytes())
        for name in ("package.json","package-lock.json","server/package.json","server/box/file.js","web/package.json","web/src/avatar/shapes.gen.ts","scripts/install-on-computer.sh","scripts/add-hq-to-hermes.py","scripts/sign-in-link.sh"):
            self.put("bot-hq/"+name,"synthetic packaging input\n")
        # Substitute only the build command: this regression checks archive/legal
        # membership, while clean source builds are validated separately.
        binary=Path(self.temp.name)/"bin";binary.mkdir()
        npm=binary/"npm";npm.write_text("#!/bin/sh\nmkdir -p server/dist web/dist\nprintf test > server/dist/index.js\nprintf test > web/dist/index.html\n");npm.chmod(0o755)
        output=Path(self.temp.name)/"runtime.tgz"
        subprocess.run(["bash",str(self.root/"bot-hq/scripts/pack.sh"),str(output)],env={**os.environ,"PATH":str(binary)+os.pathsep+os.environ['PATH']},capture_output=True,check=True)
        with tarfile.open(output) as tar:
            names=set(tar.getnames())
        for name in ("LICENSE","THIRD_PARTY_NOTICES.md","Legal/AxonCROS-LICENSE","Legal/ARTWORK_LICENSE.md","Legal/ASSET_POLICY.md","Legal/CC-BY-4.0.txt"):
            self.assertIn(name,names)


if __name__ == "__main__":
    unittest.main(verbosity=2)
