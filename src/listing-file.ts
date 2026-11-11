import {readFileSync} from 'node:fs'
import {AgeRatingAttributes, resolveAgeRatingAttributes} from './age-rating'

export type ListingFile = {
  description?: string
  keywords?: string
  supportUrl?: string
  privacyPolicyUrl?: string
  marketingUrl?: string
  copyright?: string
  category?: string
  secondaryCategory?: string
  ageRating?: 'none' | AgeRatingAttributes
  screenshots?: {
    mac?: string[]
    ios?: string[]
  }
  review?: {
    firstName?: string
    lastName?: string
    phone?: string
    email?: string
    demoAccountName?: string
    demoAccountPassword?: string
    notes?: string
  }
}

export type ResolvedListing = {
  description?: string
  keywords?: string
  supportUrl?: string
  privacyPolicyUrl?: string
  marketingUrl?: string
  copyright?: string
  category?: string
  secondaryCategory?: string
  ageRating?: AgeRatingAttributes
  screenshotPaths: string[]
  review: {
    firstName?: string
    lastName?: string
    phone?: string
    email?: string
    demoAccountName?: string
    demoAccountPassword?: string
    notes?: string
  }
}

/**
 * Parse a constrained listing YAML (scalars, `|` blocks, one-level maps, string lists).
 * Prefer this over a YAML dependency for the documented store/listing.yml shape.
 */
export function parseListingYaml(contents: string): ListingFile {
  const root: Record<string, unknown> = {}
  const lines = contents.replace(/\r\n/g, '\n').split('\n')
  let i = 0

  const isBlankOrComment = (line: string): boolean => {
    const t = line.trim()
    return !t || t.startsWith('#')
  }

  while (i < lines.length) {
    const line = lines[i]
    if (isBlankOrComment(line)) {
      i += 1
      continue
    }
    if (/^\s/.test(line)) {
      throw new Error(
        `Unexpected indented line at ${i + 1}: listing YAML only allows nesting under known keys`
      )
    }

    const match = /^([A-Za-z][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(line)
    if (!match) {
      throw new Error(`Could not parse listing YAML line ${i + 1}: ${line}`)
    }
    const key = match[1]
    const rest = match[2]
    i += 1

    if (rest === '|' || rest === '>') {
      const block: string[] = []
      while (i < lines.length) {
        const next = lines[i]
        if (next === '' || /^\s/.test(next)) {
          block.push(next.replace(/^\s{2}/, ''))
          i += 1
          continue
        }
        break
      }
      while (block.length && block[block.length - 1] === '') {
        block.pop()
      }
      root[key] = block.join('\n')
      continue
    }

    if (rest === '') {
      const nested: Record<string, unknown> | string[] = {}
      let listMode: string[] | null = null
      while (i < lines.length) {
        const next = lines[i]
        if (isBlankOrComment(next)) {
          i += 1
          continue
        }
        if (!/^\s{2}\S/.test(next) && !/^\s{2}-\s/.test(next)) {
          break
        }
        const listMatch = /^\s{2}-\s+(.*)$/.exec(next)
        if (listMatch) {
          if (!Array.isArray(listMode)) {
            listMode = []
          }
          listMode.push(unquote(listMatch[1].trim()))
          i += 1
          continue
        }
        const mapMatch = /^\s{2}([A-Za-z][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(next)
        if (!mapMatch) {
          throw new Error(`Could not parse nested listing YAML line ${i + 1}`)
        }
        if (listMode) {
          throw new Error(
            `Mixed list and map under ${key} at line ${i + 1} is not supported`
          )
        }
        const childKey = mapMatch[1]
        const childRest = mapMatch[2]
        i += 1
        if (childRest === '') {
          const childList: string[] = []
          while (i < lines.length) {
            const item = lines[i]
            if (isBlankOrComment(item)) {
              i += 1
              continue
            }
            const itemMatch = /^\s{4}-\s+(.*)$/.exec(item)
            if (!itemMatch) {
              break
            }
            childList.push(unquote(itemMatch[1].trim()))
            i += 1
          }
          ;(nested as Record<string, unknown>)[childKey] = childList
        } else {
          ;(nested as Record<string, unknown>)[childKey] =
            parseScalar(childRest)
        }
      }
      root[key] = listMode || nested
      continue
    }

    root[key] = parseScalar(rest)
  }

  return normalizeListingObject(root)
}

function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }
  return value
}

function parseScalar(raw: string): string | boolean | number | null {
  const value = unquote(raw.trim())
  if (value === 'null' || value === '~') {
    return null
  }
  if (value === 'true') {
    return true
  }
  if (value === 'false') {
    return false
  }
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value)
  }
  return value
}

