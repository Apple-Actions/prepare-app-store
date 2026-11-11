import {createReadStream, existsSync, statSync} from 'node:fs'
import {isAbsolute, join, basename} from 'node:path'
import {request as httpsRequest} from 'node:https'
import {URL} from 'node:url'
import {AscClient, AscVersion, findApp, versionState} from './asc'
import {assertMacScreenshotSize, md5Hex} from './image-size'
import {ResolvedListing} from './listing-file'
import {EDITABLE_STATES} from './prepare'

export type ListingResult = {
  appId: string
  versionId: string
  storeUrl: string
  screenshotsUploaded: number
  manualPrivacyRequired: true
}

type LocResource = {
  id: string
  attributes: {
    locale?: string
    description?: string
    keywords?: string
    supportUrl?: string
    marketingUrl?: string
    privacyPolicyUrl?: string
  }
}

function log(msg: string): void {
  process.stdout.write(`${msg}\n`)
}

async function ensureEditableVersion(
  client: AscClient,
  appId: string,
  version: string,
  platform: string
): Promise<AscVersion> {
  const existingResponse = (await client.request(
    'GET',
    `/v1/apps/${appId}/appStoreVersions`,
    {
      query: {
        'filter[versionString]': version,
        'filter[platform]': platform
      }
    }
  )) as {data?: AscVersion[]}
  const existing = existingResponse.data || []
  if (existing.length) {
    const versionObj = existing[0]
    const state = versionState(versionObj)
    if (!EDITABLE_STATES.has(state)) {
      throw new Error(
        `App Store version ${version} is in state ${state} and cannot be modified.`
      )
    }
    return versionObj
  }

  const created = (await client.request('POST', '/v1/appStoreVersions', {
    body: {
      data: {
        type: 'appStoreVersions',
        attributes: {platform, versionString: version},
        relationships: {app: {data: {type: 'apps', id: appId}}}
      }
    }
  })) as {data: AscVersion}
  log(
    `Created bare App Store version ${version} (${created.data.id}) without a build — run prepare-app-store later to attach TestFlight.`
  )
  return created.data
}

async function ensureVersionLocalization(
  client: AscClient,
  versionId: string,
  locale: string
): Promise<LocResource> {
  const locsResponse = (await client.request(
    'GET',
    `/v1/appStoreVersions/${versionId}/appStoreVersionLocalizations`
  )) as {data?: LocResource[]}
  const locs = locsResponse.data || []
  const existing = locs.find(loc => loc.attributes.locale === locale)
  if (existing) {
    return existing
  }
  const created = (await client.request(
    'POST',
    '/v1/appStoreVersionLocalizations',
    {
      body: {
        data: {
          type: 'appStoreVersionLocalizations',
          attributes: {locale},
          relationships: {
            appStoreVersion: {
              data: {type: 'appStoreVersions', id: versionId}
            }
          }
        }
      }
    }
  )) as {data: LocResource}
  log(`Created ${locale} version localization`)
  return created.data
}

async function applyVersionLocalization(
  client: AscClient,
  loc: LocResource,
  listing: ResolvedListing,
  dryRun: boolean
): Promise<void> {
  const attributes: Record<string, string> = {}
  if (listing.description !== undefined) {
    attributes.description = listing.description
  }
  if (listing.keywords !== undefined) {
    attributes.keywords = listing.keywords
  }
  if (listing.supportUrl !== undefined) {
    attributes.supportUrl = listing.supportUrl
  }
  if (listing.marketingUrl !== undefined) {
    attributes.marketingUrl = listing.marketingUrl
  }
  if (!Object.keys(attributes).length) {
    return
  }
  if (dryRun) {
    log(
      `dry-run: would PATCH appStoreVersionLocalizations/${loc.id} ${JSON.stringify(attributes)}`
    )
    return
  }
  await client.request('PATCH', `/v1/appStoreVersionLocalizations/${loc.id}`, {
    body: {
      data: {
        type: 'appStoreVersionLocalizations',
        id: loc.id,
        attributes
      }
    }
  })
  log(`Updated version localization ${loc.attributes.locale}`)
}

async function applyCopyright(
  client: AscClient,
  versionId: string,
  copyright: string | undefined,
  dryRun: boolean
): Promise<void> {
  if (!copyright) {
    return
  }
  if (dryRun) {
    log(
      `dry-run: would PATCH appStoreVersions/${versionId} copyright=${copyright}`
    )
    return
  }
  await client.request('PATCH', `/v1/appStoreVersions/${versionId}`, {
    body: {
      data: {
        type: 'appStoreVersions',
        id: versionId,
        attributes: {copyright}
      }
    }
  })
  log(`Set copyright to ${copyright}`)
}

