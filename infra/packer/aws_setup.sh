#!/bin/bash

echo "Creating non-login user csye6225..."
sudo groupadd -f csye6225
sudo useradd -r -M -g csye6225 -s /usr/sbin/nologin csye6225

echo "Updating system and installing prerequisites..."
sudo apt-get update -y
sudo apt-get install -y curl unzip jq python3-pip

echo "Installing AWS CLI v2 using the official method..."
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip -q awscliv2.zip
sudo ./aws/install
rm -rf aws awscliv2.zip

# Verify AWS CLI is installed
if ! command -v aws &> /dev/null; then
  echo "ERROR: AWS CLI v2 installation failed. Trying pip installation as fallback..."
  sudo pip3 install awscli --upgrade

  # Verify pip installation
  if ! command -v aws &> /dev/null; then
    echo "CRITICAL ERROR: All AWS CLI installation methods failed. Setup cannot continue."
    exit 1
  else
    echo "AWS CLI installed successfully via pip"
  fi
else
  echo "AWS CLI v2 installed successfully"
  # Output version info for verification
  aws --version
fi

echo "Creating application directory..."
sudo mkdir -p /opt/webapp
sudo mv /tmp/webapp /opt/webapp/
sudo chmod +x /opt/webapp/webapp

echo "Setting ownership of application files..."
sudo chown -R csye6225:csye6225 /opt/webapp
sudo chmod -R 750 /opt/webapp

echo "Setting up systemd services..."
sudo mv /tmp/webapp.service /etc/systemd/system/webapp.service
sudo chmod 644 /etc/systemd/system/webapp.service

# Create necessary directories for webapp service
sudo mkdir -p /etc/systemd/system/webapp.service.d/
sudo chmod 755 /etc/systemd/system/webapp.service.d/

echo "Enabling services to start on boot..."
sudo systemctl daemon-reload
sudo systemctl enable webapp.service

echo "Setup complete! The application will be configured by Terraform user-data at EC2 launch time."