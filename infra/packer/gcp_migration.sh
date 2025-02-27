#!/bin/bash

### ================================
### Parameter Handling
### ================================

# Default zone value - can be overridden with command line parameter
DEFAULT_ZONE="us-east1-b"
ZONE=${1:-$DEFAULT_ZONE}

# Paths to GCP Service Account JSON Keys using GitHub Actions secrets
DEV_GCP_KEY="gcp-dev-credentials.json"
DEMO_GCP_KEY="gcp-demo-credentials.json"

### ================================
### Extract Project IDs from Credentials
### ================================
echo "Extracting project IDs from credentials..."

# Extract project IDs from credential files
DEV_PROJECT_ID=$(cat $DEV_GCP_KEY | jq -r '.project_id')
DEMO_PROJECT_ID=$(cat $DEMO_GCP_KEY | jq -r '.project_id')

# Extract service account emails
DEV_SERVICE_ACCOUNT=$(cat $DEV_GCP_KEY | jq -r '.client_email')
DEMO_SERVICE_ACCOUNT=$(cat $DEMO_GCP_KEY | jq -r '.client_email')

echo "DEV Project ID: $DEV_PROJECT_ID"
echo "DEMO Project ID: $DEMO_PROJECT_ID"
echo "DEV Service Account: $DEV_SERVICE_ACCOUNT"
echo "DEMO Service Account: $DEMO_SERVICE_ACCOUNT"
echo "Using Zone: $ZONE"

### ================================
### Get Latest Compute Image
### ================================
echo "Finding the latest compute image in DEV project..."

# Authenticate with DEV project
gcloud auth activate-service-account --key-file=$DEV_GCP_KEY
gcloud config set project $DEV_PROJECT_ID

# Get the latest compute image name with "csye6225-nodejs-mysql" prefix
COMPUTE_IMAGE_NAME=$(gcloud compute images list --project=$DEV_PROJECT_ID \
  --filter="name~'csye6225-nodejs-mysql'" \
  --sort-by=~creationTimestamp --limit=1 \
  --format="value(name)")

if [ -z "$COMPUTE_IMAGE_NAME" ]; then
  echo "No compute image found with prefix 'csye6225-nodejs-mysql'. Exiting..."
  exit 1
fi

echo "Found latest compute image: $COMPUTE_IMAGE_NAME"

# Compute Instance Details
MACHINE_TYPE="e2-medium"

# Image & Machine Image Details
TIMESTAMP=$(date +%s)
TEMP_INSTANCE_DEV="temp-vm-dev-${TIMESTAMP}"
TEMP_INSTANCE_DEMO="temp-vm-demo-${TIMESTAMP}"
MACHINE_IMAGE_NAME_DEV="mi-${COMPUTE_IMAGE_NAME}"
MACHINE_IMAGE_NAME_DEMO="mi-demo-${COMPUTE_IMAGE_NAME}"
COPIED_COMPUTE_IMAGE_NAME="copy-${COMPUTE_IMAGE_NAME}"
STORAGE_LOCATION="us"

### ================================
### Step 1: Authenticate with DEV Project
### ================================
echo "Authenticating with GCP DEV Project ($DEV_PROJECT_ID)..."
gcloud auth activate-service-account --key-file=$DEV_GCP_KEY
gcloud config set project $DEV_PROJECT_ID

### ================================
### Step 2: Create a VM from Compute Image in DEV
### ================================
echo "Creating a temporary VM ($TEMP_INSTANCE_DEV) from Compute Image ($COMPUTE_IMAGE_NAME)..."
gcloud compute instances create $TEMP_INSTANCE_DEV \
  --image=$COMPUTE_IMAGE_NAME \
  --image-project=$DEV_PROJECT_ID \
  --machine-type=$MACHINE_TYPE \
  --zone=$ZONE \
  --tags=allow-ssh

echo "Waiting for VM to initialize..."
sleep 15  # Adjust wait time if needed

### ================================
### Step 3: Create a Machine Image in DEV from VM
### ================================
echo "Creating Machine Image ($MACHINE_IMAGE_NAME_DEV) from VM ($TEMP_INSTANCE_DEV)..."
gcloud compute machine-images create $MACHINE_IMAGE_NAME_DEV \
    --source-instance=$TEMP_INSTANCE_DEV \
    --source-instance-zone=$ZONE \
    --project=$DEV_PROJECT_ID \
    --storage-location=$STORAGE_LOCATION

