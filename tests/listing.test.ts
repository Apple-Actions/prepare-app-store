import {describe, expect, it} from 'vitest'
import {writeFileSync, mkdtempSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {
  noneAgeRatingAttributes,
  resolveAgeRatingAttributes
} from '../src/age-rating'
import {assertMacScreenshotSize, readImageSize} from '../src/image-size'
import {parseListingYaml, resolveListing} from '../src/listing-file'

describe('age rating preset', () => {
  it('expands none to NONE strings and false booleans', () => {
    const attrs = noneAgeRatingAttributes()
    expect(attrs.alcoholTobaccoOrDrugUseOrReferences).toBe('NONE')
    expect(attrs.violenceRealistic).toBe('NONE')
    expect(attrs.gambling).toBe(false)
    expect(attrs.advertising).toBe(false)
    expect(attrs.ageRatingOverrideV2).toBe('NONE')
  })

  it('passes through explicit attribute maps', () => {
    expect(resolveAgeRatingAttributes({gambling: true})).toEqual({
      gambling: true
    })
  })
})

describe('parseListingYaml', () => {
  it('parses the documented listing shape', () => {
    const listing = parseListingYaml(`
description: |
  Unattended macOS menu bar app.
keywords: scoreboard,NDI
supportUrl: https://example.com/support
privacyPolicyUrl: https://example.com/privacy
marketingUrl: https://example.com
copyright: 2026 Example
category: UTILITIES
ageRating: none
screenshots:
  mac:
    - store/screenshots/mac/01.png
    - store/screenshots/mac/02.png
review:
  firstName: Jane
  lastName: Doe
`)
    expect(listing.description).toBe('Unattended macOS menu bar app.')
    expect(listing.keywords).toBe('scoreboard,NDI')
    expect(listing.ageRating).toBe('none')
    expect(listing.screenshots?.mac).toEqual([
      'store/screenshots/mac/01.png',
      'store/screenshots/mac/02.png'
    ])
    expect(listing.review?.firstName).toBe('Jane')
  })
})

describe('resolveListing', () => {
  it('lets review CLI inputs win over the listing file', () => {
    const resolved = resolveListing(
      {
        review: {firstName: 'File', email: 'file@example.com'},
        screenshots: {mac: ['a.png']}
      },
      {
        platform: 'MAC_OS',
        reviewFirstName: 'CLI',
        reviewEmail: 'cli@example.com'
      }
    )
    expect(resolved.review.firstName).toBe('CLI')
    expect(resolved.review.email).toBe('cli@example.com')
    expect(resolved.screenshotPaths).toEqual(['a.png'])
    expect(resolved.ageRating).toBeUndefined()
  })
})

describe('image size', () => {
  it('reads PNG dimensions and rejects non-Mac sizes', () => {
    // 1x1 PNG
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    )
    const dir = mkdtempSync(join(tmpdir(), 'listing-'))
    const path = join(dir, 'tiny.png')
    writeFileSync(path, png)
    expect(readImageSize(path)).toEqual({width: 1, height: 1, format: 'png'})
    expect(() => assertMacScreenshotSize(path)).toThrow(/1x1/)
  })
})