async function applyReviewDetails(
  client: AscClient,
  versionId: string,
  review: ResolvedListing['review'],
  dryRun: boolean
): Promise<void> {
  const attributes: Record<string, string> = {}
  if (review.firstName) attributes.contactFirstName = review.firstName
  if (review.lastName) attributes.contactLastName = review.lastName
  if (review.phone) attributes.contactPhone = review.phone
  if (review.email) attributes.contactEmail = review.email
  if (review.demoAccountName)
    attributes.demoAccountName = review.demoAccountName
  if (review.demoAccountPassword) {
    attributes.demoAccountPassword = review.demoAccountPassword
  }
  if (review.notes) attributes.notes = review.notes
  if (!Object.keys(attributes).length) {
    return
  }

  let existingId: string | undefined
  try {
    const existing = (await client.request(
      'GET',
      `/v1/appStoreVersions/${versionId}/appStoreReviewDetail`
    )) as {data?: {id: string} | null}
    existingId = existing.data?.id
  } catch (err) {
    const status = (err as {statusCode?: number}).statusCode
    if (status !== 404) {
      throw err
    }
  }

  if (dryRun) {
    log(
      `dry-run: would ${existingId ? 'PATCH' : 'POST'} appStoreReviewDetail ${JSON.stringify(
        {
          ...attributes,
          demoAccountPassword: attributes.demoAccountPassword
            ? '***'
            : undefined
        }
      )}`
    )
    return
  }

  if (existingId) {
    await client.request('PATCH', `/v1/appStoreReviewDetails/${existingId}`, {
      body: {
        data: {
          type: 'appStoreReviewDetails',
          id: existingId,
          attributes
        }
      }
    })
    log('Updated App Review contact details')
    return
  }

  await client.request('POST', '/v1/appStoreReviewDetails', {
    body: {
      data: {
        type: 'appStoreReviewDetails',
        attributes,
        relationships: {
          appStoreVersion: {
            data: {type: 'appStoreVersions', id: versionId}
          }
        }
      }
    }
  })
  log('Created App Review contact details')
}

async function applyAgeRating(
  client: AscClient,
  appId: string,
  attributes: ResolvedListing['ageRating'],
  dryRun: boolean
): Promise<void> {
  if (!attributes) {
    return
  }
  const infos = (await client.request('GET', `/v1/apps/${appId}/appInfos`)) as {
    data?: Array<{id: string}>
  }
  const appInfo = (infos.data || [])[0]
  if (!appInfo) {
    throw new Error('No appInfos resource found for age rating')
  }
  const declaration = (await client.request(
    'GET',
    `/v1/appInfos/${appInfo.id}/ageRatingDeclaration`
  )) as {data?: {id: string}}
  if (!declaration.data?.id) {
    throw new Error('No ageRatingDeclaration found on appInfo')
  }
  if (dryRun) {
    log(
      `dry-run: would PATCH ageRatingDeclarations/${declaration.data.id} with ${Object.keys(attributes).length} attributes`
    )
    return
  }
  await client.request(
    'PATCH',
    `/v1/ageRatingDeclarations/${declaration.data.id}`,
    {
      body: {
        data: {
          type: 'ageRatingDeclarations',
          id: declaration.data.id,
          attributes
        }
      }
    }
  )
  log('Updated age rating declaration')
}

async function applyPrivacyPolicyUrl(
  client: AscClient,
  appId: string,
  locale: string,
  privacyPolicyUrl: string | undefined,
  dryRun: boolean
): Promise<void> {
  if (!privacyPolicyUrl) {
    return
  }
  const infos = (await client.request('GET', `/v1/apps/${appId}/appInfos`)) as {
    data?: Array<{id: string}>
  }
  const appInfo = (infos.data || [])[0]
  if (!appInfo) {
    throw new Error('No appInfos resource found for privacy policy URL')
  }
  const locs = (await client.request(
    'GET',
    `/v1/appInfos/${appInfo.id}/appInfoLocalizations`
  )) as {data?: LocResource[]}
  const loc = (locs.data || []).find(l => l.attributes.locale === locale)
  if (!loc) {
    if (dryRun) {
      log(
        `dry-run: would create appInfoLocalization ${locale} with privacyPolicyUrl=${privacyPolicyUrl}`
      )
      return
    }
    const created = (await client.request('POST', '/v1/appInfoLocalizations', {
      body: {
        data: {
          type: 'appInfoLocalizations',
          attributes: {locale, privacyPolicyUrl},
          relationships: {
            appInfo: {data: {type: 'appInfos', id: appInfo.id}}
          }
        }
      }
    })) as {data: LocResource}
    log(`Created app info localization ${created.data.attributes.locale}`)
    return
  }
  if (dryRun) {
    log(
      `dry-run: would PATCH appInfoLocalizations/${loc.id} privacyPolicyUrl=${privacyPolicyUrl}`
    )
    return
  }
  await client.request('PATCH', `/v1/appInfoLocalizations/${loc.id}`, {
    body: {
      data: {
        type: 'appInfoLocalizations',
        id: loc.id,
        attributes: {privacyPolicyUrl}
      }
    }
  })
  log('Updated privacy policy URL on app info localization')
}

