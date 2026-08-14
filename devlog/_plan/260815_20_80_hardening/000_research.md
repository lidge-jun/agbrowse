# 000 - Research: agbrowse 20-80 Hardening

## Source

ChatGPT 20-80 scouting report (2026-08-14) + self code audit (2026-08-15)

## Current State

- agbrowse v0.1.23 released, dev branch at f380733
- Open issue: #88 (pollWebAi hang past --timeout)
- Closed: G01-G11 gap issues, PRs #91 (strict parseArgs) merged

## Self-Discovered Bugs (Not in Report)

### BUG-1: adaptive-fetch returns API JSON instead of SPA content (P0)

Root cause - 3 components:
1. isAuthEndpoint() misses /backend-api/* and /backend-anon/* paths
2. content-scorer gives network_api SOURCE_TRUST=16, large JSON scores ~76
3. browser-escalation waits only 300ms - too short for React SPA render

### BUG-2: Duplicate version field in package.json (lines 3-4)

### BUG-3: 8 leftover spike/probe files at repo root

## Issue Inventory

### From Report (P0/P1)

H-001 Profile modes: managed / profile-copy / existing (P0)
H-002 Chrome 144+ approved auto-connect (P0)
H-003 DevToolsActivePort WebSocket connection (P0)
H-004 --browser-url / --ws-endpoint CLI flags (P0)
H-005 Endpoint identity and ownership validator (P0)
H-006 Tab ownership: only close agbrowse-opened tabs (P0)
H-007 Startup/profile lock + tab slot serialization (P0)
H-008 Action/domain policy framework (P1)
H-009 Encrypted session state storage (P1)
H-010 Observation/output size budget (P1)
H-011 Architecture: split root CLI from lifecycle (P1)
H-012 status/doctor machine-readable diagnostics (P1)

### Self-Discovered

S-001 adaptive-fetch returns API JSON for SPA URLs (P0)
S-002 Duplicate version field in package.json (P0)
S-003 Leftover spike/probe files at repo root (P1)

## Scope

IN: S-001/S-002/S-003 fix, H-001-H-012 issue registration, devlog, PRs
OUT: H-001-H-012 implementation, benchmarks, v0.2.0
