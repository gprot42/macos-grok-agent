#!/bin/bash
# =============================================================================
# Enable Vertex AI Model Garden LLMs
# =============================================================================
# This script enables the required APIs and Model Garden access for Cortex Agent.
#
# Prerequisites:
#   - Run 01-setup-vertex-sa.sh first to create the service account
#   - gcloud CLI installed and authenticated
#   - A Google Cloud project with billing enabled
#
# Usage:
#   ./02-enable-vertex-models.sh [PROJECT_ID]
#
# If PROJECT_ID is not provided, it will use the current gcloud project.
# =============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Use the same service account name as 01-setup-vertex-sa.sh
SA_NAME="cortex-agent-vertex"
KEY_PATH="$HOME/.cortex-agent/vertex-key.json"

print_header() {
    echo ""
    echo -e "${BLUE}================================================${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}================================================${NC}"
    echo ""
}

print_step() {
    echo -e "${GREEN}[✓]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[!]${NC} $1"
}

print_error() {
    echo -e "${RED}[✗]${NC} $1"
}

# Get project ID
if [ -n "$1" ]; then
    PROJECT_ID="$1"
else
    PROJECT_ID=$(gcloud config get-value project 2>/dev/null)
fi

if [ -z "$PROJECT_ID" ]; then
    print_error "No project ID specified and no default project set."
    echo "Usage: $0 [PROJECT_ID]"
    exit 1
fi

SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

print_header "Enabling Vertex AI Model Garden for: $PROJECT_ID"

# Check if gcloud is authenticated
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null | head -n1 > /dev/null; then
    print_error "gcloud is not authenticated. Run: gcloud auth login"
    exit 1
fi

print_step "Authenticated with gcloud"

# Check if service account exists (created by 01-setup-vertex-sa.sh)
print_header "Checking Service Account"

if ! gcloud iam service-accounts describe "$SA_EMAIL" --project="$PROJECT_ID" 2>/dev/null > /dev/null; then
    print_error "Service account not found: $SA_EMAIL"
    echo ""
    echo "Please run 01-setup-vertex-sa.sh first to create the service account:"
    echo -e "  ${BLUE}./scripts/01-setup-vertex-sa.sh $PROJECT_ID${NC}"
    echo ""
    exit 1
fi

print_step "Service account exists: $SA_EMAIL"

# Check for key file
if [ -f "$KEY_PATH" ]; then
    print_step "Key file exists: $KEY_PATH"
else
    print_warning "Key file not found at: $KEY_PATH"
    echo "  Run 01-setup-vertex-sa.sh to generate the key"
fi

# Enable required APIs
print_header "Enabling Required APIs"

APIS=(
    "aiplatform.googleapis.com"
    "iam.googleapis.com"
    "cloudresourcemanager.googleapis.com"
)

for api in "${APIS[@]}"; do
    echo -n "Enabling $api... "
    if gcloud services enable "$api" --project="$PROJECT_ID" 2>/dev/null; then
        echo -e "${GREEN}done${NC}"
    else
        echo -e "${YELLOW}already enabled or failed${NC}"
    fi
done

# Grant Model Garden User role (in addition to roles from script 01)
print_header "Granting Model Garden Access"

echo -n "Granting roles/aiplatform.modelGardenUser... "
if gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:$SA_EMAIL" \
    --role="roles/aiplatform.modelGardenUser" \
    --condition=None \
    --quiet 2>/dev/null > /dev/null; then
    echo -e "${GREEN}done${NC}"
else
    echo -e "${YELLOW}may already be granted${NC}"
fi

# List of Vertex AI Model Garden publisher models used by Cortex Agent
print_header "Available Models"

echo "The following models will be accessible via Vertex AI:"
echo ""
echo "  Anthropic Claude Models (via Model Garden):"
echo "    - claude-haiku-4-5@20251001"
echo "    - claude-sonnet-4-5@20250929"
echo "    - claude-opus-4-5@20251101"
echo ""
echo "  Google Gemini Models (native Vertex AI):"
echo "    - gemini-2.5-pro"
echo "    - gemini-2.5-flash"
echo "    - gemini-3-pro-preview"
echo "    - gemini-3-flash-preview"
echo ""

# Check Model Garden access
print_header "Verifying Model Garden Access"

echo "Checking available publishers in Model Garden..."
if gcloud ai models list --region=us-central1 --project="$PROJECT_ID" --limit=1 2>/dev/null > /dev/null; then
    print_step "Model Garden access verified"
else
    print_warning "Could not verify Model Garden access. This may be normal for new projects."
fi

# Anthropic models require agreement to terms
print_header "Anthropic Model Garden Setup (Manual Step Required)"

echo -e "${YELLOW}Why is this step manual?${NC}"
echo ""
echo "  Anthropic Claude models require accepting their Terms of Service."
echo "  This is a legal agreement between your organization and Anthropic"
echo "  that cannot be automated via CLI or API - it requires human consent"
echo "  in the Google Cloud Console."
echo ""
echo -e "${GREEN}Good news:${NC} This is a one-time setup per project!"
echo "  Once enabled, Claude models remain available permanently."
echo ""
echo -e "${YELLOW}Steps to enable Claude models:${NC}"
echo ""
echo "  1. Visit the Anthropic Model Garden page"
echo "  2. Click on each Claude model you want to use:"
echo "     - Claude 4.5 Haiku"
echo "     - Claude 4.5 Sonnet" 
echo "     - Claude 4.5 Opus"
echo "  3. Click 'Enable' and accept the Anthropic terms of service"
echo ""

ANTHROPIC_URL="https://console.cloud.google.com/vertex-ai/publishers/anthropic/model-garden?project=$PROJECT_ID"

# Offer to open browser
echo -e "URL: ${BLUE}${ANTHROPIC_URL}${NC}"
echo ""
read -p "Open this URL in your browser now? (y/N) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    if command -v open &> /dev/null; then
        open "$ANTHROPIC_URL"
        print_step "Opened in browser"
    elif command -v xdg-open &> /dev/null; then
        xdg-open "$ANTHROPIC_URL"
        print_step "Opened in browser"
    else
        print_warning "Could not detect browser opener. Please visit the URL manually."
    fi
fi

# Summary
print_header "Setup Complete!"

echo "Summary:"
echo "  Project:         $PROJECT_ID"
echo "  Service Account: $SA_EMAIL"
echo "  Key Location:    $KEY_PATH"
echo ""
echo "Next steps:"
echo "  1. Enable Anthropic models in Model Garden (if not done already)"
echo "  2. Launch Cortex Agent and select 'Vertex AI' endpoint"
echo ""
echo "Console links:"
echo -e "  Model Garden:  ${BLUE}https://console.cloud.google.com/vertex-ai/model-garden?project=$PROJECT_ID${NC}"
echo -e "  Anthropic:     ${BLUE}${ANTHROPIC_URL}${NC}"
echo -e "  IAM:           ${BLUE}https://console.cloud.google.com/iam-admin/iam?project=$PROJECT_ID${NC}"
echo ""

