"""プロジェクトの約束ごと（CLAUDE.md の「サプライチェーン対策」など）が守られていることのテスト"""

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).parent.parent

DIGEST = r"@sha256:[0-9a-f]{64}"
COMMIT = r"[0-9a-f]{40}"


def read(name: str) -> str:
    return (ROOT / name).read_text(encoding="utf-8")


class PinnedVersionsTest(unittest.TestCase):
    def test_docker_images_are_pinned_by_digest(self):
        dockerfile = read("Dockerfile")
        stages = re.findall(r"^FROM \S+ AS (\w+)", dockerfile, re.M)
        images = re.findall(r"^FROM (\S+)", dockerfile, re.M) + re.findall(r"--from=(\S+)", dockerfile)
        images = sorted({image for image in images if image not in stages})  # 前の段を指す --from=<段の名前> は除く
        self.assertEqual(len(images), 2)  # python と uv
        for image in images:
            self.assertRegex(image, rf"^[\w./-]+:[\w.-]+{DIGEST}$", image)

    def test_nepub_is_pinned_to_a_commit(self):
        self.assertRegex(read("pyproject.toml"), rf'"nepub @ git\+https://github\.com/ttk1/nepub\.git@{COMMIT}"')
        self.assertRegex(read("uv.lock"), rf"nepub\.git\?rev={COMMIT}#{COMMIT}")

    def test_python_dependencies_are_only_flask_and_nepub(self):
        dependencies = re.search(r"^dependencies = \[(.*?)^\]", read("pyproject.toml"), re.M | re.S)[1]
        names = [re.match(r"[\w-]+", line.strip().strip('"'))[0] for line in dependencies.strip().splitlines()]
        self.assertEqual(names, ["flask", "nepub"])


class DockerContextTest(unittest.TestCase):
    def test_everything_the_dockerfile_copies_is_in_the_build_context(self):
        # .dockerignore は、通すものだけを書く形にしている。Dockerfile が COPY するものが漏れていると、ビルドが失敗する
        allowed = {line[1:].rstrip("/") for line in read(".dockerignore").splitlines() if line.startswith("!")}
        sources = []
        for line in re.findall(r"^COPY (?!--from)(.+)$", read("Dockerfile"), re.M):  # 前の段やほかのイメージからのコピーは除く
            sources += [source.rstrip("/") for source in line.split()[:-1]]
        self.assertTrue(sources)
        self.assertEqual(set(sources) - allowed, set())


if __name__ == "__main__":
    unittest.main()
