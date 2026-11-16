# Security policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 0.1.x   | Yes       |

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub: open the repository's **Security**
tab and choose **Report a vulnerability**. Do not open a public issue for a security problem.

Include the Blindspot version (`blindspot --version`), your operating system and git
version, and the smallest repository or steps that reproduce the problem. Reports are
handled on a best-effort basis. You will be told when a fix is released, and credited if
you wish.

## What counts as a vulnerability

Blindspot analyzes repositories that may be hostile, including your own dependencies. The
design assumes that any repository it reads is untrusted. Examples of what we want to hear
about:

- Code from the analyzed repository running on your machine: through git configuration,
  hooks, filters, a planted `git` executable, or the configuration file.
- Blindspot making a network request, or writing anywhere other than the output paths you
  give it.
- File names, paths or commit text that inject terminal escape sequences, or script or
  markup into the HTML report.
- Reading files outside the repository, for example through a symbolic link.
- Input that hangs Blindspot or exhausts memory, such as hostile glob patterns or deeply
  nested source.

The full threat model, with each mitigation and its test, is in
[docs/threat-model.md](docs/threat-model.md).

## Out of scope

- The accuracy of the attention index. It is a descriptive summary, not a security control
  ([ADR 0008](docs/decisions/0008-descriptive-not-predictive.md)).
- `packages/research`, a development tool that clones public repositories over HTTPS. It is
  not part of the published package, although reports about it are still welcome.
