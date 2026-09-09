# Rayfin + Semantic Model + Foundry Sample

A standalone React sample. It demonstrates Fabric sign-in, private SQL
notes, a read-only Lakehouse preview through a semantic model, and a direct
Foundry call using a key entered by the user.

**No separate Entra SPA registration, MSAL, Lakehouse API for GraphQL,
Rayfin connector, or managed function is required.** Notes still use the
app's generated Rayfin CRUD API. Semantic-model reads are **Fabric portal
only**, not direct browser SQL.

The direct browser API-key integration is **demo-only**. Memory-only API-key
handling does not make a browser a production secret store. Use a trusted
server-side integration or appropriate user-delegated authentication for
production workloads.

## What deployment creates

| Resource | Created by this sample |
| --- | --- |
| Fabric App | `rayfin-semantic-foundry-sample`, with static React hosting and Fabric authentication. |
| Managed SQL database | A new database belonging to this app, with the `Note` schema and generated CRUD API. No existing notes database is required. |
| Semantic model | `SemanticKeyDemoModel`, containing the existing Lakehouse table you explicitly select during setup. |
| Model source binding | Automatic, per-user Entra SSO to the selected Lakehouse. No shared/fixed identity is substituted. |
| Browser configuration | Generated from this sample's actual app/backend and semantic-model IDs. |

The source Lakehouse and Foundry deployment are external prerequisites. Setup
does not modify Lakehouse data, create a Foundry resource, grant permissions,
change tenant settings, register an Entra application, or migrate old notes.

## Prerequisites

