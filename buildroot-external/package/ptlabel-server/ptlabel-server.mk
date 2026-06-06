################################################################################
#
# ptlabel-server
#
# Binary is cross-compiled by scripts/br-build-flash.sh using Buildroot's
# ARMv6+VFPv2 toolchain and dropped at .cache/ptlabel-server/bin/. We just
# install it into the target rootfs along with static assets, fonts, icons.
#
################################################################################

PTLABEL_SERVER_VERSION = local
PTLABEL_SERVER_SITE = $(BR2_EXTERNAL_PTLABEL_PATH)
PTLABEL_SERVER_SITE_METHOD = local
PTLABEL_SERVER_LICENSE = Proprietary
PTLABEL_SERVER_DEPENDENCIES = libusb
PTLABEL_SERVER_INSTALL_ROOT = /opt/ptlabel
PTLABEL_SERVER_SOURCE_ROOT = $(BR2_EXTERNAL_PTLABEL_PATH)/..
PTLABEL_SERVER_LOCAL_BINARY = $(PTLABEL_SERVER_SOURCE_ROOT)/.cache/ptlabel-server/bin/ptlabel-server
PTLABEL_SERVER_LOCAL_STATIC = $(PTLABEL_SERVER_SOURCE_ROOT)/static

define PTLABEL_SERVER_BUILD_CMDS
	test -f "$(PTLABEL_SERVER_LOCAL_BINARY)" || ( \
	  echo "ERROR: $(PTLABEL_SERVER_LOCAL_BINARY) missing" >&2; \
	  echo "run scripts/br-build-flash.sh which builds it" >&2; \
	  exit 1 )
	test -d "$(PTLABEL_SERVER_LOCAL_STATIC)" || ( \
	  echo "ERROR: $(PTLABEL_SERVER_LOCAL_STATIC) missing" >&2; \
	  echo "run: bun run build" >&2; \
	  exit 1 )
	cp "$(PTLABEL_SERVER_LOCAL_BINARY)" "$(@D)/ptlabel-server"
endef

define PTLABEL_SERVER_INSTALL_TARGET_CMDS
	mkdir -p "$(TARGET_DIR)$(PTLABEL_SERVER_INSTALL_ROOT)/bin"
	install -D -m 0755 "$(@D)/ptlabel-server" "$(TARGET_DIR)$(PTLABEL_SERVER_INSTALL_ROOT)/bin/ptlabel-server"
	install -D -m 0755 "$(PTLABEL_SERVER_SOURCE_ROOT)/scripts/gen-tls-cert.sh" "$(TARGET_DIR)$(PTLABEL_SERVER_INSTALL_ROOT)/bin/gen-tls-cert.sh"

	mkdir -p "$(TARGET_DIR)$(PTLABEL_SERVER_INSTALL_ROOT)/static"
	cp -a "$(PTLABEL_SERVER_LOCAL_STATIC)/." "$(TARGET_DIR)$(PTLABEL_SERVER_INSTALL_ROOT)/static/"

	mkdir -p "$(TARGET_DIR)$(PTLABEL_SERVER_INSTALL_ROOT)/fonts"
	cp -a "$(PTLABEL_SERVER_SOURCE_ROOT)/fonts/." "$(TARGET_DIR)$(PTLABEL_SERVER_INSTALL_ROOT)/fonts/"

	mkdir -p "$(TARGET_DIR)$(PTLABEL_SERVER_INSTALL_ROOT)/icons"
	cp -a "$(PTLABEL_SERVER_SOURCE_ROOT)/icons/." "$(TARGET_DIR)$(PTLABEL_SERVER_INSTALL_ROOT)/icons/"
endef

$(eval $(generic-package))