async function applyCategory(
  client: AscClient,
  appId: string,
  category: string | undefined,
  secondaryCategory: string | undefined,
  dryRun: boolean
): Promise<void> {
  if (!category && !secondaryCategory) {
    return
  }
  const infos = (await client.request('GET', `/v1/apps/${appId}/appInfos`)) as {
    data?: Array<{id: string}>
  }
  const appInfo = (infos.data || [])[0]
  if (!appInfo) {
    throw new Error('No appInfos resource found for category')
  }
  const relationships: Record<
    string,
    {data: {type: string; id: string} | null}
  > = {}
  if (category) {
    relationships.primaryCategory = {
      data: {type: 'appCategories', id: category}
    }
  }
  if (secondaryCategory) {
    relationships.secondaryCategory = {
      data: {type: 'appCategories', id: secondaryCategory}
    }
  }
  if (dryRun) {
    log(
      `dry-run: would PATCH appInfos/${appInfo.id} categories ${JSON.stringify(relationships)}`
    )
    return
  }
  await client.request('PATCH', `/v1/appInfos/${appInfo.id}`, {
    body: {
      data: {
        type: 'appInfos',
        id: appInfo.id,
        relationships
      }
    }
  })
  log('Updated App Store category')
}

async function ensureScreenshotSet(
  client: AscClient,
  localizationId: string,
  displayType: string,
  dryRun: boolean
): Promise<string | null> {
  const sets = (await client.request(
    'GET',
    `/v1/appStoreVersionLocalizations/${localizationId}/appScreenshotSets`
  )) as {
    data?: Array<{id: string; attributes?: {screenshotDisplayType?: string}}>
  }
  const existing = (sets.data || []).find(
    s => s.attributes?.screenshotDisplayType === displayType
  )
  if (existing) {
    return existing.id
  }
  if (dryRun) {
    log(`dry-run: would create appScreenshotSet ${displayType}`)
    return null
  }
  const created = (await client.request('POST', '/v1/appScreenshotSets', {
    body: {
      data: {
        type: 'appScreenshotSets',
        attributes: {screenshotDisplayType: displayType},
        relationships: {
          appStoreVersionLocalization: {
            data: {
              type: 'appStoreVersionLocalizations',
              id: localizationId
            }
          }
        }
      }
    }
  })) as {data: {id: string}}
  log(`Created screenshot set ${displayType}`)
  return created.data.id
}