echo "Verifying Machine Image in DEV ($MACHINE_IMAGE_NAME_DEV)..."
gcloud compute machine-images list --project=$DEV_PROJECT_ID --filter="name=$MACHINE_IMAGE_NAME_DEV"

### ================================
### Step 4: Delete Temporary VM in DEV
### ================================
echo "Deleting temporary VM ($TEMP_INSTANCE_DEV)..."
gcloud compute instances delete $TEMP_INSTANCE_DEV --zone=$ZONE --quiet

### ================================
### Step 5: Share Compute Image with DEMO Project
### ================================
echo "Granting DEMO Project ($DEMO_PROJECT_ID) access to Compute Image ($COMPUTE_IMAGE_NAME)..."
gcloud compute images add-iam-policy-binding $COMPUTE_IMAGE_NAME \
    --project=$DEV_PROJECT_ID \
    --member="serviceAccount:$DEMO_SERVICE_ACCOUNT" \
    --role="roles/compute.imageUser"

### ================================
### Step 6: Authenticate with DEMO Project
### ================================
echo "Authenticating with GCP DEMO Project ($DEMO_PROJECT_ID)..."
gcloud auth activate-service-account --key-file=$DEMO_GCP_KEY
gcloud config set project $DEMO_PROJECT_ID

### ================================
### Step 7: Copy Compute Image to DEMO
### ================================
echo "Copying Compute Image ($COMPUTE_IMAGE_NAME) to DEMO Project ($DEMO_PROJECT_ID)..."
gcloud compute images create "$COPIED_COMPUTE_IMAGE_NAME" \
    --source-image="$COMPUTE_IMAGE_NAME" \
    --source-image-project="$DEV_PROJECT_ID" \
    --project="$DEMO_PROJECT_ID"

echo "Verifying Compute Image in DEMO ($COPIED_COMPUTE_IMAGE_NAME)..."
gcloud compute images list --project=$DEMO_PROJECT_ID --filter="name=$COPIED_COMPUTE_IMAGE_NAME"

### **Wait until Compute Image is available**
WAIT_TIME=10
MAX_RETRIES=10
retry=0
while ! gcloud compute images describe $COPIED_COMPUTE_IMAGE_NAME --project=$DEMO_PROJECT_ID &>/dev/null; do
    if [[ $retry -ge $MAX_RETRIES ]]; then
        echo "Compute Image copy failed to appear in DEMO project. Exiting..."
        exit 1
    fi
    echo "⏳ Waiting for Compute Image to be available in DEMO ($WAIT_TIME seconds)..."
    sleep $WAIT_TIME
    ((retry++))
done

### ================================
### Step 8: Create a VM from Copied Compute Image in DEMO
### ================================
echo "Creating a temporary VM ($TEMP_INSTANCE_DEMO) from Copied Compute Image ($COPIED_COMPUTE_IMAGE_NAME)..."
gcloud compute instances create $TEMP_INSTANCE_DEMO \
  --image=$COPIED_COMPUTE_IMAGE_NAME \
  --image-project=$DEMO_PROJECT_ID \
  --machine-type=$MACHINE_TYPE \
  --zone=$ZONE \
  --tags=allow-ssh

echo "Waiting for VM to initialize..."
sleep 15  # Adjust wait time if needed

### ================================
### Step 9: Create a Machine Image in DEMO from VM
### ================================
echo "Creating Machine Image ($MACHINE_IMAGE_NAME_DEMO) from VM ($TEMP_INSTANCE_DEMO)..."
gcloud compute machine-images create $MACHINE_IMAGE_NAME_DEMO \
    --source-instance=$TEMP_INSTANCE_DEMO \
    --source-instance-zone=$ZONE \
    --project=$DEMO_PROJECT_ID \
    --storage-location=$STORAGE_LOCATION

echo "🔍 Verifying Machine Image in DEMO ($MACHINE_IMAGE_NAME_DEMO)..."
gcloud compute machine-images list --project=$DEMO_PROJECT_ID --filter="name=$MACHINE_IMAGE_NAME_DEMO"

### ================================
### Step 10: Delete Temporary VM in DEMO
### ================================
echo "Deleting temporary VM ($TEMP_INSTANCE_DEMO)..."
gcloud compute instances delete $TEMP_INSTANCE_DEMO --zone=$ZONE --quiet

echo "Machine Image successfully created in both DEV and DEMO projects!"