#!/bin/bash

echo "Creating non-login user csye6225..."
sudo groupadd -f csye6225
sudo useradd -r -M -g csye6225 -s /usr/sbin/nologin csye6225

echo "Updating system and installing prerequisites..."
sudo apt-get update -y
sudo apt-get install -y curl unzip jq python3-pip wget

# More robust SSM Agent installation
echo "Installing SSM Agent using recommended AWS methods..."
# Amazon Linux 2/Amazon Linux 2023
if grep -q "Amazon Linux" /etc/os-release 2>/dev/null; then
  echo "Detected Amazon Linux, installing SSM Agent..."
  sudo yum install -y amazon-ssm-agent
  sudo systemctl enable amazon-ssm-agent
  sudo systemctl start amazon-ssm-agent
# Ubuntu
elif grep -q "Ubuntu" /etc/os-release 2>/dev/null; then
  echo "Detected Ubuntu, installing SSM Agent..."
  sudo apt-get update
  sudo apt-get install -y snapd
  sudo snap install amazon-ssm-agent --classic
  sudo snap start amazon-ssm-agent
  sudo systemctl enable snap.amazon-ssm-agent.amazon-ssm-agent.service || true
  sudo systemctl start snap.amazon-ssm-agent.amazon-ssm-agent.service || true
# RHEL 8/9 or CentOS
elif grep -q "Red Hat" /etc/os-release 2>/dev/null || grep -q "CentOS" /etc/os-release 2>/dev/null; then
  echo "Detected RHEL/CentOS, installing SSM Agent..."
  sudo yum install -y https://s3.amazonaws.com/ec2-downloads-windows/SSMAgent/latest/linux_amd64/amazon-ssm-agent.rpm
  sudo systemctl enable amazon-ssm-agent
  sudo systemctl start amazon-ssm-agent
# Debian
elif grep -q "Debian" /etc/os-release 2>/dev/null; then
  echo "Detected Debian, installing SSM Agent..."
  sudo apt-get update
  sudo apt-get install -y wget
  wget https://s3.amazonaws.com/ec2-downloads-windows/SSMAgent/latest/debian_amd64/amazon-ssm-agent.deb
  sudo dpkg -i amazon-ssm-agent.deb
  sudo systemctl enable amazon-ssm-agent
  sudo systemctl start amazon-ssm-agent
  rm amazon-ssm-agent.deb
else
  echo "Unknown OS, attempting generic Linux installation..."
  # Try multiple methods
  mkdir -p /tmp/ssm
  cd /tmp/ssm
  curl "https://s3.amazonaws.com/ec2-downloads-windows/SSMAgent/latest/linux_amd64/amazon-ssm-agent.rpm" -o amazon-ssm-agent.rpm
  curl "https://s3.amazonaws.com/ec2-downloads-windows/SSMAgent/latest/debian_amd64/amazon-ssm-agent.deb" -o amazon-ssm-agent.deb

  sudo rpm -i amazon-ssm-agent.rpm 2>/dev/null || sudo dpkg -i amazon-ssm-agent.deb 2>/dev/null || true
  sudo systemctl enable amazon-ssm-agent || true
  sudo systemctl start amazon-ssm-agent || true

  cd - > /dev/null
  rm -rf /tmp/ssm
fi

# Verify SSM Agent installation and status
if command -v amazon-ssm-agent &> /dev/null; then
  echo "SSM Agent binary is installed"
else
  echo "SSM Agent binary not found. Checking service status..."
fi

# Check if service exists and is running
if systemctl list-unit-files | grep -q amazon-ssm-agent; then
  echo "SSM Agent service is installed"

  # Get status
  if systemctl is-active --quiet amazon-ssm-agent; then
    echo "SSM Agent service is running"
  else
    echo "SSM Agent service is installed but not running. Attempting to start..."
    sudo systemctl start amazon-ssm-agent

    # Check again
    if systemctl is-active --quiet amazon-ssm-agent; then
      echo "SSM Agent started successfully"
    else
      echo "Failed to start SSM Agent. Logging service status and journal..."
      sudo systemctl status amazon-ssm-agent
      sudo journalctl -u amazon-ssm-agent --no-pager -n 50
    fi
  fi
