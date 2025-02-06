#!/bin/bash

# The user that will run the application and belong to the application group
APP_USER="webAPIUser"
# The Linux group for managing application resources and permissions
APP_GROUP="webAPIGroup"
# The name of the database to be created and used by the application
DB_NAME="health_check"
# Path to the application archive on the local machine
LOCAL_APP_PATH="./app.zip"
# Directory on the local server where the application will be deployed
LOCAL_APP_DIR="/opt/csye6225"

# Function to check if 'unzip' is installed and install it if necessary
validate_unzip_package() {
    if ! command -v unzip &> /dev/null; then
        echo "'unzip' could not be found. Installing..."
        sudo apt update -y
        sudo apt install unzip -y
    else
        echo "'unzip' is already installed."
    fi
}

# Update and upgrade packages to ensure the system is up-to-date
echo "Updating package lists and upgrading packages..."
sudo apt update && sudo apt upgrade -y

# Check if 'unzip' is installed and install it if needed
echo "Checking if 'unzip' is installed..."
validate_unzip_package

# Install MySQL server
echo "Installing MySQL Server..."
sudo apt install mysql-server -y

# Start and enable the MySQL service to run on boot
echo "Starting and enabling MySQL service..."
sudo systemctl enable --now mysql

# Create the specified database
echo "Creating database $DB_NAME..."
sudo mysql -e "CREATE DATABASE IF NOT EXISTS $DB_NAME;"

# Create a Linux group for managing application permissions
echo "Creating Linux group: $APP_GROUP..."
sudo groupadd -f $APP_GROUP

# Create a user for the application and add it to the application group
echo "Creating user: $APP_USER and adding to group $APP_GROUP..."
sudo useradd -m -g $APP_GROUP -s /bin/bash $APP_USER || echo "User already exists"

# Set up the application
echo "Unzipping application from $LOCAL_APP_PATH..."
sudo mkdir -p "$LOCAL_APP_DIR"
sudo unzip -o "$LOCAL_APP_PATH" -d "LOCAL_APP_DIR"
sudo chown -R $APP_USER:$APP_GROUP $LOCAL_APP_DIR
sudo chmod -R 750 $LOCAL_APP_DIR

# Indicate that the setup process has completed successfully
echo "Setup completed!"
