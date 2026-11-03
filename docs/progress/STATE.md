# M0 / M1 status

In progress on `migration/m0-m1`. Four original repositories are preserved.

M0: bundles, staged/unstaged patches and working-tree archives captured/restored. All accessible file hashes and patch contents match. `LEARN_website/docs/STRUCTURE.md` was unreadable: committed history is bundled, raw working-tree bytes unverified. Git status stat metadata differs on Windows, but semantic diffs match.

M1: backend-only source assembled. Prisma generation, lint, strict typecheck, API/worker build, **255 unit tests**, **4 tooling tests**, and isolated SDK tarball consumer runtime/type checks passed. Contract candidate `1.0.0` has hash `f93391e681bf`, 55 OpenAPI operations and synthetic fixtures; it is local, not registry-published. Partial response DTOs/query objects are marked explicitly.

Registry network denied; offline clean install lacks tarballs. A version-matched local toolchain was used for verification only, not claimed as clean install. Docker daemon/WSL unavailable, no local DB/Redis/storage listening. Compose execution/plugin validation is unverified on this host. Live sandbox runner exits 2 rather than touching an existing database.

Next: enable an accessible Docker/test stack and registry access, run clean npm ci and sandbox:verify, verify the unreadable original document, then finish acceptance/registry publication separately. Do not claim M0/M1 fully accepted before these gates.
