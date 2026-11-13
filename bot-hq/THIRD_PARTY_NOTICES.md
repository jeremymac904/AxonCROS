# Third-party notices

Bot HQ is MIT-licensed (see `LICENSE`). It bundles or depends on the third-party work listed below. npm dependencies not listed here are covered by their own licenses, included in their packages.

## Lucide icons

The web UI's icons come from [Lucide](https://lucide.dev), via the `lucide-react` package (pinned to 1.61.0 in `web/package.json`). The original UI glyphs have been restored; Lucide remains listed here while its dependency is retained.

```
ISC License

Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

Some Lucide icons are derived from [Feather](https://feathericons.com). Those are under the MIT License:

```
Copyright (c) 2013-present Cole Bemis

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Restored UI artwork

The original UI artwork is restored from the project's design export: bot silhouettes and eyes (`web/artwork/` and `web/src/avatar/shapes.gen.ts`), UI icons and app tiles (`web/public/assets/`), and the favicon. Artwork originating in xAI/Cursor's Grok Bot app and third-party app logos remains the property of its respective owners; the project's MIT license does not grant rights to that artwork. Inclusion does not imply affiliation or endorsement.

App logos supplied at runtime by Composio also remain the property of their respective owners. The Google sign-in mark is a trademark of Google LLC.

## AxonCROS sanitized source edition

The root LICENSE covers project-authored additions; it does not override the
artwork exclusions above. `script/prepare-source-release.py` excludes the
uncleared legacy artwork and screenshots, and generates original neutral
geometry under the root MIT license. The exact supplied AxonCROS logos and
five-character Bot Team assets are separately licensed CC BY4.0 by Jeremy
McDonald; retain the root ARTWORK_LICENSE.md attribution and legalcode.
Its release manifest identifies the exact excluded/generated files. The
working private checkout retains its originals unchanged.

A bundled Node.js runtime must retain Node's LICENSE (including its bundled
third-party notices). Runtime npm dependencies retain their own LICENSE files.
The source lockfile records exact dependency resolutions; the release workflow
records an inventory rather than implying all dependencies use MIT.


## Direct WhatsApp linked-device dependencies

The optional direct WhatsApp Web adapter uses these pinned runtime packages:

| Package | Version | License / provenance |
| --- | --- | --- |
| `@whiskeysockets/baileys` | `7.0.0-rc13` | MIT; copyright 2025 Rajeh Taher/WhiskeySockets. [Upstream](https://github.com/WhiskeySockets/Baileys), [license](LICENSES/Baileys-MIT.md). |
| `qrcode` | `1.5.4` | MIT; copyright 2012 Ryan Day. [Upstream](https://github.com/soldair/node-qrcode), [license](LICENSES/QRCode-MIT.md). |
| `whatsapp-rust-bridge` | `0.5.4` | Package metadata declares MIT; JavaScript/WebAssembly dependency. [Declared upstream](https://github.com/jlucaso1/whatsapp-rust-bridge). The installed package does not contain a LICENSE file; obtain its authoritative notice before a public runtime release. |
| `libsignal` | `6.0.0` | GPL-3.0; transitive Baileys cryptography dependency. [Upstream source](https://github.com/WhiskeySockets/libsignal-node), [license](LICENSES/libsignal-GPL-3.0.md). |

The project-authored source retains its existing MIT license, and the supplied
artwork retains its separate CC BY 4.0 attribution. These licenses do **not**
replace the GPL-3.0 terms on libsignal. A combined runtime containing this
adapter must not be represented as MIT-only. Any public distribution must
satisfy the applicable GPL terms, including the corresponding-source and
license requirements for the combined work. The 3.4.0 local validation build
is not a newly authorized public binary release. The lockfile identifies exact
package artifacts; runtime packaging retains dependency source and licenses.

Baileys is an unofficial WhatsApp Web client and is not endorsed by WhatsApp
or Meta. Linking requires the account owner's explicit phone approval. This
adapter does not use the WhatsApp Business API or create a Business account;
it does not promise immunity from service restrictions or that unrelated
provider/account usage is free. No Hermes session or credentials are reused.