async function putUploadOperation(
  method: string,
  url: string,
  headers: Array<{name: string; value: string}>,
  body: Buffer
): Promise<void> {
  const target = new URL(url)
  const reqHeaders: Record<string, string> = {}
  for (const header of headers) {
    reqHeaders[header.name] = header.value
  }
  reqHeaders['Content-Length'] = String(body.length)
  await new Promise<void>((resolve, reject) => {
    const req = httpsRequest(target, {method, headers: reqHeaders}, res => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => {
        if (
          res.statusCode === undefined ||
          res.statusCode < 200 ||
          res.statusCode >= 300
        ) {
          reject(
            new Error(
              `Upload ${method} ${url} -> HTTP ${res.statusCode}\n${Buffer.concat(chunks).toString('utf8')}`
            )
          )
          return
        }
        resolve()
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

async function uploadScreenshot(
  client: AscClient,
  setId: string,
  filePath: string,
  dryRun: boolean
): Promise<boolean> {
  assertMacScreenshotSize(filePath)
  const fileSize = statSync(filePath).size
  const fileName = basename(filePath)
  const checksum = md5Hex(filePath)

  if (dryRun) {
    log(
      `dry-run: would upload screenshot ${filePath} (${fileSize} bytes, md5=${checksum}) to set ${setId || '(new)'}`
    )
    return true
  }
  if (!setId) {
    throw new Error('Missing screenshot set id')
  }

  const existing = (await client.request(
    'GET',
    `/v1/appScreenshotSets/${setId}/appScreenshots`
  )) as {
    data?: Array<{
      id: string
      attributes?: {fileName?: string; sourceFileChecksum?: string}
    }>
  }
  const same = (existing.data || []).find(
    s =>
      s.attributes?.fileName === fileName &&
      s.attributes?.sourceFileChecksum === checksum
  )
  if (same) {
    log(`Screenshot ${fileName} already present with matching checksum — skip`)
    return false
  }

  const reserved = (await client.request('POST', '/v1/appScreenshots', {
    body: {
      data: {
        type: 'appScreenshots',
        attributes: {fileName, fileSize},
        relationships: {
          appScreenshotSet: {
            data: {type: 'appScreenshotSets', id: setId}
          }
        }
      }
    }
  })) as {
    data: {
      id: string
      attributes?: {
        uploadOperations?: Array<{
          method: string
          url: string
          length: number
          offset: number
          requestHeaders: Array<{name: string; value: string}>
        }>
      }
    }
  }

  const operations = reserved.data.attributes?.uploadOperations || []
  const bytes = Buffer.concat(
    await (async () => {
      const stream = createReadStream(filePath)
      const chunks: Buffer[] = []
      for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      }
      return chunks
    })()
  )
  for (const op of operations) {
    const slice = bytes.subarray(op.offset, op.offset + op.length)
    await putUploadOperation(op.method, op.url, op.requestHeaders || [], slice)
  }

  await client.request('PATCH', `/v1/appScreenshots/${reserved.data.id}`, {
    body: {
      data: {
        type: 'appScreenshots',
        id: reserved.data.id,
        attributes: {uploaded: true, sourceFileChecksum: checksum}
      }
    }
  })
  log(`Uploaded screenshot ${fileName}`)
  return true
}

function resolveScreenshotPath(
  workspace: string,
  relativeOrAbsolute: string
): string {
  return isAbsolute(relativeOrAbsolute)
    ? relativeOrAbsolute
    : join(workspace, relativeOrAbsolute)
}

export async function setupAppStoreListing({
  client,
  workspace,
  bundleId,
  version,
  platform,
  locale,
  listing,
  dryRun
}: {
  client: AscClient
  workspace: string
  bundleId: string
  version: string
  platform: string
  locale: string
  listing: ResolvedListing
  dryRun: boolean
}): Promise<ListingResult> {
  const app = await findApp(client, bundleId)
  log(`App: ${app.attributes.name} (${app.id})`)

  const versionObj = await ensureEditableVersion(
    client,
    app.id,
    version,
    platform
  )
  log(`Version: ${version} (${versionObj.id})`)

  const loc = await ensureVersionLocalization(client, versionObj.id, locale)
  await applyVersionLocalization(client, loc, listing, dryRun)
  await applyCopyright(client, versionObj.id, listing.copyright, dryRun)
  await applyReviewDetails(client, versionObj.id, listing.review, dryRun)
  await applyAgeRating(client, app.id, listing.ageRating, dryRun)
  await applyPrivacyPolicyUrl(
    client,
    app.id,
    locale,
    listing.privacyPolicyUrl,
    dryRun
  )
  await applyCategory(
    client,
    app.id,
    listing.category,
    listing.secondaryCategory,
    dryRun
  )

  let screenshotsUploaded = 0
  if (listing.screenshotPaths.length) {
    if (platform !== 'MAC_OS') {
      throw new Error(
        `Screenshot upload in this script currently supports MAC_OS only (got ${platform}). List ios paths later.`
      )
    }
    for (const relative of listing.screenshotPaths) {
      const path = resolveScreenshotPath(workspace, relative)
      if (!existsSync(path)) {
        throw new Error(`Screenshot not found: ${path}`)
      }
    }
    const setId = await ensureScreenshotSet(
      client,
      loc.id,
      'APP_DESKTOP',
      dryRun
    )
    for (const relative of listing.screenshotPaths) {
      const path = resolveScreenshotPath(workspace, relative)
      const uploaded = await uploadScreenshot(client, setId || '', path, dryRun)
      if (uploaded) {
        screenshotsUploaded += 1
      }
    }
  }

  const storeUrl = `https://appstoreconnect.apple.com/apps/${app.id}/appstore`
  log('')
  log(
    'Complete App Privacy nutrition labels in App Store Connect (Admin), then Add for Review.'
  )
  log(`  ${storeUrl}`)

  return {
    appId: app.id,
    versionId: versionObj.id,
    storeUrl,
    screenshotsUploaded,
    manualPrivacyRequired: true
  }
}