elif systemctl list-unit-files | grep -q snap.amazon-ssm-agent; then
  echo "SSM Agent snap service is installed"

  # Get status
  if systemctl is-active --quiet snap.amazon-ssm-agent.amazon-ssm-agent.service; then
    echo "SSM Agent snap service is running"
  else
    echo "SSM Agent snap service is installed but not running. Attempting to start..."
    sudo systemctl start snap.amazon-ssm-agent.amazon-ssm-agent.service

    # Check again
    if systemctl is-active --quiet snap.amazon-ssm-agent.amazon-ssm-agent.service; then
      echo "SSM Agent snap service started successfully"
    else
      echo "Failed to start SSM Agent snap service. Logging service status and journal..."
      sudo systemctl status snap.amazon-ssm-agent.amazon-ssm-agent.service
      sudo journalctl -u snap.amazon-ssm-agent.amazon-ssm-agent.service --no-pager -n 50
    fi
  fi
else
  echo "SSM Agent service not found. Last resort installation attempt..."

  # Set region variable with fallback
  AWS_REGION=$(curl -s http://169.254.169.254/latest/dynamic/instance-identity/document | jq -r .region)
  if [ -z "$AWS_REGION" ] || [ "$AWS_REGION" = "null" ]; then
    AWS_REGION="us-east-1"  # Default fallback
    echo "Could not determine region, using default: $AWS_REGION"
  else
    echo "Running in AWS region: $AWS_REGION"
  fi

  # Last resort - try direct download and install
  mkdir -p /tmp/ssm-last
  cd /tmp/ssm-last

  wget https://amazon-ssm-${AWS_REGION}.s3.amazonaws.com/latest/linux_amd64/amazon-ssm-agent.rpm || \
  wget https://amazon-ssm-us-east-1.s3.amazonaws.com/latest/linux_amd64/amazon-ssm-agent.rpm

  if [ -f amazon-ssm-agent.rpm ]; then
    sudo rpm -i amazon-ssm-agent.rpm || sudo yum install -y ./amazon-ssm-agent.rpm || true
  fi

  if ! [ -f amazon-ssm-agent.rpm ]; then
    wget https://amazon-ssm-${AWS_REGION}.s3.amazonaws.com/latest/debian_amd64/amazon-ssm-agent.deb || \
    wget https://amazon-ssm-us-east-1.s3.amazonaws.com/latest/debian_amd64/amazon-ssm-agent.deb

    if [ -f amazon-ssm-agent.deb ]; then
      sudo dpkg -i amazon-ssm-agent.deb || sudo apt-get install -y ./amazon-ssm-agent.deb || true
    fi
  fi

  sudo systemctl enable amazon-ssm-agent || true
  sudo systemctl start amazon-ssm-agent || true

  cd - > /dev/null
  rm -rf /tmp/ssm-last
fi

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

echo "Creating application directories..."
sudo mkdir -p /opt/webapp
sudo mkdir -p /opt/myapp

# Move the webapp from /opt/webapp to /opt/myapp
if [ -f /opt/webapp/webapp ]; then
  echo "Moving webapp from /opt/webapp/webapp to /opt/myapp/..."
  sudo mv /opt/webapp/webapp /opt/myapp/
  sudo chmod +x /opt/myapp/webapp
else
  echo "File /opt/webapp/webapp not found. Checking if webapp is in /tmp..."
  # If the app is in /tmp (from an upload process), move it to /opt/myapp
  if [ -f /tmp/webapp ]; then
    echo "Moving webapp from /tmp/webapp to /opt/myapp/..."
    sudo mv /tmp/webapp /opt/myapp/
    sudo chmod +x /opt/myapp/webapp
  else
    echo "WARNING: webapp executable not found in expected locations."
  fi
fi

echo "Setting ownership of application files..."
sudo chown -R csye6225:csye6225 /opt/webapp
sudo chown -R csye6225:csye6225 /opt/myapp
sudo chmod -R 750 /opt/webapp
sudo chmod -R 750 /opt/myapp

# Ensure the systemd service directory exists
sudo mkdir -p /etc/systemd/system/webapp.service.d/
sudo chmod 755 /etc/systemd/system/webapp.service.d/

echo "Reloading systemd configuration..."
sudo systemctl daemon-reload
sudo systemctl enable webapp.service

echo "Setup complete! The application will be configured by Terraform user-data at EC2 launch time."