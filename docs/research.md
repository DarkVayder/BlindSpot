# Running the research pipeline

The pipeline validates the score as described in [research-protocol.md](research-protocol.md).
It lives in `packages/research` and is a development tool. It is not shipped with the CLI.

```bash
pnpm build
node packages/research/dist/bin.js fetch
node packages/research/dist/bin.js pin
```

| Command | What it does                                                                                                                                                                                                                                                              |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fetch` | Clones every dataset repository into `research/cache/<id>` over HTTPS, without a checkout. An existing clone that already has every pinned commit is reused without any network access. `--update` also fetches new commits. Missing pinned commits are fetched by hash.  |
| `pin`   | Resolves each snapshot date to a commit on the default branch, then the end of its outcome window, and writes them to the dataset with the commit count in the window and the number of tracked files. Pinned repositories are never re-pinned unless `--force` is given. |

Common options: `--dataset <file>` (default `research/datasets/v1.json`), `--cache <dir>`
(default `research/cache`), `--only <ids...>` and `--timeout-minutes <n>` (default 30).

Exit codes: 0 success, 2 usage or dataset error, 3 git or network failure, 4 internal error.

## The dataset file

`research/datasets/v1.json` lists the repositories with their language and license, the two
snapshot dates and the window length. After `pin`, each repository records its pinned
commits. The file's SHA-256 is recorded in every output, so a changed dataset is always
visible. Once results exist, the file is only changed through an amendment in §9 of the
protocol.
