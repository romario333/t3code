# Fork build entry points (see FORK.md).
.PHONY: desktop mobile

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
