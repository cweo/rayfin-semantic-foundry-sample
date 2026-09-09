import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { parseEnv } from 'node:util'

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const deploymentRoot = resolve(root, '.fabric-deployment')
const cli = resolve(root, 'node_modules', '@microsoft', 'rayfin-cli', 'scripts', 'main')

export function deploymentArgs(args) {
  const [flag, workspaceId, ...options] = args
  if (flag !== '--workspace-id' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(workspaceId ?? '')) {
    throw new Error('Use npm run deploy -- --workspace-id <workspace-guid> [--dry-run] [--verbose].')
  }
  if (options.some((option) => !['--dry-run', '--verbose'].includes(option))) {
    throw new Error('Only --dry-run and --verbose are supported; destructive --force is never allowed.')
  }
  return ['up', '--workspace-id', workspaceId, ...options]
}

export function deploymentEnvironment(environment) {
  // Ignore another project's targets, but retain supported authentication and
  // tenant settings so unattended deployment does not silently require login.
  return Object.fromEntries(Object.entries(environment).filter(([key]) =>
    !/^(RAYFIN_PUBLIC_|VITE_NOTES_)/i.test(key) &&
    !['RAYFIN_ENV_FILE', 'RAYFIN_WORKSPACE_ID', 'RAYFIN_ITEM_ID',
      'FABRIC_WORKSPACE_ID', 'FABRIC_ITEM_ID'].includes(key.toUpperCase())))
}

function run(file, args, cwd, credentials = {}) {
  const env = { ...deploymentEnvironment(process.env), ...credentials }
  const result = spawnSync(process.execPath, [file, ...args], { cwd, env, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Command failed (${result.status}): ${args.join(' ')}`)
}

function prepare() {
  // This sample owns only the app/model state in its private deployment root.
  mkdirSync(resolve(deploymentRoot, 'rayfin'), { recursive: true })
  cpSync(resolve(root, 'rayfin', 'rayfin.yml'), resolve(deploymentRoot, 'rayfin', 'rayfin.yml'))
  cpSync(resolve(root, 'rayfin', 'tsconfig.json'), resolve(deploymentRoot, 'rayfin', 'tsconfig.json'))
  cpSync(resolve(root, 'rayfin', 'data'), resolve(deploymentRoot, 'rayfin', 'data'), { recursive: true })
  cpSync(resolve(root, 'tsconfig.rayfin.json'), resolve(deploymentRoot, 'tsconfig.json'))
  writeFileSync(resolve(deploymentRoot, 'package.json'), JSON.stringify({
    name: 'rayfin-semantic-foundry-sample',
    private: true,
    type: 'module',
    scripts: { build: 'node ../scripts/fabric.mjs build' },
    devDependencies: { vite: '7.3.6' },
  }, null, 2) + '\n')
}

export async function main(command, args = []) {
  const upArgs = command === 'deploy' ? deploymentArgs(args) : undefined
  if (!['deploy', 'env', 'status', 'build'].includes(command)) throw new Error('Unknown Fabric command.')
  if (command !== 'deploy' && args.length) throw new Error('Unexpected arguments.')
  prepare()
  if (command === 'build') {
    if (!process.env.npm_execpath) throw new Error('Run builds through npm.')
    run(process.env.npm_execpath, ['run', 'build'], root)
    rmSync(resolve(deploymentRoot, 'dist'), { recursive: true, force: true })
    cpSync(resolve(root, 'dist'), resolve(deploymentRoot, 'dist'), { recursive: true })
    // The nested build bridge must package its own runtime config: this CLI
    // version does not emit it on every full-deployment path.
    const env = parseEnv(readFileSync(resolve(deploymentRoot, '.env.local'), 'utf8'))
    const config = {
      apiUrl: env.VITE_RAYFIN_API_URL,
      publishableKey: env.VITE_RAYFIN_PUBLISHABLE_KEY,
      workspaceId: env.VITE_FABRIC_WORKSPACE_ID,
      itemId: env.VITE_FABRIC_ITEM_ID,
      portalUrl: env.VITE_FABRIC_PORTAL_URL,
    }
    if (Object.values(config).some((value) => !value)) {
      throw new Error('Deployment runtime configuration is incomplete; refusing to publish an unconfigured notes app.')
    }
    writeFileSync(resolve(deploymentRoot, 'dist', 'rayfin.config.json'), JSON.stringify(config) + '\n')
  } else if (command === 'status') {
    if (!existsSync(resolve(deploymentRoot, 'rayfin', '.deployments.json'))) {
      throw new Error('No self-contained deployment recorded. Run npm run deploy with an explicit workspace first.')
    }
    const { deploymentStatus } = await import('./status.mjs')
    console.log(JSON.stringify(await deploymentStatus(deploymentRoot), null, 2))
  } else if (command === 'deploy') {
    if (args.includes('--dry-run')) {
      console.log('Model plan: create/validate the Direct Lake model from this sample setup selections; no API calls in dry run.')
      run(cli, upArgs, deploymentRoot)
      return
    }
    const { deployModel } = await import('./model.mjs')
    const { token } = await import('./cloud.mjs')
    await deployModel(args[1])
    run(cli, upArgs, deploymentRoot, { RAYFIN_TOKEN: await token() })
    run(cli, ['env', '--framework', 'vite'], deploymentRoot)
    const { deploymentStatus } = await import('./status.mjs')
    console.log(JSON.stringify(await deploymentStatus(deploymentRoot), null, 2))
  } else {
    run(cli, ['env', '--framework', 'vite'], deploymentRoot)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv[2], process.argv.slice(3)).catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
