import {existsSync, readFileSync} from 'node:fs'
import {isAbsolute, join} from 'node:path'
import {createAscClient, makeJwt, normalizePem} from './asc'
import {resolvePlatform, resolveVersionAndBundle} from './config'
import {initListingFile, missingListingFields} from './listing-init'
import {loadListingFile, resolveListing} from './listing-file'
import {pullListingFromAsc} from './listing-pull'
import {setupAppStoreListing} from './listing'

type CliArgs = {
  help: boolean
  init: boolean
  apply: boolean
  dryRun: boolean
  dir: string
  listingFile: string
  versionFile: string
  version: string
  bundleId: string
  platform: string
  platformFile: string
  locale: string
  issuerId: string
  apiKeyId: string
  apiPrivateKeyPath: string
  reviewFirstName: string
  reviewLastName: string
  reviewPhone: string
  reviewEmail: string
}

function usage(): string {
  return `Set up App Store Connect listing metadata (age rating, review contact,
localization copy, privacy policy URL, Mac screenshots).

Does not attach a TestFlight build or set What's New — use the prepare-app-store
Action for that. App Privacy nutrition labels remain manual in App Store Connect.

First time: --init discovers repo (+ optional ASC) values, prompts for gaps, and
writes store/listing.yml. Then dry-run / --apply pushes to App Store Connect.

Usage:
  ./scripts/setup-app-store-listing.sh --init --dir /path/to/app
  ./scripts/setup-app-store-listing.sh --init --dir /path/to/app \\
    --issuer-id '…' --api-key-id '…' --api-private-key-path ~/AuthKey_….p8
  ./scripts/setup-app-store-listing.sh --dir /path/to/app
  ./scripts/setup-app-store-listing.sh --dir /path/to/app --apply \\
    --issuer-id 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' \\
    --api-key-id 'XXXXXXXXXX' \\
    --api-private-key-path ~/Downloads/AuthKey_XXXXXXXXXX.p8 \\
    --review-first-name Jane --review-last-name Doe \\
    --review-phone '+1-555-0100' --review-email review@example.com

Options:
  --dir <path>                  App repo (default: current directory)
  --listing-file <path>         Listing YAML/JSON (default: store/listing.yml)
  --version-file <path>         xcconfig with MARKETING_VERSION / bundle id
  --version <ver>               Override marketing version
  --bundle-id <id>              Override bundle id
  --platform <platform>         IOS | MAC_OS | ... (wins over platform-file)
  --platform-file <path>        File whose first non-comment line is the platform
  --locale <locale>             Default en-US
  --review-first-name <name>    App Review contact (wins over listing file)
  --review-last-name <name>
  --review-phone <phone>
  --review-email <email>
  --issuer-id <id>              Required with --apply; optional with --init (ASC pull)
  --api-key-id <id>
  --api-private-key-path <p>
  --init                        Discover + prompt; write store/listing.yml
  --apply                       Write listing metadata to App Store Connect
  --dry-run                     Same as default without --init/--apply: plan only
  -h, --help
`
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    help: false,
    init: false,
    apply: false,
    dryRun: false,
    dir: '.',
    listingFile: 'store/listing.yml',
    versionFile: 'Config/Shared.xcconfig',
    version: '',
    bundleId: '',
    platform: '',
    platformFile: '',
    locale: 'en-US',
    issuerId: '',
    apiKeyId: '',
    apiPrivateKeyPath: '',
    reviewFirstName: '',
    reviewLastName: '',
    reviewPhone: '',
    reviewEmail: ''
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = (): string => {
      const value = argv[i + 1]
      if (!value || value.startsWith('-')) {
        throw new Error(`Missing value for ${arg}`)
      }
      i += 1
      return value
    }
    switch (arg) {
      case '-h':
      case '--help':
        args.help = true
        break
      case '--init':
        args.init = true
        break
      case '--apply':
        args.apply = true
        break
      case '--dry-run':
        args.dryRun = true
        break
      case '--dir':
        args.dir = next()
        break
      case '--listing-file':
        args.listingFile = next()
        break
      case '--version-file':
        args.versionFile = next()
        break
      case '--version':
        args.version = next()
        break
      case '--bundle-id':
        args.bundleId = next()
        break
      case '--platform':
        args.platform = next()
        break
      case '--platform-file':
        args.platformFile = next()
        break
      case '--locale':
        args.locale = next()
        break
      case '--review-first-name':
        args.reviewFirstName = next()
        break
      case '--review-last-name':
        args.reviewLastName = next()
        break
      case '--review-phone':
        args.reviewPhone = next()
        break
      case '--review-email':
        args.reviewEmail = next()
        break
      case '--issuer-id':
        args.issuerId = next()
        break
      case '--api-key-id':
        args.apiKeyId = next()
        break
      case '--api-private-key-path':
        args.apiPrivateKeyPath = next()
        break
      default:
        throw new Error(`Unknown argument: ${arg}`)
    }
  }
  return args
}

