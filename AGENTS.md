# Repository guidance

- Keep this sample standalone and environment-neutral. Do not add customer,
  organization, workspace, tenant, subscription, user, or deployed-resource
  details to source, tests, documentation, or commit messages.
- Use descriptive placeholders or all-zero GUIDs in examples. Generate synthetic
  identifiers inside tests rather than copying deployment metadata.
- Never commit API keys, tokens, passwords, connection strings, `.env` files,
  `.npmrc` credentials, deployment-state folders or their backups, runtime logs,
  screenshots of authenticated pages, build output, or dependency directories.
  `.env.example` must contain empty values or clearly synthetic placeholders.
- Before committing or pushing, inspect every staged file and outgoing commit
  for secrets and non-placeholder identifiers. Before changing visibility to
  public, inspect every branch and tag; a clean current tree is not sufficient
  if previous commits contain private data.
- Keep the Foundry key in component memory only. Preserve clear/sign-out/account
  change cleanup, request cancellation, and visible demo-only warnings.
- Keep model reads read-only and portal-brokered; never move deployment tokens
  into the browser. Do not change model precision without explicit setup consent.
- Preserve compatible, explicitly pinned Rayfin versions and package integrity
  values. All locked dependency URLs must use `https://registry.npmjs.org`
  without credentials. Do not introduce private feeds, borrow dependencies from
  another project, or rely on an authenticated developer cache.
- Define managed SQL schema in `rayfin/data`. Preserve owner policies and never
  introduce destructive deployment flags or implicit workspace selection.
- Use `npm run build`, `npm run lint`, and the relevant `npm test` selectors for
  changes. Use temporary fixtures for deployment tests, not live cloud state.
