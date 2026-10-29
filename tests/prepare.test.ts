import {describe, expect, it, vi} from 'vitest'
import {EDITABLE_STATES, prepareAppStore} from '../src/prepare'
import type {AscClient} from '../src/asc'

describe('EDITABLE_STATES', () => {
  it('includes prepare-for-submission', () => {
    expect(EDITABLE_STATES.has('PREPARE_FOR_SUBMISSION')).toBe(true)
  })
})

describe('prepareAppStore', () => {
  it("rejects submit with empty What's New", async () => {
    const client: AscClient = {request: vi.fn()}
    await expect(
      prepareAppStore({
        client,
        bundleId: 'com.example',
        version: '1.0',
        platform: 'IOS',
        whatsNew: '',
        locale: 'en-US',
        submit: true
      })
    ).rejects.toThrow(/empty What's New/)
  })

  it('attaches a build to a new App Store version', async () => {
    const request = vi.fn(async (method: string, path: string) => {
      if (method === 'GET' && path === '/v1/apps') {
        return {
          data: [
            {
              id: 'app-1',
              attributes: {name: 'Example', bundleId: 'com.example'}
            }
          ]
        }
      }
      if (method === 'GET' && path === '/v1/builds') {
        return {
          data: [
            {
              id: 'build-1',
              attributes: {version: '42', uploadedDate: '2026-01-01'}
            }
          ]
        }
      }
      if (method === 'GET' && path.includes('/appStoreVersions')) {
        return {data: []}
      }
      if (method === 'POST' && path === '/v1/appStoreVersions') {
        return {
          data: {
            id: 'ver-1',
            attributes: {appVersionState: 'PREPARE_FOR_SUBMISSION'}
          }
        }
      }
      if (method === 'POST' && path === '/v1/appStoreVersionLocalizations') {
        return {data: {attributes: {locale: 'en-US'}}}
      }
      if (method === 'GET' && path.includes('Localizations')) {
        return {data: []}
      }
      throw new Error(`unexpected ${method} ${path}`)
    })

    const result = await prepareAppStore({
      client: {request},
      bundleId: 'com.example',
      version: '1.0',
      platform: 'IOS',
      whatsNew: '- Fix bugs',
      locale: 'en-US',
      submit: false
    })

    expect(result).toEqual({
      appId: 'app-1',
      versionId: 'ver-1',
      buildNumber: '42',
      storeUrl: 'https://appstoreconnect.apple.com/apps/app-1/appstore'
    })
  })
})
