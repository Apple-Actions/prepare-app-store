import {existsSync, readFileSync, readdirSync} from 'node:fs'
import {isAbsolute, join} from 'node:path'
import {getExecOutput} from '@actions/exec'

export function parseXcconfig(contents: string): {
  version: string
  bundleId: string
} {
  let version = ''
  let bundleId = ''
  for (const line of contents.split(/\r?\n/)) {
    const versionMatch = /^MARKETING_VERSION\s*=\s*(.*)$/.exec(line)
    if (versionMatch) {
      version = versionMatch[1].trim()
    }
    const bundleMatch = /^PRODUCT_BUNDLE_IDENTIFIER\s*=\s*(.*)$/.exec(line)
    if (bundleMatch) {
      bundleId = bundleMatch[1].trim()
    }
  }
  return {version, bundleId}
}

export function readFirstValue(contents: string): string {
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }
    return trimmed.replace(/\s+/g, '')
  }
  return ''
}

async function readRepoFile(
  workspace: string,
  relativePath: string,
  sourceRef: string
): Promise<string> {
  if (sourceRef) {
    const result = await getExecOutput(
      'git',
      ['show', `${sourceRef}:${relativePath}`],
      {cwd: workspace, ignoreReturnCode: true, silent: true}
    )
    if (result.exitCode !== 0) {
      throw new Error(
        `Could not read ${relativePath} from ${sourceRef}: ${result.stderr.trim()}`
      )
    }
    return result.stdout
  }
  const path = isAbsolute(relativePath)
    ? relativePath
    : join(workspace, relativePath)
  if (!existsSync(path)) {
    throw new Error(`Missing ${relativePath}`)
  }
  return readFileSync(path, 'utf8')
}

export async function resolveVersionAndBundle({
  workspace,
  versionInput,
  bundleIdInput,
  versionFile,
  sourceRef
}: {
  workspace: string
  versionInput: string
  bundleIdInput: string
  versionFile: string
  sourceRef: string
}): Promise<{version: string; bundleId: string}> {
  if (versionInput && bundleIdInput) {
    return {version: versionInput.trim(), bundleId: bundleIdInput.trim()}
  }

  const contents = await readRepoFile(workspace, versionFile, sourceRef)
  const parsed = parseXcconfig(contents)
  const version = versionInput.trim() || parsed.version
  const bundleId = bundleIdInput.trim() || parsed.bundleId
  if (!version || !bundleId) {
    throw new Error(
      `Could not resolve MARKETING_VERSION / PRODUCT_BUNDLE_IDENTIFIER from ${versionFile} (or inputs)`
    )
  }
  return {version, bundleId}
}

export async function resolvePlatform({
  workspace,
  platformInput,
  platformFile,
  sourceRef
}: {
  workspace: string
  platformInput: string
  platformFile: string
  sourceRef: string
}): Promise<string> {
  if (platformInput.trim()) {
    return platformInput.trim()
  }
  if (platformFile.trim()) {
    const contents = await readRepoFile(workspace, platformFile, sourceRef)
    const value = readFirstValue(contents)
    if (value) {
      return value
    }
  }
  return 'IOS'
}

/** Build What's New from every *.md under release-notes/<version>/. */
export async function assembleWhatsNew({
  workspace,
  notesDir,
  sourceRef
}: {
  workspace: string
  notesDir: string
  sourceRef: string
}): Promise<string> {
  const lines: string[] = []

  if (sourceRef) {
    const listed = await getExecOutput(
      'git',
      ['ls-tree', '-r', '--name-only', sourceRef, '--', notesDir],
      {cwd: workspace, ignoreReturnCode: true, silent: true}
    )
    const files = listed.stdout
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(s => s.endsWith('.md'))
      .sort()
    for (const file of files) {
      const content = (await readRepoFile(workspace, file, sourceRef)).trim()
      if (content) {
        lines.push(`- ${content}`)
      }
    }
    return lines.join('\n')
  }

  const abs = isAbsolute(notesDir) ? notesDir : join(workspace, notesDir)
  if (!existsSync(abs)) {
    return ''
  }
  const files = readdirSync(abs)
    .filter(name => name.endsWith('.md'))
    .sort()
  for (const name of files) {
    const content = readFileSync(join(abs, name), 'utf8').trim()
    if (content) {
      lines.push(`- ${content}`)
    }
  }
  return lines.join('\n')
}