function normalizeListingObject(root: Record<string, unknown>): ListingFile {
  const listing: ListingFile = {}
  const str = (key: string): string | undefined => {
    const value = root[key]
    if (value === undefined || value === null) {
      return undefined
    }
    return String(value)
  }
  listing.description = str('description')
  listing.keywords = str('keywords')
  listing.supportUrl = str('supportUrl')
  listing.privacyPolicyUrl = str('privacyPolicyUrl')
  listing.marketingUrl = str('marketingUrl')
  listing.copyright = str('copyright')
  listing.category = str('category')
  listing.secondaryCategory = str('secondaryCategory')

  if (root.ageRating === 'none') {
    listing.ageRating = 'none'
  } else if (root.ageRating && typeof root.ageRating === 'object') {
    listing.ageRating = root.ageRating as AgeRatingAttributes
  }

  if (root.screenshots && typeof root.screenshots === 'object') {
    const shots = root.screenshots as Record<string, unknown>
    listing.screenshots = {
      mac: Array.isArray(shots.mac) ? shots.mac.map(String) : undefined,
      ios: Array.isArray(shots.ios) ? shots.ios.map(String) : undefined
    }
  }

  if (root.review && typeof root.review === 'object') {
    const review = root.review as Record<string, unknown>
    listing.review = {
      firstName:
        review.firstName !== undefined ? String(review.firstName) : undefined,
      lastName:
        review.lastName !== undefined ? String(review.lastName) : undefined,
      phone: review.phone !== undefined ? String(review.phone) : undefined,
      email: review.email !== undefined ? String(review.email) : undefined,
      demoAccountName:
        review.demoAccountName !== undefined
          ? String(review.demoAccountName)
          : undefined,
      demoAccountPassword:
        review.demoAccountPassword !== undefined
          ? String(review.demoAccountPassword)
          : undefined,
      notes: review.notes !== undefined ? String(review.notes) : undefined
    }
  }

  return listing
}

export function loadListingFile(path: string): ListingFile {
  const contents = readFileSync(path, 'utf8')
  if (path.endsWith('.json')) {
    return normalizeListingObject(
      JSON.parse(contents) as Record<string, unknown>
    )
  }
  return parseListingYaml(contents)
}

export function resolveListing(
  file: ListingFile,
  overrides: {
    reviewFirstName?: string
    reviewLastName?: string
    reviewPhone?: string
    reviewEmail?: string
    platform: string
  }
): ResolvedListing {
  const platformKey = overrides.platform === 'MAC_OS' ? 'mac' : 'ios'
  const screenshotPaths = file.screenshots?.[platformKey] || []

  return {
    description: file.description,
    keywords: file.keywords,
    supportUrl: file.supportUrl,
    privacyPolicyUrl: file.privacyPolicyUrl,
    marketingUrl: file.marketingUrl,
    copyright: file.copyright,
    category: file.category,
    secondaryCategory: file.secondaryCategory,
    ageRating: resolveAgeRatingAttributes(file.ageRating),
    screenshotPaths,
    review: {
      firstName: overrides.reviewFirstName || file.review?.firstName,
      lastName: overrides.reviewLastName || file.review?.lastName,
      phone: overrides.reviewPhone || file.review?.phone,
      email: overrides.reviewEmail || file.review?.email,
      demoAccountName: file.review?.demoAccountName,
      demoAccountPassword: file.review?.demoAccountPassword,
      notes: file.review?.notes
    }
  }
}
