#!/bin/sh
set -e
NODE_VER="${NODE_VER:-v20.19.2}"
BINS="${BINS:-/workspace/node-bins}"
FUSE=NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
mkdir -p build dist
bun build src/cli.js --target=node --format=cjs --minify-whitespace --minify-syntax --outfile build/ponyatny-bundle.js
echo '{"main":"build/ponyatny-bundle.js","output":"build/sea.blob","disableExperimentalSEAWarning":true,"useCodeCache":false}' > build/sea-config.json
"$BINS/node-$NODE_VER-linux-x64/bin/node" --experimental-sea-config build/sea-config.json
cp "$BINS/node-$NODE_VER-linux-x64/bin/node" dist/ponyatny-linux
cp "$BINS/node-$NODE_VER-win-x64/node.exe" dist/ponyatny.exe
npx --yes postject@1.0.0-alpha.6 dist/ponyatny-linux NODE_SEA_BLOB build/sea.blob --sentinel-fuse $FUSE
npx --yes postject@1.0.0-alpha.6 dist/ponyatny.exe NODE_SEA_BLOB build/sea.blob --sentinel-fuse $FUSE
chmod +x dist/ponyatny-linux
mkdir -p dist/LICENSES
cp LICENSE THIRD_PARTY_NOTICES.md dist/LICENSES/
cp licenses/node-LICENSE.txt licenses/acorn-LICENSE.txt dist/LICENSES/
