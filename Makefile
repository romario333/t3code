# Fork build entry points (see FORK.md).
.PHONY: desktop mobile cli

# Build the desktop dmg (arm64) into release/.
desktop:
	./build.sh

# Build the iOS app and install it on a plugged-in iPhone.
# CocoaPods (Ruby) crashes without a UTF-8 locale, and make's /bin/sh
# does not inherit one from the terminal.
mobile: export LANG=en_US.UTF-8
mobile: export LC_ALL=en_US.UTF-8
mobile:
	cd apps/mobile && pnpm run ios:device

# Build the t3 CLI (web client + server bundle) and install it globally
# with npm so it can be run as `t3`. UPSTREAM_BASE is read from build.sh
# so the in-app "new upstream release" pill stays in sync with desktop.
cli: export T3CODE_UPSTREAM_BASE=$(shell sed -n 's/^UPSTREAM_BASE="\(.*\)"$$/\1/p' build.sh)
cli:
	pnpm exec vp run --filter t3 build
	npm install -g ./apps/server
