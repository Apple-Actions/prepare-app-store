import {
  getBooleanInput,
  getInput,
  setFailed,
  setOutput,
  warning
} from '@actions/core'
import {join} from 'node:path'
import {createAscClient, makeJwt, normalizePem} from './asc'
import {
  assembleWhatsNew,
  resolvePlatform,
  resolveVersionAndBundle
} from './config'
import {prepareAppStore} from './prepare'

async function run(): Promise<void> {
  try {
    await main()
  } catch (err) {
    setFailed(err instanceof Error ? err.message : String(err))
  }
}

async function main(): Promise<void> {
  const issuerId = getInput('issuer-id', {required: true})
  const apiKeyId = getInput('api-key-id', {required: true})
  const apiPrivateKey = normalizePem(
    getInput('api-private-key', {required: true})
  )
  const versionFile = getInput('version-file') || 'Config/Shared.xcconfig'
  const versionInput = getInput('version')
  const bundleIdInput = getInput('bundle-id')
  const platformInput = getInput('platform')
  const platformFile = getInput('platform-file')
  const releaseNotesDirInput = getInput('release-notes-dir')
  const sourceRef = getInput('source-ref')
  const locale = getInput('locale') || 'en-US'
  const submit = getBooleanInput('submit')

  const workspace = process.env.GITHUB_WORKSPACE || process.cwd()
  const {version, bundleId} = await resolveVersionAndBundle({
    workspace,
    versionInput,
    bundleIdInput,
    versionFile,
    sourceRef
  })
  const platform = await resolvePlatform({
    workspace,
    platformInput,
    platformFile,
    sourceRef
  })
  const notesDir = releaseNotesDirInput.trim() || join('release-notes', version)
  const whatsNew = await assembleWhatsNew({
    workspace,
    notesDir,
    sourceRef
  })
  if (!whatsNew.trim()) {
    warning(
      `No release-notes files in ${notesDir}. What's New will be left untouched on the App Store version.`
    )
  }

  const token = makeJwt(apiKeyId, issuerId, apiPrivateKey)
  const client = createAscClient(token)
  const result = await prepareAppStore({
    client,
    bundleId,
    version,
    platform,
    whatsNew,
    locale,
    submit
  })

  setOutput('version', version)
  setOutput('bundle-id', bundleId)
  setOutput('build-number', result.buildNumber)
  setOutput('app-id', result.appId)
  setOutput('app-store-version-id', result.versionId)
  setOutput('store-url', result.storeUrl)
}

run()
