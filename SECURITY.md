# Security Policy

ForgeMind is local-first and should not send repository content to remote services during normal operation.

## Reporting a Vulnerability

Do not report security vulnerabilities in public issues.

Use GitHub Security Advisories when available, or contact the maintainer privately.

Please include:

- A clear description
- Steps to reproduce
- Potential impact
- Affected version
- Suggested mitigation, if known

## Scope

Security-sensitive areas include:

- Path traversal
- Unsafe filesystem writes
- Secret handling
- Command execution
- Optional local LLM compression
- Generated context accidentally including private source or secrets

