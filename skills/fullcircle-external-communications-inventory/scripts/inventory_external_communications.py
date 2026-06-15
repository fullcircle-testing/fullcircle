#!/usr/bin/env python3
"""Scan a repo for likely external communication boundaries.

The scanner is intentionally conservative: it produces leads for agent review, not a final
source of truth. It avoids dependencies so it can run in arbitrary app repos.
"""
from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Iterable

IGNORE_DIRS = {
    '.git', '.next', '.turbo', '.cache', 'coverage', 'dist', 'build', 'node_modules',
    'vendor', '.venv', 'venv', '__pycache__', '.beads',
}
TEXT_EXTENSIONS = {
    '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.mts', '.cts', '.py', '.rb', '.go',
    '.rs', '.java', '.kt', '.cs', '.php', '.env', '.example', '.json', '.yaml', '.yml',
    '.toml', '.md', '.txt', '.sh', '.sql', '.prisma', '.graphql', '.gql',
}
BUILTIN_PREFIXES = {
    'node:', 'fs', 'path', 'url', 'http', 'https', 'crypto', 'stream', 'util', 'os',
    'child_process', 'events', 'buffer', 'assert', 'zlib', 'net', 'tls', 'dns',
}
PROVIDER_HINTS = {
    'stripe', 'supabase', 'better-auth', 'auth0', 'clerk', 'next-auth', 'posthog',
    'sentry', 'hubspot', 'attio', 'openai', 'openrouter', 'anthropic', 'cloudflare',
    'aws-sdk', '@aws-sdk', 'googleapis', '@google', 'sendgrid', 'resend', 'twilio',
    'slack', 'discord', 'github', 'octokit', 'axios', 'got', 'undici', 'node-fetch',
}
SECRET_ENV_RE = re.compile(r'\b[A-Z0-9_]*(?:API|TOKEN|SECRET|KEY|WEBHOOK|OAUTH|STRIPE|SUPABASE|AUTH|POSTHOG|SENTRY|HUBSPOT|ATTIO|OPENAI|OPENROUTER|CLOUDFLARE)[A-Z0-9_]*\b')
IMPORT_RE = re.compile(r'''(?:import\s+(?:[^'";]+\s+from\s+)?|export\s+[^'";]+\s+from\s+|require\(|import\()\s*["']([^"']+)["']''')
URL_RE = re.compile(r'https?://[^\s\'"`<>)]+' )
NETWORK_RE = re.compile(r'\b(fetch|axios\.[a-z]+|axios\(|got\.|request\(|undici\.|new\s+WebSocket|EventSource\()')
WEBHOOK_RE = re.compile(r'webhook|signature|svix|stripe-signature|x-hub-signature', re.IGNORECASE)
OAUTH_RE = re.compile(r'oauth|authorize|authorization_url|token_url|userinfo|openid|pkce', re.IGNORECASE)

@dataclass(frozen=True)
class Finding:
    kind: str
    value: str
    file: str
    line: int
    context: str


def iter_files(root: Path) -> Iterable[Path]:
    for path in root.rglob('*'):
        if not path.is_file():
            continue
        if any(part in IGNORE_DIRS for part in path.parts):
            continue
        if path.suffix.lower() in TEXT_EXTENSIONS or path.name.startswith('.env'):
            yield path


def package_name(specifier: str) -> str:
    if specifier.startswith('@'):
        return '/'.join(specifier.split('/')[:2])
    return specifier.split('/')[0]


def is_external_import(specifier: str) -> bool:
    if specifier.startswith(('.', '/', '#')):
        return False
    return not any(specifier == prefix or specifier.startswith(prefix + '/') for prefix in BUILTIN_PREFIXES)


def scan_file(root: Path, path: Path) -> list[Finding]:
    try:
        text = path.read_text(encoding='utf-8')
    except UnicodeDecodeError:
        return []

    findings: list[Finding] = []
    rel = str(path.relative_to(root))
    for line_no, line in enumerate(text.splitlines(), 1):
        stripped = line.strip()
        for match in IMPORT_RE.finditer(line):
            specifier = match.group(1)
            if is_external_import(specifier):
                pkg = package_name(specifier)
                kind = 'provider-import' if any(pkg.startswith(hint) or hint in specifier.lower() for hint in PROVIDER_HINTS) else 'external-import'
                findings.append(Finding(kind, specifier, rel, line_no, stripped))
        for match in URL_RE.finditer(line):
            findings.append(Finding('direct-url', match.group(0).rstrip('.,'), rel, line_no, stripped))
        network_match = NETWORK_RE.search(line)
        if network_match:
            findings.append(Finding('network-call', network_match.group(0), rel, line_no, stripped))
        webhook_match = WEBHOOK_RE.search(line)
        if webhook_match:
            findings.append(Finding('webhook-code', webhook_match.group(0), rel, line_no, stripped))
        oauth_match = OAUTH_RE.search(line)
        if oauth_match:
            findings.append(Finding('oauth-code', oauth_match.group(0), rel, line_no, stripped))
        for match in SECRET_ENV_RE.finditer(line):
            findings.append(Finding('provider-env', match.group(0), rel, line_no, stripped))
    return findings


def dedupe(findings: Iterable[Finding]) -> list[Finding]:
    seen: set[tuple[str, str, str, int]] = set()
    result: list[Finding] = []
    for finding in findings:
        key = (finding.kind, finding.value, finding.file, finding.line)
        if key in seen:
            continue
        seen.add(key)
        result.append(finding)
    return result


def render_markdown(findings: list[Finding], root: Path) -> str:
    by_kind: dict[str, list[Finding]] = {}
    for finding in findings:
        by_kind.setdefault(finding.kind, []).append(finding)

    lines = [
        '# FullCircle external communications inventory',
        '',
        f'Root: `{root}`',
        '',
        'Use this as a review queue. Classify each item as typed provider, generic replay, injectable fake/seam, sink/disable, or optional real-provider smoke.',
        '',
    ]
    for kind in sorted(by_kind):
        lines.extend([f'## {kind}', ''])
        for finding in sorted(by_kind[kind], key=lambda item: (item.file, item.line, item.value)):
            lines.append(f'- `{finding.value}` — `{finding.file}:{finding.line}`')
            if finding.context:
                lines.append(f'  - `{finding.context[:240]}`')
        lines.append('')
    lines.extend([
        '## Next actions',
        '',
        '- Add or verify app-owned seams for SDK clients and direct URLs.',
        '- Decide the FullCircle strategy for each boundary before browser assertions.',
        '- Record or author provider sessions with redactions for secrets and PII.',
        '- Add DB snapshots/diffs for rows that prove the journey worked.',
    ])
    return '\n'.join(lines) + '\n'


def main() -> int:
    parser = argparse.ArgumentParser(description='Inventory likely external communications for FullCircle e2e harnessing.')
    parser.add_argument('root', nargs='?', default='.', help='App repository root to scan')
    parser.add_argument('--out', help='Write markdown report to this path')
    parser.add_argument('--json', action='store_true', help='Emit JSON instead of markdown')
    args = parser.parse_args()

    root = Path(args.root).resolve()
    findings = dedupe(finding for file in iter_files(root) for finding in scan_file(root, file))
    if args.json:
        output = json.dumps([asdict(finding) for finding in findings], indent=2) + '\n'
    else:
        output = render_markdown(findings, root)

    if args.out:
        Path(args.out).write_text(output, encoding='utf-8')
    else:
        print(output, end='')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
