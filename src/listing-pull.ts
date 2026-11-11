import {AscClient, AscVersion, findApp} from './asc'
import {AgeRatingAttributes, isNoneAgeRatingAttributes} from './age-rating'
import {ListingFile} from './listing-file'

type LocResource = {
  id: string
  attributes: {
    locale?: string
    description?: string
    keywords?: string
    supportUrl?: string
    marketingUrl?: string
    privacyPolicyUrl?: string
    copyright?: string
  }
}

export type ListingPullResult = {
  listing: ListingFile
  ascScreenshotsPresent: boolean
  notes: string[]
}

/** Read current App Store listing fields from ASC into a ListingFile partial. */
export async function pullListingFromAsc({
  client,
  bundleId,
  version,
  platform,
  locale
}: {
  client: AscClient
  bundleId: string
  version: string
  platform: string
  locale: string
}): Promise<ListingPullResult> {
  const notes: string[] = []
  const listing: ListingFile = {}
  const app = await findApp(client, bundleId)

  const versions = (await client.request(
    'GET',
    `/v1/apps/${app.id}/appStoreVersions`,
    {
      query: {
        'filter[versionString]': version,
        'filter[platform]': platform
      }
    }
  )) as {data?: AscVersion[]}
  const versionObj = (versions.data || [])[0]
  if (!versionObj) {
    notes.push(
      `No App Store version ${version} (${platform}) in ASC yet — skipped version localization pull.`
    )
  } else {
    const copyright = (
      versionObj.attributes as {copyright?: string} | undefined
    )?.copyright
    if (copyright) {
      listing.copyright = copyright
    }

    const locs = (await client.request(
      'GET',
      `/v1/appStoreVersions/${versionObj.id}/appStoreVersionLocalizations`
    )) as {data?: LocResource[]}
    const loc = (locs.data || []).find(l => l.attributes.locale === locale)
    if (loc) {
      if (loc.attributes.description) {
        listing.description = loc.attributes.description
      }
      if (loc.attributes.keywords) {
        listing.keywords = loc.attributes.keywords
      }
      if (loc.attributes.supportUrl) {
        listing.supportUrl = loc.attributes.supportUrl
      }
      if (loc.attributes.marketingUrl) {
        listing.marketingUrl = loc.attributes.marketingUrl
      }

      const sets = (await client.request(
        'GET',
        `/v1/appStoreVersionLocalizations/${loc.id}/appScreenshotSets`
      )) as {data?: Array<{id: string}>}
      let ascScreenshotsPresent = false
      for (const set of sets.data || []) {
        const shots = (await client.request(
          'GET',
          `/v1/appScreenshotSets/${set.id}/appScreenshots`
        )) as {data?: unknown[]}
        if ((shots.data || []).length) {
          ascScreenshotsPresent = true
          break
        }
      }
      if (ascScreenshotsPresent) {
        notes.push(
          'ASC already has screenshots for this localization; local store/screenshots paths are still required in listing.yml for --apply uploads.'
        )
      }
      return finalizePull(
        client,
        app.id,
        locale,
        listing,
        notes,
        ascScreenshotsPresent
      )
    }
    notes.push(`No ${locale} version localization in ASC.`)
  }

  return finalizePull(client, app.id, locale, listing, notes, false)
}

async function finalizePull(
  client: AscClient,
  appId: string,
  locale: string,
  listing: ListingFile,
  notes: string[],
  ascScreenshotsPresent: boolean
): Promise<ListingPullResult> {
  const infos = (await client.request('GET', `/v1/apps/${appId}/appInfos`)) as {
    data?: Array<{id: string}>
  }
  const appInfo = (infos.data || [])[0]
  if (!appInfo) {
    notes.push(
      'No appInfos resource — skipped privacy URL / category / age rating.'
    )
    return {listing, ascScreenshotsPresent, notes}
  }

  const locs = (await client.request(
    'GET',
    `/v1/appInfos/${appInfo.id}/appInfoLocalizations`
  )) as {data?: LocResource[]}
  const infoLoc = (locs.data || []).find(l => l.attributes.locale === locale)
  if (infoLoc?.attributes.privacyPolicyUrl && !listing.privacyPolicyUrl) {
    listing.privacyPolicyUrl = infoLoc.attributes.privacyPolicyUrl
  }

  try {
    const primary = (await client.request(
      'GET',
      `/v1/appInfos/${appInfo.id}/primaryCategory`
    )) as {data?: {id: string} | null}
    if (primary.data?.id) {
      listing.category = primary.data.id
    }
  } catch (err) {
    const status = (err as {statusCode?: number}).statusCode
    if (status !== 404) {
      throw err
    }
  }

  try {
    const secondary = (await client.request(
      'GET',
      `/v1/appInfos/${appInfo.id}/secondaryCategory`
    )) as {data?: {id: string} | null}
    if (secondary.data?.id) {
      listing.secondaryCategory = secondary.data.id
    }
  } catch (err) {
    const status = (err as {statusCode?: number}).statusCode
    if (status !== 404) {
      throw err
    }
  }

  try {
    const declaration = (await client.request(
      'GET',
      `/v1/appInfos/${appInfo.id}/ageRatingDeclaration`
    )) as {data?: {id: string; attributes?: AgeRatingAttributes}}
    if (declaration.data?.attributes) {
      const attrs = declaration.data.attributes
      listing.ageRating = isNoneAgeRatingAttributes(attrs) ? 'none' : {...attrs}
    }
  } catch (err) {
    const status = (err as {statusCode?: number}).statusCode
    if (status !== 404) {
      throw err
    }
  }

  return {listing, ascScreenshotsPresent, notes}
}
