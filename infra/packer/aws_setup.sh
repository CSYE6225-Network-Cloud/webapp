#!/bin/bash

echo "Creating non-login user csye6225..."
sudo groupadd -f csye6225
sudo useradd -r -M -g csye6225 -s /usr/sbin/nologin csye6225

echo "Updating system and installing dependencies..."
sudo apt-get update -y
sudo apt-get install -y awscli jq

echo "Creating application directory..."
sudo mkdir -p /opt/webapp
sudo mv /tmp/webapp /opt/webapp/
sudo chmod +x /opt/webapp/webapp

# No longer need to handle user-data-fetcher.sh

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