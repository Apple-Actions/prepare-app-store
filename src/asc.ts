import {createPrivateKey, sign} from 'node:crypto'
import {request as httpsRequest} from 'node:https'
import {URL} from 'node:url'

const API_BASE = 'https://api.appstoreconnect.apple.com'

export type AscClient = {
  request: (
    method: string,
    path: string,
    opts?: {body?: unknown; query?: Record<string, string>}
  ) => Promise<unknown>
}

export function normalizePem(raw: string): string {
  const pem = raw.replace(/\\n/g, '\n').trim()
  if (!pem.includes('BEGIN PRIVATE KEY')) {
    throw new Error('api-private-key is empty or not a PEM private key')
  }
  return pem
}

export function makeJwt(keyId: string, issuerId: string, pem: string): string {
  const header = Buffer.from(
    JSON.stringify({alg: 'ES256', kid: keyId, typ: 'JWT'})
  ).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const payload = Buffer.from(
    JSON.stringify({
      iss: issuerId,
      iat: now,
      exp: now + 1200,
      aud: 'appstoreconnect-v1'
    })
  ).toString('base64url')
  const signingInput = `${header}.${payload}`
  const key = createPrivateKey(pem)
  const sig = sign('sha256', Buffer.from(signingInput), {
    key,
    dsaEncoding: 'ieee-p1363'
  })
  return `${signingInput}.${sig.toString('base64url')}`
}

export function createAscClient(token: string): AscClient {
  return {
    request(method, path, opts = {}) {
      return request(token, method, path, opts)
    }
  }
}

function request(
  token: string,
  method: string,
  path: string,
  {body, query}: {body?: unknown; query?: Record<string, string>} = {}
): Promise<unknown> {
  const url = new URL(path.startsWith('http') ? path : `${API_BASE}${path}`)
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value)
    }
  }
  const payload = body === undefined ? null : JSON.stringify(body)
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`
  }
  if (payload !== null) {
    headers['Content-Type'] = 'application/json'
    headers['Content-Length'] = String(Buffer.byteLength(payload))
  }

  return new Promise((resolve, reject) => {
    const req = httpsRequest(url, {method, headers}, res => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8')
        if (
          res.statusCode === undefined ||
          res.statusCode < 200 ||
          res.statusCode >= 300
        ) {
          const err = new Error(
            `${method} ${url} -> HTTP ${res.statusCode}${raw ? `\n${raw}` : ''}`
          ) as Error & {statusCode?: number}
          err.statusCode = res.statusCode
          reject(err)
          return
        }
        resolve(raw ? JSON.parse(raw) : null)
      })
    })
    req.setTimeout(60000, () => {
      req.destroy(new Error('ASC request timed out'))
    })
    req.on('error', reject)
    if (payload !== null) {
      req.write(payload)
    }
    req.end()
  })
}

export type AscApp = {
  id: string
  attributes: {name: string; bundleId: string}
}

export type AscBuild = {
  id: string
  attributes: {version: string; uploadedDate: string}
}

export type AscVersion = {
  id: string
  attributes: {
    versionString?: string
    appVersionState?: string
    appStoreState?: string
    locale?: string
  }
}

export async function findApp(
  client: AscClient,
  bundleId: string
): Promise<AscApp> {
  const response = (await client.request('GET', '/v1/apps', {
    query: {'filter[bundleId]': bundleId, limit: '200'}
  })) as {data?: AscApp[]}
  const app = (response.data || []).find(
    a => a.attributes.bundleId === bundleId
  )
  if (!app) {
    throw new Error(`No app found in App Store Connect for bundle ${bundleId}`)
  }
  return app
}

export function versionState(v: AscVersion): string {
  const attrs = v.attributes || {}
  const state = attrs.appVersionState || attrs.appStoreState
  if (!state) {
    throw new Error('Could not determine App Store version state')
  }
  return state
}
