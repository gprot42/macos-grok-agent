#!/bin/bash
set -e # Exit immediately if a command exits with a non-zero status.

# --- Configuration Variables ---
APP_NAME="Vertex AI Client"
APP_IDENTIFIER="com.vertex.desktop"
APP_BUNDLE_NAME="${APP_NAME}.app"
DIST_DIR="dist"
BUILD_DIR="build"
DMG_OUTPUT_NAME="${APP_NAME}.dmg"
PKG_OUTPUT_NAME="${APP_NAME}.pkg"
SPEC_FILE="build.spec"

# --- Pre-flight Checks and Setup ---
echo "--- Starting Package Creation Process ---"
# (Pre-flight checks remain the same)
command -v uv >/dev/null 2>&1 || { echo >&2 "Error: 'uv' is not installed."; exit 1; }
command -v pyinstaller >/dev/null 2>&1 || { echo >&2 "Error: 'pyinstaller' is not installed."; exit 1; }

if [ ! -f "${SPEC_FILE}" ]; then
    echo "Error: Build spec file not found at '${SPEC_FILE}'. Please create it."
    exit 1
fi

# --- Cleanup Previous Builds ---
echo "Cleaning up previous build artifacts..."
# (Cleanup logic remains the same)
MAX_UNMOUNT_ATTEMPTS=5
for i in $(seq 1 $MAX_UNMOUNT_ATTEMPTS); do
    if hdiutil info | grep -q "/Volumes/${APP_NAME}"; then
        echo "Attempt ${i}/${MAX_UNMOUNT_ATTEMPTS}: Unmounting existing '${APP_NAME}' volume..."
        hdiutil detach "/Volumes/${APP_NAME}" -force && echo "Unmount successful." && break
        sleep 2
    else
        echo "No mounted '${APP_NAME}' disk image found."
        break
    fi
done
rm -rf "${DIST_DIR}" "${BUILD_DIR}" "${PKG_OUTPUT_NAME}" "${DMG_OUTPUT_NAME}"

# --- Install Dependencies ---
echo "Installing/updating Python dependencies with uv..."
uv pip install -e . pyinstaller

# --- Create the App Bundle with PyInstaller ---
echo "Creating the application bundle using '${SPEC_FILE}'..."
pyinstaller "${SPEC_FILE}"

APP_BUNDLE_FULL_PATH="${DIST_DIR}/${APP_BUNDLE_NAME}"
if [ ! -d "${APP_BUNDLE_FULL_PATH}" ]; then
    echo "Error: PyInstaller failed to create the app bundle at '${APP_BUNDLE_FULL_PATH}'."
    exit 1
else
    echo "App bundle created successfully."
fi

# --- Create DMG Package ---
# *** NEW APPROACH: Bypassing create-dmg and using hdiutil directly ***
echo "Creating DMG package directly with hdiutil..."

# 1. Define a temporary directory to stage the DMG contents
DMG_SRC_DIR="${BUILD_DIR}/dmg_source"
mkdir -p "${DMG_SRC_DIR}"

# 2. Copy the application bundle into the staging directory
cp -R "${APP_BUNDLE_FULL_PATH}" "${DMG_SRC_DIR}/"

# 3. Create the DMG from the staging directory
hdiutil create \
    -srcfolder "${DMG_SRC_DIR}" \
    -volname "${APP_NAME}" \
    -fs HFS+ \
    -fsargs "-c c=64,a=16,e=16" \
    -format UDZO \
    -imagekey zlib-level=9 \
    "${DMG_OUTPUT_NAME}"

if [ -f "${DMG_OUTPUT_NAME}" ]; then
    echo "DMG created successfully: ${DMG_OUTPUT_NAME}"
else
    # This section will now catch the hdiutil error directly
    echo "Error: hdiutil failed to create ${DMG_OUTPUT_NAME}."
    echo "If this still fails with 'Resource busy', the issue is likely with the OS environment."
    exit 1
fi


# --- Create PKG Package ---
echo "Creating PKG package: ${PKG_OUTPUT_NAME}..."
# (PKG logic remains the same)
DEVELOPER_ID_INSTALLER_IDENTITY="Developer ID Installer: Your Developer Name (XXXXXXXXXX)"
if [ "${DEVELOPER_ID_INSTALLER_IDENTITY}" = "Developer ID Installer: Your Developer Name (XXXXXXXXXX)" ]; then
    echo "Warning: Developer ID is a placeholder. PKG will be unsigned."
    productbuild \
        --component "${APP_BUNDLE_FULL_PATH}" "/Applications" \
        --identifier "${APP_IDENTIFIER}" \
        --version "1.0.0" \
        "${PKG_OUTPUT_NAME}"
else
    echo "Attempting to sign PKG with identity: '${DEVELOPER_ID_INSTALLER_IDENTITY}'"
    productbuild \
        --component "${APP_BUNDLE_FULL_PATH}" "/Applications" \
        --identifier "${APP_IDENTIFIER}" \
        --version "1.0.0" \
        --sign "${DEVELOPER_ID_INSTALLER_IDENTITY}" \
        "${PKG_OUTPUT_NAME}"
fi

echo "PKG created: ${PKG_OUTPUT_NAME}"
echo "--- Build process complete! ---"
