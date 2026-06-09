################################################################################
#
# ptlabel-bridge
#
# Binary is cross-compiled by scripts/br-build-flash.sh using Buildroot's
# ARMv6+VFPv2 toolchain and dropped at .cache/ptlabel-bridge/bin/.
#
################################################################################

PTLABEL_BRIDGE_VERSION = local
PTLABEL_BRIDGE_SITE = $(BR2_EXTERNAL_PTLABEL_PATH)
PTLABEL_BRIDGE_SITE_METHOD = local
PTLABEL_BRIDGE_LICENSE = Proprietary
PTLABEL_BRIDGE_DEPENDENCIES = libusb
PTLABEL_BRIDGE_INSTALL_ROOT = /opt/ptlabel
PTLABEL_BRIDGE_SOURCE_ROOT = $(BR2_EXTERNAL_PTLABEL_PATH)/..
PTLABEL_BRIDGE_LOCAL_BINARY = $(PTLABEL_BRIDGE_SOURCE_ROOT)/.cache/ptlabel-bridge/bin/ptlabel-bridge

define PTLABEL_BRIDGE_BUILD_CMDS
	test -f "$(PTLABEL_BRIDGE_LOCAL_BINARY)" || ( \
	  echo "ERROR: $(PTLABEL_BRIDGE_LOCAL_BINARY) missing" >&2; \
	  echo "run scripts/br-build-flash.sh which builds it" >&2; \
	  exit 1 )
	cp "$(PTLABEL_BRIDGE_LOCAL_BINARY)" "$(@D)/ptlabel-bridge"
endef

define PTLABEL_BRIDGE_INSTALL_TARGET_CMDS
	mkdir -p "$(TARGET_DIR)$(PTLABEL_BRIDGE_INSTALL_ROOT)/bin"
	install -D -m 0755 "$(@D)/ptlabel-bridge" "$(TARGET_DIR)$(PTLABEL_BRIDGE_INSTALL_ROOT)/bin/ptlabel-bridge"
endef

$(eval $(generic-package))