function say(msg: string): void {
  process.stdout.write(`${msg}\n`)
}

function resolveWorkspace(dir: string): string {
  return isAbsolute(dir) ? dir : join(process.cwd(), dir)
}

async function runInit(args: CliArgs): Promise<void> {
  if (args.apply || args.dryRun) {
    throw new Error('--init cannot be combined with --apply or --dry-run.')
  }
  const workspace = resolveWorkspace(args.dir)
  const listingPath = isAbsolute(args.listingFile)
    ? args.listingFile
    : join(workspace, args.listingFile)

  const platformFile =
    args.platformFile ||
    (existsSync(join(workspace, 'bin/asc_platform')) ? 'bin/asc_platform' : '')

  const {version, bundleId} = await resolveVersionAndBundle({
    workspace,
    versionInput: args.version,
    bundleIdInput: args.bundleId,
    versionFile: args.versionFile,
    sourceRef: ''
  })
  const platform = await resolvePlatform({
    workspace,
    platformInput: args.platform,
    platformFile,
    sourceRef: ''
  })

  say(`Workspace: ${workspace}`)
  say(`Bundle: ${bundleId}`)
  say(`Version: ${version}`)
  say(`Platform: ${platform}`)
  say(`Listing: ${listingPath}`)
  say('Mode: init')
  say('')

  let ascPull
  if (args.issuerId && args.apiKeyId && args.apiPrivateKeyPath) {
    if (!existsSync(args.apiPrivateKeyPath)) {
      throw new Error(`Private key file not found: ${args.apiPrivateKeyPath}`)
    }
    const pem = normalizePem(readFileSync(args.apiPrivateKeyPath, 'utf8'))
    const token = makeJwt(args.apiKeyId, args.issuerId, pem)
    const client = createAscClient(token)
    say('Pulling existing listing fields from App Store Connect…')
    ascPull = await pullListingFromAsc({
      client,
      bundleId,
      version,
      platform,
      locale: args.locale
    })
  } else {
    say(
      'No ASC credentials — discovering from the repo only. Pass --issuer-id / --api-key-id / --api-private-key-path to also pull from App Store Connect.'
    )
  }

  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY)
  if (!interactive) {
    say('Non-interactive terminal: writing discovery draft only (no prompts).')
  }

  const result = await initListingFile({
    workspace,
    listingPath,
    platform,
    interactive,
    ascPull
  })

  say('')
  say(`Wrote ${listingPath}`)
  if (result.reviewFlagsHint) {
    say(`Review contact flags for --apply: ${result.reviewFlagsHint}`)
  } else {
    say(
      'Pass --review-first-name / --review-last-name / --review-phone / --review-email on --apply (not stored in listing.yml).'
    )
  }

  const stillMissing = missingListingFields(result.listing, platform)
  if (stillMissing.length) {
    process.stderr.write(
      `Missing required fields: ${stillMissing.join(', ')}\n`
    )
    process.exitCode = 2
    return
  }

  say('Next: dry-run, then --apply with ASC credentials and --review-* flags.')
}

