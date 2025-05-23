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
  fi
else
  echo "SSM Agent service not found. Installation may have failed."
fi

echo "Installing AWS CLI v2..."
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip -q awscliv2.zip
sudo ./aws/install
rm -rf aws awscliv2.zip

# Get region and instance ID
AWS_REGION=$(curl -s --connect-timeout 5 http://169.254.169.254/latest/meta-data/placement/region || echo "us-east-1")
EC2_INSTANCE_ID=$(curl -s http://169.254.169.254/latest/meta-data/instance-id || echo "unknown-instance")

echo "Running in AWS region: $AWS_REGION on EC2 instance: $EC2_INSTANCE_ID"

# Install CloudWatch Agent for Ubuntu
echo "Installing AWS CloudWatch Agent for Ubuntu..."
wget https://s3.amazonaws.com/amazoncloudwatch-agent/ubuntu/amd64/latest/amazon-cloudwatch-agent.deb
sudo dpkg -i amazon-cloudwatch-agent.deb
rm amazon-cloudwatch-agent.deb

# Create a CloudWatch agent configuration file with consolidated logging
echo "Creating CloudWatch Agent configuration..."
sudo mkdir -p /opt/aws/amazon-cloudwatch-agent/etc/

# Create the configuration file with unified logs and StatsD metrics
sudo tee /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json > /dev/null << EOF
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
            "log_group_name": "webapp-logs",
            "log_stream_name": "${EC2_INSTANCE_ID}-syslog",
            "retention_in_days": 7
          },
          {
            "file_path": "/opt/myapp/logs/app.log",
            "log_group_name": "webapp-logs",
            "log_stream_name": "${EC2_INSTANCE_ID}-app",
            "retention_in_days": 7
          },
          {
            "file_path": "/opt/myapp/logs/error.log",
            "log_group_name": "webapp-logs",
            "log_stream_name": "${EC2_INSTANCE_ID}-error",
            "retention_in_days": 7
          },
          {
            "file_path": "/opt/myapp/logs/access.log",
            "log_group_name": "webapp-logs",
            "log_stream_name": "${EC2_INSTANCE_ID}-access",
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
      }
    },
    "append_dimensions": {
      "InstanceId": "${EC2_INSTANCE_ID}"
    }
  }
}
EOF

# Verify the configuration file exists
if [ -f /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json ]; then
  echo "CloudWatch Agent configuration file created successfully"
else
  echo "ERROR: Failed to create CloudWatch Agent configuration file - retrying"
  # Retry with direct echo method
  sudo mkdir -p /opt/aws/amazon-cloudwatch-agent/etc/
  sudo bash -c "echo '{\"agent\":{\"metrics_collection_interval\":60,\"run_as_user\":\"root\"},\"logs\":{\"logs_collected\":{\"files\":{\"collect_list\":[{\"file_path\":\"/var/log/syslog\",\"log_group_name\":\"webapp-logs\",\"log_stream_name\":\"${EC2_INSTANCE_ID}-syslog\",\"retention_in_days\":7},{\"file_path\":\"/opt/myapp/logs/app.log\",\"log_group_name\":\"webapp-logs\",\"log_stream_name\":\"${EC2_INSTANCE_ID}-app\",\"retention_in_days\":7},{\"file_path\":\"/opt/myapp/logs/error.log\",\"log_group_name\":\"webapp-logs\",\"log_stream_name\":\"${EC2_INSTANCE_ID}-error\",\"retention_in_days\":7},{\"file_path\":\"/opt/myapp/logs/access.log\",\"log_group_name\":\"webapp-logs\",\"log_stream_name\":\"${EC2_INSTANCE_ID}-access\",\"retention_in_days\":7}]}}},\"metrics\":{\"metrics_collected\":{\"statsd\":{\"service_address\":\":8125\",\"metrics_collection_interval\":60,\"metrics_aggregation_interval\":60}},\"append_dimensions\":{\"InstanceId\":\"${EC2_INSTANCE_ID}\"}}}' > /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json"
fi

# Ensure correct permissions
sudo chmod 644 /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json

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

# Verify status
if systemctl is-active --quiet amazon-cloudwatch-agent; then
  echo "CloudWatch Agent service is running"
else
  echo "Attempting to start CloudWatch Agent with configuration file..."
  sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -s -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json
  sudo systemctl restart amazon-cloudwatch-agent
fi

echo "Creating application directories..."
sudo mkdir -p /opt/webapp
sudo mkdir -p /opt/myapp

# Move the webapp from /opt/webapp to /opt/myapp if it exists
if [ -f /opt/webapp/webapp ]; then
  echo "Moving webapp from /opt/webapp/webapp to /opt/myapp/..."
  sudo mv /opt/webapp/webapp /opt/myapp/
  sudo chmod +x /opt/myapp/webapp
elif [ -f /tmp/webapp ]; then
  echo "Moving webapp from /tmp/webapp to /opt/myapp/..."
  sudo mv /tmp/webapp /opt/myapp/
  sudo chmod +x /opt/myapp/webapp
fi

echo "Setting ownership of application files..."
sudo chown -R csye6225:csye6225 /opt/webapp
sudo chown -R csye6225:csye6225 /opt/myapp
sudo chmod -R 750 /opt/webapp
sudo chmod -R 750 /opt/myapp

# Create a standardized .env file with unified log group settings
echo "Creating environment file with metrics configuration..."
sudo tee /opt/myapp/.env > /dev/null << EOF
# Application Settings
PORT=8080
NODE_ENV=production
LOG_LEVEL=info

# Logging and Metrics Configuration
CLOUDWATCH_GROUP_NAME=webapp-logs
STATSD_HOST=localhost
STATSD_PORT=8125
INSTANCE_ID=${EC2_INSTANCE_ID}
ENABLE_METRICS=true
AWS_REGION=${AWS_REGION}
EOF

# Set proper permissions for the .env file
sudo chmod 640 /opt/myapp/.env
sudo chown csye6225:csye6225 /opt/myapp/.env

# Create a service override for dependencies
echo "Creating service dependencies..."
sudo mkdir -p /etc/systemd/system/webapp.service.d/
sudo chmod 755 /etc/systemd/system/webapp.service.d/
sudo tee /etc/systemd/system/webapp.service.d/override.conf > /dev/null << EOF
[Unit]
After=network.target amazon-cloudwatch-agent.service
Wants=amazon-cloudwatch-agent.service
EOF

echo "Reloading systemd configuration..."
sudo systemctl daemon-reload
sudo systemctl enable webapp.service

# Send a test metric to verify StatsD is working
if command -v netcat >/dev/null 2>&1 || command -v nc >/dev/null 2>&1; then
  echo "Sending test metric to StatsD..."
  echo "test.metric:1|c" | nc -u -w0 127.0.0.1 8125
  echo "test.timer:100|ms" | nc -u -w0 127.0.0.1 8125
else
  echo "Installing netcat for StatsD testing..."
  sudo apt-get install -y netcat
  echo "test.metric:1|c" | nc -u -w0 127.0.0.1 8125
  echo "test.timer:100|ms" | nc -u -w0 127.0.0.1 8125
fi

echo "Setup complete!"