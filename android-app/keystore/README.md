# Development signing key

`dev-debug.keystore` is a **development-only** key (password `android`,
alias `androiddebugkey`). It is committed so that every CI build is signed
with the same key and a newer APK installs over an older one without
uninstalling. Do not use it for a store release.