| Area | Required before running |
| --- | --- |
| Tools | Node.js **24**, npm, and Azure CLI (`az`) installed. The pinned Rayfin CLI is installed locally by `npm ci`; no global Rayfin CLI or other repository is needed. |
| Package access | HTTPS access to public npm (`registry.npmjs.org`). No Microsoft employee account, private package feed, or npm token is required. The Rayfin packages are pinned together; keep the lockfile and its integrity values rather than independently upgrading individual SDK packages. |
| Fabric tenant | A Fabric administrator must enable **Fabric Apps (preview)** for your account or security group. The **Semantic Model Execute Queries REST API** tenant setting must also allow the deployment account and app users. These are separate settings. |
| Target workspace | A workspace on supported Fabric capacity in a [Fabric Apps-supported region](https://learn.microsoft.com/fabric/admin/region-availability), permission to create Fabric Apps and semantic models (normally Contributor or higher), and applicable Power BI authoring licensing. |
| Source | An existing Lakehouse with a synchronized SQL analytics endpoint and at least one Delta-backed table. Setup discovers the real schema; an existing semantic model is **not** required. |
| Setup access | The signed-in deployment account can read SQL metadata and access the selected table in OneLake. Its machine can reach the SQL endpoint over encrypted **TCP 1433**, plus Azure/Fabric/Power BI HTTPS endpoints. |
| End-user access | Run and interact on the app, **Read and Build** on the model, and access to the underlying Lakehouse data. App access alone does not grant model or Lakehouse access. |
| OneLake SSO | With OneLake security disabled, users need Lakehouse **Read + ReadAll**; with OneLake security enabled, they need appropriate OneLake roles. Workspace Contributor or higher already has broad source access. SQL endpoint SELECT permission alone does not grant Direct Lake on OneLake access. |
| Foundry | An existing Azure OpenAI / Foundry deployment supporting OpenAI v1 Chat Completions and `max_completion_tokens`, with API-key authentication enabled, available quota, and a key the user is permitted to use. |
| Browser networking | The Foundry endpoint must be reachable from the browser and allow CORS from the app origin, including POST and the `api-key` and `Content-Type` headers. A resource with local/key authentication disabled will reject this sample. |

For a resource in another workspace or behind a shortcut, users and the model
owner also need the relevant source/shortcut-target permissions. This sample
does not broaden them automatically. See
[Direct Lake security](https://learn.microsoft.com/fabric/fundamentals/direct-lake-security-integration).

## Setup and deploy

Clone this repository and run commands from the **repository root**. The explicit
npm registry avoids inheriting an unrelated default registry:

```powershell
git clone https://github.com/cweo/rayfin-semantic-foundry-sample.git
cd rayfin-semantic-foundry-sample
npm ci --registry=https://registry.npmjs.org
npm run login
npm run setup
```

`login` uses the standard Azure CLI developer identity, not a new app
registration. For a specific directory, use
`npm run login -- --tenant "<your-tenant-id>"`. This is deployment authentication,
separate from the Fabric session used by end users.

The login command includes `--allow-no-subscriptions`: Fabric access does not
require the user to own an Azure subscription. Without this flag, Azure CLI can
report "No subscriptions found" and leave the previous account active.
**Do not continue to setup after a failed login.**

Setup opens an interactive terminal picker for the app/model workspace, source
workspace, Lakehouse, and table. It shows a confirmation before creating
anything. It discovers column metadata, creates the model, confirms the SSO
binding, performs the initial Direct Lake **metadata refresh**, and executes a
small DAX read. Uploading a definition alone is not sufficient: an unrefreshed
model can report "Cannot find table".

Then deploy using the workspace saved by the picker:

```powershell
$selection = Get-Content .fabric-deployment\selection.json -Raw | ConvertFrom-Json
npm run deploy -- --workspace-id $selection.workspaceId --dry-run --verbose
npm run deploy -- --workspace-id $selection.workspaceId
npm run status
```

The dry run makes no cloud calls. Real deployment verifies the selected model
(or creates it from saved setup inputs), then deploys **the app's own SQL
database, Note schema, auth, CRUD API, and frontend together**. It also packages
the app's own `rayfin.config.json`; no manual backend configuration is needed.

Open the **Fabric App item in the Fabric portal**, using the portal item link
reported by deployment. The standalone `fabricapps.net` website can use notes
and Foundry, but cannot perform portal-brokered model reads. Do not embed the
website in an arbitrary iframe to simulate Fabric.

### Switching tenants

Cancel any running setup picker, then sign in and inspect the active account:

```powershell
npm run login -- --tenant "<new-tenant-id-or-domain>"
if ($LASTEXITCODE -ne 0) { throw "Login failed; do not run setup." }
az account show --query "{tenantId:tenantId,user:user.name}" -o json
```

Confirm the account belongs to your intended tenant. Before selecting a new
deployment target, rename the existing `.fabric-deployment` directory to an
unused backup name such as `.fabric-deployment.old`. These backup names are
gitignored. Renaming preserves the original cloud resources and local records;
hiding the directory with a filesystem attribute does not prevent scripts
from reading it. Do not delete the backup or copy it into the new deployment.

Then run `npm run setup`. Recreating `.fabric-deployment` is expected: it holds
the new target's state, not the Azure CLI login. If the picker still lists the
old tenant's workspaces, check `az account show` rather than deleting more files.

## Use the app

Sign in with Fabric. Create, edit, and delete notes; rows are private to their
owner. In the model panel, select columns and read a bounded preview (25 rows
by default, at most 100). A model error is shown as an error, never as fake or
silently truncated success.

For Foundry, open the **settings gear in the Foundry card's top-right corner**
to enter your resource endpoint, deployment name, and API key, then select
**Done**. Closing settings keeps these values in page memory, not persistent
storage. The prompt and **Clear key and response** remain in the main card.
**Escape** also closes settings and returns focus to the gear. Opening or
closing settings does not call the model: enter a prompt and select
**Ask Foundry** when ready. Changing the resource endpoint clears the current
key and answer so a key is not carried over to another resource.
For example, the endpoint shape is
`https://<your-resource>.openai.azure.com/`. Only the explicit prompt is sent;
notes and model rows are not included automatically.

**API-key warning:** the key authorizes resource usage and may incur costs.
It is accessible to the user, DevTools, extensions, injected scripts, and
diagnostic tooling. Use a disposable/restricted demo resource and rotate the
key afterwards. Do not use a shared production key.

The key is held only in component memory: not in SQL, URLs, cookies, browser
storage, `.env`, generated configuration, source, or application logs.
**Clear key and response** works during a request. Clearing, signing out,
changing accounts, or reloading discards the key and results; active requests
are aborted and late results ignored. JavaScript cannot guarantee forensic
memory erasure, and aborting cannot recall an already-accepted request or its
cost. Requests have a 2,000-character prompt limit, 1,024 completion tokens,
a 60-second timeout, and no automatic retries.

## How the three paths work

| Feature | Runtime path |
| --- | --- |
| Notes | React -> typed `RayfinClient` -> this app's generated API -> this app's managed SQL database. The SDK manages the opaque Fabric session. |
| Lakehouse preview | React -> `FabricClient` / `EmbedFabricApiProxy` / `SemanticModelMessageClient` -> Fabric portal host -> read-only DAX -> Direct Lake on OneLake. The app does not acquire or extract a Fabric/Power BI token. |
| Foundry | React -> HTTPS `/openai/v1/chat/completions`, with the user-entered `api-key` header. HTTPS endpoints are validated; redirects are rejected. |

The model reader uses Arrow query transport so its 30-second query timeout and
row cap are forwarded to the host. SDK caching is disabled. This is a one-table
read demo, not a fabricated star schema or a general-purpose SQL editor.
Unsupported source types fail setup instead of silently dropping columns.
For decimal columns beyond the fixed-decimal model range, setup shows the
declared precision/scale and asks whether to use approximate floating-point
numbers in the model (about 15 significant digits). The default is **No**.
Accept only for a demo where rounding is acceptable, not exact financial
calculations. The choice is saved with the source selection; Lakehouse data is
never altered. Declining stops setup before resource creation.

### Example notes schema

| Field | Type | Rule |
| --- | --- | --- |
| `id` | UUID | Row identifier. |
| `user_id` | Text, max 128 | Owner's Fabric session identity. |
| `title` | Text, 1-200 | Editable. |
| `body` | Text, max 4,000 | Editable. |

The authoritative decorators are in `rayfin/data/Note.ts`. Rayfin exposes the
entity as `Note` in the typed API and creates the physical SQL table
**`dbo.Notes`**. Owner checks apply to create, read, update, and delete. Updates
allow only `title` and `body`; the owner cannot be changed through a normal
update. Fabric also creates its own platform-managed tables in the database.

## Local development and generated files

After cloud deployment, `npm run dev` serves the frontend at
`http://localhost:5175`. It still uses cloud notes and Foundry. Model reads
remain portal-only; there is no offline emulator or hidden local API server.

Optional public Foundry endpoint/deployment defaults are shown in `.env.example`.
If desired, copy it to an ignored root `.env`. **Never add an API key to any
environment variable**, especially a `VITE_*` variable.

All deployment state is isolated in the ignored `.fabric-deployment` folder:
`selection.json`, `model.json`, any pending operation, generated Rayfin project,
registry, runtime configuration, and deployment build. Do not commit or copy
these into another repository. Preserve this folder for repeat deployments.

`npm run model:deploy` resumes provisioning/refresh validation from the saved
selection. Same-name unowned models and unreviewed source/schema changes are
refused. It does not overwrite another model or deploy to a different workspace
silently. Source refresh or credential failures stop the workflow; inspect the
model's connection/refresh history in Fabric before explicitly retrying.

This sample's `status` command checks its recorded app/model and the hosted
runtime configuration. It lists the SQL item with the exact app name and
refuses ambiguous matches, avoiding a pinned-CLI bug that reports the
workspace's first database. Use the app's SQL association in Fabric if you
rename the SQL item or investigate ownership.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| `npm ci` fails | Keep the committed lockfile, use the install command above, and check for inherited npm registry overrides or network/TLS restrictions. All locked package URLs must use public npm. Do not disable TLS or substitute a private feed. |
| Deployment returns 403, "The feature is not available" | Have a Fabric administrator check the Fabric Apps workload setting, its security-group scope, and supported capacity region. If those are correct, provide the service's activity ID to Fabric support. Keep deployment state and rerun deploy after access is resolved; do not recreate the model. |
| Model panel asks you to open Fabric | Use the app's Fabric portal item link from deployment/status output. The standalone site and arbitrary iframes cannot broker model reads. |
| "Cannot find table" on a newly created model | Initial Direct Lake framing must finish. `npm run model:deploy` resumes saved setup/refresh state. If you changed the model manually, review and refresh it in Fabric instead. |
| Fabric sign-in works but model reads are denied | Check model Read/Build, the semantic-model query tenant setting, and the user's OneLake source permissions separately. Notes sign-in does not grant these. |
| Foundry key is blank after reload or sign-out | Expected: the key is never persisted. Re-enter it through the settings gear. |
| Foundry rejects the key or request | Check the resource endpoint, deployment name, key-auth setting, and quota. For browser network errors, check CORS allows the app origin, POST, `api-key`, and `Content-Type`. |
| Setup reports an existing unowned model or changed source | Preserve the saved state and review the conflict. The sample intentionally does not overwrite/adopt another model or silently change its source. |

## Key files and commands

| Location | Responsibility |
| --- | --- |
| `scripts/setup.mjs`, `sql-metadata.mjs` | Explicit source selection; Node-only SQL metadata discovery. |
| `scripts/model-definition.mjs`, `model.mjs`, `cloud.mjs` | Model definition, SSO binding checks, initial refresh, deployment state, API/LRO handling. |
| `scripts/fabric.mjs`, `status.mjs`, `rayfin/` | Independent app/notes SQL/auth/hosting deployment and own-resource status. |
| `src/semanticModel.ts`, `SemanticModelPanel.tsx` | Portal-only, bounded DAX preview. |
| `src/openai.ts`, `OpenAIPanel.tsx` | Memory-only API-key input and direct inference. |
| `src/notes/`, `App.tsx` | Private CRUD, Fabric session, account-change cleanup. |

`npm run build`, `npm run lint`, and `npm test` use the included toolchain.
The included GitHub Actions workflow installs on a fresh Ubuntu runner with
Node.js 24, public npm only, and no npm credentials before running these commands.
Deployment tests use temporary fixtures rather than altering live deployment
state. Browser/portal sign-in, actual user permissions, and a user-entered key
must still be exercised in the intended tenant; mocked tests are not proof of
those integrations.

## References

- [Fabric data-app template](https://learn.microsoft.com/fabric/apps/data-apps-template)
- [Fabric Apps project structure](https://learn.microsoft.com/fabric/apps/project-structure)
- [Deploy a Fabric App](https://learn.microsoft.com/fabric/apps/deploy-app)
- [Rayfin authentication](https://rayfin.ai/docs/auth)
- [Semantic-model definitions](https://learn.microsoft.com/rest/api/fabric/articles/item-management/definitions/semantic-model-definition)
- [Direct Lake security and SSO](https://learn.microsoft.com/fabric/fundamentals/direct-lake-security-integration)
