#!/bin/bash

# Configuration Variables
PROJECT_ID="dev-project-452007"
ZONE="us-east1-b"
MACHINE_TYPE="e2-medium"
STORAGE_IMAGE_NAME="custom-nodejs-mysql-1740467739"
TEMP_INSTANCE_NAME="custom-nodejs-temp-vm"
MACHINE_IMAGE_NAME="custom-nodejs-mysql-machine-image"
STORAGE_LOCATION="us"

echo "Step 1: Creating a temporary VM from the storage image..."
gcloud compute instances create $TEMP_INSTANCE_NAME \
  --image=$STORAGE_IMAGE_NAME \
  --image-project=$PROJECT_ID \
  --machine-type=$MACHINE_TYPE \
  --zone=$ZONE \
  --tags=allow-ssh

echo "Waiting for VM to initialize..."
sleep 30  # Wait to ensure the VM is fully initialized

echo "Step 2: Creating a Machine Image from the VM..."
gcloud compute machine-images create $MACHINE_IMAGE_NAME \
  --source-instance=$TEMP_INSTANCE_NAME \
  --source-instance-zone=$ZONE \
  --project=$PROJECT_ID \
  --storage-location=$STORAGE_LOCATION

echo "Step 3: Verifying the Machine Image..."
gcloud compute machine-images list --filter="name=$MACHINE_IMAGE_NAME"

echo "Step 4: Deleting the temporary VM..."
gcloud compute instances delete $TEMP_INSTANCE_NAME --zone=$ZONE --quiet

echo "Done! Your new Machine Image is ready: $MACHINE_IMAGE_NAME"