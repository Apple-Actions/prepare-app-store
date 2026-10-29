# Prepare App Store

A GitHub Action that prepares an [App Store Connect](https://appstoreconnect.apple.com) version from a processed TestFlight build and release notes. It sits after [`Apple-Actions/upload-testflight-build`](https://github.com/Apple-Actions/upload-testflight-build) in the shipping pipeline:

1. Finds the newest `VALID` TestFlight build for the marketing version
2. Creates or reuses an editable App Store version and attaches that build
3. Sets **What's New** from `release-notes/<version>/*.md`
4. Optionally submits the version for review

Designed to compose with the rest of the Apple-Actions suite:

- [`Apple-Actions/import-codesign-certs`](https://github.com/Apple-Actions/import-codesign-certs)
- [`Apple-Actions/download-provisioning-profiles`](https://github.com/Apple-Actions/download-provisioning-profiles)
- [`Apple-Actions/xcodebuild`](https://github.com/Apple-Actions/xcodebuild)
- [`Apple-Actions/upload-testflight-build`](https://github.com/Apple-Actions/upload-testflight-build)
- [`Apple-Actions/bump-marketing-version`](https://github.com/Apple-Actions/bump-marketing-version)
- [`Apple-Actions/create-dmg`](https://github.com/Apple-Actions/create-dmg)
- [`Apple-Actions/notarize`](https://github.com/Apple-Actions/notarize)

## Usage

```yaml
- uses: Apple-Actions/prepare-app-store@v1
  with:
    issuer-id: ${{ vars.APPSTORE_ISSUER_ID }}
    api-key-id: ${{ vars.APPSTORE_API_KEY_ID }}
    api-private-key: ${{ secrets.APPSTORE_API_PRIVATE_KEY }}
    # Optional: read version + notes from another ref after checkout/fetch
    # source-ref: origin/prod
    # submit: true
```

By default the action reads `MARKETING_VERSION` and `PRODUCT_BUNDLE_IDENTIFIER` from `Config/Shared.xcconfig`. Pass `version` and `bundle-id` to override. For macOS App Store apps, set `platform: MAC_OS` or point `platform-file` at a one-line file.

| Input | Default | Description |
|-------|---------|-------------|
| `issuer-id` | *(required)* | App Store Connect API issuer id |
| `api-key-id` | *(required)* | App Store Connect API key id |
| `api-private-key` | *(required)* | PKCS8 PEM private key |
| `version-file` | `Config/Shared.xcconfig` | File containing marketing version + bundle id |
| `version` | | Explicit version (wins over file) |
| `bundle-id` | | Explicit bundle id (wins over file) |
| `platform` | `IOS` (or `platform-file`) | ASC platform |
| `platform-file` | | File with platform string |
| `release-notes-dir` | `release-notes/<version>` | Markdown notes for What's New |
| `source-ref` | | Optional git ref for version file / notes |
| `locale` | `en-US` | Localization for What's New |
| `submit` | `false` | Also submit for review |

| Output | Description |
|--------|-------------|
| `version` | Resolved marketing version |
| `bundle-id` | Resolved bundle id |
| `build-number` | Attached TestFlight CFBundleVersion |
| `app-id` | ASC app id |
| `app-store-version-id` | ASC appStoreVersions id |
| `store-url` | App Store Connect URL |