async function runApplyOrDryRun(args: CliArgs): Promise<void> {
  if (args.apply && args.dryRun) {
    throw new Error('Pass either --apply or --dry-run, not both.')
  }
  const dryRun = !args.apply
  const workspace = resolveWorkspace(args.dir)

  const listingPath = isAbsolute(args.listingFile)
    ? args.listingFile
    : join(workspace, args.listingFile)
  if (!existsSync(listingPath)) {
    throw new Error(
      `Missing listing file: ${listingPath}\nRun with --init first to create it.`
    )
  }

  const platformFile =
    args.platformFile ||
    (existsSync(join(workspace, 'bin/asc_platform')) ? 'bin/asc_platform' : '')

  const {version, bundleId} = await resolveVersionAndBundle({
    workspace,
    versionInput: args.version,
    bundleIdInput: args.bundleId,
    versionFile: args.versionFile,
    sourceRef: ''
  })
  const platform = await resolvePlatform({
    workspace,
    platformInput: args.platform,
    platformFile,
    sourceRef: ''
  })

  const file = loadListingFile(listingPath)
  const listing = resolveListing(file, {
    platform,
    reviewFirstName: args.reviewFirstName,
    reviewLastName: args.reviewLastName,
    reviewPhone: args.reviewPhone,
    reviewEmail: args.reviewEmail
  })

  say(`Workspace: ${workspace}`)
  say(`Bundle: ${bundleId}`)
  say(`Version: ${version}`)
  say(`Platform: ${platform}`)
  say(`Locale: ${args.locale}`)
  say(`Listing: ${listingPath}`)
  if (dryRun) {
    say('Mode: dry-run (no ASC writes)')
  } else {
    say('Mode: apply')
  }
  say('')

  if (dryRun) {
    say('Planned listing payload:')
    say(
      JSON.stringify(
        {
          ...listing,
          review: {
            ...listing.review,
            demoAccountPassword: listing.review.demoAccountPassword
              ? '***'
              : undefined
          },
          ageRating: listing.ageRating
            ? `{${Object.keys(listing.ageRating).length} attributes}`
            : undefined
        },
        null,
        2
      )
    )
    say('')
    say(
      'Preview only. Re-run with --apply and ASC credentials to write to App Store Connect.'
    )
    if (!args.issuerId || !args.apiKeyId || !args.apiPrivateKeyPath) {
      return
    }
  }

  if (!args.issuerId || !args.apiKeyId || !args.apiPrivateKeyPath) {
    throw new Error(
      '--apply requires --issuer-id, --api-key-id, and --api-private-key-path'
    )
  }
  if (!existsSync(args.apiPrivateKeyPath)) {
    throw new Error(`Private key file not found: ${args.apiPrivateKeyPath}`)
  }

  const pem = normalizePem(readFileSync(args.apiPrivateKeyPath, 'utf8'))
  const token = makeJwt(args.apiKeyId, args.issuerId, pem)
  const client = createAscClient(token)
  const result = await setupAppStoreListing({
    client,
    workspace,
    bundleId,
    version,
    platform,
    locale: args.locale,
    listing,
    dryRun
  })

  say('')
  say(
    JSON.stringify(
      {
        appId: result.appId,
        versionId: result.versionId,
        storeUrl: result.storeUrl,
        screenshotsUploaded: result.screenshotsUploaded,
        manualPrivacyRequired: result.manualPrivacyRequired
      },
      null,
      2
    )
  )
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    say(usage())
    return
  }
  if (args.init) {
    await runInit(args)
    return
  }
  await runApplyOrDryRun(args)
}

async function run(): Promise<void> {
  try {
    await main()
  } catch (err) {
    process.stderr.write(
      `${err instanceof Error ? err.message : String(err)}\n`
    )
    process.exit(1)
  }
}

void run()
