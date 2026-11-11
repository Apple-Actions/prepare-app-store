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

## Before first submit: listing script

This Action only attaches a build and sets What's New. For a first App Store version you also need listing metadata (age rating, App Review contact, description / URLs, screenshots). Use the local script in this repo — it is **not** wired into the Action, so every prepare run does not re-upload screenshots.

```bash
yarn build   # once, in a checkout of this repo

# 1) Bootstrap store/listing.yml (repo discover + optional ASC pull + prompts)
./scripts/setup-app-store-listing.sh --init --dir /path/to/your/app
# Optional: also pull fields already in App Store Connect
./scripts/setup-app-store-listing.sh --init --dir /path/to/your/app \
  --issuer-id '…' --api-key-id '…' --api-private-key-path ~/AuthKey_….p8

# 2) Dry-run, then apply (review contact stays on the CLI — not in listing.yml)
./scripts/setup-app-store-listing.sh --dir /path/to/your/app
./scripts/setup-app-store-listing.sh --dir /path/to/your/app --apply \
  --issuer-id '…' --api-key-id '…' --api-private-key-path ~/AuthKey_….p8 \
  --review-first-name Jane --review-last-name Doe \
  --review-phone '+1-555-0100' --review-email review@example.com
```

`--init` merges (highest wins): existing `store/listing.yml`, ASC pull (when credentials are passed), then repo heuristics (README URLs / first paragraph, `store/screenshots/{mac,ios}/*`). On a TTY it prompts only for gaps. Without a TTY it writes a discovery draft and exits `2` if required fields are still missing.

Default listing file: `store/listing.yml` (see [`examples/store/listing.yml`](examples/store/listing.yml)). Mac screenshots must be one of `1280x800`, `1440x900`, `2560x1600`, `2880x1800`.

**Still manual:** App Privacy nutrition labels in App Store Connect (Admin). First-version What's New stays this Action's job after a VALID TestFlight build exists.
