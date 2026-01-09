#!/bin/bash
# setup-vertex-sa.sh - Create a service account for Vertex AI access
#
# Usage: ./setup-vertex-sa.sh PROJECT_ID [SERVICE_ACCOUNT_NAME]
#
# This script creates a Google Cloud service account with the necessary
# permissions to use Vertex AI with Cortex Agent.

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
SA_NAME="${2:-cortex-agent-vertex}"
KEY_FILE="vertex-key.json"

print_header() {
    echo -e "\n${BLUE}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}  Cortex Agent - Vertex AI Service Account Setup${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}\n"
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

# Check arguments
if [ -z "$1" ]; then
    print_header
    echo "Usage: $0 PROJECT_ID [SERVICE_ACCOUNT_NAME]"
    echo ""
    echo "Arguments:"
    echo "  PROJECT_ID           Your Google Cloud project ID (required)"
    echo "  SERVICE_ACCOUNT_NAME Name for the service account (default: cortex-agent-vertex)"
    echo ""
    echo "Example:"
    echo "  $0 my-gcp-project"
    echo "  $0 my-gcp-project my-custom-sa-name"
    exit 1
fi

PROJECT_ID="$1"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

print_header

echo -e "Project ID:      ${YELLOW}${PROJECT_ID}${NC}"
echo -e "Service Account: ${YELLOW}${SA_NAME}${NC}"
echo -e "Key File:        ${YELLOW}${KEY_FILE}${NC}"
echo ""

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    print_error "gcloud CLI is not installed"
    echo "Please install it from: https://cloud.google.com/sdk/docs/install"
    exit 1
fi

print_step "gcloud CLI found"

# Set the project
echo ""
echo "Setting project..."
gcloud config set project "$PROJECT_ID" 2>/dev/null
print_step "Project set to $PROJECT_ID"

# Enable required APIs
echo ""
echo "Enabling required APIs..."
gcloud services enable aiplatform.googleapis.com --quiet 2>/dev/null || true
gcloud services enable compute.googleapis.com --quiet 2>/dev/null || true
print_step "Vertex AI API enabled"

# Check if service account already exists
echo ""
echo "Checking for existing service account..."
if gcloud iam service-accounts describe "$SA_EMAIL" &>/dev/null; then
    print_warning "Service account already exists: $SA_EMAIL"
    read -p "Delete existing keys and create new one? (y/N): " confirm
    if [[ "$confirm" =~ ^[Yy]$ ]]; then
        # Delete existing keys
        for key in $(gcloud iam service-accounts keys list --iam-account="$SA_EMAIL" --format="value(name)" --filter="keyType=USER_MANAGED" 2>/dev/null); do
            gcloud iam service-accounts keys delete "$key" --iam-account="$SA_EMAIL" --quiet 2>/dev/null || true
        done
        print_step "Existing keys deleted"
    else
        echo "Aborting."
        exit 0
    fi
else
    # Create service account
    echo "Creating service account..."
    gcloud iam service-accounts create "$SA_NAME" \
        --display-name="Cortex Agent Vertex AI" \
        --description="Service account for Cortex Agent to access Vertex AI" \
        2>/dev/null
    print_step "Service account created: $SA_EMAIL"
fi

# Grant required roles
echo ""
echo "Granting IAM roles..."

# Vertex AI User
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:$SA_EMAIL" \
    --role="roles/aiplatform.user" \
    --quiet 2>/dev/null || true
print_step "Granted: Vertex AI User (roles/aiplatform.user)"

# Model Garden User (for Claude models via Anthropic)
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:$SA_EMAIL" \
    --role="roles/aiplatform.modelGardenUser" \
    --quiet 2>/dev/null || true
print_step "Granted: Model Garden User (roles/aiplatform.modelGardenUser)"

# Create key file
echo ""
echo "Creating key file..."
if [ -f "$KEY_FILE" ]; then
    print_warning "Key file already exists, backing up to ${KEY_FILE}.bak"
    mv "$KEY_FILE" "${KEY_FILE}.bak"
fi

gcloud iam service-accounts keys create "$KEY_FILE" \
    --iam-account="$SA_EMAIL" \
    2>/dev/null
print_step "Key file created: $KEY_FILE"

# Set permissions on key file
chmod 600 "$KEY_FILE"
print_step "Key file permissions set (600)"

# Generate access token
echo ""
echo "Generating access token..."
gcloud auth activate-service-account --key-file="$KEY_FILE" 2>/dev/null
ACCESS_TOKEN=$(gcloud auth print-access-token 2>/dev/null)

# Print summary
echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Setup Complete!${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${YELLOW}Project ID:${NC}"
echo "  $PROJECT_ID"
echo ""
echo -e "${YELLOW}Service Account:${NC}"
echo "  $SA_EMAIL"
echo ""
echo -e "${YELLOW}Key File:${NC}"
echo "  $(pwd)/$KEY_FILE"
echo ""
echo -e "${YELLOW}Access Token (expires in 1 hour):${NC}"
echo "  ${ACCESS_TOKEN:0:50}..."
echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo "To use in Cortex Agent:"
echo "  1. Open Settings (Menu → Settings)"
echo "  2. Paste the access token in 'API Key'"
echo "  3. Enter '$PROJECT_ID' as 'Project ID'"
echo "  4. Select 'Vertex AI' as the endpoint"
echo ""
echo "To refresh the token later:"
echo "  gcloud auth activate-service-account --key-file=$KEY_FILE"
echo "  gcloud auth print-access-token"
echo ""
echo -e "${RED}IMPORTANT:${NC} Keep $KEY_FILE secure and never commit it to git!"
echo ""

# Add to .gitignore if not already there
if [ -f ".gitignore" ]; then
    if ! grep -q "vertex-key.json" .gitignore; then
        echo "vertex-key.json" >> .gitignore
        print_step "Added $KEY_FILE to .gitignore"
    fi
fi
