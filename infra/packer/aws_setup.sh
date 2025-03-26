#!/bin/bash

echo "Creating non-login user csye6225..."
sudo groupadd -f csye6225
sudo useradd -r -M -g csye6225 -s /usr/sbin/nologin csye6225

echo "Updating system and installing prerequisites..."
sudo apt-get update -y
sudo apt-get install -y curl unzip jq python3-pip wget snapd

# Ubuntu-specific SSM Agent installation
echo "Installing SSM Agent for Ubuntu..."
sudo apt-get update
sudo snap install amazon-ssm-agent --classic
sudo snap start amazon-ssm-agent
sudo systemctl enable snap.amazon-ssm-agent.amazon-ssm-agent.service
sudo systemctl start snap.amazon-ssm-agent.amazon-ssm-agent.service

# Verify SSM Agent installation and status
if systemctl list-unit-files | grep -q snap.amazon-ssm-agent; then
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
  echo "SSM Agent service not found. Installation may have failed."
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

# Install StatsD for metrics collection
echo "Installing StatsD for metrics collection..."
sudo apt-get install -y git build-essential
git clone https://github.com/statsd/statsd.git /tmp/statsd
sudo mkdir -p /opt/statsd
sudo cp -r /tmp/statsd/* /opt/statsd/
rm -rf /tmp/statsd

# Make sure Node.js is installed
echo "Checking for Node.js installation..."
if ! command -v node &> /dev/null; then
  echo "Node.js not found. Installing Node.js..."
  # For Ubuntu/Debian
  curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
  sudo apt-get install -y nodejs

  # Verify installation
  if command -v node &> /dev/null; then
    echo "Node.js installed successfully: $(node --version)"
  else
    echo "ERROR: Node.js installation failed. StatsD may not work properly."
  fi
else
  echo "Node.js is already installed: $(node --version)"
fi

# Create StatsD config file - FIX: Use the correct backend name
sudo tee /opt/statsd/config.js > /dev/null << EOF
{
  port: 8125,
  mgmt_port: 8126,
  percentThreshold: [90, 95, 99],
  flushInterval: 60000,
  backends: ["./backends/console", "aws-cloudwatch-statsd-backend"],
  cloudwatch: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: "${AWS_REGION:-us-east-1}",
    namespace: "WebApp/Metrics",
    dimensions: [
      {
        "InstanceId": "${EC2_INSTANCE_ID}",
        "Environment": "${ENVIRONMENT:-production}"
      }
    ]
  }
}
EOF

# Create StatsD systemd service file
sudo tee /etc/systemd/system/statsd.service > /dev/null << EOF
[Unit]
Description=StatsD metrics collection daemon
After=network.target

[Service]
Type=simple
User=csye6225
Group=csye6225
WorkingDirectory=/opt/statsd
ExecStart=/usr/bin/node /opt/statsd/stats.js /opt/statsd/config.js
Restart=always
RestartSec=10
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=statsd
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

echo "Installing necessary StatsD modules..."
cd /opt/statsd
sudo npm install @aws-sdk/client-cloudwatch
sudo npm install async
sudo npm install aws-cloudwatch-statsd-backend

# Set proper ownership
sudo chown -R csye6225:csye6225 /opt/statsd

# Enable and start StatsD service
sudo systemctl daemon-reload
sudo systemctl enable statsd
sudo systemctl start statsd

# Verify StatsD is running
if systemctl is-active --quiet statsd; then
  echo "StatsD service is running"
else
  echo "Failed to start StatsD. Checking logs..."
  sudo systemctl status statsd
  sudo journalctl -u statsd --no-pager -n 30
fi

# Install CloudWatch Agent for Ubuntu
echo "Installing AWS CloudWatch Agent for Ubuntu..."
# Download the CloudWatch agent package
wget https://s3.amazonaws.com/amazoncloudwatch-agent/ubuntu/amd64/latest/amazon-cloudwatch-agent.deb
# Install the package
sudo dpkg -i amazon-cloudwatch-agent.deb
# Clean up
rm amazon-cloudwatch-agent.deb

# Create a CloudWatch agent configuration file
echo "Creating CloudWatch Agent configuration..."
sudo mkdir -p /opt/aws/amazon-cloudwatch-agent/etc/
sudo tee /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json > /dev/null << 'EOF'
{
  "agent": {
    "metrics_collection_interval": 60,
    "run_as_user": "root"
  },
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [
          {
            "file_path": "/var/log/syslog",
            "log_group_name": "syslog",
            "log_stream_name": "{instance_id}",
            "retention_in_days": 7
          },
          {
            "file_path": "/opt/myapp/logs/*.log",
            "log_group_name": "webapp-logs",
            "log_stream_name": "{instance_id}-{file_name}",
            "retention_in_days": 7
          },
          {
            "file_path": "/opt/myapp/logs/app.log",
            "log_group_name": "webapp-application-logs",
            "log_stream_name": "{instance_id}-application",
            "retention_in_days": 7
          },
          {
            "file_path": "/opt/myapp/logs/error.log",
            "log_group_name": "webapp-error-logs",
            "log_stream_name": "{instance_id}-errors",
            "retention_in_days": 7
          },
          {
            "file_path": "/opt/myapp/logs/access.log",
            "log_group_name": "webapp-access-logs",
            "log_stream_name": "{instance_id}-access",
            "retention_in_days": 7
          }
        ]
      }
    }
  },
  "metrics": {
    "metrics_collected": {
      "statsd": {
        "service_address": ":8125",
        "metrics_collection_interval": 60,
        "metrics_aggregation_interval": 60
      },
      "collectd": {
        "metrics_aggregation_interval": 60
      },
      "disk": {
        "measurement": [
          "used_percent",
          "inodes_free"
        ],
        "metrics_collection_interval": 60,
        "resources": [
          "*"
        ]
      },
      "mem": {
        "measurement": [
          "mem_used_percent",
          "mem_available_percent"
        ],
        "metrics_collection_interval": 60
      },
      "swap": {
        "measurement": [
          "swap_used_percent"
        ],
        "metrics_collection_interval": 60
      },
      "cpu": {
        "resources": [
          "*"
        ],
        "measurement": [
          "cpu_usage_idle",
          "cpu_usage_iowait",
          "cpu_usage_user",
          "cpu_usage_system"
        ],
        "totalcpu": true,
        "metrics_collection_interval": 60
      }
    },
    "append_dimensions": {
      "AutoScalingGroupName": "${aws:AutoScalingGroupName}",
      "ImageId": "${aws:ImageId}",
      "InstanceId": "${aws:InstanceId}",
      "InstanceType": "${aws:InstanceType}"
    },
    "aggregation_dimensions": [
      ["InstanceId"],
      ["AutoScalingGroupName"],
      []
    ]
  }
}
EOF

# Ensure the logs directory exists with proper permissions
sudo mkdir -p /opt/myapp/logs
sudo touch /opt/myapp/logs/app.log
sudo touch /opt/myapp/logs/error.log
sudo touch /opt/myapp/logs/access.log
sudo chown -R csye6225:csye6225 /opt/myapp/logs
sudo chmod -R 750 /opt/myapp/logs

# Enable and start the CloudWatch agent service
echo "Enabling and starting CloudWatch Agent..."
sudo systemctl enable amazon-cloudwatch-agent
sudo systemctl start amazon-cloudwatch-agent

# Verify CloudWatch Agent installation and status
if systemctl list-unit-files | grep -q amazon-cloudwatch-agent; then
  echo "CloudWatch Agent service is installed"

  # Get status
  if systemctl is-active --quiet amazon-cloudwatch-agent; then
    echo "CloudWatch Agent service is running"
  else
    echo "CloudWatch Agent service is installed but not running. Attempting to start..."
    sudo systemctl start amazon-cloudwatch-agent

    # Check again
    if systemctl is-active --quiet amazon-cloudwatch-agent; then
      echo "CloudWatch Agent started successfully"
    else
      echo "Failed to start CloudWatch Agent. Logging service status and journal..."
      sudo systemctl status amazon-cloudwatch-agent
      sudo journalctl -u amazon-cloudwatch-agent --no-pager -n 50
    fi
  fi
else
  echo "WARNING: CloudWatch Agent service not found. Checking for binary..."
  if command -v amazon-cloudwatch-agent-ctl &> /dev/null; then
    echo "CloudWatch Agent binary found. Starting manually..."
    sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a start
  else
    echo "CRITICAL ERROR: CloudWatch Agent binary not found. Installation failed."
  fi
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

# Create a service override to ensure CloudWatch agent and StatsD start together with webapp
echo "Creating service dependencies..."
sudo mkdir -p /etc/systemd/system/webapp.service.d/
sudo chmod 755 /etc/systemd/system/webapp.service.d/
sudo tee /etc/systemd/system/webapp.service.d/override.conf > /dev/null << EOF
[Unit]
After=network.target amazon-cloudwatch-agent.service statsd.service
Wants=amazon-cloudwatch-agent.service statsd.service
EOF

echo "Reloading systemd configuration..."
sudo systemctl daemon-reload
sudo systemctl enable webapp.service

echo "Setup complete! The application will be configured by Terraform user-data at EC2 launch time."