// audit: allow no-boundary — pure listing helper unit test; live ASC I/O is manual --apply / mocked prepare tests
import {describe, expect, it} from 'vitest'
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {
  discoverListingFromRepo,
  firstParagraph,
  mergeListingSources
} from '../src/listing-discover'
import {missingListingFields, serializeListingYaml} from '../src/listing-init'
import {parseListingYaml} from '../src/listing-file'
import {
  isNoneAgeRatingAttributes,
  noneAgeRatingAttributes
} from '../src/age-rating'

describe('discoverListingFromRepo', () => {
  // audit: allow no-boundary — pure listing helper unit test; live ASC I/O is manual --apply / mocked prepare tests
  it('reads README paragraph, URLs, and screenshot globs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'listing-discover-'))
    writeFileSync(
      join(dir, 'README.md'),
      `# App

Unattended macOS menu bar tool for venues.

See [support](https://awresports.com/support) and [privacy](https://awresports.com/privacy).
Marketing: https://awresports.com
`
    )
    mkdirSync(join(dir, 'store/screenshots/mac'), {recursive: true})
    writeFileSync(join(dir, 'store/screenshots/mac/01.png'), 'x')
    writeFileSync(join(dir, 'store/screenshots/mac/02.jpg'), 'x')

    const listing = discoverListingFromRepo(dir)
    expect(listing.description).toMatch(/Unattended macOS/)
    expect(listing.supportUrl).toBe('https://awresports.com/support')
    expect(listing.privacyPolicyUrl).toBe('https://awresports.com/privacy')
    expect(listing.marketingUrl).toBe('https://awresports.com')
    expect(listing.screenshots?.mac).toEqual([
      'store/screenshots/mac/01.png',
      'store/screenshots/mac/02.jpg'
    ])
    expect(listing.ageRating).toBe('none')
  })
})

describe('firstParagraph', () => {
  // audit: allow no-boundary — pure listing helper unit test; live ASC I/O is manual --apply / mocked prepare tests
  it('skips badges and headings', () => {
    expect(
      firstParagraph(`# Title

[![ci](https://img.shields.io/badge)](https://example.com)

Hello world is here.

## Next
`)
    ).toBe('Hello world is here.')
  })
})

describe('mergeListingSources', () => {
  // audit: allow no-boundary — pure listing helper unit test; live ASC I/O is manual --apply / mocked prepare tests
  it('prefers existing over ASC over repo', () => {
    const merged = mergeListingSources({
      repo: {
        description: 'repo',
        supportUrl: 'https://repo.example/support',
        keywords: 'from-repo'
      },
      asc: {
        description: 'asc',
        privacyPolicyUrl: 'https://asc.example/privacy'
      },
      existing: {
        description: 'file'
      }
    })
    expect(merged.description).toBe('file')
    expect(merged.supportUrl).toBe('https://repo.example/support')
    expect(merged.privacyPolicyUrl).toBe('https://asc.example/privacy')
    expect(merged.keywords).toBe('from-repo')
  })
})

describe('serializeListingYaml', () => {
  // audit: allow no-boundary — pure listing helper unit test; live ASC I/O is manual --apply / mocked prepare tests
  it('round-trips through parseListingYaml', () => {
    const yaml = serializeListingYaml({
      description: 'Line one\nLine two',
      keywords: 'a,b',
      supportUrl: 'https://example.com/support',
      privacyPolicyUrl: 'https://example.com/privacy',
      ageRating: 'none',
      screenshots: {mac: ['store/screenshots/mac/01.png']}
    })
    const parsed = parseListingYaml(yaml)
    expect(parsed.description).toBe('Line one\nLine two')
    expect(parsed.keywords).toBe('a,b')
    expect(parsed.ageRating).toBe('none')
    expect(parsed.screenshots?.mac).toEqual(['store/screenshots/mac/01.png'])
  })
})

describe('missingListingFields', () => {
  // audit: allow no-boundary — pure listing helper unit test; live ASC I/O is manual --apply / mocked prepare tests
  it('reports required gaps for MAC_OS', () => {
    expect(missingListingFields({}, 'MAC_OS')).toEqual([
      'description',
      'supportUrl',
      'privacyPolicyUrl',
      'ageRating',
      'screenshots.mac'
    ])
  })
})

describe('isNoneAgeRatingAttributes', () => {
  // audit: allow no-boundary — pure listing helper unit test; live ASC I/O is manual --apply / mocked prepare tests
  it('accepts the none preset and rejects gambling', () => {
    expect(isNoneAgeRatingAttributes(noneAgeRatingAttributes())).toBe(true)
    expect(isNoneAgeRatingAttributes({gambling: true})).toBe(false)
  })
})

describe('init write without prompts', () => {
  // audit: allow no-boundary — pure listing helper unit test; live ASC I/O is manual --apply / mocked prepare tests
  it('writes a draft listing file from discovery', async () => {
    const {initListingFile} = await import('../src/listing-init')
    const dir = mkdtempSync(join(tmpdir(), 'listing-init-'))
    writeFileSync(
      join(dir, 'README.md'),
      `# Tool\n\nDoes a thing.\n\nhttps://example.com/support\nhttps://example.com/privacy\n`
    )
    mkdirSync(join(dir, 'store/screenshots/mac'), {recursive: true})
    writeFileSync(join(dir, 'store/screenshots/mac/01.png'), 'x')
    const listingPath = join(dir, 'store/listing.yml')
    const result = await initListingFile({
      workspace: dir,
      listingPath,
      platform: 'MAC_OS',
      interactive: false
    })
    expect(result.written).toBe(true)
    expect(readFileSync(listingPath, 'utf8')).toMatch(/description:/)
    expect(result.missing).toEqual([])
  })
})
