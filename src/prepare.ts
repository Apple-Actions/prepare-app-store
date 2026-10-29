import {info, warning} from '@actions/core'
import {appendFileSync} from 'node:fs'
import {AscBuild, AscClient, AscVersion, findApp, versionState} from './asc'

export const EDITABLE_STATES = new Set([
  'PREPARE_FOR_SUBMISSION',
  'DEVELOPER_REJECTED',
  'REJECTED',
  'METADATA_REJECTED',
  'INVALID_BINARY'
])

function emit(msg: string): void {
  info(msg)
  const summary = process.env.GITHUB_STEP_SUMMARY
  if (summary) {
    appendFileSync(summary, `${msg}\n\n`)
  }
}

export type PrepareResult = {
  appId: string
  versionId: string
  buildNumber: string
  storeUrl: string
}

export async function prepareAppStore({
  client,
  bundleId,
  version,
  platform,
  whatsNew,
  locale,
  submit
}: {
  client: AscClient
  bundleId: string
  version: string
  platform: string
  whatsNew: string
  locale: string
  submit: boolean
}): Promise<PrepareResult> {
  const stripped = whatsNew.trim()
  if (stripped.length > 4000) {
    throw new Error(
      `What's New is ${stripped.length} characters; App Store Connect caps at 4000.`
    )
  }
  if (submit && !stripped) {
    throw new Error(
      "Refusing to submit for review with empty What's New. Add release-notes/<version>/*.md first."
    )
  }

  const app = await findApp(client, bundleId)
  emit(`App: ${app.attributes.name} (${app.id})`)

  const buildsResponse = (await client.request('GET', '/v1/builds', {
    query: {
      'filter[app]': app.id,
      'filter[preReleaseVersion.version]': version,
      'filter[processingState]': 'VALID',
      sort: '-uploadedDate',
      limit: '1'
    }
  })) as {data?: AscBuild[]}
  const builds = buildsResponse.data || []
  if (!builds.length) {
    throw new Error(
      `No VALID build found for version ${version}. Either the latest build is still processing or none has been uploaded. Check TestFlight in App Store Connect.`
    )
  }
  const build = builds[0]
  emit(
    `Build: ${version} build #${build.attributes.version} (uploaded ${build.attributes.uploadedDate})`
  )

  const existingResponse = (await client.request(
    'GET',
    `/v1/apps/${app.id}/appStoreVersions`,
    {
      query: {
        'filter[versionString]': version,
        'filter[platform]': platform
      }
    }
  )) as {data?: AscVersion[]}
  const existing = existingResponse.data || []

  let versionObj: AscVersion
  if (existing.length) {
    versionObj = existing[0]
    const state = versionState(versionObj)
    if (!EDITABLE_STATES.has(state)) {
      throw new Error(
        `App Store version ${version} is in state ${state} and cannot be modified. Reset or remove the version in App Store Connect if you need to re-prepare.`
      )
    }
    await client.request('PATCH', `/v1/appStoreVersions/${versionObj.id}`, {
      body: {
        data: {
          type: 'appStoreVersions',
          id: versionObj.id,
          relationships: {build: {data: {type: 'builds', id: build.id}}}
        }
      }
    })
    emit(`Attached build to App Store version ${version} (${versionObj.id})`)
  } else {
    const created = (await client.request('POST', '/v1/appStoreVersions', {
      body: {
        data: {
          type: 'appStoreVersions',
          attributes: {platform, versionString: version},
          relationships: {
            app: {data: {type: 'apps', id: app.id}},
            build: {data: {type: 'builds', id: build.id}}
          }
        }
      }
    })) as {data: AscVersion}
    versionObj = created.data
    emit(
      `Created App Store version ${version} (${versionObj.id}, state=${versionState(versionObj)})`
    )
  }

  if (stripped) {
    const locsResponse = (await client.request(
      'GET',
      `/v1/appStoreVersions/${versionObj.id}/appStoreVersionLocalizations`
    )) as {data?: AscVersion[]}
    const locs = locsResponse.data || []
    const targets = locs.filter(loc => (loc.attributes || {}).locale === locale)
    if (!targets.length) {
      warning(`No ${locale} localization on this version — creating it.`)
      const created = (await client.request(
        'POST',
        '/v1/appStoreVersionLocalizations',
        {
          body: {
            data: {
              type: 'appStoreVersionLocalizations',
              attributes: {locale, whatsNew},
              relationships: {
                appStoreVersion: {
                  data: {type: 'appStoreVersions', id: versionObj.id}
                }
              }
            }
          }
        }
      )) as {data: AscVersion}
      emit(`Set What's New for ${created.data.attributes.locale}`)
    } else {
      for (const loc of targets) {
        await client.request(
          'PATCH',
          `/v1/appStoreVersionLocalizations/${loc.id}`,
          {
            body: {
              data: {
                type: 'appStoreVersionLocalizations',
                id: loc.id,
                attributes: {whatsNew}
              }
            }
          }
        )
        emit(`Set What's New for ${loc.attributes.locale}`)
      }
    }
  }

  const storeUrl = `https://appstoreconnect.apple.com/apps/${app.id}/appstore`
  if (!submit) {
    emit('Ready. Verify the version, then click Submit for Review:')
    emit(`  ${storeUrl}`)
    return {
      appId: app.id,
      versionId: versionObj.id,
      buildNumber: build.attributes.version,
      storeUrl
    }
  }

  try {
    const readyResponse = (await client.request(
      'GET',
      `/v1/apps/${app.id}/reviewSubmissions`,
      {
        query: {
          'filter[platform]': platform,
          'filter[state]': 'READY_FOR_REVIEW'
        }
      }
    )) as {data?: AscVersion[]}
    const ready = readyResponse.data || []
    let submissionId: string
    if (ready.length) {
      submissionId = ready[0].id
    } else {
      const created = (await client.request('POST', '/v1/reviewSubmissions', {
        body: {
          data: {
            type: 'reviewSubmissions',
            attributes: {platform},
            relationships: {app: {data: {type: 'apps', id: app.id}}}
          }
        }
      })) as {data: AscVersion}
      submissionId = created.data.id
    }
    await client.request('POST', '/v1/reviewSubmissionItems', {
      body: {
        data: {
          type: 'reviewSubmissionItems',
          relationships: {
            reviewSubmission: {
              data: {type: 'reviewSubmissions', id: submissionId}
            },
            appStoreVersion: {
              data: {type: 'appStoreVersions', id: versionObj.id}
            }
          }
        }
      }
    })
    const patched = (await client.request(
      'PATCH',
      `/v1/reviewSubmissions/${submissionId}`,
      {
        body: {
          data: {
            type: 'reviewSubmissions',
            id: submissionId,
            attributes: {submitted: true}
          }
        }
      }
    )) as {data?: {attributes?: {submitted?: boolean; state?: string}}}
    const attrs = (patched.data || {}).attributes || {}
    emit(
      `Review submission ${submissionId} submitted=${attrs.submitted} state=${attrs.state}`
    )
    emit(`Submitted ${version} for App Store review.`)
    emit(`  ${storeUrl}`)
  } catch {
    emit('Prepared the App Store version but could not submit for review.')
    emit(`Finish in App Store Connect: ${storeUrl}`)
    throw new Error('Could not submit for App Store review')
  }

  return {
    appId: app.id,
    versionId: versionObj.id,
    buildNumber: build.attributes.version,
    storeUrl
  }
}
