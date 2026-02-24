# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 3.6.x   | Yes       |
| < 3.6   | No        |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

To report a vulnerability, email **ajiltu5467@gmail.com** with the subject line `[Security] SF-Intel Studio`. This keeps the disclosure private until a fix is available.

Include in your report:
- A description of the vulnerability
- Steps to reproduce
- Potential impact
- Any suggested mitigations if known

You can expect an initial response within 72 hours. If the issue is confirmed, a fix will be prioritized and released as soon as possible.

## Scope

This extension interacts with Salesforce orgs and has access to session cookies and API responses. Security issues related to the following are considered in scope:

- Cookie or credential exposure
- Content Security Policy bypasses
- Cross-origin data leakage
- Malicious code execution via the extension context
