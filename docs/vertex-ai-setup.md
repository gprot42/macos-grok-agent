# Vertex AI Service Account Setup

This guide explains how to set up a Google Cloud service account for using Vertex AI with Cortex Agent.

## Prerequisites

- A Google Cloud account with billing enabled
- The `gcloud` CLI installed ([Install Guide](https://cloud.google.com/sdk/docs/install))
- A Google Cloud project with Vertex AI API enabled

## Quick Setup (Automated)

Run the provided script to automatically create a service account:

```bash
./scripts/setup-vertex-sa.sh YOUR_PROJECT_ID
```

This will:
1. Create a service account named `cortex-agent-vertex`
2. Grant the required Vertex AI permissions
3. Generate and download a JSON key file
4. Display the access token for use in Cortex Agent

## Manual Setup

### Step 1: Set Your Project

```bash
export PROJECT_ID="your-project-id"
gcloud config set project $PROJECT_ID
```

### Step 2: Enable Required APIs

```bash
gcloud services enable aiplatform.googleapis.com
gcloud services enable compute.googleapis.com
```

### Step 3: Create Service Account

```bash
gcloud iam service-accounts create cortex-agent-vertex \
    --display-name="Cortex Agent Vertex AI" \
    --description="Service account for Cortex Agent to access Vertex AI"
```

### Step 4: Grant Permissions

```bash
# Grant Vertex AI User role
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:cortex-agent-vertex@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="roles/aiplatform.user"

# Grant Model Garden User role (for Claude models)
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:cortex-agent-vertex@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="roles/aiplatform.modelGardenUser"
```

### Step 5: Create and Download Key

```bash
gcloud iam service-accounts keys create vertex-key.json \
    --iam-account=cortex-agent-vertex@${PROJECT_ID}.iam.gserviceaccount.com
```

### Step 6: Generate Access Token

```bash
# Activate the service account
gcloud auth activate-service-account \
    --key-file=vertex-key.json

# Generate access token
gcloud auth print-access-token
```

## Using in Cortex Agent

1. Open Cortex Agent
2. Click **Menu** → **Settings**
3. In the **API Key** field, paste the access token from the previous step
4. In the **Project ID** field, enter your Google Cloud project ID
5. Select **Vertex AI** as the endpoint

## Token Refresh

Access tokens expire after 1 hour. To refresh:

```bash
gcloud auth print-access-token
```

For automated token refresh, consider using application default credentials:

```bash
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/vertex-key.json"
gcloud auth application-default print-access-token
```

## Available Models on Vertex AI

| Model | Description |
|-------|-------------|
| Claude 4.5 Haiku | Fast and efficient |
| Claude 4.5 Sonnet | Balanced performance |
| Claude 4.5 Opus | Most capable |
| Gemini 2.5 Pro | Advanced multimodal |
| Gemini 2.5 Flash | Fast multimodal |
| Gemini 3 Pro | Next-gen multimodal |
| Gemini 3 Flash | Fast next-gen |

## Troubleshooting

### "Permission denied" errors

Ensure the service account has the correct roles:

```bash
gcloud projects get-iam-policy $PROJECT_ID \
    --flatten="bindings[].members" \
    --format="table(bindings.role)" \
    --filter="bindings.members:cortex-agent-vertex"
```

### "API not enabled" errors

Enable the Vertex AI API:

```bash
gcloud services enable aiplatform.googleapis.com
```

### Token expired

Regenerate the access token:

```bash
gcloud auth print-access-token
```

## Security Best Practices

1. **Rotate keys regularly** - Delete old keys and create new ones monthly
2. **Use least privilege** - Only grant the roles needed
3. **Protect key files** - Never commit key files to version control
4. **Monitor usage** - Check Cloud Console for unexpected API calls

## Cleanup

To remove the service account when no longer needed:

```bash
gcloud iam service-accounts delete \
    cortex-agent-vertex@${PROJECT_ID}.iam.gserviceaccount.com
```
