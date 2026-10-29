import {mkdtempSync, mkdirSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {describe, expect, it} from 'vitest'
import {
  assembleWhatsNew,
  parseXcconfig,
  readFirstValue,
  resolveVersionAndBundle
} from '../src/config'

describe('parseXcconfig', () => {
  it('reads marketing version and bundle id', () => {
    expect(
      parseXcconfig(
        'MARKETING_VERSION = 1.2\nPRODUCT_BUNDLE_IDENTIFIER = com.example.App\n'
      )
    ).toEqual({version: '1.2', bundleId: 'com.example.App'})
  })
})

describe('readFirstValue', () => {
  it('skips comments and blank lines', () => {
    expect(readFirstValue('# comment\n\nMAC_OS\n')).toBe('MAC_OS')
  })
})

describe('resolveVersionAndBundle', () => {
  it('prefers explicit inputs', async () => {
    await expect(
      resolveVersionAndBundle({
        workspace: '/tmp',
        versionInput: '9.9',
        bundleIdInput: 'com.explicit',
        versionFile: 'missing.xcconfig',
        sourceRef: ''
      })
    ).resolves.toEqual({version: '9.9', bundleId: 'com.explicit'})
  })

  it('reads the version file', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'prepare-config-'))
    mkdirSync(join(workspace, 'Config'), {recursive: true})
    writeFileSync(
      join(workspace, 'Config/Shared.xcconfig'),
      'MARKETING_VERSION = 2.0\nPRODUCT_BUNDLE_IDENTIFIER = com.file\n'
    )
    await expect(
      resolveVersionAndBundle({
        workspace,
        versionInput: '',
        bundleIdInput: '',
        versionFile: 'Config/Shared.xcconfig',
        sourceRef: ''
      })
    ).resolves.toEqual({version: '2.0', bundleId: 'com.file'})
  })
})

describe('assembleWhatsNew', () => {
  it('concatenates markdown notes', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'prepare-notes-'))
    const notes = join(workspace, 'release-notes/1.0')
    mkdirSync(notes, {recursive: true})
    writeFileSync(join(notes, 'b.md'), 'Second')
    writeFileSync(join(notes, 'a.md'), 'First')
    await expect(
      assembleWhatsNew({
        workspace,
        notesDir: 'release-notes/1.0',
        sourceRef: ''
      })
    ).resolves.toBe('- First\n- Second')
  })
})
