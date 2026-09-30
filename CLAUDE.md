# Project rules

Full spec: `docs/BUILD_SPEC.md` (Part A = requirements, Part B = open gaps/decisions).

- **No payment processing and no payment fields** (v1). Money fields are display/quote only.
- The data model in `docs/BUILD_SPEC.md` is the source of truth — flag any change instead of redesigning silently.
- Schema + migrations are reviewed before UI code. Build one phase at a time.
- Ship seed/fixture data with every phase.
- Telegram: official Bot API + official Mini Apps SDK only, no third-party wrappers.
- The verification badge must work standalone when embedded on an unrelated third-party site.
