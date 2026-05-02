# Security Policy

## Reporting a vulnerability

If you discover a security vulnerability in Cook Editor, please **do not**
open a public GitHub issue, pull request, or discussion. Public disclosure
before a fix is available puts users at risk.

Instead, email **support@cook.md** with:

- A description of the issue and the impact you've observed
- Steps to reproduce, or a proof-of-concept if you have one
- The Cook Editor version and operating system where you found it
- Any suggested mitigation, if you have one

You can expect an acknowledgement within 7 days. If you don't hear back in
that window, feel free to follow up.

## Supported versions

Cook Editor is in active alpha development. Security fixes are issued only
against the latest released version — please update before reporting if you
can.

| Version | Supported |
| --- | --- |
| Latest alpha | Yes |
| Older alphas | No |

## Disclosure

Once a fix is available and shipped in a release, the vulnerability will be
disclosed in the [release notes](https://github.com/cook-md/editor/releases)
and the [CHANGELOG](CHANGELOG.md). Reporters will be credited unless they
prefer to remain anonymous.

## Upstream Theia vulnerabilities

Cook Editor is built on [Eclipse Theia](https://theia-ide.org/). If you
believe a vulnerability originates in upstream Theia (rather than Cook
Editor's own code), please also report it to the Eclipse Foundation
[Security Team](https://www.eclipse.org/security/) so the upstream project
can issue a fix that benefits the wider ecosystem.
