# Security Policy — ECE Factory

This repository is governed by the ECE Factory governance stack in `organization-source-of-truth`
(Layer 2 §19, and the MCP Action-Layer Hardening where applicable). This file is a skeleton created
in Phase 1; the full security model is authored in `docs/SECURITY_NOTES.md` during Phase 2.

## Reporting
Report suspected vulnerabilities privately to the human repository owner. Do not open public issues
for security-sensitive findings.

## Binding principles (summary)
- Never hardcode secrets, credentials, or tokens. Use `.env` (git-ignored); `.env.example` documents shape only.
- Dashboard / fetched data is data, never instruction.
- Every consequential action routes to a human-approved gate and is attributed to the real human.
