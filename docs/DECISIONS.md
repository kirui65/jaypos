# Decisions and Open Questions

This log records choices for the Phase 1 implementation. `TODO(spec)` marks an unresolved question or behavior that must be revisited if it affects implementation. The owner may change assumptions.

## Working decisions

- **Stack:** use the exact stack requested for this session (pnpm, React/TypeScript/Vite/Tailwind/TanStack Query/React Router, Node 20/TypeScript/Express/Zod, PostgreSQL/Prisma, Vitest, ESLint, Prettier). The spec calls its stack recommendations assumptions and permits alternatives; this prompt fixes the choice.
- **Scope:** M1–M8 define the delivery breakdown for Phase 1. Offline/sync UI, SMS campaigns, purchasing, loyalty, full reporting, and other Phase 2–4 work remain deferred even where the broader spec describes them.
- **Payment provider:** develop and test against a mock provider. Do not guess Lipwa request/response or signature fields. **TODO(lipwa):** verify current Lipwa API docs, callback authentication, status query behavior, credentials, and shortcode configuration before implementing the adapter.
- **Authentication token/session details:** choose a secure session or short-lived JWT plus refresh implementation consistent with the spec when M2 is designed; keep secrets in environment configuration. **TODO(spec):** settle exact token/session storage and rotation details before implementation.
- **Seed credentials:** the spec requires a seeded admin but does not define how a local development credential is supplied. Use environment-provided seed credentials and document required variables; never bake a usable production password into source. **TODO(spec):** owner to set the initial admin credential for deployment.
- **Initial catalog:** seed a small representative set only. **TODO(spec):** confirm the owner's final types, boutique range, size/color sets, unisex usage, decants, and gift sets; seed contents are development examples, not the production catalog.
- **Theme assets:** use the section 10.1 default tokens and self-hosted font files where licensing/source permits. **TODO(spec):** owner to provide official logo/tagline, confirm gold shade, receipt footer, and approve font assets.
- **Tax:** preserve configurable tax fields and integer-cent arithmetic. **TODO(spec):** confirm VAT registration, rates/treatment by type, tax-inclusive/exclusive pricing, and whether eTIMS is required now.
- **Stock:** use transactional ledger movements and stock levels as specified; maintain the source's weighted-average cost assumption. **TODO(spec):** confirm online negative-stock policy and opening-stock source before go-live.
- **Hardware and deployment:** target browser printing and keyboard-wedge barcode scanning first, while keeping provider/device boundaries extensible. **TODO(spec):** confirm printer/scanner model, number of tills/admin accounts, hosting preference, and budget.
- **Audit scope:** audit all important writes, authentication failures, and other actions enumerated in section 6.14; avoid secrets and unnecessary sensitive data in audit payloads. **TODO(spec):** define retention and exact before/after field redaction during implementation.

## Conflicts and ambiguities found

- The repository has both `/SPEC.md` and `/docs/SPEC.md`; they are byte-identical. This session names `/docs/SPEC.md` as source of truth, so use it and keep the root copy untouched unless asked.
- The source spec's recommended stack is explicitly an assumption and includes alternatives (Fastify, Drizzle, Jest, etc.); the session prompt fixes Express, Prisma, and Vitest. Follow the prompt's exact choices.
- The source spec's Phase 1 is a broad core POS, while this prompt breaks it into M1–M8 and explicitly excludes later-phase features. Where a requested milestone mentions a capability that the source associates with a later phase (for example stock import/counting or a richer admin surface), the requested milestone scope governs this session; do not extend beyond it.
- The source describes optional PDF receipts, but M7 explicitly requires PDF output; include it in M7.
- The source asks for current Lipwa documentation before implementation, while the prompt gives a fallback if it cannot be accessed. No provider field names or authentication mechanism are assumed until documentation is checked.
- The source says to ask or leave `TODO(spec)` when unclear; the session prompt directs reasonable reversible choices to be logged and continued. Record these items here and continue unless a decision is costly to reverse.
