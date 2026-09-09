// @vitest-environment node
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { deploymentArgs, deploymentEnvironment, deploymentRoot, root } from './fabric.mjs'

const read = (path) => readFileSync(resolve(root, path), 'utf8')
const workspace = '00000000-0000-0000-0000-000000000000'
let fixtureRoot
let fixtureDeployment
beforeAll(() => {
  fixtureRoot = mkdtempSync(resolve(tmpdir(), 'rayfin-semantic-foundry-test-'))
  fixtureDeployment = resolve(fixtureRoot, '.fabric-deployment')
  mkdirSync(resolve(fixtureRoot, 'scripts'))
  for (const file of ['package.json', 'tsconfig.rayfin.json', 'rayfin', 'scripts/fabric.mjs']) {
    cpSync(resolve(root, file), resolve(fixtureRoot, file), { recursive: true })
  }
  symlinkSync(resolve(root, 'node_modules'), resolve(fixtureRoot, 'node_modules'), 'junction')
})
afterAll(() => {
  if (fixtureRoot) rmSync(fixtureRoot, { recursive: true, force: true })
})
describe('self-contained deployment contract', () => {
  it('keeps headless authentication but excludes another projects deployment target', () => {
    expect(deploymentEnvironment({
      RAYFIN_TOKEN: 'test-token',
      RAYFIN_TENANT_ID: 'test-tenant',
      RAYFIN_TELEMETRY_OPTOUT: '1',
      RAYFIN_PUBLIC_ITEM_ID: 'old-item',
      RAYFIN_ENV_FILE: 'other.env',
      VITE_NOTES_API_URL: 'old-backend',
      VITE_ENTRA_CLIENT_ID: 'spa-client',
    })).toEqual({
      RAYFIN_TOKEN: 'test-token',
      RAYFIN_TENANT_ID: 'test-tenant',
      RAYFIN_TELEMETRY_OPTOUT: '1',
      VITE_ENTRA_CLIENT_ID: 'spa-client',
    })
  })
  it('requires an explicit workspace and rejects destructive or alternate target arguments', () => {
    expect(deploymentArgs(['--workspace-id', workspace, '--dry-run', '--verbose']))
      .toEqual(['up', '--workspace-id', workspace, '--dry-run', '--verbose'])
    for (const args of [[], ['--workspace', 'default'], ['--workspace-id', workspace, '--force'],
      ['--workspace-id', workspace, '--env-file', 'old.env']]) {
      expect(() => deploymentArgs(args)).toThrow()
    }
  })
  it('isolates its registry, env and schema from other deployments', () => {
    expect(deploymentRoot).toBe(resolve(root, '.fabric-deployment'))
    const script = read('scripts/fabric.mjs')
    expect(script).not.toContain("resolve(root, 'rayfin', '.env')")
    expect(script).not.toContain("resolve(root, 'rayfin', '.deployments.json')")
    const yaml = read('rayfin/rayfin.yml')
    expect(yaml).toContain('name: rayfin-semantic-foundry-sample')
    expect(script).toContain("name: 'rayfin-semantic-foundry-sample'")
    expect(JSON.parse(read('package.json')).name).toBe('rayfin-semantic-foundry-sample')
    expect(yaml).toMatch(/auth:\s+enabled: true/)
    expect(yaml).toMatch(/data:\s+enabled: true\s+dialect: mssql/)
    expect(yaml).toMatch(/staticHosting:\s+enabled: true\s+folder: dist\s+buildCommand: npm run build/)
  })
  it('pins its own CLI/core and preserves external env config', () => {
    const pkg = JSON.parse(read('package.json'))
    expect(pkg.devDependencies['@microsoft/rayfin-cli']).toBe('1.35.0-beta.0')
    expect(pkg.devDependencies['@microsoft/rayfin-core']).toBe('1.35.0-beta.0')
    expect(pkg.scripts.predev).toBe('npm run env')
    expect(pkg.scripts.prebuild).toBe('npm run env')
    expect(pkg.scripts.login).toBe('az login --allow-no-subscriptions')
    expect(read('vite.config.ts')).toContain("'.fabric-deployment', '.env.local'")
    expect(read('scripts/fabric.mjs')).not.toMatch(/writeFileSync\([^)]*['"]\.env['"]/)
  })
  it('locks dependencies to public npm without feed credentials', () => {
    const lock = JSON.parse(read('package-lock.json'))
    expect(lock.name).toBe(JSON.parse(read('package.json')).name)
    for (const [path, pkg] of Object.entries(lock.packages)) {
      if (!path) continue
      const url = new URL(pkg.resolved)
      expect(url.origin).toBe('https://registry.npmjs.org')
      expect(url.username + url.password + url.search + url.hash).toBe('')
      expect(pkg.integrity).toMatch(/^sha(?:1|512)-/)
    }
  })
  it('runs an offline dry run and env mapping without changing private/legacy files', () => {
    const protectedFiles = ['.env', '.env.local', '.fabric-deployment/model.json',
      '.fabric-deployment/.env.local', '.fabric-deployment/rayfin/.deployments.json']
    const fingerprints = () => protectedFiles.map((file) => {
      const path = resolve(root, file)
      return existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : null
    })
    const before = fingerprints()
    for (const args of [
      ['deploy', '--workspace-id', workspace, '--dry-run', '--verbose'],
      ['env'],
    ]) {
      const result = spawnSync(process.execPath, [resolve(fixtureRoot, 'scripts/fabric.mjs'), ...args],
        { cwd: fixtureRoot, encoding: 'utf8' })
      expect(result.status).toBe(0)
      if (args[0] === 'deploy') {
        const output = result.stdout + result.stderr
        expect(output).toContain('No API calls will be made')
        expect(output).toContain('auth=true, data=true')
        expect(output).toContain('Generate and apply DAB configuration')
        expect(output).toContain('Build, package, and deploy static content')
      }
    }
    expect(fingerprints()).toEqual(before)
  }, 90000)
  it('compiles the isolated schema into owner-scoped SQL/DAB without cloud calls', async () => {
    const { generateDabConfig } = await import(pathToFileURL(resolve(root,
      'node_modules/@microsoft/rayfin-cli/dist/utils/dab-config-generator.js')).href)
    const result = await generateDabConfig({ projectRoot: fixtureDeployment, dialect: 'mssql' })
    expect(result.entities.map((entity) => entity.name)).toEqual(['Note'])
    const config = JSON.parse(readFileSync(result.configPath, 'utf8'))
    const permissions = config.entities.Note.permissions
    expect(permissions).toHaveLength(1)
    expect(permissions[0].role).toBe('authenticated')
    expect(permissions[0].actions.map((action) => action.action).sort())
      .toEqual(['create', 'delete', 'read', 'update'])
    for (const action of permissions[0].actions) {
      expect(action.policy.database).toBe('@claims.sub eq @item.user_id')
    }
    expect(permissions[0].actions.find((action) => action.action === 'update').fields.include.sort())
      .toEqual(['body', 'title'])
  }, 30000)
})
