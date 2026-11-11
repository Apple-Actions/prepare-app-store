import {existsSync, readdirSync, readFileSync, statSync} from 'node:fs'
import {join, relative} from 'node:path'
import {ListingFile} from './listing-file'

const URL_RE = /https?:\/\/[^\s>)\]"'`]+/gi

const SUPPORT_HINT = /support|help|contact|docs|documentation|faq/i
const PRIVACY_HINT = /privacy/i
const MARKETING_SKIP =
  /github\.com|raw\.githubusercontent|shields\.io|badge|travis-ci|circleci|codecov|sentry\.io|npmjs\.com|yarnpkg\.com/i

/**
 * Lightweight repo heuristics for store/listing.yml bootstrap.
 * Prefer README links and store/screenshots globs; no deep scrape.
 */
export function discoverListingFromRepo(workspace: string): ListingFile {
  const listing: ListingFile = {}
  const readme = readReadme(workspace)
  if (readme) {
    const urls = extractUrls(readme)
    listing.supportUrl = pickUrl(urls, SUPPORT_HINT)
    listing.privacyPolicyUrl = pickUrl(urls, PRIVACY_HINT)
    listing.marketingUrl = pickMarketingUrl(urls, [
      listing.supportUrl,
      listing.privacyPolicyUrl
    ])
    listing.description = firstParagraph(readme)
  }

  const mac = globScreenshots(workspace, 'store/screenshots/mac')
  const ios = globScreenshots(workspace, 'store/screenshots/ios')
  if (mac.length || ios.length) {
    listing.screenshots = {}
    if (mac.length) listing.screenshots.mac = mac
    if (ios.length) listing.screenshots.ios = ios
  }

  listing.ageRating = 'none'
  listing.copyright = `${new Date().getFullYear()}`

  return listing
}

function readReadme(workspace: string): string | undefined {
  for (const name of ['README.md', 'Readme.md', 'readme.md']) {
    const path = join(workspace, name)
    if (existsSync(path) && statSync(path).isFile()) {
      return readFileSync(path, 'utf8')
    }
  }
  return undefined
}

function extractUrls(text: string): string[] {
  const found = text.match(URL_RE) || []
  return [...new Set(found.map(u => u.replace(/[.,;:]+$/, '')))]
}

function pickUrl(urls: string[], hint: RegExp): string | undefined {
  return urls.find(u => hint.test(u))
}

function pickMarketingUrl(
  urls: string[],
  exclude: Array<string | undefined>
): string | undefined {
  const skip = new Set(exclude.filter(Boolean) as string[])
  return urls.find(u => !skip.has(u) && !MARKETING_SKIP.test(u))
}

/** First non-heading, non-badge paragraph from a README. */
export function firstParagraph(readme: string): string | undefined {
  const lines = readme.replace(/\r\n/g, '\n').split('\n')
  const block: string[] = []
  let started = false
  for (const line of lines) {
    const trimmed = line.trim()
    if (!started) {
      if (
        !trimmed ||
        trimmed.startsWith('#') ||
        trimmed.startsWith('![') ||
        trimmed.startsWith('[![') ||
        trimmed.startsWith('---')
      ) {
        continue
      }
      started = true
    }
    if (!trimmed) {
      break
    }
    if (trimmed.startsWith('#')) {
      break
    }
    block.push(trimmed)
  }
  const text = block.join(' ').trim()
  return text || undefined
}

function globScreenshots(workspace: string, relativeDir: string): string[] {
  const abs = join(workspace, relativeDir)
  if (!existsSync(abs) || !statSync(abs).isDirectory()) {
    return []
  }
  return readdirSync(abs)
    .filter(name => /\.(png|jpe?g)$/i.test(name))
    .sort()
    .map(name => relative(workspace, join(abs, name)).replace(/\\/g, '/'))
}

/** Fill only empty fields on `base` from `fill`. Screenshots merge per platform. */
function mergeListingPreferBase(
  base: ListingFile,
  fill: ListingFile
): ListingFile {
  const out: ListingFile = {...base}
  const take = <K extends keyof ListingFile>(key: K): void => {
    if (out[key] === undefined || out[key] === '') {
      if (fill[key] !== undefined && fill[key] !== '') {
        out[key] = fill[key]
      }
    }
  }
  take('description')
  take('keywords')
  take('supportUrl')
  take('privacyPolicyUrl')
  take('marketingUrl')
  take('copyright')
  take('category')
  take('secondaryCategory')
  take('ageRating')
  take('review')

  const mac = out.screenshots?.mac?.length
    ? out.screenshots.mac
    : fill.screenshots?.mac
  const ios = out.screenshots?.ios?.length
    ? out.screenshots.ios
    : fill.screenshots?.ios
  if (mac || ios) {
    out.screenshots = {
      ...(mac ? {mac} : {}),
      ...(ios ? {ios} : {})
    }
  }
  return out
}

/**
 * Priority: existing listing > ASC pull > repo discovery.
 * `mergeListingPreferBase(base, fill)` keeps base and fills empty slots from fill.
 */
export function mergeListingSources(parts: {
  repo: ListingFile
  asc?: ListingFile
  existing?: ListingFile
}): ListingFile {
  let merged: ListingFile = {...parts.repo}
  if (parts.asc) {
    merged = mergeListingPreferBase(parts.asc, merged)
  }
  if (parts.existing) {
    merged = mergeListingPreferBase(parts.existing, merged)
  }
  return merged
}
