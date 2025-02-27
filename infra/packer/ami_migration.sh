#!/bin/bash

# Get AWS credentials from environment variables
SOURCE_AWS_ACCESS_KEY="${DEV_AWS_ACCESS_KEY_ID}"
SOURCE_AWS_SECRET_KEY="${DEV_AWS_SECRET_ACCESS_KEY}"
TARGET_AWS_ACCESS_KEY="${DEMO_AWS_ACCESS_KEY_ID}"
TARGET_AWS_SECRET_KEY="${DEMO_AWS_SECRET_ACCESS_KEY}"

# Input Region Details
AWS_REGION="us-east-1"
NEW_AMI_NAME="Copied-csye6225-nodejs-mysql-$(date +%Y%m%d-%H%M%S)"

# Set AWS CLI Profiles for Both Accounts
aws configure set aws_access_key_id $SOURCE_AWS_ACCESS_KEY --profile source-account
aws configure set aws_secret_access_key $SOURCE_AWS_SECRET_KEY --profile source-account
aws configure set region $AWS_REGION --profile source-account

aws configure set aws_access_key_id $TARGET_AWS_ACCESS_KEY --profile target-account
aws configure set aws_secret_access_key $TARGET_AWS_SECRET_KEY --profile target-account
aws configure set region $AWS_REGION --profile target-account

echo "AWS CLI Profiles Configured"

# Get Source Account ID
echo "Getting source account ID..."
SOURCE_ACCOUNT_ID=$(aws sts get-caller-identity \
    --profile source-account \
    --query 'Account' \
    --output text)
echo "Source Account ID: $SOURCE_ACCOUNT_ID"

# Get latest AMI with the name pattern used in packer build
echo "Getting latest AMI ID..."
SOURCE_AMI_ID=$(aws ec2 describe-images \
    --profile source-account \
    --owners $SOURCE_ACCOUNT_ID \
    --filters "Name=name,Values=csye6225-nodejs-mysql-*" \
    --query 'sort_by(Images, &CreationDate)[-1].ImageId' \
    --output text)
echo "Found latest AMI: $SOURCE_AMI_ID"

# Get Target Account ID
echo "🔍 Getting target account ID..."
TARGET_ACCOUNT_ID=$(aws sts get-caller-identity \
    --profile target-account \
    --query 'Account' \
    --output text)
echo "Target Account ID: $TARGET_ACCOUNT_ID"

# Share the AMI with the Target Account
echo "Sharing AMI ($SOURCE_AMI_ID) with target account ($TARGET_ACCOUNT_ID)..."
aws ec2 modify-image-attribute \
    --profile source-account \
    --image-id $SOURCE_AMI_ID \
    --launch-permission "Add=[{UserId=$TARGET_ACCOUNT_ID}]" \
    --region $AWS_REGION

# Get the Snapshot ID of the AMI
echo "Fetching Snapshot ID..."
SNAPSHOT_ID=$(aws ec2 describe-images \
    --profile source-account \
    --image-ids $SOURCE_AMI_ID \
    --region $AWS_REGION \
    --query 'Images[0].BlockDeviceMappings[0].Ebs.SnapshotId' \
    --output text)

echo "Found Snapshot ID: $SNAPSHOT_ID"

# Share the Snapshot with the Target Account
echo "Sharing Snapshot ($SNAPSHOT_ID) with target account ($TARGET_ACCOUNT_ID)..."
aws ec2 modify-snapshot-attribute \
    --profile source-account \
    --snapshot-id $SNAPSHOT_ID \
    --attribute createVolumePermission \
    --operation-type add \
    --user-ids $TARGET_ACCOUNT_ID \
    --region $AWS_REGION

# Copy the AMI to the Target Account
echo "Copying AMI to target account..."
TARGET_AMI_ID=$(aws ec2 copy-image \
    --profile target-account \
    --source-image-id $SOURCE_AMI_ID \
    --source-region $AWS_REGION \
    --region $AWS_REGION \
    --name "$NEW_AMI_NAME" \
    --query 'ImageId' --output text)

echo "AMI Copy Started: $TARGET_AMI_ID"

# Wait for AMI to be Available
echo "Waiting for AMI ($TARGET_AMI_ID) to be available..."
aws ec2 wait image-available --profile target-account --image-ids $TARGET_AMI_ID --region $AWS_REGION

echo "AMI ($TARGET_AMI_ID) is now available in target account!"

echo "Migration Complete!"