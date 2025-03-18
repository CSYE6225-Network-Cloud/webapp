#!/bin/bash

# This script is no longer needed as its functionality is now handled by the Terraform user-data.sh
# Keeping this as a placeholder that logs a message and exits successfully

# Log file for backward compatibility
LOG_FILE="/var/log/db-config-fetcher.log"

# Function to log messages
log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" | tee -a $LOG_FILE
}

log "INFO: This script is deprecated. Database configuration is now handled by Terraform userdata.sh"
log "INFO: This script is exiting successfully without making any changes"

# Exit successfully so systemd considers this a successful execution
exit 0